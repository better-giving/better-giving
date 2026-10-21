import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import type { Challenge } from 'altcha-lib/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALTCHA_LIFETIME_SECONDS, createAltcha } from './altcha';

// the proof of work the donation form solves where no Turnstile pair is set. each case solves a real
// challenge with the library's own solver, the one the widget runs, so a payload here is a payload a
// browser would send.

async function solve(challenge: Challenge): Promise<string> {
	const solution = await solveChallenge({ challenge, deriveKey });
	if (solution === null) throw new Error('the challenge did not solve');
	return btoa(JSON.stringify({ challenge, solution }));
}

afterEach(() => {
	vi.useRealTimers();
});

describe('verify', () => {
	it('accepts a solved challenge it issued', async () => {
		const altcha = createAltcha();
		const payload = await solve(await altcha.challenge());

		expect(await altcha.verify(payload)).toEqual({ ok: true });
	});

	it('refuses a wrong solution', async () => {
		const altcha = createAltcha();
		const challenge = await altcha.challenge();
		const payload = btoa(
			JSON.stringify({ challenge, solution: { counter: 1, derivedKey: '00'.repeat(32) } })
		);

		expect(await altcha.verify(payload)).toMatchObject({ ok: false, reason: 'rejected' });
	});

	it('refuses the same solution a second time', async () => {
		const altcha = createAltcha();
		const payload = await solve(await altcha.challenge());

		expect(await altcha.verify(payload)).toEqual({ ok: true });
		expect(await altcha.verify(payload)).toMatchObject({ ok: false, reason: 'rejected' });
	});

	it('refuses a solution submitted twice at once, once', async () => {
		const altcha = createAltcha();
		const payload = await solve(await altcha.challenge());

		const answers = await Promise.all([altcha.verify(payload), altcha.verify(payload)]);
		expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
	});

	it('refuses a challenge past its lifetime', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const altcha = createAltcha();
		const payload = await solve(await altcha.challenge());

		vi.setSystemTime(Date.now() + (ALTCHA_LIFETIME_SECONDS + 1) * 1000);
		expect(await altcha.verify(payload)).toMatchObject({ ok: false, reason: 'rejected' });
	});

	it('refuses a challenge another process issued', async () => {
		const payload = await solve(await createAltcha().challenge());

		expect(await createAltcha().verify(payload)).toMatchObject({ ok: false, reason: 'rejected' });
	});

	it.each([
		['no payload', undefined],
		['a payload that is not base64 JSON', 'not a payload'],
		['a payload of the wrong shape', btoa(JSON.stringify({ challenge: 1, solution: 2 }))],
		['an oversized payload', 'a'.repeat(10_000)]
	])('refuses %s', async (_, payload) => {
		expect(await createAltcha().verify(payload)).toMatchObject({ ok: false, reason: 'rejected' });
	});
});
