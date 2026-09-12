import type { PaypalRail, StripeRail } from '@better-giving/form/embed/rails';
import type { FeeRule, FeeRules } from '@better-giving/form/v1';
import type { ConfigEnv } from '../config/env';

// what each processor charges to move a gift, as a fact about the processor rather than about the
// org.
//
// it is a constant in the tree and not a column, an environment variable or a box in /admin,
// and that is the decision rather than an omission. the rate is published by the payment
// processor and, on Stripe, is the same for every deployment of this app; a number an operator
// retypes is a number an operator mistypes, and the failure mode is silent — the fee line on the
// donor's screen quotes more than the processor takes and the difference is collected from people
// giving money to a charity. nothing in /admin can tell a stale rate from a current one either,
// so the box would age without ever reading wrong.
//
// this is US pricing, which is the same scope `FORM_CURRENCY` in ../../forms/amounts.ts fixes:
// v0 denominates every form in USD. a fork whose Stripe account is priced somewhere else is the
// trigger to reopen this — and reopening it means deciding where a per-deployment rate lives and
// what stops it from being wrong, not adding a column.
//
// **one half of that argument does not survive the second processor, and the tables below are the
// shape of what does.** the published-rate half holds for both: PayPal publishes its rates as
// Stripe does. the same-for-every-deployment half does not — PayPal prices an approved 501(c)(3)
// organisation differently from everyone else and reports nowhere which of the two an account is
// on — so PayPal has two tables rather than one, and what selects between them is an answer about
// the account rather than a rate anybody retypes. that keeps the property this header is
// defending: every number is in the tree, reviewed, and no operator can mistype one.
//
// one processor's table prices that processor's own rails and no others, which is the split
// `STRIPE_RAILS` and `PAYPAL_RAILS` in packages/form/src/embed/rails.ts hold. `servedFeeRules`
// below is what a config is served: the two composed, since `FeeRules` on the wire is total over
// every rail and a deployment serving one processor still serves a table a donor's form can price
// any offered rail against.
//
// the numbers are the processors' published US rates: https://stripe.com/pricing and
// https://www.paypal.com/us/webapps/mpp/merchant-fees

/**
 * the card price, and every rail that settles as a card carries it by reference below.
 *
 * `percent` is a fraction and never a percentage — 0.029, never 2.9. `FeeRule` in packages/form/src/v1.ts
 * says so on the wire for the same reason it matters here: a percentage stored as a percentage is
 * a hundred-fold error on the screen that asks for money.
 *
 * frozen, because `readonly` on the type is erased at runtime and this exact object is handed by
 * reference into every `FormConfig` this deployment serves, inside an isolate that outlives the
 * request. one caller writing to it in place reprices every donation form served afterwards, and
 * nothing would report it — the constant would still read correctly in the tree.
 */
const CARD: FeeRule = Object.freeze({ percent: 0.029, fixedMinor: 30 });

/**
 * the price of each rail this app offers, in the shape `/api/v1/forms/:id/config` serves.
 *
 * the annotation is load-bearing: `FeeRules` is total over `PaymentMethod`, so a rail added to
 * that union without a price here is a compile error rather than a fee line that silently reads
 * zero. that is the property the wire type was given for, and an annotation is what keeps it —
 * a bare `satisfies` on an object literal would infer only the keys written.
 *
 * apple_pay and google_pay share the card rule by reference rather than by copy, because they
 * are card rails: a wallet tokenises a card and settles at card pricing, so a separate literal
 * for either would be a second number to keep in step with the first.
 *
 * ach is the shape the cap exists for. the bound is on the proportional part alone — the fee is
 * `min(proportional, capMinor) + fixedMinor` — and `estimateFee` in packages/form/src/fee.ts is what
 * applies it. 0.8% capped at $5.00: at a gift of $620.00 the capped fee and the grossed-up one
 * are the same $5.00, and above that the cap is what the donor covers. $620 and not the $625 the
 * bare rate crosses at, because `estimateFee` grosses the fee up so the gift arrives whole — it
 * charges the smaller of the grossed-up total and `amount + cap`, and the second becomes the
 * smaller from 62000 minor units up.
 *
 * frozen for the reason `CARD` above is, and each rule frozen on its own because `Object.freeze`
 * is shallow: sealing the outer record alone would leave every rate inside it writable, which is
 * the value that would actually be worth changing under someone.
 */
