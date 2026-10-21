import { createChallenge, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import type { Challenge, Payload } from 'altcha-lib/types';
import { describe, expect, it } from 'vitest';
import type { Failure } from '../checkout.machine';
import { CHALLENGE_ATTEMPT_LIMIT, createAltchaChallenge, REFRESH_MARGIN_MS } from './altcha';

// the node pool, and the deployment's side played by altcha-lib itself: every challenge here is
// one the app's own issuer would mint (`createAltcha` in packages/app/src/lib/server/api/altcha.ts,
// at a cost a spec solves in a few milliseconds), and every payload is checked by the library's own
// verifier under the secret it was signed with. a payload this adapter shapes wrongly fails here
// the way it would fail at the endpoint.

const SECRET = 'spec-signature-secret';
const URL = 'https://give.example.org/api/v1/forms/frm_a8x2k9/challenge';

function issue(expiresAt = Math.floor(Date.now() / 1000) + 20 * 60): Promise<Challenge> {
	return createChallenge({
		algorithm: 'PBKDF2/SHA-256',
		cost: 10,
		keyPrefix: '0',
		deriveKey,
		expiresAt,
		hmacSignatureSecret: SECRET
	});
}

function verifies(payload: string): Promise<boolean> {
	const { challenge, solution } = JSON.parse(atob(payload)) as Payload;
	return verifySolution({ challenge, solution, deriveKey, hmacSignatureSecret: SECRET }).then(
		(result) => result.verified
	);
}

/** a challenge endpoint that answers each read with the next of `answers`, recording each url. */
function endpoint(answers: ReadonlyArray<() => Promise<Response>>) {
	const asked: string[] = [];
	const fetch = (input: RequestInfo | URL): Promise<Response> => {
		asked.push(String(input));
		const answer = answers[Math.min(asked.length - 1, answers.length - 1)];
		if (answer === undefined) throw new Error('no answer');
		return answer();
	};
	return { asked, fetch: fetch as typeof globalThis.fetch };
}

const fresh = () => issue().then((challenge) => Response.json(challenge));
const unreachable = () => Promise.reject(new TypeError('Failed to fetch'));

/** a timer that never runs on its own, so a spec decides when each wait is over. */
function manualDelay() {
	const pending: Array<{ run: () => void; ms: number }> = [];
	const delay = (run: () => void, ms: number) => {
		const entry = { run, ms };
		pending.push(entry);
		return () => {
			const at = pending.indexOf(entry);
			if (at !== -1) pending.splice(at, 1);
		};
	};
	const fire = () => {
		for (const entry of pending.splice(0)) entry.run();
	};
	return { delay, pending, fire };
}

function until(check: () => boolean): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const poll = () => {
			if (check()) resolve();
			else if (Date.now() - started > 5_000) reject(new Error('timed out'));
			else setTimeout(poll, 1);
		};
		poll();
	});
}

describe('an ALTCHA challenge solved in the background', () => {
	it('reads a challenge from the address it was handed and passes on a payload that verifies', async () => {
		const { asked, fetch } = endpoint([fresh]);
		const tokens: string[] = [];
		createAltchaChallenge(
			URL,
			(token) => tokens.push(token),
			() => {},
			{ fetch }
		);

		await until(() => tokens.length === 1);

		expect(asked).toEqual([URL]);
		expect(await verifies(tokens[0] ?? '')).toBe(true);
	});

	// a payload is spent by the send it rode on, honoured or refused, so the one after it is solved
	// from a challenge read afresh rather than from the one just spent.
	it('solves a fresh challenge on reset', async () => {
		const { asked, fetch } = endpoint([fresh]);
		const tokens: string[] = [];
		const challenge = createAltchaChallenge(
			URL,
			(token) => tokens.push(token),
			() => {},
			{
				fetch
			}
		);
		await until(() => tokens.length === 1);

		challenge.reset();
		await until(() => tokens.length === 2);

		expect(asked).toHaveLength(2);
		expect(tokens[1]).not.toBe(tokens[0]);
		expect(await verifies(tokens[1] ?? '')).toBe(true);
	});

	it('hands over nothing once stopped, even from a solve already under way', async () => {
		let answer: (response: Response) => void = () => {};
		const { fetch } = endpoint([() => new Promise((resolve) => (answer = resolve))]);
		const tokens: string[] = [];
		const challenge = createAltchaChallenge(
			URL,
			(token) => tokens.push(token),
			() => {},
			{
				fetch
			}
		);

		challenge.stop();
		answer(Response.json(await issue()));
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(tokens).toEqual([]);
	});

	// a reset lands while the solve before it is still running, whenever the donor's press is quicker
	// than the work — and that earlier solve's payload is the one the press already spent.
	it('passes on only the solve the latest reset started', async () => {
		const answers: Array<(response: Response) => void> = [];
		const { fetch } = endpoint([() => new Promise((resolve) => answers.push(resolve))]);
		const tokens: string[] = [];
		const challenge = createAltchaChallenge(
			URL,
			(token) => tokens.push(token),
			() => {},
			{
				fetch
			}
		);

		challenge.reset();
		await until(() => answers.length === 2);
		answers[0]?.(Response.json(await issue()));
		answers[1]?.(Response.json(await issue()));
		await until(() => tokens.length === 1);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(tokens).toHaveLength(1);
	});
});

