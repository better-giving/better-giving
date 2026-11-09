import { describe, expect, it, vi } from 'vitest';
import { dayOf } from '../page/end-date';
import { formatInstant, parseViewerZone, VIEWER_ZONE_COOKIE } from './viewer-time.ts';

// an instant on an /admin screen, read in the viewer's zone: a gift at 00:23 in Manila is the 22nd
// there and still the 21st in New York.

const LATE_NIGHT = '2026-10-21T16:23:00Z';

describe('formatInstant', () => {
	it.each([
		['Asia/Manila', '2026-10-22', '22 Oct 2026'],
		['America/New_York', '2026-10-21', '21 Oct 2026']
	])('puts %s on its own day', (zone, isoDay, day) => {
		expect(formatInstant(LATE_NIGHT, zone, 'iso-day')).toBe(isoDay);
		expect(formatInstant(LATE_NIGHT, zone, 'day')).toBe(day);
	});

	it.each([
		// the first and last millisecond of a UTC day, in UTC itself and either side of it
		['2026-10-22T00:00:00.000Z', 'UTC', '2026-10-22'],
		['2026-10-21T23:59:59.999Z', 'UTC', '2026-10-21'],
		['2026-10-22T00:00:00.000Z', 'Asia/Manila', '2026-10-22'],
		['2026-10-21T23:59:59.999Z', 'Asia/Manila', '2026-10-22'],
		['2026-10-22T00:00:00.000Z', 'America/New_York', '2026-10-21'],
		['2026-10-21T23:59:59.999Z', 'America/New_York', '2026-10-21'],
		['2026-10-22T00:00:00.000Z', 'Asia/Kolkata', '2026-10-22'],
		['2026-10-21T23:59:59.999Z', 'Asia/Kolkata', '2026-10-22'],
		// and Kolkata's own midnight, half an hour off the UTC hour
		['2026-10-21T18:30:00.000Z', 'Asia/Kolkata', '2026-10-22'],
		['2026-10-21T18:29:59.999Z', 'Asia/Kolkata', '2026-10-21']
	])('reads %s in %s as %s', (at, zone, isoDay) => {
		expect(formatInstant(at, zone, 'iso-day')).toBe(isoDay);
		expect(formatInstant(at, zone, 'day')).toBe(
			`${Number(isoDay.slice(8))} Oct ${isoDay.slice(0, 4)}`
		);
	});

	it('writes a moment on the 24-hour clock with the zone’s offset from UTC', () => {
		expect(formatInstant(LATE_NIGHT, 'Asia/Manila', 'moment')).toBe('22 Oct 2026, 00:23 UTC+8');
		expect(formatInstant(LATE_NIGHT, 'America/New_York', 'moment')).toBe(
			'21 Oct 2026, 12:23 UTC-4'
		);
		expect(formatInstant(LATE_NIGHT, 'UTC', 'moment')).toBe('21 Oct 2026, 16:23 UTC');
		expect(formatInstant(LATE_NIGHT, 'Asia/Kolkata', 'moment')).toBe('21 Oct 2026, 21:53 UTC+5:30');
		expect(formatInstant(LATE_NIGHT, 'America/St_Johns', 'moment')).toBe(
			'21 Oct 2026, 13:53 UTC-2:30'
		);
	});

	it('writes the offset the zone has at that instant, either side of a clock change', () => {
		// New York and London both leave summer time between these two instants
		const winter = '2026-12-01T16:23:59.999Z';
		expect(formatInstant(winter, 'America/New_York', 'moment')).toBe('1 Dec 2026, 11:23 UTC-5');
		expect(formatInstant(winter, 'Europe/London', 'moment')).toBe('1 Dec 2026, 16:23 UTC');
		expect(formatInstant(LATE_NIGHT, 'Europe/London', 'moment')).toBe('21 Oct 2026, 17:23 UTC+1');
	});

	it('takes the instant as a Date, epoch milliseconds or an ISO string alike', () => {
		const ms = Date.parse(LATE_NIGHT);
		expect(formatInstant(new Date(ms), 'Asia/Manila', 'moment')).toBe(
			formatInstant(LATE_NIGHT, 'Asia/Manila', 'moment')
		);
		expect(formatInstant(ms, 'Asia/Manila', 'iso-day')).toBe('2026-10-22');
	});

	it('refuses a zone the runtime does not know rather than reading it as UTC', () => {
		for (const style of ['iso-day', 'day', 'moment'] as const) {
			expect(() => formatInstant(LATE_NIGHT, 'Mars/Olympus', style)).toThrow(RangeError);
		}
	});
});

