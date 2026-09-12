import { describe, expect, it } from 'vitest';
import { estimateFee } from '@better-giving/form/fee';
import { PAYPAL_RAILS, STRIPE_RAILS } from '@better-giving/form/embed/rails';
import { PAYMENT_METHODS, WALLET_METHODS } from '@better-giving/form/v1';
import {
	PAYPAL_US_FEE_RULES_CHARITY,
	PAYPAL_US_FEE_RULES_STANDARD,
	paypalFeeRules,
	servedFeeRules,
	STRIPE_US_FEE_RULES
} from './fees';

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

	// every rail this processor settles, including one added to its list tomorrow. the annotation on
	// the constant already makes a gap a compile error; this is what catches a gap after somebody
	// widens it.
	it('prices every rail this processor settles', () => {
		for (const rail of STRIPE_RAILS) expect(STRIPE_US_FEE_RULES[rail]).toBeDefined();
	});

	// and none it does not: a price here for a rail another processor settles is a number nothing
	// takes, sitting where a reader would read it as this processor's.
	it('prices no rail another processor settles', () => {
		expect(Object.keys(STRIPE_US_FEE_RULES).sort()).toEqual([...STRIPE_RAILS].sort());
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
	it.each(STRIPE_RAILS)('gives %s a rule the estimator accepts', (rail) => {
		expect(estimateFee(10000, STRIPE_US_FEE_RULES[rail])).not.toBeNull();
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
		for (const rail of STRIPE_RAILS) {
			expect(Object.isFrozen(STRIPE_US_FEE_RULES[rail])).toBe(true);
		}
	});
});

describe('the two PayPal tables', () => {
	/**
	 * the published charity and standard rates, asserted as two numbers each for the reason the card
	 * price is: a rate written as `1.99` rather than `0.0199` is a hundred-fold over-collection on
	 * the screen that asks for money, and a flat charge written in dollars is the same error one
	 * order of magnitude down.
	 *
	 * two tables rather than one rate plus a modifier, because which of them an organisation is on
	 * is an answer about its account and not a figure anybody types — the header on ./fees.ts argues
	 * what that keeps.
	 */
	it('prices an approved charity at 1.99% plus 49 cents', () => {
		expect(PAYPAL_US_FEE_RULES_CHARITY.paypal).toEqual({ percent: 0.0199, fixedMinor: 49 });
	});

	it('prices every other organisation at 3.49% plus 49 cents', () => {
		expect(PAYPAL_US_FEE_RULES_STANDARD.paypal).toEqual({ percent: 0.0349, fixedMinor: 49 });
	});

	// Venmo is a funding source inside the same checkout, so it must not merely match the PayPal
	// rule today — it must be that rule, or one of them gets edited alone.
	it.each([PAYPAL_US_FEE_RULES_CHARITY, PAYPAL_US_FEE_RULES_STANDARD])(
		'prices Venmo exactly as the PayPal rail',
		(table) => {
			expect(table.venmo).toBe(table.paypal);
		}
	);

	it.each([PAYPAL_US_FEE_RULES_CHARITY, PAYPAL_US_FEE_RULES_STANDARD])(
		'prices this processor’s rails and no others',
		(table) => {
			expect(Object.keys(table).sort()).toEqual([...PAYPAL_RAILS].sort());
		}
	);

	// frozen at both levels, for the reason the Stripe table is: these objects are handed by
	// reference into every config an isolate serves, and `Object.freeze` is shallow.
	it.each([PAYPAL_US_FEE_RULES_CHARITY, PAYPAL_US_FEE_RULES_STANDARD])(
		'cannot be rewritten in place, at either level',
		(table) => {
			expect(Object.isFrozen(table)).toBe(true);
			for (const rail of PAYPAL_RAILS) expect(Object.isFrozen(table[rail])).toBe(true);
		}
	);
});

