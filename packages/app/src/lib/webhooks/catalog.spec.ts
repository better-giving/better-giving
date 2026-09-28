import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENT_TYPES, WEBHOOK_EVENTS } from './catalog';

// the wire names are a receiver's `switch` cases and a destination's stored subscriptions, so the
// list is written out here rather than read back off ./catalog.ts: a rename fails this spec.

describe('the webhook event catalog', () => {
	it('is the nine wire names, in the order a screen lists them', () => {
		expect(WEBHOOK_EVENT_TYPES).toEqual([
			'gift.made',
			'gift.refunded',
			'gift.dispute_opened',
			'donor.added',
			'donor.updated',
			'recurring_gift.started',
			'recurring_gift.updated',
			'recurring_gift.charge_failed',
			'recurring_gift.ended'
		]);
	});

	it('labels each one in words a fundraiser uses', () => {
		expect(WEBHOOK_EVENTS['gift.made']).toBe('Gift made');
		expect(WEBHOOK_EVENTS['recurring_gift.charge_failed']).toBe('Recurring charge failed');
		for (const label of Object.values(WEBHOOK_EVENTS)) expect(label).toMatch(/^[A-Z][a-z ]+$/);
	});
});
