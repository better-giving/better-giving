import { describe, expect, it } from 'vitest';
import { byDayShown } from './received-order.ts';

// the gifts list is read newest first against the day each row shows. the server orders by the
// stored instant, and a gift in hand is stored at its day's UTC midnight, so west of UTC an online
// gift can show an earlier day than an in-hand gift it sorts above.

const online = { id: 'online', receivedAt: '2026-10-22T02:00:00.000Z' };
const inHand = { id: 'in-hand', receivedOn: '2026-10-22' };

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

describe('byDayShown', () => {
	it('lists an online gift showing the 21st in New York below an in-hand gift of the 22nd', () => {
		expect(ids(byDayShown([online, inHand], 'America/New_York'))).toEqual(['in-hand', 'online']);
	});

	it('keeps the same two in the server’s order in Manila, where both show the 22nd', () => {
		expect(ids(byDayShown([online, inHand], 'Asia/Manila'))).toEqual(['online', 'in-hand']);
	});

	it('keeps the given order between rows showing the same day', () => {
		// both the 21st in New York, given earlier instant first: no ordering by instant within a day
		const morning = { id: 'morning', receivedAt: '2026-10-21T13:00:00.000Z' };
		const evening = { id: 'evening', receivedAt: '2026-10-22T02:00:00.000Z' };
		const typed = { id: 'typed', receivedOn: '2026-10-21' };

		expect(ids(byDayShown([morning, typed, evening], 'America/New_York'))).toEqual([
			'morning',
			'typed',
			'evening'
		]);
	});

	it('keeps the given order with no zone, when no row shows a day yet', () => {
		expect(ids(byDayShown([online, inHand], null))).toEqual(['online', 'in-hand']);
	});
});
