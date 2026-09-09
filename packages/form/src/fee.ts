// the processing fee, computed twice on purpose: once here from a rule, once by the server
// from the truth, and reconciled against each other the moment the intent is minted.
//
// why an estimate exists at all: the donor has to be told what they will pay before pressing
// the button that pays it, so the fee is a stated amount on the screen rather than an abstract
// "cover processing fees" toggle with no number on it. the authoritative figure does not exist
// until `POST /api/v1/forms/:id/donations` mints an intent, and that happens once per submit
// rather than once per form arrival — so the form displays arithmetic it did locally, and
// `reconcile` below is what keeps that from being a promise it cannot keep.
//
// the disagreement between the two is a value, not an error. a client-side rate is wrong the
// day Stripe prices a method differently, so the rate is not hardcoded here: it is
// server-supplied and per-method, the estimate is derived from it, and when the server's own
// number differs the donor is stopped on a screen that says so before anything is charged. a
// silent overwrite is the failure mode this module exists to make unrepresentable, which is why
// `reconcile` returns a named kind rather than a boolean.
//
// pure arithmetic: this file imports the contract vocabulary and nothing else — no framework,
// no DOM, no Stripe — which is what lets every rounding claim in ./fee.spec.ts be asserted
// with two numbers and no browser.

import type { FeeRule, Quote } from './v1';

/**
 * a fee and the total that carries it, both in minor units.
 *
 * both numbers rather than one plus the amount, because both are rendered: the fee line states
 * the fee and the submit button restates the total it will spend. recomputing either at a call
 * site is how the button and the line end up a minor unit apart.
 */
export type FeeEstimate = {
	readonly feeMinor: number;
	readonly totalMinor: number;
};

/**
 * the widest rate this treats as a price rather than as a misconfiguration.
 *
 * no rail charges half a gift to move it, and the arithmetic degrades badly long before it
 * breaks: at rates approaching 1 the gross-up divides by almost nothing and puts a total on the
 * screen that is orders of magnitude above what the donor chose. Above this the estimate is
 * withheld and the authoritative quote is the only number the donor is shown, which is the same
 * degradation an absent rule gets.
 */
export const MAX_FEE_PERCENT = 0.5;

/**
 * the fixed-point scale the gross-up is computed on.
 *
 * integer arithmetic, not a float quotient, and the difference is visible to a donor.
 * `Math.ceil` over a binary-float division exceeds the exact ceiling in ordinary cases — 7% of
 * 465 minor units grosses to exactly 500 and to 501 in floating point — and one such cent makes
 * the server's exact answer land as `adjusted`, so the confirm screen tells the donor the total
 * changed over a difference that was never there.
 */
const SCALE = 1_000_000;

/**
 * whether this rule prices this gift at all — every misconfiguration both readings of the fee
 * withhold on.
 *
 * one predicate rather than the same six lines in each, and that is the contract rather than
 * tidiness: the two functions below answer opposite questions about the same rule, and a donor
 * shown one figure and not the other over a rate nobody typed is a fee row that contradicts
 * itself. a seventh misconfiguration is added here and both readings withhold on it together.
 *
 * misconfiguration and no more than that. `estimateDeductedFee` below withholds on one further
 * condition of its own — a gift too small to take the fee out of — and that asymmetry is deliberate:
 * it is a fact about the deduction rather than about the rule. the gross-up of that same gift is a
 * real charge the donor can be asked for, and withholding it to keep the two symmetrical would take
 * a chargeable figure off the row and leave `estimate` null, which is what `reconcile` below reads
 * as never having shown the donor a number. ./fee.spec.ts pins both sides of that boundary.
 *
 * a type guard, so the callers read `rule.percent` without re-asking whether the config published
 * one.
 */
function isPriceable(amountMinor: number, rule: FeeRule | undefined): rule is FeeRule {
	if (rule === undefined) return false;
	if (!Number.isInteger(amountMinor) || amountMinor <= 0) return false;
	if (!Number.isFinite(rule.percent) || rule.percent < 0) return false;
	if (rule.percent > MAX_FEE_PERCENT) return false;
	if (!Number.isInteger(rule.fixedMinor) || rule.fixedMinor < 0) return false;
	const cap = rule.capMinor;
	if (cap !== undefined && (!Number.isInteger(cap) || cap < 0)) return false;
	return true;
}

