import { dayOf, isTimeZone } from '../page/end-date';

// an instant on an /admin screen, written in the viewer's own time zone: the zone the browser
// resolves, carried to the server in the `admin_zone` cookie so a server render already reads the
// same day (./viewer-time.react.tsx writes it). a value that is a date in its own right — a book entry's
// day, a manual gift's received day — is not an instant and never comes through here.
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
 * 22 Oct 2026, 00:23 GMT+8 — the 24-hour clock and `Intl`'s short zone name. a zone the runtime
 * does not know throws a RangeError rather than reading as UTC.
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

function momentOf(ms: number, zone: string): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		hourCycle: 'h23',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZoneName: 'short'
	}).formatToParts(ms);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((each) => each.type === type)?.value ?? '';
	return (
		`${part('day')} ${part('month')} ${part('year')}, ` +
		`${part('hour')}:${part('minute')} ${part('timeZoneName')}`
	);
}
