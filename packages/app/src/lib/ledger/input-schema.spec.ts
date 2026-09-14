import { describe, expect, it, vi } from 'vitest';
import { FORM_CURRENCY, readAmount } from '../forms/amounts';
import {
	CORRECTION_INPUT,
	FUTURE_DATE,
	MAX_CORRECTION_NOTE,
	NOTE_MISSING,
	readAccountingDate,
	SAME_ACCOUNT,
	STALE_PAGE,
	ZERO_AMOUNT
} from './input-schema';

// what a correcting entry's boxes may hold, checked with no database and no browser — the same
// schema `src/routes/_app.admin.books.tsx` parses a body against and hands to conform, so a case
// here is a case about both sides of the wire at once.

/** a correction every rule accepts, which each case below spoils one box of. */
const CORRECTION = {
	source_id: '019fb0d2-7d57-7c5e-a7df-baed1f27b405',
	occurred_on: '2026-03-31',
	out_of: '019fb0d2-7d57-7c5e-a7df-baed1f27b405',
	into: '019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9',
	amount: '25.00',
	note: 'Stripe fee for payment pi_123, taken out of undeposited funds.'
};

/** every message one box was refused with, keyed by the box. */
function refusals(values: Record<string, string>): Record<string, string[]> {
	const parsed = CORRECTION_INPUT.safeParse(values);
	if (parsed.success) return {};
	const errors: Record<string, string[]> = {};
	for (const issue of parsed.error.issues) {
		const key = String(issue.path[0] ?? '');
		(errors[key] ??= []).push(issue.message);
	}
	return errors;
}

describe('the amount a correction moves', () => {
	it('is refused in the words `readAmount` refuses it in', () => {
		// one rule read for two answers, the arrangement `amountBound` in ../forms/input-schema.ts
		// is already under: the sentence the box is refused with is the one the parser produces, so
		// the browser and the Worker cannot describe the same rule differently.
		const { problem } = readAmount('25.005', FORM_CURRENCY);
		expect(problem).toBeTypeOf('string');
		expect(refusals({ ...CORRECTION, amount: '25.005' }).amount).toEqual([problem]);
	});
});

describe('an amount of nothing', () => {
	it('is refused, because `post()` would refuse it with no box to blame', () => {
		// `post()` rejects a zero line outright — a zero records nothing and is the shape a
		// mis-computed split produces — so without this the operator meets a 500 rather than a
		// sentence under the box they typed it in.
		expect(refusals({ ...CORRECTION, amount: '0' }).amount).toEqual([ZERO_AMOUNT]);
		expect(refusals({ ...CORRECTION, amount: '0.00' }).amount).toEqual([ZERO_AMOUNT]);
	});
});

describe('an amount that is not a positive whole number of minor units', () => {
	it('is refused with one sentence on the amount box, and no other box', () => {
		// `postCorrection` throws on a figure that is not positive, which would reach the operator as
		// a 500. the direction is the two pickers and never a sign, so a negative is not a correction
		// the other way round — it is a box to fix.
		for (const amount of ['NaN', '-5', '-0.01', 'Infinity', '1e3']) {
			const errors = refusals({ ...CORRECTION, amount });
			expect(errors.amount, amount).toHaveLength(1);
			expect(Object.keys(errors), amount).toEqual(['amount']);
		}
	});
});

describe('the note on a correction', () => {
	it('is required, because a correction with no stated reason is what makes books unreadable', () => {
		// conform strips an empty box to `undefined` before the schema sees it, so the sentence has
		// to sit on the type constructor: a `.min(1)` message would be answered with zod's own
		// "expected string, received undefined" instead.
		expect(refusals({ ...CORRECTION, note: '' }).note).toEqual([NOTE_MISSING]);
		expect(refusals({ ...CORRECTION, note: '   ' }).note).toEqual([NOTE_MISSING]);
	});
});

describe('the date a correction is dated', () => {
	it('is refused where the calendar has no such day', () => {
		// `<input type="date">` cannot produce this and a hand-built body can. it is the accounting
		// date, so it decides which period the entry lands in — a day that does not exist would
		// reach `post()` as an Invalid Date and be refused there with no box to blame.
		expect(refusals({ ...CORRECTION, occurred_on: '2026-02-30' }).occurred_on).toHaveLength(1);
		expect(refusals({ ...CORRECTION, occurred_on: '31/03/2026' }).occurred_on).toHaveLength(1);
	});

	it('is read as midnight UTC, so the day typed is the day stored', () => {
		// the Worker's clock is UTC and a bare day carries no zone, so the two have to be pinned
		// together or a correction dated the 31st lands in the following month for half the world.
		const read = readAccountingDate('2026-03-31');
		expect(read.problem).toBe(null);
		expect(read.at?.toISOString()).toBe('2026-03-31T00:00:00.000Z');
	});
});

