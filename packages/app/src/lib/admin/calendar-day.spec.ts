import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { calendarDay } from './calendar-day';
import { CalendarDay } from './local-day';

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

// the gifts list omits the zone when the loader has none. the markup must not name a day: Manila
// would be the 22nd and UTC the 21st, and either one is the day an admin must not be served.
it('serves neither day of that instant when no zone is passed', () => {
	const html = renderToString(createElement(CalendarDay, { at: '2026-10-21T16:23:00.000Z' }));
	const time = html.match(/<time\b([^>]*)>([^<]*)<\/time>/);

	expect(time).not.toBeNull();
	expect(time?.[1]).not.toContain('2026-10-22');
	expect(time?.[1]).not.toContain('2026-10-21');
	expect(time?.[1]).not.toMatch(/datetime/i);
	expect(time?.[2]).toBe('');
	// the day that arrives later is ten characters, and the empty element holds that box.
	expect(time?.[1]).toContain('10ch');
	expect(time?.[1]).toContain('1lh');
	expect(time?.[1]).toContain('inline-block');
});
