import { describe, expect, it } from 'vitest';
import { DONATION_STATUSES, DONATION_STATUS_LABELS } from './statuses';

// node pool, no database: this module is a vocabulary and imports nothing.

describe('the gift status vocabulary', () => {
	it('names every state the projection can produce', () => {
		// totality is the claim, not the words. the map is keyed by `DonationStatus`, so a seventh
		// state is already a type error — what this catches is the array and the map being edited
		// apart, which the compiler cannot see once a key is merely spare.
		expect(Object.keys(DONATION_STATUS_LABELS).sort()).toEqual([...DONATION_STATUSES].sort());
	});
});
