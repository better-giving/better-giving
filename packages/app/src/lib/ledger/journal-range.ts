import { readAccountingDate } from './input-schema';
import type { JournalTarget } from '../server/ledger/journal-file';

// the three values the accountant's download is asked for, in the one place the screen that asks
// for them and the route that answers may both import from.
//
// not under `$lib/server/**`, for the reason ./sources.ts is not: `/admin/books` names these boxes
// and builds the link that carries them, and a component cannot import a value from
// `$lib/server/**` at all. what crosses from there is `JournalTarget`'s type, which leaves no
// runtime edge; the targets themselves are the keys of `JOURNAL_TARGET_LABELS` below, so the set a
// screen offers and the set a request is read against are one set.
//
// the query string and not a form body: the range is a *read*, so the address an operator is
// standing on is what says which range they are looking at — the screen and the file are asked for
// the same three values the same way, and a link to either is a link to that range.

/**
 * what each value is called on the wire.
 *
 * stated once rather than typed into the boxes and into the link separately: a name that drifts
 * between the two leaves the form submitting values the loader never looks at, which reads as a
 * range that will not take rather than as anything failing.
 */
export const JOURNAL_RANGE_FIELDS = {
	from: 'from',
	to: 'to',
	target: 'target'
} as const;

export type JournalRangeField = (typeof JOURNAL_RANGE_FIELDS)[keyof typeof JOURNAL_RANGE_FIELDS];

/**
 * what an accounting package is called on a screen.
 *
 * keyed by `JournalTarget` rather than by `string`, the discipline `ENTRY_SOURCE_LABELS` in
 * ./sources.ts is under: a third target is a type error here rather than an option nobody offers.
 * the words are the packages' own names, which are what an operator picks between.
 */
export const JOURNAL_TARGET_LABELS: Record<JournalTarget, string> = {
	quickbooks: 'QuickBooks Online',
	xero: 'Xero'
};

/**
 * every target, as the set a request is read against and a screen offers.
 *
 * the keys of the record above rather than a second list beside it. the assertion is sound and is
 * what a second list would cost: the literal is excess-checked against `Record<JournalTarget, ...>`,
 * so its keys are exactly the targets and a third one is added in one place.
 */
export const JOURNAL_TARGETS_OFFERED = Object.keys(
	JOURNAL_TARGET_LABELS
) as readonly JournalTarget[];

/**
 * what a far end standing before the near one is told, under `to`.
 *
 * exported so ./journal-range.spec.ts asserts the sentence rather than a copy of it, and so
 * `/admin/books` can tell this refusal from the others: it is the only one of them the two date
 * boxes can be walked into, and the only one that screen words for a person.
 *
 * it names no box, unlike `SAME_ACCOUNT` in ./input-schema.ts, because it is read in two registers
 * — under the wire name on a 4xx line and under the screen's own label beside the press — and a
 * sentence naming `From` would be right in one of them and odd in the other.
 */
export const RANGE_REVERSED = 'must not be before the first day of the range';

/** one value the request could not be read from, named as the query string spells it. */
export type JournalRangeProblem = {
	readonly field: JournalRangeField;
	readonly problem: string;
};

/**
 * the range and target a request asks for, or every value that stopped it being read.
 *
 * one shape for a value that is absent and one that is malformed, and that is deliberate: a
 * request carrying neither end is the screen's own first visit, which shows no count, and a
 * request carrying one bad end is a hand-typed address. neither produces a file, and nothing
 * downstream branches on which it was.
 */
export type JournalRangeRead =
	| {
			readonly ok: true;
			/** the first instant of the first day. */
			readonly from: Date;
			/** the last instant of the last day — see `readJournalRange`. */
			readonly to: Date;
			readonly target: JournalTarget;
	  }
	| { readonly ok: false; readonly problems: readonly JournalRangeProblem[] };

