import { describe, expect, it } from 'vitest';
import { recurringStatusNote, RECURRING_PLAN_STATUSES, RECURRING_STATUS_LABELS } from './statuses';

// node pool, no database: this module is a vocabulary and imports nothing.

describe('the recurring gift status vocabulary', () => {
	it('names every state the column may hold', () => {
		// totality is the claim, not the words. the map is keyed by `RecurringPlanStatus`, so a
		// fourth status is already a type error — what this catches is the array and the map being
		// edited apart, which the compiler cannot see once a key is merely spare.
		expect(Object.keys(RECURRING_STATUS_LABELS).sort()).toEqual(
			[...RECURRING_PLAN_STATUSES].sort()
		);
	});

	it('calls a cancelled commitment Stopped, and never Cancelled', () => {
		// `DONATION_STATUS_LABELS.cancelled` already means a payment outcome on a list read beside
		// this one, and every confirmation in this dashboard is escaped by a link labelled `Cancel`.
		// one word with two meanings on adjacent screens is the drift this asserts against.
		expect(RECURRING_STATUS_LABELS.cancelled).toBe('Stopped');
	});

	it('says a lapsed gift can start collecting again on its own', () => {
		// the sentence that stops a staff member concluding "it already failed, leave it" and
		// leaving a donor collected from after they asked to stop. `revives` in
		// `$lib/server/donations/collect.ts` is what makes it true: a delivery saying the card went
		// through moves a `lapsed` row back to `active`.
		expect(recurringStatusNote('lapsed', 'Stripe')).toContain('start collecting again on its own');
	});

	it('names the processor the commitment is on, and never the other one', () => {
		// a deployment charges on whichever processor it holds keys for, and a commitment lives on
		// the one that collected its first charge. a note naming the other sends a staff member to
		// an account they hold nothing on.
		expect(recurringStatusNote('lapsed', 'PayPal')).toContain('PayPal');
		for (const status of RECURRING_PLAN_STATUSES) {
			expect(recurringStatusNote(status, 'PayPal') ?? '').not.toContain('Stripe');
			expect(recurringStatusNote(status, 'Stripe') ?? '').not.toContain('PayPal');
		}
	});

	it('writes no sentence at all where no processor stands behind the commitment', () => {
		// `recurring_plan.provider` keeps `manual`, which no adapter answers for. the payment-failed
		// sentence is a claim about what a processor did, so on a commitment none is behind it is
		// not softened — it is not written.
		expect(recurringStatusNote('lapsed', null)).toBeNull();
		// and the one that names no processor is unaffected: it says what this deployment will do.
		expect(recurringStatusNote('cancelled', null)).toContain('Nothing further is collected');
	});
});
