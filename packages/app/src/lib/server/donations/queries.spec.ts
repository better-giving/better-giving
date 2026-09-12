import { describe, expect, it } from 'vitest';
import { projectRail, projectStatus, type SettlementAttempt } from './queries';

// node pool, no database: the projection is a pure function over rows, and the rows it is given
// here are written by hand precisely so a case can hold a shape a fixture would have to work to
// produce — a failed attempt recorded after the succeeded one, a refund that is still pending.
//
// what reads real rows out of a real D1 is ./queries.workers.spec.ts. this file is the states.

let sequence = 0;

/**
 * one settlement attempt, at a business time given in whole seconds from an arbitrary epoch.
 *
 * `id` is minted in call order and never controlled by a case, deliberately: the projection breaks
 * a tie on business time by id, so a case that pinned ids would be asserting the tie-break with
 * its thumb on the scale. the cases that care about order state it in `occurredAt`.
 */
function attempt(over: Partial<SettlementAttempt> = {}): SettlementAttempt {
	sequence += 1;
	return {
		id: `019fb200-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
		direction: 'inbound',
		status: 'succeeded',
		amountMinor: 10_000,
		method: 'card',
		provider: 'stripe',
		occurredAt: new Date(0),
		...over
	};
}

describe('the gift status projection', () => {
	it('reads a retried card as completed, not as the failure it started with', () => {
		// the case the whole shape exists for: a retried card is two rows, and the first one
		// failing does not make the gift failed. an implementation that asked whether any attempt
		// failed reads a collected gift as lost.
		const status = projectStatus([
			attempt({ status: 'failed', occurredAt: new Date(1000) }),
			attempt({ status: 'succeeded', occurredAt: new Date(2000) })
		]);
		expect(status).toBe('completed');
	});

	it('keeps a gift completed when a later attempt fails', () => {
		// the other order, and it is not the same case: only a gift with no succeeded attempt falls
		// through to the latest one, so a success collected at T1 stays collected however the rail
		// reports a retry at T2. money that moved is not undone by an attempt — that is a refund,
		// which is a row of its own.
		const status = projectStatus([
			attempt({ status: 'succeeded', occurredAt: new Date(1000) }),
			attempt({ status: 'failed', occurredAt: new Date(2000) })
		]);
		expect(status).toBe('completed');
	});

	it('reads a gift whose latest attempt failed as failed', () => {
		const status = projectStatus([
			attempt({ status: 'failed', occurredAt: new Date(1000) }),
			attempt({ status: 'failed', occurredAt: new Date(2000) })
		]);
		expect(status).toBe('failed');
	});

	it('reads a gift whose latest attempt was abandoned as cancelled', () => {
		// a different fact from one the rail refused: nothing was ever charged. staff chasing a
		// failed card and staff chasing an abandoned checkout do different things about it.
		const status = projectStatus([
			attempt({ status: 'failed', occurredAt: new Date(1000) }),
			attempt({ status: 'cancelled', occurredAt: new Date(2000) })
		]);
		expect(status).toBe('cancelled');
	});

	it('decides the latest attempt by business time, never by the order the rows arrive in', () => {
		// the same two attempts as above with the array reversed, which is what a redelivered
		// webhook or a corrected `occurred_at` produces. an implementation that read the last row
		// — or the first — happens to be right on one of these two cases and wrong on the other.
		const status = projectStatus([
			attempt({ status: 'cancelled', occurredAt: new Date(2000) }),
			attempt({ status: 'failed', occurredAt: new Date(1000) })
		]);
		expect(status).toBe('cancelled');
	});

	it('reads a gift with no settlement attempt at all as pending', () => {
		// the state a gift is in between the row being written and the rail reporting anything.
		expect(projectStatus([])).toBe('pending');
	});

	it('reads a gift whose refunds reach what it collected as refunded', () => {
		const status = projectStatus([
			attempt({ amountMinor: 10_000 }),
			attempt({ direction: 'refund', amountMinor: 10_000 })
		]);
		expect(status).toBe('refunded');
	});

	it('reads a gift refunded in part as partly refunded', () => {
		// the state the books are actually in, and the one a single boolean cannot hold: the org
		// keeps the difference, so a screen that showed this as either refunded or completed is
		// wrong about money it still has.
		const status = projectStatus([
			attempt({ amountMinor: 10_000 }),
			attempt({ direction: 'refund', amountMinor: 2500 })
		]);
		expect(status).toBe('partially_refunded');
	});

	it.each(['pending', 'failed', 'cancelled'] as const)(
		'counts a %s refund toward neither refunded state',
		(status) => {
			// a refund the rail has not paid out is money the org still holds. counting one would
			// report a gift as refunded on the strength of an intention, and the correction — a
			// refund that then fails — arrives as a status change nobody is watching for.
			const projected = projectStatus([
				attempt({ amountMinor: 10_000 }),
				attempt({ direction: 'refund', status, amountMinor: 10_000 })
			]);
			expect(projected).toBe('completed');
		}
	);

	it('reads an attempt still on its way as pending', () => {
		// an ACH debit or an intent awaiting the donor. money that has not arrived is not money
		// that failed, and a fundraiser chasing the second would be chasing nothing.
		expect(projectStatus([attempt({ status: 'pending' })])).toBe('pending');
	});
});

describe('the gift rail projection', () => {
	it('names the rail the money arrived on, never one that failed before it', () => {
		// the same reading `projectStatus` takes of the same rows: an attempt that succeeded is what
		// the gift is, and an earlier refusal is not. the two attempts differ in rail because that
		// is the only way a case can tell which one was read.
		const rail = projectRail([
			attempt({ status: 'failed', method: 'card', provider: 'stripe', occurredAt: new Date(1000) }),
			attempt({ method: 'venmo', provider: 'paypal', occurredAt: new Date(2000) })
		]);
		expect(rail).toEqual({ method: 'venmo', provider: 'paypal' });
	});

	it('names the rail that was tried on a gift nothing has settled', () => {
		// `payment.method` is written at quote time from what the donor picked and overwritten by
		// what settled, so on a gift with nothing settled it is the attempt — which is the whole of
		// what anybody knows, and a blank cell would say less than that.
		const rail = projectRail([attempt({ status: 'pending', method: 'ach', provider: 'stripe' })]);
		expect(rail).toEqual({ method: 'ach', provider: 'stripe' });
	});

	it('keeps the rail a donor used apart from the processor that settled it', () => {
		// the pair the schema's two columns exist to keep apart: Venmo is a rail PayPal settles, so
		// a projection reading one column for both answers `paypal` to a gift the donor gave on
		// Venmo — and the screen then names a rail nobody used.
		expect(projectRail([attempt({ method: 'venmo', provider: 'paypal' })])).toEqual({
			method: 'venmo',
			provider: 'paypal'
		});
	});

	it('carries no processor on a gift no processor stands behind', () => {
		// a staff-entered cheque. `payment.provider` is nullable, and inventing a processor for a
		// gift none moved is worse than naming none.
		expect(projectRail([attempt({ method: 'check', provider: null })])).toEqual({
			method: 'check',
			provider: null
		});
	});

	it('reads a gift with no settlement attempt at all as no rail', () => {
		// the shape `projectStatus` answers `pending` to. there is nothing to name, and the screen
		// draws the absence rather than a rail nobody used.
		expect(projectRail([])).toBeNull();
	});
});
