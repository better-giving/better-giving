import { expect, it } from 'vitest';
import type { DonationStatus } from '$lib/donations/statuses';
import { DONATION_STATUS_TONES } from './status-tones';

// `done` is the accent, and on a gift the accent reads as the money being in. a gift the processor
// has taken money back out of — refunded in full or in part, or disputed and not yet ruled on — must
// never read that way, whatever rung the argument in ./status-tones.ts settles each one on.

const MONEY_TAKEN_BACK: DonationStatus[] = ['refunded', 'partially_refunded', 'disputed'];

it('draws no gift the processor has taken money back out of on the done rung', () => {
	for (const status of MONEY_TAKEN_BACK) {
		expect(DONATION_STATUS_TONES[status], status).not.toBe('done');
	}
});
