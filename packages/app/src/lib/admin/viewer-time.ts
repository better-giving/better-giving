import { isTimeZone } from '../page/end-date';

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

/**
 * `raw`, when it is an IANA zone the runtime knows; null for anything else. `Intl` also takes an
 * offset such as `+08:00` as a zone, which the browser never writes, so a leading sign is refused.
 */
export function parseViewerZone(raw: string | null | undefined): string | null {
	return raw && !/^[+-]/.test(raw) && isTimeZone(raw) ? raw : null;
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

// one wall-clock format per zone, built on first use: the three styles all read the same parts.
// IANA's names, links included, number under a thousand, but `Intl` takes any casing of each, so
// the cache is emptied past that rather than grown by whatever the cookie names.
const WALL_CLOCK_LIMIT = 1000;
const wallClocks = new Map<string, Intl.DateTimeFormat>();

function wallClockIn(zone: string): Intl.DateTimeFormat | null {
	const cached = wallClocks.get(zone);
	if (cached !== undefined) return cached;
	let format: Intl.DateTimeFormat;
	try {
		format = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		});
	} catch {
		return null;
	}
	if (wallClocks.size >= WALL_CLOCK_LIMIT) wallClocks.clear();
	wallClocks.set(zone, format);
	return format;
}

/** whether this runtime can write an instant in `zone`. */
export function canWriteIn(zone: string): boolean {
	return wallClockIn(zone) !== null;
}

/**
 * `at` in `zone`: `iso-day` is 2026-10-22, `day` is 22 Oct 2026, and `moment` is
 * 22 Oct 2026, 00:23 UTC+8 — the 24-hour clock and the zone's offset from UTC at that instant. an
 * instant that is not a date, or a zone the runtime does not know, throws a RangeError rather than
 * reading as some other day or as UTC.
 */
export function formatInstant(
	at: Date | number | string,
	zone: string,
	style: InstantStyle
): string {
	const ms = typeof at === 'string' ? Date.parse(at) : Number(at);
	if (Number.isNaN(ms)) throw new RangeError(`${JSON.stringify(String(at))} is not a date`);
	const wall = wallClockIn(zone);
	if (wall === null) throw new RangeError(`${JSON.stringify(zone)} is not a time zone`);

	// every part is a number but the month, which is MONTH's en-US name in UTC: a zone's name
	// (`timeZoneName`) is spelt by the engine's own ICU, so a server render and the browser that
	// hydrates it could write the same zone two ways, which react 19 reports as a hydration error.
	const parts = wall.formatToParts(ms);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((each) => each.type === type)?.value);
	const [year, month, day, hour, minute] = [
		part('year'),
		part('month'),
		part('day'),
		part('hour'),
		part('minute')
	];
	if (style === 'iso-day') {
		return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	}
	const monthName = MONTH.format(Date.UTC(year, month - 1, 1));
	if (style === 'day') return `${day} ${monthName} ${year}`;

	const wallMs = Date.UTC(year, month - 1, day, hour, minute, part('second'));
	const offsetMinutes = Math.round((wallMs - Math.floor(ms / 1000) * 1000) / 60_000);
	const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
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