describe('a correction dated ahead of the day it is posted', () => {
	/** the instant every case below is dated against, so none of them turns on the day it runs. */
	const NOW = Date.UTC(2026, 2, 31, 12);

	/** a whole number of days either side of `NOW`, in the form the box submits. */
	function day(offset: number): string {
		return new Date(NOW + offset * 86_400_000).toISOString().slice(0, 10);
	}

	/** the box read against a frozen clock, which is the only thing the ceiling is measured from. */
	function dated(occurred_on: string): string[] | undefined {
		vi.useFakeTimers({ now: NOW });
		try {
			return refusals({ ...CORRECTION, occurred_on }).occurred_on;
		} finally {
			vi.useRealTimers();
		}
	}

	it('is refused, because nothing a correction fixes has happened yet', () => {
		// the year is the typo this catches: a date years out is a period nobody meant, and it
		// posts cleanly and silently without this.
		expect(dated('2262-03-31')).toEqual([FUTURE_DATE]);
		expect(dated(day(2))).toEqual([FUTURE_DATE]);
	});

	it('is not refused a day out, which is the widest a civil clock runs ahead of UTC', () => {
		// the ceiling is measured against the Worker's UTC day and this schema also runs in the
		// browser, where the day is the operator's own — so a tighter ceiling would have the screen
		// accept a date the action then refuses, which is what one shared schema exists to prevent.
		expect(dated(day(1))).toBeUndefined();
		expect(dated(day(0))).toBeUndefined();
		expect(dated(day(-1))).toBeUndefined();
		expect(dated('2020-01-01')).toBeUndefined();
	});
});

describe('the two accounts a correction moves between', () => {
	it('are each required, and the sentence names the side', () => {
		// a `<select>` whose first option is blank is what makes this reachable, and the blank is
		// deliberate: a picker preselecting an account posts a correction against one nobody chose.
		expect(refusals({ ...CORRECTION, out_of: '' }).out_of).toHaveLength(1);
		expect(refusals({ ...CORRECTION, into: '' }).into).toHaveLength(1);
	});

	it('is not told they collide while neither has been chosen', () => {
		// the pair rule reads two siblings, and a side nobody chose is not yet a side that collides:
		// being told both are the same account before either is picked is a sentence about a
		// decision the operator has not made. the two blank refusals abort, which is what keeps the
		// object check off a value that has not been filled in.
		const neither = refusals({ ...CORRECTION, out_of: '', into: '' });
		expect(neither.out_of).toHaveLength(1);
		expect(neither.into).toHaveLength(1);
		expect(neither.into).not.toContain(SAME_ACCOUNT);
	});

	it('may not be the same account, which nets to zero and means nothing', () => {
		// it posts cleanly — `post()` sees two lines summing to zero and has no opinion about which
		// accounts they name — so this is the only place it can be refused. the message is keyed to
		// `into`, which is the box the operator changes to fix it.
		const both = refusals({ ...CORRECTION, into: CORRECTION.out_of });
		expect(both.into).toEqual([SAME_ACCOUNT]);
		expect(both.out_of).toBeUndefined();
	});

	it('are told they collide on the first press, even while another box is refused', () => {
		// every refusal is marked from the first attempt. a collision withheld until the note and the
		// amount are fixed is a sentence the operator meets only after they thought they were done.
		const alongside = refusals({ ...CORRECTION, into: CORRECTION.out_of, note: '', amount: '0' });
		expect(alongside.into).toEqual([SAME_ACCOUNT]);
		expect(alongside.note).toEqual([NOTE_MISSING]);
		expect(alongside.amount).toEqual([ZERO_AMOUNT]);
	});
});

describe('the length of a note', () => {
	it('is capped, and the refusal counts what was written', () => {
		// the cap is read off the module rather than copied, which is how one silently stops being
		// tested when it is raised.
		expect(refusals({ ...CORRECTION, note: 'a'.repeat(MAX_CORRECTION_NOTE) }).note).toBeUndefined();
		const over = refusals({ ...CORRECTION, note: 'a'.repeat(MAX_CORRECTION_NOTE + 1) }).note;
		expect(over).toEqual([`must be at most ${MAX_CORRECTION_NOTE} characters`]);
	});
});

describe('the id a correction is posted under', () => {
	it('is refused where the page did not mint one', () => {
		// the box is hidden and the loader fills it, so nothing an operator did can empty it: what
		// reaches here without one is a hand-built body or a page whose markup went missing, and
		// neither is something to file an entry for. the sentence says the only thing that helps.
		expect(refusals({ ...CORRECTION, source_id: '' }).source_id).toEqual([STALE_PAGE]);
	});

	it('is refused where it is not the shape this screen mints', () => {
		// a uuidv7, because that is what `entry_group.source_id` holds for an `adjustment` and what
		// the pair's unique index is asked to refuse a second time. an arbitrary string would be
		// filed as one and would collide with nothing.
		expect(refusals({ ...CORRECTION, source_id: 'not-a-uuid' }).source_id).toEqual([STALE_PAGE]);
	});
});
