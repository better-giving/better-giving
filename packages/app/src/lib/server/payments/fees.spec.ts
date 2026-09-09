import { describe, expect, it } from 'vitest';
import { estimateFee } from '@better-giving/form/fee';
import { PAYMENT_METHODS, WALLET_METHODS } from '@better-giving/form/v1';
import { STRIPE_US_FEE_RULES } from './fees';

describe('STRIPE_US_FEE_RULES', () => {
	/**
	 * the published card price, and the two numbers asserted separately because they are two
	 * different mistakes: a rate written as `2.9` rather than `0.029` is a hundred-fold
	 * over-collection stated on the screen that asks for money, and a flat charge written in
	 * dollars rather than cents is the same error one order of magnitude down.
	 */
	it('prices a card at 2.9% plus 30 cents', () => {
		expect(STRIPE_US_FEE_RULES.card).toEqual({ percent: 0.029, fixedMinor: 30 });
	});

	// a wallet tokenises a card and settles at card pricing, so the two must not merely match
	// today — they must be the card rule, or one of them gets edited alone.
	it.each(WALLET_METHODS)('prices %s exactly as a card', (wallet) => {
		expect(STRIPE_US_FEE_RULES[wallet]).toBe(STRIPE_US_FEE_RULES.card);
	});

	/**
	 * the bank-debit price, and the cap is the half that cannot be dropped: without it every gift
	 * above $620.00 quotes a fee larger than the one Stripe takes, and the surplus is collected
	 * from someone giving money to a charity. $620 rather than the $625 the bare rate crosses at,
	 * because `estimateFee` grosses the fee up so the gift arrives whole.
	 */
	it('prices a bank debit at 0.8% capped at $5.00, with no flat charge', () => {
		expect(STRIPE_US_FEE_RULES.ach).toEqual({ percent: 0.008, fixedMinor: 0, capMinor: 500 });
	});

	// every rail priced, including one added to the union tomorrow. the annotation on the constant
	// already makes a gap a compile error; this is what catches a gap after somebody widens it.
	it('prices every rail this app can offer', () => {
		for (const method of PAYMENT_METHODS) expect(STRIPE_US_FEE_RULES[method]).toBeDefined();
	});

	/**
	 * every rule is one the estimator will actually use.
	 *
	 * `estimateFee` returns `null` on a rule it cannot trust — a rate past `MAX_FEE_PERCENT`, a
	 * non-integer flat charge, a malformed cap — and the form degrades to showing no fee line at
	 * all. that degradation is correct for a garbled response off the wire and would be silent
	 * here: this constant is the one input to it that is not untrusted JSON, so a typo in it
	 * would take the fee line off every donation form with nothing reporting why.
	 */
	it.each(PAYMENT_METHODS)('gives %s a rule the estimator accepts', (method) => {
		expect(estimateFee(10000, STRIPE_US_FEE_RULES[method])).not.toBeNull();
	});

	/**
	 * the cap binding, asserted through the estimator rather than by reading `capMinor` back.
	 *
	 * $1,000 over a bank debit is 0.8% = $8.00 uncapped, and the published price is $5.00. the
	 * gross-up is what the donor covers, so the fee lands a little above the raw cap — the point
	 * of the case is the order of magnitude the bound puts it in, which is the $5 ceiling rather
	 * than an unbounded rate.
	 */
	it('stops a bank debit’s proportional fee at the $5.00 cap', () => {
		const uncapped = estimateFee(100000, { percent: 0.008, fixedMinor: 0 });
		const capped = estimateFee(100000, STRIPE_US_FEE_RULES.ach);
		expect(capped?.feeMinor).toBe(500);
		expect(uncapped?.feeMinor).toBeGreaterThan(500);
	});

	/**
	 * where the cap starts binding, which is $620.00 and not the $625 the bare rate crosses at.
	 *
	 * the difference is the gross-up: `estimateFee` charges the smaller of the grossed-up total
	 * and `amount + cap`, so the crossover is the amount at which those two agree rather than the
	 * one at which 0.8% reaches $5.00. asserted rather than only stated, because the number is
	 * quoted in the comment on the constant and a reader has no other way to check it.
	 */
	it('binds the bank-debit cap from a gift of $620.00 upwards', () => {
		const bare = { percent: 0.008, fixedMinor: 0 };
		expect(estimateFee(62000, bare)?.feeMinor).toBe(500);
		expect(estimateFee(62000, STRIPE_US_FEE_RULES.ach)?.feeMinor).toBe(500);

		// a cent above it, the unbounded fee keeps growing and the published one does not.
		expect(estimateFee(62001, bare)?.feeMinor).toBeGreaterThan(500);
		expect(estimateFee(62001, STRIPE_US_FEE_RULES.ach)?.feeMinor).toBe(500);
	});

	/**
	 * frozen at every level, because `readonly` is erased at runtime and this object is shared by
	 * reference into every `FormConfig` served from an isolate that outlives the request.
	 *
	 * each rule as well as the record: `Object.freeze` is shallow, so sealing the outer object
	 * alone would leave every rate inside it writable — and the rate is the value that would
	 * actually be worth changing under someone.
	 */
	it('cannot be rewritten in place, at either level', () => {
		expect(Object.isFrozen(STRIPE_US_FEE_RULES)).toBe(true);
		for (const method of PAYMENT_METHODS) {
			expect(Object.isFrozen(STRIPE_US_FEE_RULES[method])).toBe(true);
		}
	});
});