export const STRIPE_US_FEE_RULES: Readonly<Record<StripeRail, FeeRule>> = Object.freeze({
	card: CARD,
	apple_pay: CARD,
	google_pay: CARD,
	ach: Object.freeze({ percent: 0.008, fixedMinor: 0, capMinor: 500 })
});

/**
 * what PayPal charges an organisation it has approved for its charity rate.
 *
 * total over the rails PayPal settles, for the reason the Stripe table above is total over its
 * own: a rail added to that list without a price is a compile error rather than a fee line that
 * silently reads zero.
 *
 * Venmo carries the PayPal rule by reference rather than by copy, the way the wallets carry the
 * card rule above: it is a funding source inside the same checkout, priced as the checkout is, so
 * a separate literal would be a second number to keep in step with the first.
 *
 * frozen at both levels for `CARD`'s reason.
 */
const PAYPAL_CHARITY: FeeRule = Object.freeze({ percent: 0.0199, fixedMinor: 49 });
export const PAYPAL_US_FEE_RULES_CHARITY: Readonly<Record<PaypalRail, FeeRule>> = Object.freeze({
	paypal: PAYPAL_CHARITY,
	venmo: PAYPAL_CHARITY
});

/** what PayPal charges an organisation it has not approved for that rate. */
const PAYPAL_STANDARD: FeeRule = Object.freeze({ percent: 0.0349, fixedMinor: 49 });
export const PAYPAL_US_FEE_RULES_STANDARD: Readonly<Record<PaypalRail, FeeRule>> = Object.freeze({
	paypal: PAYPAL_STANDARD,
	venmo: PAYPAL_STANDARD
});

/**
 * which of the two PayPal tables this deployment's organisation is priced at.
 *
 * `PAYPAL_CHARITY_RATE_APPROVED` is the whole of the answer, because PayPal reports on no call
 * which rate an account is on — so nothing can check this value against the account, and the one
 * spelling that sets it is `true` (.dev.vars.example documents the same word).
 *
 * every other value is the standard rate, `false` and `yes` and `1` alike, and the two directions
 * of a misreading are why the word is exact. read as approved, a donor covering the fee is quoted
 * 1.99% against the 3.49% PayPal takes and the organisation nets less than the gift the donor
 * chose; read as standard, they are quoted more than PayPal takes and the surplus reaches the
 * organisation. so an answer that is not the word falls to the rate that cannot cost the
 * organisation money.
 *
 * case-insensitive: `True` is an operator answering the question rather than a different answer.
 * `readConfigEnv` in ../config/env.ts has already trimmed the value and dropped a blank one.
 */
export function paypalFeeRules(env: ConfigEnv): Readonly<Record<PaypalRail, FeeRule>> {
	return env.PAYPAL_CHARITY_RATE_APPROVED?.toLowerCase() === 'true'
		? PAYPAL_US_FEE_RULES_CHARITY
		: PAYPAL_US_FEE_RULES_STANDARD;
}

/**
 * the table `/api/v1/forms/:id/config` serves, covering every rail the wire vocabulary holds.
 *
 * composed from each processor's own rules rather than picked whole: the two tables price
 * disjoint rails, so the composition is total and neither can overwrite the other's price. a
 * deployment holding one processor serves this same table — `paymentMethods` on the served config
 * is what says which of these rails a donor is actually offered, and a price carried for a rail
 * nobody is offered prices nothing.
 *
 * which PayPal table is a fact about the org's own PayPal account and arrives as one, so it is a
 * parameter rather than a choice made here.
 *
 * frozen, because this object is handed by reference into every `FormConfig` served from an
 * isolate that outlives the request — `CARD` above states what one caller writing to it in place
 * would cost. the rules inside it are the frozen ones the two tables already hold.
 */
export function servedFeeRules(paypal: Readonly<Record<PaypalRail, FeeRule>>): FeeRules {
	return Object.freeze({ ...STRIPE_US_FEE_RULES, ...paypal });
}
