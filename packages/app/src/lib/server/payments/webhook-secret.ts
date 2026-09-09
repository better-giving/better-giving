import { secretFingerprint } from '@better-giving/operator/stripe/secret-fingerprint';
import { readConfigEnv } from '../config/env';
import type { WebhookRegistration } from './webhook-registration';

// whether the signing secret this deployment holds is the one its own webhook endpoint signs
// with, which is a comparison only this deployment can make.
//
// no read on Stripe's API hands a signing secret back (https://docs.stripe.com/api/webhook_endpoints/list)
// and no read on Cloudflare hands a stored one back either, so a console outside the worker can
// only report that a slot is filled — which is what reads as fine over a deployment verifying
// nothing. the worker holds both halves: the variable, and the fingerprint the adapter stamps onto
// the endpoint it creates (`packages/operator/src/stripe/secret-fingerprint.ts`).
//
// it sits beside ./webhook-registration.ts rather than inside it because that module reads no
// deploy-time variable at all — it asks the payment port about somebody else's account and carries
// the stamp out untouched. this is where the stamp and the variable meet, and its one caller is
// `src/routes/console.payments.ts`.

/**
 * whether the stored signing secret is the one the processor is signing with, as a closed set.
 *
 *   verifying      — the endpoint registered at this deployment's address was created with the
 *                    secret this deployment holds. the only member that says deliveries are being
 *                    verified.
 *   stale          — a secret is stored and it is a different endpoint's. the shape a replacement
 *                    leaves behind when nobody sets the new value, and the reason this exists:
 *                    everything else on the screen is green while every delivery fails
 *                    verification, and no gift reaches the books.
 *   unset          — nothing is stored. a member of its own rather than an arm of `stale`, because
 *                    what it asks for is a value to set rather than an endpoint to replace.
 *   unconfirmable  — there is nothing to compare against. no endpoint is registered, the account
 *                    could not be read, or the endpoint carries no stamp — an endpoint registered in
 *                    the dashboard or by `stripe listen` was never stamped, and a deployment on one
 *                    is working. reported as `stale`, it would send an operator to replace a working
 *                    endpoint and cost them the secret they have.
 *
 * four members and not a boolean, because `unconfirmable` and `stale` are opposite instructions
 * wearing the same absence of a match.
 */
export const WEBHOOK_SECRET_STANDINGS = ['verifying', 'stale', 'unset', 'unconfirmable'] as const;
export type WebhookSecretStandingState = (typeof WEBHOOK_SECRET_STANDINGS)[number];

/**
 * where the stored signing secret stands against the endpoint the processor holds.
 *
 * `detail` is the sentence for the state, and it is `null` on every state that has nothing to add
 * to the block it is drawn under. only `stale` carries one, because only `stale` is a finding the
 * screen does not otherwise state.
 */
export type WebhookSecretStanding = {
	readonly state: WebhookSecretStandingState;
	readonly detail: string | null;
};

/**
 * the comparison a row reporting the variable cannot make.
 *
 * such a row reads a variable, and the value it would have to be compared against is returned once
 * at creation and by no read afterwards (`RegisteredWebhookEndpoint` in ./provider.ts) — so
 * presence is the whole of what a variable can report, and presence is what reads as fine over a
 * deployment verifying nothing. what makes the comparison possible is the fingerprint the adapter
 * stamps onto the endpoint it creates;
 * `packages/operator/src/stripe/secret-fingerprint.ts` holds the reasoning and
 * both digests come from it.
 *
 * it takes the registration as an argument rather than reading it, because that value is a read of
 * somebody else's account and this module reaches no network: the caller that has asked the
 * processor about the endpoint already holds both halves. async because the digest is
 * `crypto.subtle`'s.
 *
 * `source` is the platform env whole, narrowed here by `readConfigEnv` — so a blank value and a
 * binding sitting in a string's slot mean "unset" here exactly as they do everywhere else the
 * deploy-time values are read, and the caller hands over `platform.env` rather than a copy narrowed
 * for a screen (a loader's return value is serialized to the browser).
 *
 * nothing about the secret leaves here — not the value, not its digest. what a caller gets is which
 * of four states it is in and, in one of them, what to do about it.
 */
export async function webhookSecretStanding(
	source: unknown,
	registration: WebhookRegistration
): Promise<WebhookSecretStanding> {
	const stored = await secretFingerprint(readConfigEnv(source).STRIPE_WEBHOOK_SECRET);
	if (stored === null) return { state: 'unset', detail: null };

	// the stamp is read off the registration rather than asked for: `registered` is the only arm
	// carrying an endpoint at all, and the other two are blocks the webhook section already words.
	const stamped = registration.state === 'registered' ? registration.secretFingerprint : null;
	if (stamped === null) return { state: 'unconfirmable', detail: null };

	if (stamped === stored) return { state: 'verifying', detail: null };

	return {
		state: 'stale',
		// the press rather than a value to type: this secret is handed over once, in the answer that
		// registers the endpoint, and is readable from no call afterwards — so the press that
		// registers is the only thing that can store the right one.
		detail:
			'The stored signing secret is not the one this deployment’s webhook endpoint was created ' +
			'with, so Stripe’s deliveries are failing verification and no gift is reaching the books. ' +
			'Open the console (`better-giving open`) and set Stripe up again under Donation processor: ' +
			'that press registers the endpoint and stores the secret it is handed, which is the only ' +
			'moment one is readable.'
	};
}
