import type { PaymentMethod } from '../v1';

/**
 * which rails each processor settles, as two lists that cover the vocabulary exactly once.
 *
 * no rail is offered by both, which is what keeps a deployment holding two processors from ever
 * having to choose one for a gift: the inline card fields collect `card`, the bank debit and the
 * wallets, and the hosted window collects `paypal` and `venmo` — a donor paying by card inside
 * that window is on the `paypal` rail rather than on `card`, because `card` is the inline box.
 *
 * an adapter reads its own list rather than the whole vocabulary, so a rail it cannot mint is one
 * it never asks its processor for. `rail-agreement.spec.ts` in the app holds the two lists to
 * `PAYMENT_METHODS`: a rail in neither, or in both, is a rail nothing settles.
 *
 * `satisfies` rather than an annotation, so each stays a literal union and is checked to be a
 * subset of the vocabulary.
 */
export const STRIPE_RAILS = [
	'card',
	'ach',
	'apple_pay',
	'google_pay'
] as const satisfies readonly PaymentMethod[];
export type StripeRail = (typeof STRIPE_RAILS)[number];

export const PAYPAL_RAILS = ['paypal', 'venmo'] as const satisfies readonly PaymentMethod[];
export type PaypalRail = (typeof PAYPAL_RAILS)[number];

/** whether this rail is one the inline card fields collect, narrowing a rail read off a config. */
export function isStripeRail(rail: PaymentMethod): rail is StripeRail {
	return (STRIPE_RAILS as readonly PaymentMethod[]).includes(rail);
}

/** whether this rail is one the hosted window collects, narrowing a rail read off a config. */
export function isPaypalRail(rail: PaymentMethod): rail is PaypalRail {
	return (PAYPAL_RAILS as readonly PaymentMethod[]).includes(rail);
}

/**
 * the rail the donor was quoted on, as its own processor's name for it.
 *
 * total over `PaymentMethod`, so a rail added to `PAYMENT_METHODS` in ../v1.ts without a name
 * here is a compile error rather than an element group collecting details the intent cannot be
 * paid with. it mirrors `INTENT_METHODS` in `src/lib/server/payments/stripe.ts` over the rails
 * above that processor settles, and the two must agree: the intent is minted for exactly one rail,
 * so an element group offering another one collects details that are refused at confirmation.
 *
 * the wallets map onto `card` because that is how they are delivered — a wallet is a way of
 * presenting a card, not a method of its own.
 *
 * exported for the spec that holds the tables to each other,
 * `src/lib/server/payments/rail-agreement.spec.ts`, and for nothing in production: the import
 * direction runs one way and no module under `src/lib/server/**` may carry this file's SDK.
 *
 * a leaf of its own, rather than a member of `./stripe.ts`'s exports: that file's `exports` map
 * entry published `createPaymentSurface`, `loadStripeScript` and eleven more Stripe-adapter
 * symbols to deliver this one constant to one spec. it is not moved into `../v1.ts` either — `v1`
 * is the provider-agnostic wire contract every rail speaks the same way, and `us_bank_account`
 * below is Stripe's own vocabulary for one of them (`rail-agreement.spec.ts` argues this the same
 * way). this module is the whole of what production needs to publish and the whole of what the
 * spec needs to read, and nothing else.
 */
export const RAILS: Readonly<Record<PaymentMethod, string>> = Object.freeze({
	card: 'card',
	apple_pay: 'card',
	google_pay: 'card',
	ach: 'us_bank_account',
	paypal: 'paypal',
	venmo: 'venmo'
});
