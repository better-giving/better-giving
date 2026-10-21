// the proof of work `/api/v1` owes a submission on a deployment holding no Turnstile pair: ALTCHA,
// self-hosted, issued and verified in this process with no account anywhere (./challenge.ts picks
// which check runs).
//
// one instance per process, built at start beside the rate limiters (../runtime/env.ts) and never at
// module scope. its two secrets are random per process and live nowhere else, and that is what makes
// the in-memory replay set below airtight on one container (AGENTS.md → Storage): a challenge issued
// before a restart was signed with a key the new process never held, so it is refused rather than
// spent a second time against a set that forgot it. the cost is a donor mid-form across a restart
// solving one more challenge.
//
// the challenge is not bound to a form. solving one costs the same whichever form asked, and the
// submission it rides on is re-read against its own form record anyway.

import { createChallenge, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import type { Challenge, Payload } from 'altcha-lib/types';

/** how long an issued challenge may be solved and submitted in. */
export const ALTCHA_LIFETIME_SECONDS = 20 * 60;

/**
 * the work: PBKDF2-SHA256 at 5,000 iterations per attempt, against a one-byte key prefix, so about
 * 256 attempts on average. issuing derives nothing, so a flood of challenge reads costs this process
 * one HMAC each; verifying derives one key, behind the quote endpoint's own bucket.
 */
const ALGORITHM = 'PBKDF2/SHA-256';
const COST = 5_000;
const KEY_PREFIX = '00';

/** a payload is a challenge and its solution, base64 JSON; a few hundred bytes from the widget. */
const MAX_PAYLOAD_LENGTH = 4_096;

export type AltchaResult =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly reason: 'rejected';
			readonly detail: string;
			readonly operatorFix: null;
	  };

export interface Altcha {
	/** a fresh signed challenge, the body `GET /api/v1/forms/{id}/challenge` answers with. */
	challenge(): Promise<Challenge>;
	/** checks `payload` and spends it: one challenge clears one submission. never throws. */
	verify(payload: string | undefined): Promise<AltchaResult>;
}

export function createAltcha(): Altcha {
	const signatureSecret = randomSecret();
	/** each spent challenge's nonce, held until its challenge expires and no longer. */
	const spent = new Map<string, number>();

	function spend(nonce: string, expiresAt: number): boolean {
		const now = Date.now() / 1000;
		for (const [held, until] of spent) if (until < now) spent.delete(held);
		if (spent.has(nonce)) return false;
		spent.set(nonce, expiresAt);
		return true;
	}

	return {
		challenge: () =>
			createChallenge({
				algorithm: ALGORITHM,
				cost: COST,
				keyPrefix: KEY_PREFIX,
				deriveKey,
				expiresAt: Math.floor(Date.now() / 1000) + ALTCHA_LIFETIME_SECONDS,
				hmacSignatureSecret: signatureSecret
			}),

		async verify(raw) {
			const payload = parsePayload(raw);
			if (payload === null) {
				return rejected(
					'No ALTCHA solution accompanied this submission. Solve the challenge from ' +
						'`GET /api/v1/forms/{formId}/challenge` and send the payload as `altchaPayload`.'
				);
			}

			let verified: boolean;
			let expired = false;
			try {
				const result = await verifySolution({
					challenge: payload.challenge,
					solution: payload.solution,
					deriveKey,
					hmacSignatureSecret: signatureSecret
				});
				verified = result.verified;
				expired = result.expired;
			} catch {
				// the library throws on parameters it cannot read, which a stranger's payload can carry.
				verified = false;
			}
			if (expired) {
				return rejected(
					'This ALTCHA challenge has expired. Solve a fresh one and send its payload as ' +
						'`altchaPayload`.'
				);
			}
			if (!verified) {
				return rejected(
					'This ALTCHA solution is not one this deployment issued and accepts. Solve a fresh ' +
						'challenge and send its payload as `altchaPayload`.'
				);
			}

			// verified implies a signed `expiresAt`, since every challenge issued above carries one.
			const { nonce, expiresAt = 0 } = payload.challenge.parameters;
			if (!spend(nonce, expiresAt)) {
				return rejected(
					'This ALTCHA solution was already used. A challenge clears one submission, so solve ' +
						'a fresh one and send its payload as `altchaPayload`.'
				);
			}
			return { ok: true };
		}
	};
}

/** the widget's payload, or null where it is absent, oversized or not base64 JSON of that shape. */
function parsePayload(raw: string | undefined): Payload | null {
	if (raw === undefined || raw.length === 0 || raw.length > MAX_PAYLOAD_LENGTH) return null;
	let decoded: unknown;
	try {
		decoded = JSON.parse(atob(raw));
	} catch {
		return null;
	}
	if (typeof decoded !== 'object' || decoded === null) return null;
	const { challenge, solution } = decoded as { challenge?: unknown; solution?: unknown };
	if (typeof challenge !== 'object' || challenge === null) return null;
	if (typeof solution !== 'object' || solution === null) return null;
	const { parameters } = challenge as { parameters?: unknown };
	if (typeof parameters !== 'object' || parameters === null) return null;
	if (typeof (parameters as { nonce?: unknown }).nonce !== 'string') return null;
	return decoded as Payload;
}

function randomSecret(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
}

function rejected(detail: string): AltchaResult {
	return { ok: false, reason: 'rejected', detail, operatorFix: null };
}