describe('the table a config is served', () => {
	/**
	 * every rail the wire vocabulary holds, priced.
	 *
	 * `FeeRules` in packages/form/src/v1.ts is total over that vocabulary, and a rail served without
	 * a rule is a fee line the donation form draws nothing for — so the composition is what has to
	 * be total, whichever processors a deployment happens to hold.
	 */
	it('prices every rail the vocabulary holds', () => {
		const served = servedFeeRules(PAYPAL_US_FEE_RULES_STANDARD);

		for (const rail of PAYMENT_METHODS) expect(served[rail]).toBeDefined();
		expect(Object.keys(served).sort()).toEqual([...PAYMENT_METHODS].sort());
	});

	// each processor's own rules and nothing composed over them: the two tables price disjoint
	// rails, so neither can overwrite the other's price however they are spread together.
	it('takes each rail’s price from the processor that settles it', () => {
		const served = servedFeeRules(PAYPAL_US_FEE_RULES_CHARITY);

		for (const rail of STRIPE_RAILS) expect(served[rail]).toBe(STRIPE_US_FEE_RULES[rail]);
		for (const rail of PAYPAL_RAILS) {
			expect(served[rail]).toBe(PAYPAL_US_FEE_RULES_CHARITY[rail]);
		}
	});

	// the charity switch is a fact about the org's PayPal account, so the two answers have to be two
	// different served tables rather than one table read differently.
	it('serves the rate the caller named', () => {
		expect(servedFeeRules(PAYPAL_US_FEE_RULES_CHARITY).paypal.percent).toBe(0.0199);
		expect(servedFeeRules(PAYPAL_US_FEE_RULES_STANDARD).paypal.percent).toBe(0.0349);
	});

	// handed by reference into every `FormConfig` an isolate serves, for as long as that isolate
	// lives: one caller writing to it in place reprices every form served after it, and the constants
	// in the tree would still read correctly.
	it('cannot be rewritten in place', () => {
		expect(Object.isFrozen(servedFeeRules(PAYPAL_US_FEE_RULES_STANDARD))).toBe(true);
	});
});

describe('the PayPal table a deployment is priced at', () => {
	/**
	 * the one value that picks the charity rate, spelled as .dev.vars.example documents it.
	 *
	 * PayPal reports on no call which rate an account is on, so this variable is the whole of the
	 * answer and nothing can check it against the account.
	 */
	it('prices an approved organisation at the charity rate', () => {
		expect(paypalFeeRules({ PAYPAL_CHARITY_RATE_APPROVED: 'true' })).toBe(
			PAYPAL_US_FEE_RULES_CHARITY
		);
	});

	/**
	 * every other value is the standard rate, and the asymmetry is why.
	 *
	 * read as approved, a donor covering the fee is quoted 1.99% against the 3.49% PayPal takes and
	 * the organisation nets less than the gift the donor chose. read as standard, they are quoted
	 * more than PayPal takes and the surplus reaches the organisation. so an answer that is not the
	 * word falls to the rate that cannot cost the organisation money — `false` and `yes` alike.
	 */
	it.each([
		{ label: 'unset', env: {} },
		{ label: 'false', env: { PAYPAL_CHARITY_RATE_APPROVED: 'false' } },
		{ label: 'yes', env: { PAYPAL_CHARITY_RATE_APPROVED: 'yes' } },
		{ label: '1', env: { PAYPAL_CHARITY_RATE_APPROVED: '1' } }
	])('prices an organisation whose answer is $label at the standard rate', ({ env }) => {
		expect(paypalFeeRules(env)).toBe(PAYPAL_US_FEE_RULES_STANDARD);
	});

	// an operator answering the question rather than giving a different answer.
	it.each(['True', 'TRUE'])('reads %s as the same answer', (spelling) => {
		expect(paypalFeeRules({ PAYPAL_CHARITY_RATE_APPROVED: spelling })).toBe(
			PAYPAL_US_FEE_RULES_CHARITY
		);
	});
});
