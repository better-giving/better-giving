import { describe, expect, it } from 'vitest';
import {
	estimateDeductedFee,
	estimateFee,
	MAX_FEE_PERCENT,
	reconcile,
	RECONCILIATION_KINDS,
	RECONCILIATION_LABELS
} from './fee';
import type { FeeRule } from './v1';

// node pool, no browser and no Stripe — the whole point of keeping the fee arithmetic in a
// module of its own. Every claim below is decidable from two numbers and a rule.

/** Stripe's ordinary US card price at the time of writing; the shape matters, not the rate. */
const CARD: FeeRule = { percent: 0.029, fixedMinor: 30 };

/** Stripe's US bank-debit price at the time of writing: 0.8% capped at $5.00, no flat charge. */
const ACH: FeeRule = { percent: 0.008, fixedMinor: 0, capMinor: 500 };

/** unwraps an estimate that must have been computable, reporting the rule if it was not. */
function estimated(amountMinor: number, rule: FeeRule) {
	const estimate = estimateFee(amountMinor, rule);
	if (estimate === null) {
		throw new Error(`expected ${amountMinor} under ${JSON.stringify(rule)} to be estimable`);
	}
	return estimate;
}

/**
 * the gross-up an estimate is measured against, in integers with no float anywhere in it.
 *
 * `ceil((amount + fixed) / (1 - percent))` computed in BigInt at the rate's six-decimal
 * resolution — an oracle the binary-float quotient cannot agree with by accident.
 */
function exactCeiling(amountMinor: number, rule: FeeRule): bigint {
	const scale = 1_000_000n;
	const numerator = BigInt(amountMinor + rule.fixedMinor) * scale;
	const denominator = scale - BigInt(Math.round(rule.percent * 1_000_000));
	const quotient = numerator / denominator;
	return numerator % denominator === 0n ? quotient : quotient + 1n;
}

