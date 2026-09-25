import type {
	WebhookRepaired,
	WebhookSecretReading,
	WebhookSubscriptionReading
} from '../api/types';

// whether Stripe is telling this deployment that a gift was paid, read out of the two readings the
// payments report carries about the endpoint, and what the repair press answered — out of the
// drawing (./payment-notices.tsx) so that a case can be written against it: ../../vite.config.ts
// pins `node` and there is no dom, so a rule left inside the component is one no spec can reach.
//
// **the row says what the gift costs and never what the machine is called.** an operator reads
// that card gifts are charged and never marked paid; the endpoint, its events and its signing secret
// are this press's to establish and the Save's to replace (CLAUDE.md → Product surface).
//
// **the repair is offered on one standing and no other.** it switches the endpoint that is already
// there back on and subscribes it to everything, and it leaves the signing secret alone
// (packages/app/src/routes/console.webhook-repair.ts) — so an endpoint that is missing, or whose
// secret is not the one this deployment holds, is the Save's to remake, and a Repair drawn over
// either would answer `repaired` over a row still reading `Not working`.

/** what the repair press posts as its intent. */
export const WEBHOOK_REPAIR_INTENT = 'webhook-repair';

/**
 * where payment notices stand, most basic fault first.
 *
 *   working      — the endpoint is on and subscribed to everything, and its secret is this
 *                  deployment's or cannot be compared (`unconfirmable` in
 *                  packages/operator/src/console/payments.ts is never drawn as a fault).
 *   unregistered — Stripe holds no endpoint at this deployment's address.
 *   unverified   — deliveries arrive and none of them verifies, because the secret is another
 *                  endpoint's or there is none. ahead of `incomplete` because the Save that remakes
 *                  the secret remakes the subscription with it.
 *   incomplete   — the endpoint is this deployment's and is switched off, short of an event, or
 *                  both. the one standing the repair is for.
 */
export type NoticesStanding =
	| { kind: 'working' }
	| { kind: 'unregistered' }
	| { kind: 'unverified' }
	| { kind: 'incomplete'; delivering: boolean; short: boolean };

/**
 * the standing, or `null` where the row has nothing of its own to say.
 *
 * an account that could not be read is said once for every reading it spoils, in the Stripe
 * screen's own sentence (`unreadable` in ./stripe-section.tsx); `not_applicable` is a processor that
 * keeps no endpoint, which is never Stripe.
 */
export function noticesStanding(
	webhook: WebhookSecretReading,
	subscription: WebhookSubscriptionReading
): NoticesStanding | null {
	if (subscription.state === 'unreadable' || subscription.state === 'not_applicable') return null;
	if (subscription.state === 'unregistered') return { kind: 'unregistered' };
	if (webhook.state === 'stale' || webhook.state === 'unset') return { kind: 'unverified' };
	if (subscription.state === 'incomplete') {
		return {
			kind: 'incomplete',
			delivering: subscription.delivering,
			short: subscription.missingEventTypes.length > 0
		};
	}
	return { kind: 'working' };
}

/** the sentence under the row, in a fundraiser's words, for every standing. */
export function noticesNote(standing: NoticesStanding): string {
	if (standing.kind === 'working') return 'Stripe tells this deployment each time a gift is paid.';
	if (standing.kind === 'unregistered') {
		return 'Stripe has nowhere to tell this deployment a gift was paid, so card gifts are charged and never marked paid. Press Save with your two keys to set it up.';
	}
	if (standing.kind === 'unverified') {
		return 'Stripe tells this deployment when a gift is paid, but this deployment can’t confirm those messages came from Stripe, so it turns every one away and card gifts are never marked paid. Press Save with your two keys to set it up again.';
	}
	const stops = standing.delivering
		? 'Stripe isn’t telling this deployment about every kind of payment'
		: standing.short
			? 'Stripe has stopped telling this deployment when a gift is paid, and isn’t set to tell it about every kind of payment'
			: 'Stripe has stopped telling this deployment when a gift is paid';
	return `${stops}, so card gifts can be charged and never marked paid.`;
}

/** whether the answer standing is a repair that landed, which is what moves the reader to the row. */
export const repairLanded = (answer: WebhookRepaired | null): boolean =>
	answer?.kind === 'reported' && answer.report.outcome === 'repaired';