/**
 * what the donor is charged so the org receives `amountMinor`, or `null` when the rule cannot
 * say.
 *
 * the gross-up is not `amount * percent + fixed`. the processor takes its percentage of the
 * total it captures, so a fee added on top is itself charged for. solving
 * `total = amount + total*percent + fixed` gives `total = (amount + fixed) / (1 - percent)`.
 * the naive form leaves the org short by `percent * fee` on every single gift — small, silent,
 * permanent, and in the direction nobody audits.
 *
 * rounds up. a half minor unit rounded down is an underpayment the org absorbs; rounded up it
 * costs the donor at most one cent.
 *
 * what comes back is the rule solved, and no more than that. the rule states one percentage and
 * one flat charge, and a card priced above it — issued outside the account's country, or settled
 * through a currency conversion — is charged more than the rule says, leaving the org short of the
 * gift by the difference. that surcharge is proportional, so the shortfall grows with the gift and
 * at the top of `maxAmountMinor` it is dollars rather than cents. copy around this number may still
 * say the org receives the whole gift, and it does not rest on the size: the org is receiving rather
 * than disbursing, and the donor's receipt is for what they paid either way. the covered reading of
 * the fee row in ./views.ts is where that is said.
 *
 * takes `undefined` as a first-class input. `feeRules` arrives as untrusted JSON keyed by rail,
 * and a response missing one key hands a caller `undefined` through a type that says otherwise;
 * accepting it here is what keeps that from being a `TypeError` thrown inside a state
 * transition, which stops the whole form rather than one fee line.
 *
 * returns `null` rather than throwing, and the distinction matters on someone else's website:
 * a misconfigured rule or a float amount from a host attribute must degrade to "no fee line
 * shown, authority is the only number" — never to an exception that stops a donation form from
 * rendering at all.
 */
export function estimateFee(amountMinor: number, rule: FeeRule | undefined): FeeEstimate | null {
	if (!isPriceable(amountMinor, rule)) return null;
	const cap = rule.capMinor;

	const numerator = (amountMinor + rule.fixedMinor) * SCALE;
	if (!Number.isSafeInteger(numerator)) return null;

	const grossedUp = Math.ceil(numerator / (SCALE - Math.round(rule.percent * SCALE)));
	// above the cap the gross-up has nothing to solve: the proportional part no longer grows with
	// the total, so the fee is the cap plus the flat charge and the total is the gift plus both.
	// the smaller of the two is the one the cap binds in — below it the capped form is the larger
	// and the rate is what the processor takes; at and above it the gross-up is the larger and
	// quotes a fee past the one incurred. integers on both sides, so the choice adds no rounding.
	const totalMinor =
		cap === undefined ? grossedUp : Math.min(grossedUp, amountMinor + cap + rule.fixedMinor);
	if (!Number.isSafeInteger(totalMinor)) return null;
	return { feeMinor: totalMinor - amountMinor, totalMinor };
}

/**
 * a fee taken out of a gift and what is left of it, both in minor units.
 *
 * both numbers for the reason `FeeEstimate` above carries both: the declined reading of the fee
 * row states the fee and what the org receives in one sentence, and a call site subtracting the
 * one from the gift itself is a second derivation of the other.
 */
export type DeductedFee = {
	readonly feeMinor: number;
	readonly netMinor: number;
};

/**
 * what the processor takes out of a gift the donor did not cover, or `null` when the rule cannot
 * say.
 *
 * the opposite quantity from `estimateFee` above and not a rearrangement of it. the gross-up
 * solves for a total the fee is part of; this is the rule applied to the gift as it stands —
 * `min(proportional, cap) + fixed`, which is the shape `src/lib/server/payments/fees.ts` states for
 * the same rails. a gift of $50.00 grosses up to $51.81 and is deducted down to $48.25, and
 * neither number is reachable from the other.
 *
 * **nothing ever reconciles this.** `POST /api/v1/forms/:id/donations` prices what the donor is
 * charged, which on a declined gift is the gift itself; the processor's deduction happens
 * afterwards at Stripe and no endpoint in this repo returns it. so this figure is display-only and
 * must never reach `CheckoutContext.estimate` (./checkout.machine.ts) — `reconcile` below reads a
 * declining donor's absent estimate as the `unestimated` kind, and a number fed in there would
 * route correct gifts to the correction screen.
 *
 * rounds the proportional part to nearest, where the gross-up rounds up. the gross-up rounds up
 * because a half minor unit rounded down is a shortfall the org absorbs on a gift the donor
 * believed they had covered; this number is charged to nobody and checked against nothing, so
 * neither direction is a shortfall and nearest is the reading wrong by the least. a half unit goes
 * up, which is stated rather than left to be worked out — it is also the direction that never
 * overstates what the org receives.
 *
 * returns `null` where the deduction would leave nothing, and this is the one withholding
 * `estimateFee` above does not share — see `isPriceable`. at a gift smaller than the flat charge
 * the row would state a fee larger than the gift and an org receiving a negative amount, and no
 * figure at all is the honest reading of a price the gift cannot carry. the same gift still grosses
 * up, so the covered reading of the row keeps its figure where this one has none.
 */
export function estimateDeductedFee(
	amountMinor: number,
	rule: FeeRule | undefined
): DeductedFee | null {
	if (!isPriceable(amountMinor, rule)) return null;

	// fixed point for the reason `SCALE` above gives: the rate is exact at six decimal places and a
	// binary-float product of it is not, so the half that decides the rounding has to be a real one.
	const scaled = amountMinor * Math.round(rule.percent * SCALE);
	if (!Number.isSafeInteger(scaled)) return null;
	const proportional = Math.round(scaled / SCALE);
	const cap = rule.capMinor;
	const feeMinor =
		(cap === undefined ? proportional : Math.min(proportional, cap)) + rule.fixedMinor;
	if (feeMinor >= amountMinor) return null;
	return { feeMinor, netMinor: amountMinor - feeMinor };
}

