import type { PaymentMethod } from '../v1';

/**
 * the rail the donor was quoted on, as the provider's own name for it.
 *
 * total over `PaymentMethod`, so a rail added to `PAYMENT_METHODS` in ../v1.ts without a name
 * here is a compile error rather than an element group collecting details the intent cannot be
 * paid with. it mirrors `INTENT_METHODS` in `src/lib/server/payments/stripe.ts`, and the two must
 * agree: the intent is minted for exactly one rail, so an element group offering another one
 * collects details that are refused at confirmation.
 *
 * the wallets map onto `card` because that is how they are delivered — a wallet is a way of
 * presenting a card, not a method of its own.
 *
 * exported for the spec that holds the two tables to each other,
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
	ach: 'us_bank_account'
});
