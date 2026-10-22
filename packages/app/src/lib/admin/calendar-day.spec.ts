import { expect, it } from 'vitest';
import { calendarDay } from './calendar-day.ts';

// the calendar day of an instant in a named zone, as `YYYY-MM-DD`. the three cases are the days a
// caller can get wrong: a zone ahead of UTC, the same instant in UTC, and a chosen day stored as
// UTC midnight by `readAccountingDate` in ../ledger/input-schema.ts.

it('is the next day in Manila, where 16:23 UTC is already the 22nd', () => {
	expect(calendarDay(new Date('2026-10-21T16:23:00.000Z'), 'Asia/Manila')).toBe('2026-10-22');
});

it('is that same instant on the UTC calendar', () => {
	expect(calendarDay(new Date('2026-10-21T16:23:00.000Z'), 'UTC')).toBe('2026-10-21');
});

it('is a chosen day stored as UTC midnight', () => {
	expect(calendarDay(new Date('2026-10-22T00:00:00.000Z'), 'UTC')).toBe('2026-10-22');
});
