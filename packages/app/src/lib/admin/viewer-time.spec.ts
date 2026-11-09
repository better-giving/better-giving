import { describe, expect, it } from 'vitest';
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

	it('writes a moment on the 24-hour clock with the short zone name', () => {
		expect(formatInstant(LATE_NIGHT, 'Asia/Manila', 'moment')).toBe('22 Oct 2026, 00:23 GMT+8');
		expect(formatInstant(LATE_NIGHT, 'America/New_York', 'moment')).toBe('21 Oct 2026, 12:23 EDT');
		expect(formatInstant(LATE_NIGHT, 'UTC', 'moment')).toBe('21 Oct 2026, 16:23 UTC');
		expect(formatInstant(LATE_NIGHT, 'Asia/Kolkata', 'moment')).toBe('21 Oct 2026, 21:53 GMT+5:30');
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

describe('parseViewerZone', () => {
	it('names the cookie the browser writes', () => {
		expect(VIEWER_ZONE_COOKIE).toBe('admin_zone');
	});

	it('takes an IANA zone the runtime knows', () => {
		expect(parseViewerZone('Asia/Manila')).toBe('Asia/Manila');
		expect(parseViewerZone('UTC')).toBe('UTC');
	});

	it.each([null, undefined, '', 'Mars/Olympus', 'Asia/Manila; Path=/', 'not a zone'])(
		'refuses %j',
		(raw) => {
			expect(parseViewerZone(raw)).toBeNull();
		}
	);
});
