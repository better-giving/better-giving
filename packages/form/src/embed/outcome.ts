// Stripe's answer to a confirmation, in this flow's own outcome vocabulary.
//
// the whole of the mapping ../ports.ts describes when it says "the names are ours, not
// stripe's. Mapping `requires_action`/`processing`/`requires_payment_method` happens in the
// adapter that implements this port". it is a module of its own rather than a branch inside
// ./stripe.ts because it is the one part of the payment path that can be asserted without a
// browser, a network or an account — a plain object in, an outcome out.
//
// the rule the whole file is written from: only a rail that actually refused becomes
// `declined`, and everything else that cannot be read as a definite state becomes
// `indeterminate`. `declined` is one press away from a fresh attempt (`failed` in
// ../checkout.machine.ts offers Retry), and that press mints a second intent — so guessing
// `declined` about a confirmation that may have succeeded is what charges a donor twice, while
// guessing `indeterminate` about one that definitely failed only costs a read.

import type { ConfirmOutcome } from '../ports';

/**
 * the intent as much of it as this mapping reads.
 *
 * a structural subset rather than Stripe's `PaymentIntent`, so this module carries no import
 * from the SDK and ./outcome.spec.ts can state a case as three fields instead of forty. the
 * adapter passes the real object, which satisfies this.
 */
export type IntentLike = {
	readonly status: string;
	readonly next_action?: { readonly type?: string } | null;
	readonly last_payment_error?: { readonly message?: string } | null;
};

/**
 * what `stripe.confirmPayment` and `stripe.retrievePaymentIntent` both resolve to.
 *
 * exactly one of the two fields is present, which is the shape of Stripe's own
 * `PaymentIntentResult`. an error may still carry the intent it was about, and where it does
 * that intent is the better answer — see `outcomeOf`.
 */
export type ConfirmResult = {
	readonly paymentIntent?: IntentLike | null;
	readonly error?: StripeErrorLike | null;
};

/** the error as much of it as this mapping reads. */
export type StripeErrorLike = {
	readonly type?: string;
	readonly message?: string;
	readonly payment_intent?: IntentLike | null;
};

/** what a donor is told when the rail refused without saying anything usable. */
const UNSTATED_DECLINE = 'Your payment was not accepted. Try a different payment method.';

/**
 * what a donor is told when the provider refused the request rather than the money.
 *
 * the provider's own sentence names a parameter and is written for whoever built the integration,
 * so it goes to the console where they can read it (`../embed/stripe.ts`) and never to the donor,
 * who can act on none of it. what they can act on is that nothing was charged and the press is
 * theirs to make again.
 */
const UNCONFIRMABLE =
	'This gift could not be sent for payment, and nothing was charged. Try again.';

/**
 * one Stripe intent status as an outcome.
 *
 * `requires_payment_method` is two states wearing one name and the same distinction the server
 * adapter draws (`settlementStatus` in `src/lib/server/payments/stripe.ts`): before anything has
 * been tried it means the confirmation never got as far as the rail, and after a refusal it
 * means the rail said no. `last_payment_error` is what separates them, and here the second
 * reading is the one that matters — it is the only status this app ever reads as a decline.
 */
export function outcomeOfIntent(intent: IntentLike): ConfirmOutcome {
	switch (intent.status) {
		case 'succeeded':
			return { kind: 'succeeded' };

		case 'processing':
			return { kind: 'processing' };

		case 'requires_action':
			// two actions and one of them has a screen. microdeposits are a wait the donor leaves
			// and comes back from; everything else the confirmation did not complete in the page
			// is the browser being handed to the donor's bank, which is `redirecting` — a state
			// with no transitions out, because the next thing that happens is a fresh page load.
			return intent.next_action?.type === 'verify_with_microdeposits'
				? { kind: 'awaiting_microdeposits' }
				: { kind: 'redirecting' };

		case 'requires_payment_method':
			// the rail's own words where it left any. without them nothing refused this intent
			// that can be named, so it is not reported as a refusal at all.
			return intent.last_payment_error
				? { kind: 'declined', message: intent.last_payment_error.message ?? UNSTATED_DECLINE }
				: { kind: 'indeterminate' };

		default:
			return { kind: 'indeterminate' };
	}
}

/**
 * the error types that say the rail itself refused, and the whole of them.
 *
 * `card_error` is a refusal by the issuer: the money was asked for and the answer was no. every
 * other type Stripe.js declares (`api_connection_error`, `api_error`, `rate_limit_error`,
 * `authentication_error`, `invalid_request_error`, `idempotency_error`) says something about
 * the request rather than about the money, and none of them says the money did not move.
 *
 * a list rather than a `default: declined`, so an error type minted after this was written
 * reads as unknown instead of as a refusal.
 */
