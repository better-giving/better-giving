// how a monthly figure is bucketed, in the one place every read that states one derives it from.
//
// two halves that have to agree byte for byte. the database groups with
// `strftime('%Y-%m', <column> / 1000, 'unixepoch')`, which reads a Unix-ms column as the UTC
// instant it is stored as and buckets it by UTC calendar month; `monthKey` below is that spelling
// in TypeScript, and a second one written at a call site is where the two would start to disagree
// about which month a gift is in — silently, because both answers are well-formed.
//
// nothing here reads a clock. `now` is a parameter everywhere, so the caller states which month is
// the current one and a spec can pin a boundary to the millisecond — and one loader reading it once
// is what stops two figures on a screen straddling a month change mid-render.

/** how many months the run is. twelve, which is the year a screen draws. */
export const SERIES_MONTHS = 12;

/** the bucket a UTC instant falls in, spelled the way `strftime('%Y-%m', …)` spells it. */
export function monthKey(at: Date): string {
	return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** the first instant of the month `offset` months from the one `now` is in, UTC. */
export function monthStart(now: Date, offset: number): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

/** one month's figure, as a grouped read hands it back. */
export type MonthTotal = { month: string; total: number };

/** what a screen states beside a run of months, and the run itself. */
export type MonthlyRun = {
	/** every month there has ever been one of these in, not only the ones inside the run. */
	total: number;
	/** the month `now` is in. */
	thisMonth: number;
	/** one figure per month, oldest first, `SERIES_MONTHS` of them. */
	points: number[];
	/** the first instant of the oldest bucket, UTC. */
	firstMonth: Date;
	/** the first instant of the newest, which is the month `now` is in. */
	lastMonth: Date;
};

/**
 * a grouped read cut into the run a screen draws, and the total it stands beside.
 *
 * the rows are every month the books hold rather than twelve, and that is what the total is taken
 * over: a figure summed from the twelve would shrink as the year turned away from an older month,
 * which is a total that disagrees with itself between two loads and with the books on both.
 *
 * a month with no row is a nought and never a gap. the run is what says which month is which — a
 * screen draws one column per bucket — so a month left out shifts every column after it onto the
 * wrong label.
 */
export function overMonths(rows: readonly MonthTotal[], now: Date): MonthlyRun {
	const byMonth = new Map(rows.map((row) => [row.month, row.total]));
	return {
		total: rows.reduce((sum, row) => sum + row.total, 0),
		thisMonth: byMonth.get(monthKey(now)) ?? 0,
		points: Array.from(
			{ length: SERIES_MONTHS },
			(_, i) => byMonth.get(monthKey(monthStart(now, i - (SERIES_MONTHS - 1)))) ?? 0
		),
		firstMonth: monthStart(now, -(SERIES_MONTHS - 1)),
		lastMonth: monthStart(now, 0)
	};
}