describe('an ALTCHA challenge that cannot be read', () => {
	// one dropped request is a blip the next attempt fixes, and reporting it would take a donation
	// form down over a moment that had already passed.
	it('tries again after a read that failed, and reports nothing once one succeeds', async () => {
		const { asked, fetch } = endpoint([unreachable, fresh]);
		const { delay, pending, fire } = manualDelay();
		const tokens: string[] = [];
		const failures: Failure[] = [];
		createAltchaChallenge(
			URL,
			(token) => tokens.push(token),
			(f) => failures.push(f),
			{
				fetch,
				delay
			}
		);

		await until(() => pending.length === 1);
		fire();
		await until(() => tokens.length === 1);

		expect(asked).toHaveLength(2);
		expect(failures).toEqual([]);
	});

	it.each([
		{ label: 'a request that never completes', answer: unreachable },
		{
			label: 'a refusal',
			answer: () =>
				Promise.resolve(Response.json({ message: 'Too many requests.' }, { status: 429 }))
		},
		{
			label: 'a body that is not a challenge',
			answer: () => Promise.resolve(Response.json({ hello: 'world' }))
		}
	])(
		`reports $label after ${CHALLENGE_ATTEMPT_LIMIT} attempts in a row, naming the address`,
		async ({ answer }) => {
			const { asked, fetch } = endpoint([answer]);
			const { delay, pending, fire } = manualDelay();
			const failures: Failure[] = [];
			createAltchaChallenge(
				URL,
				() => {},
				(f) => failures.push(f),
				{ fetch, delay }
			);

			for (let attempt = 1; attempt < CHALLENGE_ATTEMPT_LIMIT; attempt++) {
				await until(() => pending.length === 1);
				expect(failures).toEqual([]);
				fire();
			}
			await until(() => failures.length === 1);

			expect(asked).toHaveLength(CHALLENGE_ATTEMPT_LIMIT);
			expect(failures[0]?.message).toMatch(/nothing was charged/);
			expect(failures[0]?.fix).toContain(URL);
		}
	);

	it('reports nothing for a read the element stopped', async () => {
		const fetch = ((_: unknown, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () =>
					reject(new DOMException('aborted', 'AbortError'))
				);
			})) as typeof globalThis.fetch;
		const { delay, pending } = manualDelay();
		const failures: Failure[] = [];
		const challenge = createAltchaChallenge(
			URL,
			() => {},
			(f) => failures.push(f),
			{
				fetch,
				delay
			}
		);

		challenge.stop();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(failures).toEqual([]);
		expect(pending).toEqual([]);
	});
});

describe('an ALTCHA payload kept live', () => {
	// a challenge lasts twenty minutes, and a donor who leaves the tab open past that still presses
	// with a payload the endpoint accepts — the job `refresh-expired` does for a Turnstile token.
	it('solves a fresh challenge shortly before the one it holds expires', async () => {
		const expiresAt = Math.floor(Date.now() / 1000) + 20 * 60;
		const { asked, fetch } = endpoint([
			() => issue(expiresAt).then((challenge) => Response.json(challenge)),
			fresh
		]);
		const { delay, pending, fire } = manualDelay();
		const tokens: string[] = [];
		const before = Date.now();
		createAltchaChallenge(
			URL,
			(token) => tokens.push(token),
			() => {},
			{ fetch, delay }
		);

		await until(() => tokens.length === 1);
		const wait = pending[0]?.ms ?? 0;
		expect(wait).toBeLessThanOrEqual(expiresAt * 1000 - before - REFRESH_MARGIN_MS);
		expect(wait).toBeGreaterThanOrEqual(expiresAt * 1000 - Date.now() - REFRESH_MARGIN_MS);

		fire();
		await until(() => tokens.length === 2);
		expect(asked).toHaveLength(2);
	});

	it('takes the refresh down with it when stopped', async () => {
		const { fetch } = endpoint([fresh]);
		const { delay, pending } = manualDelay();
		const tokens: string[] = [];
		const challenge = createAltchaChallenge(
			URL,
			(token) => tokens.push(token),
			() => {},
			{
				fetch,
				delay
			}
		);
		await until(() => tokens.length === 1);

		challenge.stop();

		expect(pending).toEqual([]);
	});
});
