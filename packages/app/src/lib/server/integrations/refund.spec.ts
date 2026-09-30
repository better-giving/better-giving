import { describe, expect, it } from 'vitest';
import { type RefundRow, renderRefund } from './refund';

// one refund-direction row as both feeds render it, around whatever gift shape the feed carries.

const ROW: RefundRow = {
	id: '01920000-0000-7000-8000-000000000005',
	giftId: '01920000-0000-7000-8000-000000000003',
	occurredAt: new Date('2026-01-20T09:00:00.000Z'),
	amountMinor: 2_050,
	currency: 'USD',
	source: 'dispute',
	respondBy: new Date('2026-02-01T00:00:00.000Z')
};

describe('renderRefund()', () => {
	it('renders the refund’s own id, time and money, and what sent it back, around the gift given', () => {
		const gift = { id: ROW.giftId, anything: 'the feed’s own shape' };

		expect(renderRefund(ROW, gift)).toStrictEqual({
			id: '01920000-0000-7000-8000-000000000005',
			occurred_at: '2026-01-20T09:00:00.000Z',
			amount: '20.50',
			amount_minor: 2_050,
			currency: 'USD',
			source: 'dispute',
			gift
		});
	});

	it('writes the amount in the currency’s own digits', () => {
		expect(renderRefund({ ...ROW, amountMinor: 2_500, currency: 'JPY' }, null).amount).toBe('2500');
	});
});
