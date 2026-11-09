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

	it('keeps the given order within a day when it is not in order of instant', () => {
		// both the 21st in New York, given latest instant first: an instant sort would reverse them
		const evening = { id: 'evening', receivedAt: '2026-10-22T02:00:00.000Z' };
		const morning = { id: 'morning', receivedAt: '2026-10-21T13:00:00.000Z' };
		const typed = { id: 'typed', receivedOn: '2026-10-21' };

		expect(ids(byDayShown([evening, typed, morning], 'America/New_York'))).toEqual([
			'evening',
			'typed',
			'morning'
		]);
	});

	it('lists a gift of the day before below one of the next day, east of UTC', () => {
		// Manila: 16:00Z on the 21st shows the 22nd, 15:59Z still shows the 21st. the online gift
		// showing the 22nd is given after a row showing the 21st and moves up beside the in-hand 22nd.
		const lateOnline = { id: 'late-online', receivedAt: '2026-10-21T16:00:00.000Z' };
		const earlyOnline = { id: 'early-online', receivedAt: '2026-10-21T15:59:00.000Z' };
		const typedOn21 = { id: 'typed-21', receivedOn: '2026-10-21' };
		const typedOn22 = { id: 'typed-22', receivedOn: '2026-10-22' };

		expect(ids(byDayShown([typedOn22, typedOn21, earlyOnline, lateOnline], 'Asia/Manila'))).toEqual(
			['typed-22', 'late-online', 'typed-21', 'early-online']
		);
	});

	it('keeps the given order with no zone, when no row shows a day yet', () => {
		expect(ids(byDayShown([online, inHand], null))).toEqual(['online', 'in-hand']);
	});
});
