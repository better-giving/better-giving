import { describe, expect, it } from 'vitest';
import { PAYPAL_RAILS, RAILS, STRIPE_RAILS } from '@better-giving/form/embed/rails';
import { PAYMENT_METHODS } from '@better-giving/form/v1';
import { INTENT_METHODS } from './stripe';

// the guard on the one thing the two ends of a confirmation have to agree about.
//
// why this file exists. a donation is minted by one adapter and confirmed by the other: ./stripe.ts
// names the rails the intent may be paid on, and `packages/form/src/embed/stripe.ts` names the rails the
// element group confirms with. a confirmation carries the group's own list for the API to check
// against the intent's, so a rail either of them spells differently is a gift refused before any
// rail is touched — no charge, no decline, an intent left at `requires_payment_method` with nothing
// attached and no `last_payment_error`, and a donor reading a thank-you. it is observed rather
// than hypothetical: a divergence here has stopped every gift on a deployment.
//
// two tables rather than one, and that is deliberate rather than the drift this catches. each
// adapter is the only module on its side that knows a payment SDK exists (CLAUDE.md routes payments
// through the `PaymentProvider` port), so the provider's vocabulary stops at those two files —
// hoisting a shared table into packages/form/src/v1.ts would put `us_bank_account` in the wire contract
// every other provider would then have to speak. what the pair owes instead is agreement, which is
// what this asserts.
//
// it is a spec on this side because the import direction allows it: `$lib/server/**` may import
// from `packages/form/src/**` and never the other way (CLAUDE.md). nothing in production imports the browser
// adapter from here, and nothing should — it carries the browser SDK with it.
//
// the behaviour that puts the group on one rail for the length of a confirmation is
// `packages/form/src/embed/stripe.dom.spec.ts`; what this adds is that the rail it lands on is the one the
// intent was minted for.

describe('the rails a confirmation names at both ends', () => {
	// total over this processor's own rails, so a rail added there reaches this file rather than
	// being covered by whichever cases somebody remembered to write.
	it.each(STRIPE_RAILS)('spells %s the same way on the intent and in the group', (method) => {
		expect([...INTENT_METHODS[method]]).toEqual([RAILS[method]]);
	});

	// the intent is payable on exactly one rail, because the fee that produced its amount was priced
	// for that rail (./fees.ts). the group is narrowed to that rail at confirmation, so a second
	// entry here would be a rail the group could never name back.
	it.each(STRIPE_RAILS)('mints a %s intent for one rail and no more', (method) => {
		expect(INTENT_METHODS[method]).toHaveLength(1);
	});

	/**
	 * every rail is settled by exactly one processor, which is what lets each adapter hold a table
	 * total over its own list rather than over the vocabulary.
	 *
	 * the runtime half of a claim the types make one way only: `STRIPE_RAILS` and `PAYPAL_RAILS` are
	 * each checked to be a subset of `PAYMENT_METHODS`, and nothing there says the two cover it and
	 * do not overlap. a rail in neither is one no processor settles and no table owes a price or an
	 * intent method for — a gift offered on it reaches the point of charging and finds nothing.
	 */
	it('gives every rail one processor and no more', () => {
		const owned = [...STRIPE_RAILS, ...PAYPAL_RAILS];

		expect([...owned].sort()).toEqual([...PAYMENT_METHODS].sort());
		expect(new Set(owned).size).toBe(owned.length);
	});

	// this processor mints an intent for its own rails and for no other: a rail it does not settle
	// with an entry here is one this adapter would name to an API that has no method for it.
	it('mints an intent for this processor’s rails alone', () => {
		expect(Object.keys(INTENT_METHODS).sort()).toEqual([...STRIPE_RAILS].sort());
	});
});