const DECLINING_ERROR_TYPES: readonly string[] = ['card_error'];

/**
 * the error type that says the donor has not finished the provider's own fields.
 *
 * a refusal by the provider's own validation, before anything left the page: no rail was touched,
 * nothing was refused, and the donor has not submitted a form at all. so it is not an outcome of
 * the gift — see `unfinished` in ../ports.ts, and `outcomeOfConfirmation` below for why it is read
 * ahead of the intent.
 *
 * beside `DECLINING_ERROR_TYPES` rather than in it, which is the whole of this defect: read as a
 * decline it ends the flow on "this gift was not completed" over a card the donor never filled in.
 */
const UNFINISHED_FIELD_TYPES: readonly string[] = ['validation_error'];

/**
 * the error types that say the request itself was refused, so no rail was ever reached.
 *
 * `invalid_request_error` is the provider rejecting the call before processing it — a parameter it
 * will not accept, or one that disagrees with the intent being confirmed. the money provably did
 * not move, which is what separates it from `api_connection_error` and `api_error`: those two say
 * the request may have been received and answered, and stay `indeterminate` for that reason.
 *
 * it is read before the intent, and that ordering is the whole point. an error of this type
 * carries the intent back exactly as it was minted — `requires_payment_method`, nothing attached,
 * no `last_payment_error` — which `outcomeOfIntent` reads as an answer nobody has. so a refusal
 * this end can be certain about would otherwise arrive as the one state the flow treats as
 * unknowable, and a donor would be thanked for a gift that was never charged.
 */
const REFUSED_REQUEST_TYPES: readonly string[] = ['invalid_request_error'];

/**
 * whether a refusal is the donor's own to act on rather than this integration's.
 *
 * the two lists above are the two a donor can do something about — an issuer said no, or a field
 * of the provider's own is not finished — and each already reaches them on the screen: the first as
 * a sentence this flow carries, the second as the provider's own mark on its own field. everything
 * else is a fault of the integration or of the network, which is what ./stripe.ts reports to the
 * console of the page the form is embedded in. the distinction is worth drawing: a decline logged
 * on every host page is noise on the path that works, and noise is where a fault that only happens
 * once goes unread. an unfinished form is noisier still — it is the ordinary way a donor fills one
 * in.
 */
export function donorsOwn(error: StripeErrorLike | null | undefined): boolean {
	if (error === null || error === undefined) return false;
	const type = error.type ?? '';
	return DECLINING_ERROR_TYPES.includes(type) || UNFINISHED_FIELD_TYPES.includes(type);
}

/**
 * a confirmation or a resume, as one outcome.
 *
 * the intent is read before the error, and where an error carries one the intent wins. Stripe
 * attaches the PaymentIntent to most errors raised on a request about one, so the case where
 * nothing but an error type is available is the case where the answer genuinely never
 * arrived — which is what keeps `indeterminate` a rare state rather than the busy one.
 */
export function outcomeOf(result: ConfirmResult): ConfirmOutcome {
	const intent = result.paymentIntent ?? result.error?.payment_intent;
	if (intent) return outcomeOfIntent(intent);

	const error = result.error;
	if (error && DECLINING_ERROR_TYPES.includes(error.type ?? '')) {
		return { kind: 'declined', message: error.message ?? UNSTATED_DECLINE };
	}
	return { kind: 'indeterminate' };
}

/**
 * a confirmation, as one outcome.
 *
 * `outcomeOf` above with two types read ahead of the intent, and the split is what the two callers
 * may each claim. a confirmation the provider refused outright never reached a rail, so the money
 * provably did not move — see `REFUSED_REQUEST_TYPES`, and the intent such an error carries
 * describes the moment before the call rather than what became of the gift. a *read* refused the
 * same way says nothing whatever about a charge that may already have settled, which is why the
 * certainty lives on this entry point and never on the shared one.
 *
 * an unfinished field is the same ordering for the same reason. the confirmation was stopped by the
 * provider's own validation before anything left the page, and whatever intent came back with it is
 * the intent as it was minted — `requires_payment_method`, nothing attached — which `outcomeOfIntent`
 * reads as an answer nobody has. so a donor who simply had not filled the card in would land in the
 * one state the flow treats as unknowable, with no way back to the fields.
 */
export function outcomeOfConfirmation(result: ConfirmResult): ConfirmOutcome {
	const error = result.error;
	if (error && REFUSED_REQUEST_TYPES.includes(error.type ?? '')) {
		return { kind: 'declined', message: UNCONFIRMABLE };
	}
	if (error && UNFINISHED_FIELD_TYPES.includes(error.type ?? '')) return { kind: 'unfinished' };
	return outcomeOf(result);
}

export { UNCONFIRMABLE, UNSTATED_DECLINE };
