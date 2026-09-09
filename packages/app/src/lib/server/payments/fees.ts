import type { FeeRule, FeeRules } from '@better-giving/form/v1';

// what Stripe charges to move a gift, as a fact about the processor rather than about the org.
//
// it is a constant in the tree and not a column, an environment variable or a box in /admin,
// and that is the decision rather than an omission. the rate is published by the payment
// processor and is the same for every deployment of this app; a number an operator retypes is a
// number an operator mistypes, and the failure mode is silent — the fee line on the donor's
// screen quotes more than the processor takes and the difference is collected from people
// giving money to a charity. nothing in /admin can tell a stale rate from a current one either,
// so the box would age without ever reading wrong.
//
// this is US pricing, which is the same scope `FORM_CURRENCY` in ../../forms/amounts.ts fixes:
// v0 denominates every form in USD. a fork whose Stripe account is priced somewhere else is the
// trigger to reopen this — and reopening it means deciding where a per-deployment rate lives and
// what stops it from being wrong, not adding a column. until then, a second pricing table here
// would be a value nothing selects between.
//
// the numbers are Stripe's published US rates: https://stripe.com/pricing

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
export const STRIPE_US_FEE_RULES: FeeRules = Object.freeze({
	card: CARD,
	apple_pay: CARD,
	google_pay: CARD,
	ach: Object.freeze({ percent: 0.008, fixedMinor: 0, capMinor: 500 })
});