describe('estimateFee', () => {
	it('grosses the total up so the org nets the amount the donor chose', () => {
		// the formula is the point and it is not `amount * percent + fixed`. The processor
		// charges its percentage on the total it captures, so a fee added on top is itself
		// charged for. Solving total = amount + total*percent + fixed gives
		// total = (amount + fixed) / (1 - percent) — and the naive version leaves the org
		// short by percent*fee on every gift, forever, in a direction nobody audits.
		//
		// $25.00 at 2.9% + 30c: (2500 + 30) / 0.971 = 2605.56… → 2606.
		const estimate = estimated(2500, CARD);
		expect(estimate.totalMinor).toBe(2606);
		expect(estimate.feeMinor).toBe(106);
	});

	it('rounds the total up, never down, so the shortfall is never the org’s', () => {
		// a half-cent rounded down is an underpayment the org absorbs silently on every gift.
		// Rounding up costs the donor at most one minor unit and keeps the invariant that what
		// the org receives is at least what the donor chose to give.
		const { totalMinor, feeMinor } = estimated(2500, CARD);
		const chargedByProcessor = Math.round(totalMinor * CARD.percent) + CARD.fixedMinor;
		expect(totalMinor - chargedByProcessor).toBeGreaterThanOrEqual(2500);
		expect(feeMinor).toBe(totalMinor - 2500);
	});

	it('charges the flat part alone when the rule has no percentage', () => {
		// a rail priced as a flat charge — ACH is commonly capped this way — must not divide by
		// anything, and the arithmetic has to degrade to plain addition rather than to a
		// special case somebody forgets to write.
		expect(estimated(10_000, { percent: 0, fixedMinor: 500 })).toEqual({
			feeMinor: 500,
			totalMinor: 10_500
		});
	});

	it('prices a rule with no cap exactly as it always did', () => {
		// the cap is an addition to `FeeRule` in a contract that may only be added to, so the
		// rails that carry no cap have to be untouched by it — an absent bound is not a bound of
		// zero, and reading it as one would make every card fee the flat charge alone.
		expect(estimated(2500, CARD)).toEqual({ feeMinor: 106, totalMinor: 2606 });
		expect(estimated(2500, { percent: 0.008, fixedMinor: 0 }).totalMinor).toBe(2521);
	});

	it('agrees with an uncapped rule on every gift below the cap', () => {
		// a cap that is never reached must not move a single number. the two rules differ only in
		// the bound, so any disagreement here is the cap leaking into arithmetic it does not
		// govern.
		const uncapped: FeeRule = { percent: ACH.percent, fixedMinor: ACH.fixedMinor };
		for (const amountMinor of [100, 2500, 10_000, 50_000, 61_999, 62_000]) {
			expect(estimated(amountMinor, ACH)).toEqual(estimated(amountMinor, uncapped));
		}
	});

	it('stops the proportional part at the cap once the gift is large enough to reach it', () => {
		// the rule this exists for: Stripe's US bank debit is 0.8% capped at $5.00, so past the
		// cap the fee is flat and the total is the gift plus the cap. an uncapped gross-up quotes
		// 0.8% of the whole gift — $8.00 on a $1000 donation against the $5.00 actually taken —
		// which is an over-collection stated on the screen that asks for money.
		expect(estimated(100_000, ACH)).toEqual({ feeMinor: 500, totalMinor: 100_500 });
		// the point the cap starts binding: 0.8% of a $625 charge is exactly $5.00, so $620 net
		// is the last gift the uncapped gross-up and the capped one agree on.
		expect(estimated(62_000, ACH).totalMinor).toBe(62_500);
		expect(estimated(62_001, ACH)).toEqual({ feeMinor: 500, totalMinor: 62_501 });
	});

	it('adds the flat charge above the cap rather than inside it', () => {
		// the cap bounds the proportional part alone. read as a bound on the whole fee it would
		// quote under what the processor takes on a rail priced with both, and the difference is
		// a shortfall the org absorbs.
		expect(estimated(100_000, { percent: 0.008, fixedMinor: 30, capMinor: 500 })).toEqual({
			feeMinor: 530,
			totalMinor: 100_530
		});
	});

	it('never asks a donor covering the fee for more than the capped fee', () => {
		// the fee-coverage path is the one that spends the donor's money, so the bound is
		// asserted over a spread rather than at the one amount somebody had in mind — and with
		// the org still whole at every point, because a cap the gross-up honoured by undercharging
		// would move the shortfall onto the org instead of the donor.
		for (const amountMinor of [100, 62_000, 62_001, 100_000, 1_000_000, 250_000_000]) {
			const { feeMinor, totalMinor } = estimated(amountMinor, ACH);
			expect(feeMinor).toBeLessThanOrEqual(500 + ACH.fixedMinor);
			const chargedByProcessor =
				Math.min(Math.round(totalMinor * ACH.percent), 500) + ACH.fixedMinor;
			expect(totalMinor - chargedByProcessor).toBeGreaterThanOrEqual(amountMinor);
		}
	});

	it('lands on the exact ceiling with a cap present, not one minor unit above it', () => {
		// the fixed-point arithmetic the gross-up is computed on is what puts 7% of 465 at 500
		// rather than at 501, and a cap must not reintroduce the float path it exists to avoid:
		// both numbers the cap chooses between are integers, so the choice adds no rounding of
		// its own. the cent is not the point — a total one above the server's exact answer makes
		// the confirm screen report an adjustment over a difference that was never there.
		expect(estimated(465, { percent: 0.07, fixedMinor: 0, capMinor: 500 }).totalMinor).toBe(500);
		expect(estimated(435, { percent: 0.07, fixedMinor: 30, capMinor: 500 }).totalMinor).toBe(500);
	});

	it('reports no estimate for a cap that is not a whole non-negative amount', () => {
		// a malformed bound is a misconfigured rule, and it degrades the way every other one
		// does: no fee line, the authoritative quote is the only number the donor is shown. a
		// fractional or negative cap silently applied would be a total nobody can reconcile.
		expect(estimateFee(100_000, { percent: 0.008, fixedMinor: 0, capMinor: 500.5 })).toBeNull();
		expect(estimateFee(100_000, { percent: 0.008, fixedMinor: 0, capMinor: -500 })).toBeNull();
		expect(
			estimateFee(100_000, { percent: 0.008, fixedMinor: 0, capMinor: Number.NaN })
		).toBeNull();
		// a cap of nothing is a price: the rail takes its flat charge and no proportion at all.
		expect(estimated(100_000, { percent: 0.008, fixedMinor: 30, capMinor: 0 })).toEqual({
			feeMinor: 30,
			totalMinor: 100_030
		});
	});

	it('reports no estimate rather than a number when the rule cannot be grossed up', () => {
		// a processor that takes 100% has no gross-up: the equation's denominator is zero and
		// every larger percentage inverts the sign, which would put a negative fee on the screen
		// asking for money. This is misconfiguration, and the honest response is to show no
		// estimate at all and let the authoritative quote be the only number the donor sees —
		// never to throw, because a donation form that throws on load stops donations.
		expect(estimateFee(2500, { percent: 1, fixedMinor: 0 })).toBeNull();
		expect(estimateFee(2500, { percent: 1.5, fixedMinor: 0 })).toBeNull();
		expect(estimateFee(2500, { percent: -0.1, fixedMinor: 0 })).toBeNull();
	});

	it('lands on the exact ceiling rather than one minor unit above it', () => {
		// both of these gross up to exactly 500, and a binary-float quotient puts both at 501.
		// The cent is not the point: a total one above the server's exact answer makes every gift
		// at such a rate reconcile as `adjusted`, so the confirm screen tells the donor the total
		// changed over a difference that was never there.
		expect(estimated(465, { percent: 0.07, fixedMinor: 0 }).totalMinor).toBe(500);
		expect(estimated(435, { percent: 0.07, fixedMinor: 30 }).totalMinor).toBe(500);
	});

	it('never totals below the exact ceiling, so the org is never short', () => {
		// the invariant the rounding exists for, over a spread rather than over the one rate
		// somebody had in mind — a half minor unit rounded down is an underpayment the org absorbs
		// silently, on every gift, in the direction nobody audits.
		for (const percent of [0, 0.008, 0.029, 0.035, 0.07, 0.199, 0.5]) {
			for (const fixedMinor of [0, 30, 500]) {
				for (const amountMinor of [435, 465, 500, 999, 2500, 10_000, 123_457, 5_000_000]) {
					const rule = { percent, fixedMinor };
					expect(BigInt(estimated(amountMinor, rule).totalMinor)).toBeGreaterThanOrEqual(
						exactCeiling(amountMinor, rule)
					);
				}
			}
		}
	});

	it('reports no estimate at all when the config published no rule for the rail', () => {
		// `feeRules` arrives as untrusted JSON keyed by rail, and a response missing one key hands
		// this function `undefined` through a type that says otherwise. Answering `null` is what
		// keeps that from being a TypeError thrown inside a state transition — which stops the
		// whole form rather than one fee line, leaving a live-looking button on a frozen page.
		expect(estimateFee(2500, undefined)).toBeNull();
	});

	it('refuses a rate no processor charges rather than producing a garbage total', () => {
		// the arithmetic degrades long before the denominator reaches zero: at rates approaching 1
		// the gross-up divides by almost nothing, and `1 - Number.EPSILON` put 4503599627370496000
		// minor units on the screen that asks for money. Above the ceiling the estimate is
		// withheld and the authoritative quote is the only number the donor sees, which is the
		// same degradation an absent rule gets.
		expect(estimateFee(2500, { percent: 1 - Number.EPSILON, fixedMinor: 0 })).toBeNull();
		expect(estimateFee(2500, { percent: 0.9, fixedMinor: 0 })).toBeNull();
		// the boundary is read off the constant rather than off a copy of its value, so raising
		// the ceiling moves this test with it instead of leaving it asserting a retired rate.
		expect(estimateFee(2500, { percent: MAX_FEE_PERCENT * 1.02, fixedMinor: 0 })).toBeNull();
		// the ceiling itself is still a price.
		expect(estimateFee(2500, { percent: MAX_FEE_PERCENT, fixedMinor: 0 })).not.toBeNull();
	});

	it('reports no estimate for an amount that is not a positive whole minor unit', () => {
		// `2500.5` cents is not money, and the one place a float can enter is a host page
		// setting an attribute. Refusing here keeps the fraction from compounding through the
		// gross-up into a total nobody can reconcile.
		expect(estimateFee(0, CARD)).toBeNull();
		expect(estimateFee(-2500, CARD)).toBeNull();
		expect(estimateFee(2500.5, CARD)).toBeNull();
		expect(estimateFee(Number.NaN, CARD)).toBeNull();
	});
});

