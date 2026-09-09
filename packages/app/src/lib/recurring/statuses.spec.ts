import { describe, expect, it } from 'vitest';
import {
	RECURRING_PLAN_STATUSES,
	RECURRING_STATUS_LABELS,
	RECURRING_STATUS_NOTES
} from './statuses';

// node pool, no database: this module is a vocabulary and imports nothing.

describe('the recurring gift status vocabulary', () => {
	it('names every state the column may hold', () => {
		// totality is the claim, not the words. both maps are keyed by `RecurringPlanStatus`, so a
		// fourth status is already a type error — what this catches is the array and a map being
		// edited apart, which the compiler cannot see once a key is merely spare.
		expect(Object.keys(RECURRING_STATUS_LABELS).sort()).toEqual(
			[...RECURRING_PLAN_STATUSES].sort()
		);
		expect(Object.keys(RECURRING_STATUS_NOTES).sort()).toEqual([...RECURRING_PLAN_STATUSES].sort());
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
		expect(RECURRING_STATUS_NOTES.lapsed).toContain('start collecting again on its own');
	});
});