/** one day in milliseconds. UTC has no daylight saving, so every day is this long. */
const DAY = 86_400_000;

/**
 * the range a request names, as the pair of instants `readEntryGroupsInRange` is asked for.
 *
 * **the far end is the last instant of its day and not that day's midnight.** an entry's
 * `occurred_at` is the instant the money moved — a settled gift carries the processor's own time of
 * day — and the read is closed at both ends, so a bound at midnight silently drops everything
 * posted after it on the last day of the range. that is a month's final day missing from a file
 * nothing reports as short.
 *
 * an absent value and an unreadable one are read the same way, through `readAccountingDate('')`:
 * both mean there is no day here, and a second branch for the empty string would be a second
 * sentence saying so.
 */
export function readJournalRange(params: URLSearchParams): JournalRangeRead {
	const from = readAccountingDate(params.get(JOURNAL_RANGE_FIELDS.from) ?? '');
	const to = readAccountingDate(params.get(JOURNAL_RANGE_FIELDS.to) ?? '');
	const asked = params.get(JOURNAL_RANGE_FIELDS.target) ?? '';
	const target = JOURNAL_TARGETS_OFFERED.find((offered) => offered === asked) ?? null;

	// **a range written backwards is refused and never exported.** it reads as a range, and the
	// read between its two ends returns nothing — so it produces the same header row with nothing
	// under it that a genuinely empty range does, which says this organisation posted nothing in
	// that period. that answer is wrong and it is stated confidently, to an accountant. two date
	// boxes are easy to fill in the wrong order and nothing about the file says which happened.
	//
	// the two ends of one day are a range, so the comparison is `<` rather than `<=`.
	const reversed = from.at !== null && to.at !== null && to.at.getTime() < from.at.getTime();

	if (from.at === null || to.at === null || target === null || reversed) {
		return {
			ok: false,
			problems: [
				...(from.problem === null
					? []
					: [{ field: JOURNAL_RANGE_FIELDS.from, problem: from.problem }]),
				...(to.problem === null ? [] : [{ field: JOURNAL_RANGE_FIELDS.to, problem: to.problem }]),
				// under `to` and not `from`: both days are ones the calendar has, and the far end is
				// the one the near end is read against.
				...(reversed ? [{ field: JOURNAL_RANGE_FIELDS.to, problem: RANGE_REVERSED }] : []),
				...(target === null
					? [
							{
								field: JOURNAL_RANGE_FIELDS.target,
								problem: `must be one of ${JOURNAL_TARGETS_OFFERED.join(', ')}`
							}
						]
					: [])
			]
		};
	}

	return { ok: true, from: from.at, to: new Date(to.at.getTime() + DAY - 1), target };
}

/**
 * the calendar day an instant falls on, UTC.
 *
 * the far end of a read range is the last instant of its own day, so this reads back the day that
 * was asked for at either end.
 */
function day(at: Date): string {
	return at.toISOString().slice(0, 10);
}

/**
 * what the downloaded file is called.
 *
 * the target and both ends of the range, because a downloads folder is where two of these meet: a
 * second month, or the same month shaped for the other package, under one name is the file an
 * operator imports twice without being able to tell.
 */
export function journalFileName(target: JournalTarget, from: Date, to: Date): string {
	return `${target}-journal-${day(from)}-to-${day(to)}.csv`;
}

/**
 * the three values written back out, as the query string a link to this range carries.
 *
 * built from what was read rather than from what arrived, so the address the screen offers is one
 * `readJournalRange` reads back to the same range — anything else the caller was standing on is
 * left off rather than carried into the link.
 */
export function journalRangeQuery(target: JournalTarget, from: Date, to: Date): string {
	return new URLSearchParams({
		[JOURNAL_RANGE_FIELDS.from]: day(from),
		[JOURNAL_RANGE_FIELDS.to]: day(to),
		[JOURNAL_RANGE_FIELDS.target]: target
	}).toString();
}