describe('estimateDeductedFee', () => {
	it('takes the fee out of the gift rather than adding it on top', () => {
		// the opposite quantity from the gross-up, and the whole reason this function exists: what
		// the processor deducts from the gift is `min(proportional, cap) + fixed` on the gift itself,
		// never solved against a total the fee is part of. $50.00 at 2.9% + 30c leaves $48.25, where
		// the gross-up of the same gift would have charged the donor $51.81.
		expect(estimateDeductedFee(5000, CARD)).toEqual({ feeMinor: 175, netMinor: 4825 });
	});

	it('stops the proportional part at the cap, and leaves it alone below one', () => {
		// the same bound the gross-up honours, applied to the gift rather than to a total: 0.8% of
		// $1000.00 is $8.00 and the rail takes $5.00. read as a bound on the whole fee it would also
		// swallow the flat charge, so the flat part is added above it here as it is there.
		expect(estimateDeductedFee(100_000, ACH)).toEqual({ feeMinor: 500, netMinor: 99_500 });
		expect(estimateDeductedFee(100_000, { percent: 0.008, fixedMinor: 30, capMinor: 500 })).toEqual(
			{ feeMinor: 530, netMinor: 99_470 }
		);
		// below the cap the bound must not move a single number — an absent bound is not a bound of
		// zero, and a capped rule and an uncapped one price the same gift identically here.
		expect(estimateDeductedFee(5000, ACH)).toEqual({ feeMinor: 40, netMinor: 4960 });
		expect(estimateDeductedFee(5000, { percent: 0.008, fixedMinor: 0 })).toEqual({
			feeMinor: 40,
			netMinor: 4960
		});
	});

	it('rounds the proportional part to nearest rather than up, and takes a half upwards', () => {
		// the gross-up rounds up because a half rounded down is a shortfall the org absorbs on a gift
		// the donor believed they had covered. this number is charged to nobody, so nearest is the
		// reading wrong by the least — and 2.9% of $25.00 is exactly 72.5 minor units, which is the
		// half that decides it. rounding up would state 73 for the wrong reason and rounding down 72.
		expect(estimateDeductedFee(2500, CARD)?.feeMinor).toBe(103);
		// and it is genuinely to nearest rather than up: 2.9% of $10.00 is 29 exactly, and of $10.10
		// is 29.29 — which rounds down to 29 where a ceiling would state 30.
		expect(estimateDeductedFee(1000, CARD)?.feeMinor).toBe(59);
		expect(estimateDeductedFee(1010, CARD)?.feeMinor).toBe(59);
	});

	it('reports no deduction where the fee would leave the org nothing', () => {
		// a gift smaller than the flat charge prices to a fee larger than the gift, and the row would
		// state an org receiving a negative amount. `minAmountMinor` is a per-form figure with a floor
		// of one minor unit (`config.ts`), so this is a configuration rather than an impossibility —
		// and no figure is the honest reading of a price the gift cannot carry.
		expect(estimateDeductedFee(30, CARD)).toBeNull();
		expect(estimateDeductedFee(29, CARD)).toBeNull();
		// the first gift that carries its own price, and the proportional part is a whole minor unit
		// by then: 2.9% of 32 rounds to 1 on top of the 30 flat.
		expect(estimateDeductedFee(32, CARD)).toEqual({ feeMinor: 31, netMinor: 1 });
	});

	it('holds that floor alone, where the gross-up still prices the same gift', () => {
		// the one degradation the two readings do not share, and it is deliberate. the predicate they
		// do share is misconfiguration; this floor is a priceable rule meeting a gift it cannot be
		// taken out of, which is a fact about the deduction and not about the rule. covering the fee
		// on that gift is a real charge a donor can be asked for, and withholding it would take a
		// chargeable figure off the row — and, through `estimate`, route the gift past the
		// reconciliation that measures authority's total against what the donor was shown.
		expect(estimateDeductedFee(30, CARD)).toBeNull();
		expect(estimateFee(30, CARD)).toEqual({ feeMinor: 32, totalMinor: 62 });
	});

	it('withholds the deduction on every degradation the gross-up withholds on', () => {
		// the two readings of the fee row share one predicate, so a misconfigured rule takes both
		// figures off the row together. a donor shown one and not the other reads a row that
		// contradicts itself — the switch says the org pays a fee that the row says does not exist.
		for (const [amountMinor, rule] of [
			[5000, undefined],
			[0, CARD],
			[-5000, CARD],
			[5000.5, CARD],
			[Number.NaN, CARD],
			[5000, { percent: 1, fixedMinor: 0 }],
			[5000, { percent: -0.1, fixedMinor: 0 }],
			[5000, { percent: MAX_FEE_PERCENT * 1.02, fixedMinor: 0 }],
			[5000, { percent: 0.029, fixedMinor: 30.5 }],
			[5000, { percent: 0.008, fixedMinor: 0, capMinor: 500.5 }],
			[5000, { percent: 0.008, fixedMinor: 0, capMinor: -500 }]
		] as const) {
			expect(estimateDeductedFee(amountMinor, rule)).toBeNull();
			expect(estimateFee(amountMinor, rule)).toBeNull();
		}
		// and the ceiling itself is still a price on both readings.
		expect(estimateDeductedFee(5000, { percent: MAX_FEE_PERCENT, fixedMinor: 0 })).not.toBeNull();
	});
});

