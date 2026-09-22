import { ZAPIER_TRIGGERS, type ZapierTrigger } from '../db/schema';

// the surface Zapier's servers call: what "under `/zapier`" means and what every answer on it
// carries.
//
// the key is the credential (./key.ts) and nothing else is: no cookie is read, no CORS header is
// sent and there is no `OPTIONS` handler, because only Zapier's servers call it and a page in a
// browser must not read an answer. it is not under `/api/v1`, which is public and unauthenticated
// by CLAUDE.md's own rule.

/**
 * the URL prefix of the Zapier surface.
 *
 * a route joins it by nesting under `src/routes/zapier.ts`, whose `middleware` charges the rate
 * limit and then checks the key; `src/routes.spec.ts` fails on a route served under this prefix
 * that sits anywhere else.
 */
export const ZAPIER_BASE_PATH = '/zapier';

/** an answer from this surface. `no-store`, because every one of them is this deployment's data. */
export function zapierJson(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** what a caller on this surface is told to do once its address has spent the rate limit. */
export const ZAPIER_RATE_LIMIT_FIX =
	'Send it again after the seconds `Retry-After` names, or with the Better Giving key in its `Authorization: Bearer` header — a request carrying the key is never limited.';

/**
 * the one answer to every request whose key did not check out — missing, garbled, never made or
 * replaced. one body for all four, so a caller learns nothing about which.
 */
export function zapierKeyRefusal(): Response {
	return zapierJson(
		{
			message:
				'This request carries no Better Giving key this deployment accepts in its `Authorization: Bearer` header.',
			fix: 'Make a Zapier key in the Better Giving console, or copy the one that replaced it, and reconnect the account on Zapier with it.'
		},
		401
	);
}

/** whether `value` names one of this deployment's triggers. */
export function isZapierTrigger(value: unknown): value is ZapierTrigger {
	return ZAPIER_TRIGGERS.some((trigger) => trigger === value);
}

/** the 422 for a trigger this deployment does not have, naming it and listing the ones it does. */
export function unknownTriggerRefusal(value: unknown): Response {
	return zapierJson(
		{
			message: `The trigger ${JSON.stringify(value)} is not one this deployment has.`,
			fix: `Use one of ${ZAPIER_TRIGGERS.map((t) => `\`${t}\``).join(', ')}.`
		},
		422
	);
}
