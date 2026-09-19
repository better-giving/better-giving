import { describe, expect, it } from 'vitest';
import { JOURNAL_TARGETS } from '../server/ledger/journal-file';
import {
	JOURNAL_RANGE_FIELDS,
	JOURNAL_TARGET_LABELS,
	JOURNAL_TARGETS_OFFERED,
	RANGE_REVERSED,
	journalFileName,
	journalRangeQuery,
	readJournalRange
} from './journal-range';

/** the query string a screen's own form would submit for March. */
function march(over: Record<string, string> = {}): URLSearchParams {
	return new URLSearchParams({
		[JOURNAL_RANGE_FIELDS.from]: '2026-03-01',
		[JOURNAL_RANGE_FIELDS.to]: '2026-03-31',
		[JOURNAL_RANGE_FIELDS.target]: 'quickbooks',
		...over
	});
}

describe('the accounting packages a file may be shaped for', () => {
	it('offers exactly the ones the shaping takes, each with a word', () => {
		// the assertion the `Object.keys` in that module rests on: the labels are the offered set,
		// so a third target added to the shaping is offered rather than silently left off the
		// screen and refused off the wire.
		expect([...JOURNAL_TARGETS_OFFERED].sort()).toEqual([...JOURNAL_TARGETS].sort());
		for (const target of JOURNAL_TARGETS) {
			// the package's own name and never the key, which is what a screen would draw a
			// `?? value` fallback of.
			expect(JOURNAL_TARGET_LABELS[target]).not.toBe(target);
			expect(JOURNAL_TARGET_LABELS[target].length).toBeGreaterThan(0);
		}
	});
});

describe('the range a request names', () => {
	it('opens at the first instant of the first day and closes at the last of the last', () => {
		const read = readJournalRange(march());
		if (!read.ok) throw new Error('March did not read');

		expect(read.from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
		// the whole of the last day, because an entry's `occurred_at` is the instant the money
		// moved — a bound at that day's midnight drops everything posted after it.
		expect(read.to.toISOString()).toBe('2026-03-31T23:59:59.999Z');
	});

	it('is refused where a day is not on the calendar, naming the end it was written at', () => {
		const read = readJournalRange(march({ [JOURNAL_RANGE_FIELDS.to]: '2026-02-30' }));
		if (read.ok) throw new Error('a day the calendar does not have was read');

		expect(read.problems.map(({ field }) => field)).toEqual([JOURNAL_RANGE_FIELDS.to]);
	});

	it('is refused where the far end is before the near one, naming the end that is', () => {
		const read = readJournalRange(march({ [JOURNAL_RANGE_FIELDS.to]: '2026-02-28' }));
		if (read.ok) throw new Error('a range ending before it starts was read');

		// not an empty range: a range that holds nothing and a range written backwards produce the
		// same header-only file, and that file reads as a period nothing was posted in.
		expect(read.problems).toEqual([{ field: JOURNAL_RANGE_FIELDS.to, problem: RANGE_REVERSED }]);
	});

	it('takes a range of one day, which is the edge that check stands on', () => {
		const read = readJournalRange(march({ [JOURNAL_RANGE_FIELDS.to]: '2026-03-01' }));
		if (!read.ok) throw new Error('a single day did not read');

		expect(read.from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
		expect(read.to.toISOString()).toBe('2026-03-01T23:59:59.999Z');
	});

	it('is refused where nothing was asked at all, naming all three', () => {
		const read = readJournalRange(new URLSearchParams());
		if (read.ok) throw new Error('an empty query was read as a range');

		expect(read.problems.map(({ field }) => field)).toEqual([
			JOURNAL_RANGE_FIELDS.from,
			JOURNAL_RANGE_FIELDS.to,
			JOURNAL_RANGE_FIELDS.target
		]);
	});
});

describe('the range written back out', () => {
	it('reads back to the range it was written from', () => {
		const read = readJournalRange(march());
		if (!read.ok) throw new Error('March did not read');

		const again = readJournalRange(
			new URLSearchParams(journalRangeQuery(read.target, read.from, read.to))
		);
		if (!again.ok) throw new Error('the query it wrote did not read back');

		expect(again).toEqual(read);
	});

	it('names the file for its target and both days of the range', () => {
		const read = readJournalRange(march());
		if (!read.ok) throw new Error('March did not read');

		// both ends, so a second month in the same downloads folder is a second file.
		expect(journalFileName(read.target, read.from, read.to)).toBe(
			'quickbooks-journal-2026-03-01-to-2026-03-31.csv'
		);
	});
});
