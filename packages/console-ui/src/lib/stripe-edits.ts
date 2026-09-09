import { KEY_BLANK, KEY_FIELD, type StripeAct, type StripeKeyName } from './stripe-keys';

// what the two Stripe boxes asked the deployment to do, read out of the form the operator pressed.
//
// **the reading is the form's own**, which is the argument ./secret-edits.ts makes about the mail
// group: what an empty box means is decided by what the box was drawn holding, so the press reads
// it in the browser and posts the act rather than the boxes. what crosses to the binary is a pair
// of keys, one key, or the two names to delete
// (`packages/console/internal/server/stripe.go`).
//
// **nothing here reaches a network, and the values it answers with are on their way into one
// request body and nowhere else.** a key this refuses is a key that never leaves the page.
//
// **and what it refuses is a box, never the shape of what is in it.** whether a string is a key
// this account can charge on is Stripe's to answer and nothing anywhere guesses at it: the press
// hands the pair over and the first thing the chain does is ask (`naming` in
// `packages/console/internal/stripe`), so a wrong value comes back named by the only party that
// knows. a box the pair would be left without is answered in front of this reader —
// `stripeRefusals` in ./stripe-keys.ts names it while the operator is still standing at it — and
// the binary's door refuses only a slot holding nothing or a padded value (`asking` in
// `packages/console/internal/server/stripe.go`). the door stays the authority: nothing but this
// browser reaches this reader, so a press arriving any other way is turned down there whatever was
// decided here.
//
// **there are three acts and the secret box is what decides which** — the enumeration is
// ./stripe-keys.ts's, because the screen states the act in a confirm before the press and this
// module makes the same reading of the boxes. a typed secret key is the whole errand. an untouched
// one is the publishable key alone: the press carries no key, so it can make no call to the
// processor. an emptied one is {@link STRIPE_REMOVAL}, which is one write and reaches neither the
// processor nor the published key.

/** what the deployment is holding, which is what the box for it was seeded from. */
export type StripeHeld = {
	/** the stored secret key, and `''` where the deployment holds none that can be read back. */
	readonly secretKey: string;
};

/** what the two boxes asked for, or which of them could not be read as an act. */
export type StripeKeyEdits =
	| {
			ok: true;
			/** the whole chain, made afresh against the pair that was pasted. */
			act: Extract<StripeAct, 'errand'>;
			keys: { secretKey: string; publishableKey: string };
	  }
	/** the publishable key alone: the secret key was left alone, so no call can be made at all. */
	| { ok: true; act: Extract<StripeAct, 'publish'>; publishableKey: string }
	/** the two credentials deleted, which reaches neither the processor nor the published key. */
	| { ok: true; act: Extract<StripeAct, 'remove'> }
	/** keyed by the name of the box at fault, which is where the screen prints the sentence. */
	| { ok: false; errors: Record<string, string> };

/**
 * the removal's whole payload, in the shape the credentials write takes.
 *
 * **the signing secret goes with the key and never after it.** it verifies deliveries from the
 * account the secret key charges on, so a deployment left holding it alone would be checking
 * signatures for an account nothing can reach. `null` is what deletes a name, so the removal is the
 * same one call as a save.
 */
export const STRIPE_REMOVAL: Readonly<Record<string, string | null>> = {
	STRIPE_SECRET_KEY: null,
	STRIPE_WEBHOOK_SECRET: null
};

/**
 * what the two boxes asked the deployment to do.
 *
 * **the secret box is the one the press is decided on, and it is read against what the deployment
 * says it is holding.** the stored key coming back unchanged is the box nobody went near, an
 * emptied box over one is a value taken away, and anything else is a key to run the whole errand
 * with — the three acts ./stripe-keys.ts enumerates, and the same seeded reading
 * `secretEdits` in ./secret-edits.ts makes of the mail form.
 *
 * **`held` is the deployment's own answer and never the form's.** a form claiming a key is stored
 * would turn an empty box into a delete and an untouched box into a press that changes nothing
 * quietly; one claiming it is not would run the whole errand over a key nobody retyped. the press reads
 * it off the binary before this is called (../routes/_index.tsx), which is what the mail group does
 * for the same reason.
 *
 * **a removal reads the other box not at all.** the press writes nothing to the published slot and
 * can write nothing, so a sentence about that box would be a refusal over a value this press does
 * not touch.
 *
 * **an empty box is the only refusal, and it is a fact about the form rather than about a key.**
 * the press has nothing to carry, which this can see; whether what it does carry is a key Stripe
 * will take is Stripe's answer and is asked for by making the call.
 *
 * **a value is never trimmed.** trimming would store a key that differs from what the operator
 * pasted, and a space at either end is a character of it. a padded key fails against Stripe, which
 * is where it is reported.
 *
 * the names are the enumeration's, so a form naming a value under any other has nowhere to reach.
 */
export function stripeKeyEdits(posted: FormData, held: StripeHeld): StripeKeyEdits {
	const errors: Record<string, string> = {};
	const read = (name: StripeKeyName): string => {
		const typed = posted.get(KEY_FIELD(name));
		return typeof typed === 'string' ? typed : '';
	};

	const secretKey = read('STRIPE_SECRET_KEY');
	const publishableKey = read('STRIPE_PUBLISHABLE_KEY');

	// the two boxes the seed makes an act rather than a value, and both of them end the reading:
	// neither carries a key, so nothing below has anything to check.
	if (held.secretKey !== '' && secretKey === '') return { ok: true, act: 'remove' };
	const untouched = held.secretKey !== '' && secretKey === held.secretKey;

	// a box of spaces is an empty box here: the deployment drops such a string (`readConfigEnv` in
	// packages/app/src/lib/server/config/env.ts), so a press carrying one has nothing to store. what
	// is trimmed is the reading and never the value.
	//
	// the word is the one the screen puts under the box for the same state, taken from where that
	// screen takes it (`KEY_BLANK` in ./stripe-keys.ts), so a press that came from somewhere other
	// than that screen is answered the way that screen would have answered it.
	if (!untouched && secretKey.trim() === '') errors.STRIPE_SECRET_KEY = KEY_BLANK;
	if (publishableKey.trim() === '') errors.STRIPE_PUBLISHABLE_KEY = KEY_BLANK;

	// refused whole rather than acted on in half: one press registers an endpoint, stores two
	// credentials, provisions a product and publishes a key, and a deployment holding the boxes that
	// parsed is a deployment in a state nobody asked for.
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return untouched
		? { ok: true, act: 'publish', publishableKey }
		: { ok: true, act: 'errand', keys: { secretKey, publishableKey } };
}