describe('an instant that is not a date', () => {
	// Date.parse('') is NaN, and formatInstant refuses it rather than writing a day: `LocalTime` in
	// ./viewer-time.react.tsx is the boundary that turns a missing or unparseable instant into a dash.
	it.each(['iso-day', 'day', 'moment'] as const)('throws a RangeError for %s', (style) => {
		expect(() => formatInstant('', 'UTC', style)).toThrow(RangeError);
		expect(() => formatInstant('not a date', 'Asia/Manila', style)).toThrow(RangeError);
	});
});

describe('parseViewerZone', () => {
	it('names the cookie the browser writes', () => {
		expect(VIEWER_ZONE_COOKIE).toBe('admin_zone');
	});

	it.each(['UTC', 'Asia/Manila', 'America/Argentina/Buenos_Aires', 'Etc/GMT+8'])(
		'takes the IANA zone %j',
		(zone) => {
			expect(parseViewerZone(zone)).toBe(zone);
		}
	);

	it.each([null, undefined, '', 'Mars/Olympus', 'Asia/Manila; Path=/', 'not a zone', '%%%'])(
		'refuses %j',
		(raw) => {
			expect(parseViewerZone(raw)).toBeNull();
		}
	);

	// `Intl` takes an offset as a zone, but the browser only ever writes an IANA name, so an offset
	// in the cookie was written by something else.
	it.each(['+08:00', '-03:00', '+0800', '-05', '+00:00'])('refuses the offset %j', (raw) => {
		expect(parseViewerZone(raw)).toBeNull();
	});
});

describe('the formats an instant is written with', () => {
	// a spy that still builds the real thing, so a call that does build one goes on to format.
	const formatsBuilt = () => {
		const Real = Intl.DateTimeFormat;
		return (
			vi
				.spyOn(Intl, 'DateTimeFormat')
				// biome-ignore lint/complexity/useArrowFunction: the module under test calls it with `new`, which an arrow function cannot take.
				.mockImplementation(function (...args: ConstructorParameters<typeof Real>) {
					return new Real(...args);
				})
		);
	};

	it.each(['iso-day', 'day', 'moment'] as const)(
		'builds no Intl.DateTimeFormat for %s once the zone has been written in',
		(style) => {
			formatInstant(LATE_NIGHT, 'Pacific/Chatham', style);
			const built = formatsBuilt();
			expect(formatInstant('2026-12-01T16:23:00Z', 'Pacific/Chatham', style)).toBeTruthy();
			expect(built).not.toHaveBeenCalled();
		}
	);

	// `Intl` takes any casing of a zone, so a cookie can name a new spelling each time. the cache is
	// emptied past its bound rather than grown; the only way to see that through the public API is
	// that a spelling formatted long ago has to be built again.
	it('forgets a spelling formatted before the cache filled, and still formats every one right', () => {
		// bit k of n upper-cases the k-th letter of the zone's name
		const spelling = (n: number) => {
			let letter = 0;
			return [...'America/Argentina/Buenos_Aires']
				.map((char) =>
					/[a-z]/i.test(char)
						? (n >> letter++) & 1
							? char.toUpperCase()
							: char.toLowerCase()
						: char
				)
				.join('');
		};
		const first = spelling(0);
		expect(formatInstant(LATE_NIGHT, first, 'moment')).toBe('21 Oct 2026, 13:23 UTC-3');

		// more distinct spellings than the cache holds, whatever it held before this case
		for (let n = 1; n <= 1100; n++) {
			expect(formatInstant(LATE_NIGHT, spelling(n), 'iso-day')).toBe('2026-10-21');
		}

		const built = formatsBuilt();
		expect(formatInstant(LATE_NIGHT, first, 'moment')).toBe('21 Oct 2026, 13:23 UTC-3');
		expect(built).toHaveBeenCalledTimes(1);
	});

	it.each([
		'2026-10-22T00:00:00.000Z',
		'2026-10-21T23:59:59.999Z',
		'2026-10-21T18:30:00.000Z',
		'2026-10-21T18:29:59.999Z'
	])('reads %s as the same day dayOf in ../page/end-date.ts does', (at) => {
		for (const zone of ['UTC', 'Asia/Manila', 'America/New_York', 'Asia/Kolkata']) {
			expect(formatInstant(at, zone, 'iso-day')).toBe(dayOf(Date.parse(at), zone));
		}
	});
});
