import { dayOf, isTimeZone } from '../page/end-date';

// an instant on an /admin screen, written in the viewer's own time zone: the zone the browser
// resolves, carried to the server in the `admin_zone` cookie so a server render already reads the
// same day (./viewer-time.react.tsx writes it). a value that is a date in its own right, such as a
// book entry's day or a manual gift's received day, is not an instant and never comes through here.
//
// pure and not under `$lib/server/**`: the layout loader parses the cookie and a component formats.

/** the cookie the browser writes its IANA zone to, and the layout loader reads. */
export const VIEWER_ZONE_COOKIE = 'admin_zone';

/** the three ways an /admin screen writes an instant. */
export type InstantStyle = 'iso-day' | 'day' | 'moment';

/** `raw`, when it is an IANA zone the runtime knows; null for anything else. */
export function parseViewerZone(raw: string | null | undefined): string | null {
	return raw && isTimeZone(raw) ? raw : null;
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/**
 * `at` in `zone`: `iso-day` is 2026-10-22, `day` is 22 Oct 2026, and `moment` is
 * 22 Oct 2026, 00:23 UTC+8 — the 24-hour clock and the zone's offset from UTC at that instant. a
 * zone the runtime does not know throws a RangeError rather than reading as UTC.
 */
export function formatInstant(
	at: Date | number | string,
	zone: string,
	style: InstantStyle
): string {
	const ms = typeof at === 'string' ? Date.parse(at) : Number(at);
	if (style === 'moment') return momentOf(ms, zone);
	const isoDay = dayOf(ms, zone);
	if (isoDay === null) throw new RangeError(`${JSON.stringify(zone)} is not a time zone`);
	if (style === 'iso-day') return isoDay;
	const midnight = Date.parse(`${isoDay}T00:00:00Z`);
	return `${Number(isoDay.slice(8))} ${MONTH.format(midnight)} ${isoDay.slice(0, 4)}`;
}

// every part of a moment is a number but the month, which is MONTH's en-US name in UTC: a zone's
// name (`timeZoneName`) is spelt by the engine's own ICU, so a server render and the browser that
// hydrates it could write the same zone two ways, which react 19 reports as a hydration error.
function momentOf(ms: number, zone: string): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric'
	}).formatToParts(ms);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((each) => each.type === type)?.value);
	const [year, month, day, hour, minute] = [
		part('year'),
		part('month'),
		part('day'),
		part('hour'),
		part('minute')
	];
	const wall = Date.UTC(year, month - 1, day, hour, minute, part('second'));
	const offsetMinutes = Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
	const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
	const monthName = MONTH.format(Date.UTC(year, month - 1, 1));
	return `${day} ${monthName} ${year}, ${clock} ${offsetLabel(offsetMinutes)}`;
}

/** an offset from UTC in minutes as UTC, UTC+8, UTC-4 or UTC+5:30. */
function offsetLabel(minutes: number): string {
	if (minutes === 0) return 'UTC';
	const sign = minutes > 0 ? '+' : '-';
	const hours = Math.floor(Math.abs(minutes) / 60);
	const rest = Math.abs(minutes) % 60;
	return `UTC${sign}${hours}${rest === 0 ? '' : `:${String(rest).padStart(2, '0')}`}`;
}
