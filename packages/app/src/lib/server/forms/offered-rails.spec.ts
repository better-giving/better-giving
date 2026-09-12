import type { PaymentMethod } from '@better-giving/form/v1';
import { describe, expect, it } from 'vitest';
import { PAYPAL_RAILS, STRIPE_RAILS } from '@better-giving/form/embed/rails';
import type {
	RailChargeabilities,
	RailChargeability,
	RailStanding
} from '../payments/rail-chargeability';
import { offeredRails } from './offered-rails';

// which rails a donation form offers, away from anything that serves it.
//
// a node spec rather than a workers one because nothing here touches the database (CLAUDE.md splits
// the pools by that), and the seam is a value: a case that wants an account approved for one rail
// and not the other just says so. ./rail-cache.workers.spec.ts is the other half, and it is a
// workers spec because the edge cache is workerd's.

/**
 * an account that answered, with every rail it settles at the standing named and the rest approved.
 *
 * the rails another processor settles carry no entry, which is the answer a one-processor read
 * gives: `RailChargeability.rails` in ../payments/rail-chargeability.ts is one processor's own.
 */
function read(rails: Partial<Record<PaymentMethod, RailStanding>>): RailChargeability {
	return {
		state: 'read',
		chargesEnabled: true,
		rails: {
			card: rails.card ?? 'approved',
			ach: rails.ach ?? 'approved',
			apple_pay: rails.apple_pay ?? 'approved',
			google_pay: rails.google_pay ?? 'approved'
		}
	};
}

/** a deployment configured for Stripe alone, which is every case that names no other processor. */
function stripeOnly(rails: Partial<Record<PaymentMethod, RailStanding>> = {}): RailChargeabilities {
	return { stripe: read(rails) };
}

describe('offeredRails', () => {
	it('offers every rail this account answered for where it is approved for each', () => {
		expect(offeredRails(stripeOnly())).toEqual([...STRIPE_RAILS]);
	});

	/**
	 * a rail this read never covered is not offered, and it is not an omission.
	 *
	 * the deployment's list holds more than one processor's rails
	 * (`OFFERED_PAYMENT_METHODS` in ../../forms/offered-rails.ts), and an account that settles four
	 * of them says nothing about the other two — so what is offered is what something approved
	 * rather than what nothing refused. a deployment holding that other processor's keys is what
	 * puts its rails in front of a donor.
	 */
	it('offers no rail the account was never asked about', () => {
		expect(offeredRails(stripeOnly())).not.toContain('paypal');
		expect(offeredRails(stripeOnly())).not.toContain('venmo');
	});

	/**
	 * the same rule read from the other end: a deployment holding PayPal's pair and no Stripe key.
	 *
	 * the two processors never compete for a rail — Stripe settles the card rails and PayPal settles
	 * its own two (`STRIPE_RAILS` and `PAYPAL_RAILS` in packages/form/src/embed/rails.ts) — so such a
	 * deployment offers no card rail at all, which is the reading rather than a gap to paper over.
	 */
	it('offers PayPal’s own rails and no card rail where PayPal is the only account', () => {
		const paypalOnly: RailChargeabilities = {
			paypal: {
				state: 'read',
				chargesEnabled: true,
				rails: { paypal: 'approved', venmo: 'approved' }
			}
		};

		expect(offeredRails(paypalOnly)).toEqual([...PAYPAL_RAILS]);
	});

	/**
	 * a rail the account cannot charge is not put in front of a donor.
	 *
	 * the same direction `offeredCadences` in ./offered-cadences.ts holds for a cadence, and the
	 * reason ../payments/rail-chargeability.ts's header states: the processor enforces none of the
	 * operator's switches on a charge this app mints, so a rail offered here is a donor picking Bank
	 * and meeting a failure at the last step, on a page nobody here can see.
	 */
	it.each([
		['switched_off'],
		['never_requested'],
		['in_review'],
		['not_approved'],
		['account_cannot_charge']
	] as const)('leaves out a rail standing at %s', (standing) => {
		expect(offeredRails(stripeOnly({ ach: standing }))).toEqual([
			'card',
			'apple_pay',
			'google_pay'
		]);
	});

	/**
	 * a wallet is dropped on its own standing, and the card it settles as stays.
	 *
	 * the two share a capability (`RAIL_CAPABILITY` in ../payments/rail-chargeability.ts) and not a
	 * switch, so this is the case that says the shared half did not swallow the separate one: an
	 * operator who switched Apple Pay off has a form that still takes cards.
	 */
	it('leaves out a wallet the account will not offer, keeping the card', () => {
		expect(offeredRails(stripeOnly({ apple_pay: 'switched_off' }))).toEqual([
			'card',
			'ach',
			'google_pay'
		]);
	});

	/**
	 * an account approved for nothing offers nothing, and that is a config nobody serves.
	 *
	 * the empty list is a real answer here rather than one this module protects against, which is
	 * where it parts company with `offeredCadences` in ./offered-cadences.ts: a gift that happens
	 * once needs nothing on the account, so that module always has one-time to fall back to and this
	 * one has nothing to fall back to at all. what stops an unrenderable config reaching a donation
	 * form is `publishedConfig`'s own refusal in ./published-config.ts, which names the rail to
	 * approve.
	 */
	it('offers nothing where the account is approved for no rail it lists', () => {
		const none = stripeOnly({
			card: 'never_requested',
			ach: 'never_requested',
			apple_pay: 'never_requested',
			google_pay: 'never_requested'
		});
		expect(offeredRails(none)).toEqual([]);
	});

	/**
	 * a read nobody could make offers that processor's rails whole, which is the wide direction.
	 *
	 * the opposite of what a cadence does on the same failure, and the module header says why: an
	 * unreadable standing narrowed to nothing is not a form offering less, it is no form at all on
	 * every site this deployment is embedded on.
	 *
	 * that processor's rails and not the deployment's list: the widening is per processor, so a
	 * Stripe blip cannot put a rail on a form that nothing on this deployment could mint.
	 */
	it('offers that processor’s rails whole where its account could not be read', () => {
		expect(offeredRails({ stripe: { state: 'unreadable', detail: 'no key is set' } })).toEqual([
			...STRIPE_RAILS
		]);
	});

	/**
	 * a deployment that can charge on no processor offers no rail at all.
	 *
	 * the fresh fork, and the deployment whose only credentials are a processor this release ships
	 * no adapter for. it is the state the whole per-processor composition exists for: taken over the
	 * ceiling instead, an empty configured list would reach the widening arm and put every rail this
	 * repository has a form for in front of a donor nothing could charge.
	 */
	it('offers nothing where no processor is configured', () => {
		expect(offeredRails({})).toEqual([]);
	});

	/**
	 * one processor's blip widens that processor's rails and leaves the other's answer alone.
	 *
	 * the case the union exists for. merged into one reading, a Stripe outage would either blank
	 * PayPal's approved rails or widen them — and the second is a donation form offering a way to
	 * pay on an account this deployment was never told the standing of.
	 */
	it('widens one processor’s rails without touching the other’s', () => {
		const readings: RailChargeabilities = {
			stripe: { state: 'unreadable', detail: 'Stripe did not answer' },
			paypal: {
				state: 'read',
				chargesEnabled: true,
				rails: { paypal: 'approved', venmo: 'switched_off' }
			}
		};

		expect(offeredRails(readings)).toEqual(['card', 'ach', 'apple_pay', 'google_pay', 'paypal']);
	});
});
