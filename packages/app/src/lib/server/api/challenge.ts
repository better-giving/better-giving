// which spam check a submission owes, and the one place that decides it: Turnstile where both of
// its keys are set, the self-hosted ALTCHA proof of work (./altcha.ts) otherwise. there is always
// one, so no deployment takes a gift unchecked. the served config tells the donation form which to
// run (../forms/published-config.ts), from `challengeKind` below.

import type { Altcha } from './altcha';
import { type TurnstileCheck, type TurnstileResult, verifyTurnstile } from './turnstile';

export type ChallengeKind = 'turnstile' | 'altcha';

/** a submission's claim to have cleared either check: the Turnstile fields and the ALTCHA payload. */
export type ChallengeCheck = TurnstileCheck & {
	/** `QuoteRequest.altchaPayload`, the widget's base64 payload, trusted for nothing yet. */
	readonly altchaPayload: string | undefined;
};

export type ChallengeResult = TurnstileResult;

/** Turnstile where both keys hold a value, ALTCHA otherwise: half a pair is no pair. */
export function challengeKind(env: {
	readonly TURNSTILE_SITE_KEY?: string | undefined;
	readonly TURNSTILE_SECRET_KEY?: string | undefined;
}): ChallengeKind {
	const site = env.TURNSTILE_SITE_KEY?.trim() ?? '';
	const secret = env.TURNSTILE_SECRET_KEY?.trim() ?? '';
	return site !== '' && secret !== '' ? 'turnstile' : 'altcha';
}

/** runs the check `challengeKind` names for this deployment. never throws. */
export function verifyChallenge(
	check: ChallengeCheck,
	altcha: Altcha,
	turnstile: (check: TurnstileCheck) => Promise<TurnstileResult> = verifyTurnstile
): Promise<ChallengeResult> {
	const kind = challengeKind({
		TURNSTILE_SITE_KEY: check.siteKey,
		TURNSTILE_SECRET_KEY: check.secretKey
	});
	return kind === 'turnstile' ? turnstile(check) : altcha.verify(check.altchaPayload);
}
