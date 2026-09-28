import { describe, expect, it } from 'vitest';
import { dayOf, endOfDay } from './end-date';

// node pool: `Intl`'s time-zone data is the only outside fact, and the expected instants are
// worked out by hand from each zone's published offsets.

const now = Date.UTC(2026, 0, 15, 12);

describe('the end of a day in a time zone', () => {
	it.each([
		['a winter day in New York, UTC-5', '2026-02-10', 'America/New_York', '2026-02-11T05:00:00Z'],
		[
			'the day New York springs forward, 23 hours long',
			'2026-03-08',
			'America/New_York',
			'2026-03-09T04:00:00Z'
		],
		[
			'the day New York falls back, 25 hours long',
			'2026-11-01',
			'America/New_York',
			'2026-11-02T05:00:00Z'
		],
		['a day east of UTC', '2026-02-10', 'Asia/Tokyo', '2026-02-10T15:00:00Z'],
		[
			'the day before Santiago’s clocks skip midnight',
			'2026-09-05',
			'America/Santiago',
			'2026-09-06T04:00:00Z'
		],
		[
			'the day Santiago repeats its last hour',
			'2026-04-04',
			'America/Santiago',
			'2026-04-05T04:00:00Z'
		]
	])('is the last millisecond before the next day starts, on %s', (_, day, timeZone, nextDay) => {
		expect(endOfDay({ day, timeZone, now })).toEqual({ ok: true, endsAt: Date.parse(nextDay) - 1 });
	});

	it.each(['2026-02-30', '2026-2-10', '10/02/2026', ''])(
		'refuses %j, which is not a day',
		(day) => {
			expect(endOfDay({ day, timeZone: 'UTC', now })).toEqual({
				ok: false,
				reason: `${JSON.stringify(day)} is not a day; an end date is written YYYY-MM-DD`
			});
		}
	);

	it('refuses a zone that is not one', () => {
		expect(endOfDay({ day: '2026-02-10', timeZone: 'Mars/Olympus', now })).toEqual({
			ok: false,
			reason: '"Mars/Olympus" is not a time zone'
		});
	});

	it('refuses a day already over where the operator is, and takes today', () => {
		const tokyoNoon = Date.parse('2026-01-15T03:00:00Z');
		expect(endOfDay({ day: '2026-01-14', timeZone: 'Asia/Tokyo', now: tokyoNoon })).toEqual({
			ok: false,
			reason: '2026-01-14 is already over'
		});
		expect(endOfDay({ day: '2026-01-15', timeZone: 'Asia/Tokyo', now: tokyoNoon })).toMatchObject({
			ok: true
		});
	});
});

describe('the day an end falls on', () => {
	it('reads back the day endOfDay was given, across a DST edge', () => {
		for (const [day, timeZone] of [
			['2026-03-08', 'America/New_York'],
			['2026-09-05', 'America/Santiago']
		] as const) {
			const end = endOfDay({ day, timeZone, now });
			expect(end.ok && dayOf(end.endsAt, timeZone)).toBe(day);
		}
	});

	it('is null in a zone that is not one', () => {
		expect(dayOf(now, 'Mars/Olympus')).toBeNull();
	});
});
