import type { PaymentMethod } from '@better-giving/form/v1';
import { describe, expect, it } from 'vitest';
import { OFFERED_PAYMENT_METHODS } from '../../forms/offered-rails';
import type { RailChargeability, RailStanding } from '../payments/rail-chargeability';
import { offeredRails } from './offered-rails';

// which rails a donation form offers, away from anything that serves it.
//
// a node spec rather than a workers one because nothing here touches the database (CLAUDE.md splits
// the pools by that), and the seam is a value: a case that wants an account approved for one rail
// and not the other just says so. ./rail-cache.workers.spec.ts is the other half, and it is a
// workers spec because the edge cache is workerd's.

/** an account that answered, with every rail at the standing named and the rest approved. */
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

describe('offeredRails', () => {
	it('offers every rail the deployment lists where the account is approved for each', () => {
		expect(offeredRails(read({}))).toEqual([...OFFERED_PAYMENT_METHODS]);
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
		expect(offeredRails(read({ ach: standing }))).toEqual(['card', 'apple_pay', 'google_pay']);
	});

	/**
	 * a wallet is dropped on its own standing, and the card it settles as stays.
	 *
	 * the two share a capability (`RAIL_CAPABILITY` in ../payments/rail-chargeability.ts) and not a
	 * switch, so this is the case that says the shared half did not swallow the separate one: an
	 * operator who switched Apple Pay off has a form that still takes cards.
	 */
	it('leaves out a wallet the account will not offer, keeping the card', () => {
		expect(offeredRails(read({ apple_pay: 'switched_off' }))).toEqual([
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
		const none = read({
			card: 'never_requested',
			ach: 'never_requested',
			apple_pay: 'never_requested',
			google_pay: 'never_requested'
		});
		expect(offeredRails(none)).toEqual([]);
	});

	/**
	 * a read nobody could make offers the deployment's list whole, which is the wide direction.
	 *
	 * the opposite of what a cadence does on the same failure, and the module header says why: an
	 * unreadable standing narrowed to nothing is not a form offering less, it is no form at all on
	 * every site this deployment is embedded on.
	 */
	it('offers the deployment’s list whole where the account could not be read', () => {
		expect(offeredRails({ state: 'unreadable', detail: 'no key is set' })).toEqual([
			...OFFERED_PAYMENT_METHODS
		]);
	});
});