/**
 * whether the server's own numbers can be charged and stated at all.
 *
 * every screen that states a total is a claim about the money, and nothing downstream compares
 * that total against the intent again — so a garbled response would put a number in front of the
 * donor that the charge does not hold. A quote that fails this is a failure the donor is told
 * about rather than one that is rendered.
 *
 * `totalMinor >= amountMinor` is the one cross-field rule, and it is about what the donor is
 * charged: covering the fee adds to the gift and declining leaves it alone, so no fee arrangement
 * produces a total below it. what the org receives is a different quantity and this says nothing
 * about it — see the note on the gross-up above.
 */
export function quoteIsUsable(quote: Quote, amountMinor: number): boolean {
	if (typeof quote.paymentToken !== 'string' || quote.paymentToken.length === 0) return false;
	if (!Number.isSafeInteger(quote.feeMinor) || quote.feeMinor < 0) return false;
	if (!Number.isSafeInteger(quote.totalMinor) || quote.totalMinor <= 0) return false;
	return quote.totalMinor >= amountMinor;
}

/**
 * the three things a reconciliation can be saying about the total.
 *
 * `unestimated` is not `as_estimated`. Where the donor declined to cover the fee, or the rule was
 * unusable, they were shown no number to agree with — calling that "as estimated" is a claim
 * about a screen that never rendered. Three kinds, so the copy can be honest in all three cases.
 *
 * only `adjusted` reaches a screen. the correction screen exists exactly where the figure moved
 * (`confirm` in ./checkout.machine.ts), and the other two are what "charge straight through"
 * is made of — so their labels below are carried rather than rendered.
 */
export const RECONCILIATION_KINDS = ['as_estimated', 'adjusted', 'unestimated'] as const;
export type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number];

/**
 * what a screen would call each outcome.
 *
 * keyed by `ReconciliationKind` rather than `string`, so a fourth kind is a type error here
 * rather than an empty line on the one screen whose job is to state the money. `adjusted` is the
 * one with a render site today (./views.ts); the other two are kept because a kind without a
 * sentence is a kind nobody can put back on a screen.
 */
export const RECONCILIATION_LABELS: Record<ReconciliationKind, string> = {
	as_estimated: 'This is the total you were shown.',
	adjusted: 'The total changed since you pressed Donate.',
	unestimated: 'This is the total you will be charged.'
};

/**
 * the figure the donor was last shown, measured against the server's authority.
 *
 * `shownTotalMinor` is what was on the control the donor pressed, which is not the same thing as
 * "there was an estimate": for any donor who declined to cover the fee, and on any rail the
 * config publishes no rule for, there is no estimate and the gift itself is the figure on the
 * button. Both are ordinary, so a rule that keyed off the estimate's existence would send those
 * gifts to a correction screen with nothing on it to correct.
 *
 * `deltaMinor` is signed. a total that fell and a total that rose are both adjustments and
 * both owe the donor a sentence, but they are not the same news, and an absolute delta renders
 * them identically.
 *
 * `totalMinor` is on every member deliberately: whatever the reconciliation says, the screen
 * needs the number to charge, and a caller that had to unwrap the union to find it would end
 * up defaulting one of the branches.
 */
export type Reconciliation =
	| { readonly kind: 'as_estimated'; readonly totalMinor: number }
	| {
			readonly kind: 'adjusted';
			readonly shownTotalMinor: number;
			readonly totalMinor: number;
			readonly deltaMinor: number;
	  }
	| { readonly kind: 'unestimated'; readonly totalMinor: number };

/**
 * the one member a screen is drawn for, named so a projection can require it.
 *
 * the correction screen renders `adjusted` and nothing else, so the step that carries a
 * reconciliation carries this rather than the union — which is what stops a layout rendering the
 * correction copy over a figure that never moved.
 */
export type AdjustedReconciliation = Extract<Reconciliation, { readonly kind: 'adjusted' }>;

/**
 * compares what the donor was shown against what they will be charged.
 *
 * `shownTotalMinor` decides the kind, and `estimate` decides only which of the two agreeing kinds
 * is named. That split is the whole rule: nobody is charged a figure they were not shown, and a
 * deployment that shows no fee at all is not thereby a deployment that corrects every gift.
 *
 * takes a `null` estimate as a first-class input rather than making the caller branch: "there was
 * no estimate" is one of the three answers this function exists to give, and pushing it back to
 * the machine is how a `?? 0` ends up comparing a real total against a fabricated zero.
 */
export function reconcile(
	estimate: FeeEstimate | null,
	authority: { readonly feeMinor: number; readonly totalMinor: number },
	shownTotalMinor: number
): Reconciliation {
	if (authority.totalMinor !== shownTotalMinor) {
		return {
			kind: 'adjusted',
			shownTotalMinor,
			totalMinor: authority.totalMinor,
			deltaMinor: authority.totalMinor - shownTotalMinor
		};
	}
	return estimate === null
		? { kind: 'unestimated', totalMinor: authority.totalMinor }
		: { kind: 'as_estimated', totalMinor: authority.totalMinor };
}
