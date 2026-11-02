import { expect, it } from 'vitest';
import type { DonationStatus } from '$lib/donations/statuses';
import { DONATION_STATUS_TONES, RECURRING_STATUS_TONES } from './status-tones';

// `done` is the accent, and on a gift the accent would read as the money being in. a gift the processor
// has taken money back out of — refunded in full or in part, or disputed and not yet ruled on — must
// never read that way, whatever rung the argument in ./status-tones.ts settles each one on.

const MONEY_TAKEN_BACK: DonationStatus[] = ['refunded', 'partially_refunded', 'disputed'];

it('draws no gift the processor has taken money back out of on the done rung', () => {
	for (const status of MONEY_TAKEN_BACK) {
		expect(DONATION_STATUS_TONES[status], status).not.toBe('done');
	}
});

// a gift that settled, and a repeating gift still collecting, are at rest: nothing on the row is
// asked of the operator, so each takes the base pill and no tone, and the eye goes to the rows that
// are waiting or refused instead.
it('draws a settled gift and a collecting recurring gift as the neutral pill', () => {
	expect(DONATION_STATUS_TONES.completed).toBeUndefined();
	expect(RECURRING_STATUS_TONES.active).toBeUndefined();
});

it('leaves waiting on attention and failed on blocker', () => {
	expect(DONATION_STATUS_TONES.pending).toBe('attention');
	expect(DONATION_STATUS_TONES.failed).toBe('blocker');
	expect(RECURRING_STATUS_TONES.lapsed).toBe('blocker');
});
