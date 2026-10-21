// the anti-abuse adapter for a deployment whose spam check is ALTCHA: a proof of work, read from
// the deployment and solved here, behind the same `FormChallenge` ./turnstile.ts answers with.
//
// nothing is drawn. the challenge is fetched and solved in the background while the donor fills
// the form in, and the solved payload reaches the flow through `onToken` exactly as a Turnstile
// token does, so the donor is never shown a puzzle and the card reserves no space for one.
//
// solved with altcha-lib's own solver and its WebCrypto PBKDF2, rather than with ALTCHA's widget
// package. the widget draws a checkbox, injects its own stylesheet and starts its solvers as blob
// workers, so on a stranger's page it asks their policy for `worker-src blob:` and a style
// allowance, and puts a control in front of the donor. `crypto.subtle.deriveBits` is asynchronous
// and runs off the page's thread already, so the solve needs no worker, no WASM and nothing in a
// Content-Security-Policy beyond the `connect-src` the deployment origin already needs (README →
// Content-Security-Policy).
//
// the payload is the one the widget submits — base64 of `{ challenge, solution }` — because that is
// the shape the endpoint verifies (`createAltcha` in packages/app/src/lib/server/api/altcha.ts).

import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/web/pbkdf2';
import type { Challenge, Solution } from 'altcha-lib/types';
import type { Failure } from '../checkout.machine';
import type { FormChallenge } from '../element';
import { UNCHALLENGEABLE } from './turnstile';

/**
 * how many reads in a row may fail before the form says no payload is coming.
 *
 * exported so a spec asserts the boundary rather than a number copied out of this file. one failed
 * read is a blip the next fixes, and reporting it would take the form down over it; three, spaced
 * by `RETRY_DELAY_MS`, is a deployment this page cannot reach.
 */
export const CHALLENGE_ATTEMPT_LIMIT = 3;

/** how long after a failed read the next is made. */
export const RETRY_DELAY_MS = 2_000;

/**
 * how long before a held challenge expires the next is solved.
 *
 * a minute because a solve takes a second or two on a slow phone, and a payload is only worth
 * holding while the endpoint will still accept it.
 */
export const REFRESH_MARGIN_MS = 60_000;

/** the timer a retry and a refresh are armed on, returning the cancel for it. */
type Delay = (run: () => void, ms: number) => () => void;

/** what a spec replaces: the network and the timer. */
export type AltchaSeam = {
	readonly fetch?: typeof fetch;
	readonly delay?: Delay;
};

const defaultDelay: Delay = (run, ms) => {
	const timer = setTimeout(run, ms);
	return () => clearTimeout(timer);
};

/**
 * one background solve after another, each handing its payload to `onToken`.
 *
 * `challengeUrl` is absolute: the served path resolved against the address the config was read
 * from, which only the caller knows (`createChallenge` in ./challenge.ts).
 *
 * a solve is started at once, again on every `reset`, and again shortly before the challenge it
 * solved expires. only the latest one hands anything over: each runs under its own abort, and
 * whatever starts the next aborts the one before it, so a payload from a solve a reset overtook —
 * the one the press just spent — never reaches the flow.
 */
export function createAltchaChallenge(
	challengeUrl: string,
	onToken: (token: string) => void,
	onUnavailable: (failure: Failure) => void,
	seam?: AltchaSeam
): FormChallenge {
	const read = seam?.fetch ?? fetch;
	const delay = seam?.delay ?? defaultDelay;
	/** the solve under way, aborted by whatever replaces it: a reset, a refresh, or a stop. */
	let current = new AbortController();
	/** the cancel for the retry or refresh armed by the solve under way. */
	let disarm: () => void = () => {};

	const unavailable = (fix: string): void => onUnavailable({ message: UNCHALLENGEABLE, fix });

	async function readChallenge(signal: AbortSignal): Promise<Challenge | null> {
		const response = await read(challengeUrl, {
			signal,
			credentials: 'omit',
			headers: { accept: 'application/json' }
		});
		if (!response.ok) return null;
		return asChallenge(await response.json());
	}

	async function solve(controller: AbortController, attempt: number): Promise<void> {
		const { signal } = controller;
		const challenge = await readChallenge(signal).catch(() => null);
		if (signal.aborted) return;
		if (challenge === null) {
			if (attempt >= CHALLENGE_ATTEMPT_LIMIT) unavailable(unreadableFix(challengeUrl));
			else disarm = delay(() => void solve(controller, attempt + 1), RETRY_DELAY_MS);
			return;
		}

		// the solver throws on parameters it cannot work with — an algorithm other than PBKDF2, a
		// prefix that is not hex — and returns null on its own timeout.
		const solution = await solveChallenge({ challenge, deriveKey, controller }).catch(() => null);
		// checked after the solve as well as by it: the solver only looks at the signal between
		// attempts, so one that finds its answer on the attempt a reset lands in still returns it.
		if (signal.aborted) return;
		if (solution === null) {
			unavailable(unsolvableFix(challengeUrl));
			return;
		}
		onToken(payloadOf(challenge, solution));

		const { expiresAt } = challenge.parameters;
		if (expiresAt !== undefined) {
			disarm = delay(start, Math.max(0, expiresAt * 1000 - Date.now() - REFRESH_MARGIN_MS));
		}
	}

	function start(): void {
		current.abort();
		disarm();
		current = new AbortController();
		void solve(current, 1);
	}

	start();
	return {
		reset: start,
		stop: () => {
			current.abort();
			disarm();
		}
	};
}

/** a body read as a challenge, or nothing where it carries no parameters to solve. */
function asChallenge(body: unknown): Challenge | null {
	if (typeof body !== 'object' || body === null) return null;
	const { parameters } = body as { parameters?: unknown };
	return typeof parameters === 'object' && parameters !== null ? (body as Challenge) : null;
}

/** the payload ALTCHA's widget submits: base64 of the challenge as issued and its solution. */
function payloadOf(challenge: Challenge, solution: Solution): string {
	const { parameters, signature } = challenge;
	return btoa(JSON.stringify({ challenge: { parameters, signature }, solution }));
}

function unreadableFix(url: string): string {
	return (
		`The form reads its security check from ${url}, and ${CHALLENGE_ATTEMPT_LIMIT} reads in a ` +
		'row did not return a challenge. Check that this page can reach the deployment: a ' +
		'Content-Security-Policy needs the deployment origin in connect-src, and the deployment ' +
		'must be up and serving this form.'
	);
}

function unsolvableFix(url: string): string {
	return (
		`The security check read from ${url} could not be solved in this browser. The challenge ` +
		'names an algorithm or a cost this form does not solve, so check that the deployment and the ' +
		'form script it serves are the same release.'
	);
}
