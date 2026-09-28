// a campaign's end date, between the day an operator names (`YYYY-MM-DD`) and the instant a page
// document stores (`endsAt` in ./keys.ts): the last millisecond before the next day first begins in
// the operator's time zone. a day an operator or a reply names (`set.endDate` in ./accept-reply.ts)
// lands through `endOfDay`, and `endDayOf` reads a stored end back as the day it closes.
//
// the zone's rules are `Intl`'s, so a day that is 23 or 25 hours long, or one whose next day starts
// at 01:00 because the clocks skip midnight, ends where the zone says it does. an IANA name the
// runtime does not know is refused rather than read as UTC.
//
// pure and not under `$lib/server/**`: a component renders what `dayOf` returns.

const DAY_MS = 86_400_000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function endOfDay({
	day,
	timeZone,
	now
}: {
	day: string;
	timeZone: string;
	now: number;
}): { ok: true; endsAt: number } | { ok: false; reason: string } {
	const [, year, month, date] = DAY.exec(day) ?? [];
	const midnight = Date.UTC(Number(year), Number(month) - 1, Number(date));
	if (year === undefined || new Date(midnight).toISOString().slice(0, 10) !== day) {
		return {
			ok: false,
			reason: `${JSON.stringify(day)} is not a day; an end date is written YYYY-MM-DD`
		};
	}
	const wall = wallClock(timeZone);
	if (wall === null) return { ok: false, reason: `${JSON.stringify(timeZone)} is not a time zone` };

	// the next day's midnight, written as if the zone were UTC; the offsets either side of it are
	// the only ones its first instant can be at.
	const next = midnight + DAY_MS;
	const offsets = new Set([next - DAY_MS, next, next + DAY_MS].map((at) => wall(at) - at));
	const candidates = [...offsets].map((offset) => next - offset);
	const exact = candidates.filter((at) => wall(at) === next);
	// no instant reads midnight where the clocks skip it: the day starts at the first one past it.
	const nextStarts = Math.min(
		...(exact.length > 0 ? exact : candidates.filter((at) => wall(at) > next))
	);
	const endsAt = nextStarts - 1;
	if (endsAt <= now) return { ok: false, reason: `${day} is already over` };
	return { ok: true, endsAt };
}

/** whether the runtime knows `zone` as an IANA time zone. */
export function isTimeZone(zone: string): boolean {
	return wallClock(zone) !== null;
}

/** the day, `YYYY-MM-DD`, that the instant `at` falls on in `timeZone`; null for an unknown zone. */
export function dayOf(at: number, timeZone: string): string | null {
	const wall = wallClock(timeZone);
	return wall === null ? null : new Date(wall(at)).toISOString().slice(0, 10);
}

/**
 * the day, `YYYY-MM-DD`, a page's stored end closes on, in the zone it was chosen in (`endsZone`
 * in ./keys.ts); null for a page with no end. ./catalog.ts holds the pair both or neither.
 */
export function endDayOf(page: {
	readonly endsAt?: number | undefined;
	readonly endsZone?: string | undefined;
}): string | null {
	const { endsAt, endsZone } = page;
	return endsAt === undefined || endsZone === undefined ? null : dayOf(endsAt, endsZone);
}

/** `YYYY-MM-DD` as a fundraiser reads it: Dec 31, 2026. */
export function dayWords(day: string): string {
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(Date.parse(`${day}T00:00:00Z`));
}

/** the zone's wall clock at an instant, to the second, as the instant UTC shows the same reading at. */
function wallClock(timeZone: string): ((at: number) => number) | null {
	let format: Intl.DateTimeFormat;
	try {
		format = new Intl.DateTimeFormat('en-US', {
			timeZone,
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
	return (at) => {
		const parts = Object.fromEntries(
			format.formatToParts(at).map(({ type, value }) => [type, Number(value)])
		);
		const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = parts;
		return Date.UTC(year, month - 1, day, hour, minute, second);
	};
}
