import { secretFingerprint } from '@better-giving/operator/stripe/secret-fingerprint';
import { readConfigEnv, type ConfigEnv } from '../config/env';
import type { ProcessorName } from './provider';
import type { WebhookRegistration } from './webhook-registration';

// whether what this deployment holds is what its own webhook endpoint is verified against, which
// is a comparison only this deployment can make.
//
// no read on a processor's API hands a signing secret back (https://docs.stripe.com/api/webhook_endpoints/list)
// and no read on Cloudflare hands a stored one back either, so a console outside the worker can
// only report that a slot is filled — which is what reads as fine over a deployment verifying
// nothing. the worker holds both halves: the variable, and the stamp the adapter put on the
// endpoint it created (`WebhookEndpointSummary.verificationStamp` in ./provider.ts).
//
// **what is compared is one processor's fact and the table below is where that lives.** Stripe
// signs a delivery with a secret, so the comparison is between two digests of it and the stored
// value never leaves this side (`packages/operator/src/stripe/secret-fingerprint.ts`). PayPal
// identifies the endpoint by the id it minted at registration, and an id is not a credential, so
// the comparison there is the value itself. a module that knew only the first would be a module
// that has to be rewritten rather than extended, which is what a table total over `ProcessorName`
// prevents.
//
// it sits beside ./webhook-registration.ts rather than inside it because that module reads no
// deploy-time variable at all — it asks the payment port about somebody else's account and carries
// the stamp out untouched. this is where the stamp and the variable meet, and its one caller is
// `src/routes/console.payments.ts`.

/**
 * whether what is stored is what the processor is verifying against, as a closed set.
 *
 *   verifying      — the endpoint registered at this deployment's address was created with what
 *                    this deployment holds. the only member that says deliveries are being
 *                    verified.
 *   stale          — a value is stored and it is a different endpoint's. the shape a replacement
 *                    leaves behind when nobody sets the new value, and the reason this exists:
 *                    everything else on the screen is green while every delivery fails
 *                    verification, and no gift reaches the books.
 *   unset          — nothing is stored. a member of its own rather than an arm of `stale`, because
 *                    what it asks for is a value to set rather than an endpoint to replace.
 *   unconfirmable  — there is nothing to compare against. no endpoint is registered, the account
 *                    could not be read, or the endpoint carries no stamp — an endpoint registered in
 *                    the dashboard or by `stripe listen` was never stamped, and a deployment on one
 *                    is working. reported as `stale`, it would send an operator to replace a working
 *                    endpoint and cost them the secret they have. it is also the permanent answer on
 *                    a processor whose endpoint this release does not register at all: nothing here
 *                    ever stamped one, so there is no stamp to hold the stored value against and
 *                    there never will be.
 *
 * four members and not a boolean, because `unconfirmable` and `stale` are opposite instructions
 * wearing the same absence of a match.
 */
export const WEBHOOK_SECRET_STANDINGS = ['verifying', 'stale', 'unset', 'unconfirmable'] as const;
export type WebhookSecretStandingState = (typeof WEBHOOK_SECRET_STANDINGS)[number];

/**
 * where the stored value stands against the endpoint the processor holds.
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
 * how one processor's deliveries are verified: the variable that carries it, and how what is stored
 * becomes something an endpoint's stamp can be compared with.
 *
 * `stamp` is what keeps the credential on this side. Stripe's returns a digest, so nothing derived
 * from the secret crosses; PayPal's returns the value, which is an endpoint id and not a secret at
 * all — the distinction is the field's, not this table's, and `WebhookEndpointSummary` in
 * ./provider.ts is where it is stated.
 *
 * `null` out of a stamp is "nothing is stored", which is why it takes the variable's value rather
 * than a value already known to be set: `secretFingerprint` already answers that way on purpose —
 * an unset variable and a set one must not produce comparable values — and a second presence check
 * here would be a second opinion about the same thing.
 *
 * total over `ProcessorName`, so a processor added at the port without an answer here is a compile
 * error rather than a deployment reported as verifying because nothing looked.
 */
const VERIFICATION: Readonly<
	Record<
		ProcessorName,
		{
			readonly variable: keyof ConfigEnv;
			readonly stamp: (stored: string | undefined) => Promise<string | null> | string | null;
		}
	>
> = Object.freeze({
	stripe: { variable: 'STRIPE_WEBHOOK_SECRET', stamp: secretFingerprint },
	paypal: { variable: 'PAYPAL_WEBHOOK_ID', stamp: (stored) => stored ?? null }
});

/**
 * the comparison a row reporting the variable cannot make.
 *
 * such a row reads a variable, and the value it would have to be compared against is returned once
 * at creation and by no read afterwards (`RegisteredWebhookEndpoint` in ./provider.ts) — so
 * presence is the whole of what a variable can report, and presence is what reads as fine over a
 * deployment verifying nothing. what makes the comparison possible is the stamp the adapter puts on
 * the endpoint it creates.
 *
 * it takes the registration as an argument rather than reading it, because that value is a read of
 * somebody else's account and this module reaches no network: the caller that has asked the
 * processor about the endpoint already holds both halves. async because one of the two stamps is
 * `crypto.subtle`'s.
 *
 * `processor` says which account the registration is a read of, so the variable compared is the one
 * that verifies *those* deliveries. it is taken as an argument rather than read off the
 * registration because a registration is a reading of an account and carries no name — the caller
 * asked one provider and holds `PaymentProvider.processor` for it.
 *
 * `source` is the platform env whole, narrowed here by `readConfigEnv` — so a blank value and a
 * binding sitting in a string's slot mean "unset" here exactly as they do everywhere else the
 * deploy-time values are read, and the caller hands over `platform.env` rather than a copy narrowed
 * for a screen (a loader's return value is serialized to the browser).
 *
 * nothing about the stored value leaves here — not the value, not its digest. what a caller gets is
 * which of four states it is in and, in one of them, what to do about it.
 */
export async function webhookSecretStanding(
	source: unknown,
	processor: ProcessorName,
	registration: WebhookRegistration
): Promise<WebhookSecretStanding> {
	const { variable, stamp } = VERIFICATION[processor];
	const stored = await stamp(readConfigEnv(source)[variable]);
	if (stored === null) return { state: 'unset', detail: null };

	// the stamp is read off the registration rather than asked for: `registered` is the only arm
	// carrying an endpoint at all, and the other two are blocks the webhook section already words.
	const stamped = registration.state === 'registered' ? registration.verificationStamp : null;
	if (stamped === null) return { state: 'unconfirmable', detail: null };

	if (stamped === stored) return { state: 'verifying', detail: null };

	return {
		state: 'stale',
		// the press rather than a value to type: this value is handed over once, in the answer that
		// registers the endpoint, and is readable from no call afterwards — so the press that
		// registers is the only thing that can store the right one.
		detail:
			`The stored \`${variable}\` is not the one this deployment’s webhook endpoint was created ` +
			'with, so the processor’s deliveries are failing verification and no gift is reaching the ' +
			'books. Open the console (`better-giving open`) and set the processor up again under ' +
			'Donation processor: that press registers the endpoint and stores what it is handed, ' +
			'which is the only moment the value is readable.'
	};
}
