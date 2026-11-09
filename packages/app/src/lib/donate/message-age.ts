// how long ago a donor's message arrived, in the words "Messages from donors" sets beside it:
// "yesterday", "3 days ago", "last week", "2 weeks ago", and past a month the month it arrived in.
//
// counted from a `now` the route read with the page rather than from the clock where this runs, so
// the server's render and the browser's hydration write the same words. the month is read in UTC
// for the same reason: the server and the donor's browser stand in different zones.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** past this many weeks the words are the month, which "5 weeks ago" says less plainly. */
const WEEKS_SHOWN = 4;

/** `receivedAt` against `now`, both ISO 8601, in `locale`'s words. */
export function messageAge(receivedAt: string, now: string, locale: string): string {
	const at = Date.parse(receivedAt);
	const elapsed = Math.max(0, Date.parse(now) - at);
	const ago = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
	if (elapsed < MINUTE) return ago.format(0, 'second');
	if (elapsed < HOUR) return ago.format(-Math.floor(elapsed / MINUTE), 'minute');
	if (elapsed < DAY) return ago.format(-Math.floor(elapsed / HOUR), 'hour');
	if (elapsed < WEEK) return ago.format(-Math.floor(elapsed / DAY), 'day');
	if (elapsed < (WEEKS_SHOWN + 1) * WEEK) return ago.format(-Math.floor(elapsed / WEEK), 'week');
	const sameYear = new Date(at).getUTCFullYear() === new Date(Date.parse(now)).getUTCFullYear();
	return new Intl.DateTimeFormat(locale, {
		month: 'long',
		...(sameYear ? {} : { year: 'numeric' }),
		timeZone: 'UTC'
	}).format(at);
}