describe('reconcile', () => {
	it('reports the total as estimated when authority charges the figure that was shown', () => {
		// the ordinary case, and it still gets a name rather than a null: "this is what you were
		// shown" is a claim, not the absence of one.
		const result = reconcile(estimated(2500, CARD), { feeMinor: 106, totalMinor: 2606 }, 2606);
		expect(result.kind).toBe('as_estimated');
		expect(result.totalMinor).toBe(2606);
	});

	it('states the difference when authority disagrees, rather than overwriting it', () => {
		// the state the correction screen exists for. The rule is a published rate; the server
		// knows the real one, and the day Stripe prices a method differently the two disagree.
		// A silent overwrite means a donor pressed a button saying $26.06 and was charged
		// $26.50 — so the difference is carried, signed, and said out loud.
		const result = reconcile(estimated(2500, CARD), { feeMinor: 150, totalMinor: 2650 }, 2606);
		expect(result).toEqual({
			kind: 'adjusted',
			shownTotalMinor: 2606,
			totalMinor: 2650,
			deltaMinor: 44
		});
	});

	it('signs the delta so a total that fell is distinguishable from one that rose', () => {
		// a cheaper-than-estimated total is still an adjustment — the donor is owed the same
		// sentence — but "we corrected this down" and "we corrected this up" are not the same
		// news, and an absolute delta would render them identically.
		const result = reconcile(estimated(2500, CARD), { feeMinor: 80, totalMinor: 2580 }, 2606);
		expect(result.kind).toBe('adjusted');
		expect(result).toMatchObject({ deltaMinor: -26 });
	});

	it('reports an unestimated total when the donor was never shown an estimate', () => {
		// a declined fee, a rail with no published rule and an unusable one all reach this function
		// with no estimate to compare against. Calling that `as_estimated` would be a lie about a
		// number nobody saw, so it is its own kind.
		const result = reconcile(null, { feeMinor: 0, totalMinor: 2500 }, 2500);
		expect(result.kind).toBe('unestimated');
		expect(result.totalMinor).toBe(2500);
	});

	// the discriminator, asserted on its own rather than inferred from the four cases above: the
	// kind is decided by what the donor saw and never by whether an estimate happened to exist. a
	// rule keyed off the estimate would put a correction screen in front of every donor who
	// declined the fee — which is an ordinary gift, not an edge.
	it('is decided by the figure the donor saw, not by whether there was an estimate', () => {
		// no estimate and the gift itself on the button, charged exactly: nothing to correct.
		expect(reconcile(null, { feeMinor: 0, totalMinor: 5000 }, 5000).kind).toBe('unestimated');
		// no estimate and a total that moved anyway — an unusable fee rule under a donor who is
		// covering it. the donor saw $50.00 and is being charged $51.75, which is a correction.
		expect(reconcile(null, { feeMinor: 175, totalMinor: 5175 }, 5000)).toEqual({
			kind: 'adjusted',
			shownTotalMinor: 5000,
			totalMinor: 5175,
			deltaMinor: 175
		});
	});
});

describe('the reconciliation vocabulary', () => {
	it('names every kind a reconciliation can be in', () => {
		// keyed by the union rather than by `string`, so a fourth kind is a type error here
		// rather than a blank line on the screen that states the money.
		for (const kind of RECONCILIATION_KINDS) {
			expect(RECONCILIATION_LABELS[kind]).toBeTypeOf('string');
		}
		expect(RECONCILIATION_KINDS).toHaveLength(3);
	});
});
