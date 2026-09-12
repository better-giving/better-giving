import type { PaymentMethod } from '@better-giving/form/v1';

// the ways a donor may pay that this repository has a donation form for at all, and no form
// chooses.
//
// a constant in this repository and nothing else: no column holds it and no screen sets it. it is
// the ceiling rather than the answer — `offeredRails` in `$lib/server/forms/offered-rails.ts`
// narrows it to the rails this deployment's processor account is approved for, and that narrowed
// list is what `readPublishedConfig` serves as `FormConfig.paymentMethods`.
//
// `parseQuoteRequest` in `$lib/server/donations/quote-input.ts` gates a submitted `method` against
// this list whole rather than against the narrowed one, and the gap is deliberate: the served config
// is cached and reaches pages this deployment cannot recall (CLAUDE.md), so a rail we have stopped
// offering still arrives and is charged rather than refused.
//
// it lives here rather than in `packages/form/src/v1.ts` because `v1` is a permanent wire contract and
// which rails a deployment happens to offer is not part of it — `PAYMENT_METHODS` there stays the
// full vocabulary a config *may* report, and this is what this one does. it lives here rather than
// under `$lib/server/**` because the operator console names the rails on a screen and a component
// cannot import from there at all.

/**
 * the offered rails, in the order a donor is shown them.
 *
 * the wallets are in it because the provider's own box is where they are drawn and the form's own
 * Donate press is what opens their sheet — see the `wallets` hash in
 * `packages/form/src/embed/stripe.ts`, which switches each of them on per deployment off this list
 * once it has been narrowed. that they name no wire type of their own is `RAILS` in
 * `packages/form/src/embed/rails.ts`.
 *
 * Link is absent and is not an omission. it has no name in `PAYMENT_METHODS` at all — a donor who
 * picks it is quoted on `card`, which is what the intent it confirms against carries.
 *
 * in `PAYMENT_METHODS`' own order, which is not a preference: `parseConfig` in
 * `packages/form/src/config.ts` re-orders whatever it is served into that vocabulary's order, so a
 * second order written here would be one every donor's form quietly discards while the operator
 * console kept rendering it. that order opens with `card`, which is what `displayRail` in
 * `packages/form/src/checkout.machine.ts` prices the fee row against for a donor who has picked no
 * rail yet — the rail a wallet is delivered as, so the figure holds for whichever of the three
 * they go on to pick.
 *
 * `readonly PaymentMethod[]` rather than a literal tuple, because nothing may narrow on which
 * members are in it: a reader that branched on `card` being here would have to be reopened the day
 * a rail leaves, and the two consumers both take the list whole.
 *
 * more than one processor's rails, and being on this list says nothing about which: `STRIPE_RAILS`
 * and `PAYPAL_RAILS` in `packages/form/src/embed/rails.ts` are where that is written, and a
 * deployment holding one processor narrows to that processor's own rails through the read
 * `offeredRails` in `$lib/server/forms/offered-rails.ts` makes.
 */
export const OFFERED_PAYMENT_METHODS: readonly PaymentMethod[] = [
	'card',
	'ach',
	'apple_pay',
	'google_pay',
	'paypal',
	'venmo'
];
