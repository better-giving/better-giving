import { describe, expect, it } from 'vitest';
import { monthKey, monthStart, overMonths, SERIES_MONTHS } from './months';

// the run is twelve, and every case below states its months as keys rather than as instants: what
// a screen draws is what `strftime('%Y-%m', …)` grouped, and a case that built its own dates would
// be asserting this module against itself.

describe('the bucket an instant falls in', () => {
	it('spells a UTC month the way strftime does', () => {
		expect(monthKey(new Date('2026-09-05T12:00:00.000Z'))).toBe('2026-09');
		// the pad is the whole of it: `2026-9` groups with nothing sqlite ever wrote.
		expect(monthKey(new Date('2026-01-31T23:59:59.999Z'))).toBe('2026-01');
	});

	it('is the month the instant is in at either edge of it, UTC', () => {
		expect(monthKey(monthStart(new Date('2026-09-05T12:00:00.000Z'), 0))).toBe('2026-09');
		expect(monthKey(monthStart(new Date('2026-01-15T00:00:00.000Z'), -1))).toBe('2025-12');
	});
});

describe('a year of monthly totals', () => {
	const NOW = new Date('2026-09-05T12:00:00.000Z');

	it('ends the run at the month now is in, and starts it eleven back', () => {
		const run = overMonths([], NOW);

		expect(run.points).toHaveLength(SERIES_MONTHS);
		expect(monthKey(run.lastMonth)).toBe('2026-09');
		expect(monthKey(run.firstMonth)).toBe('2025-10');
	});

	it('stands each month in its own bucket and leaves the rest at nought', () => {
		const run = overMonths(
			[
				{ month: '2026-09', total: 12_480 },
				{ month: '2026-08', total: 18_290 },
				{ month: '2025-10', total: 6_240 }
			],
			NOW
		);

		expect(run.points).toEqual([6_240, 0, 0, 0, 0, 0, 0, 0, 0, 0, 18_290, 12_480]);
		expect(run.thisMonth).toBe(12_480);
	});

	it('counts a month older than the run in the total and in no bucket', () => {
		// the total is everything the books hold rather than the sum of the twelve, so a figure
		// beside the run does not shrink as the year turns away from an older month.
		const run = overMonths(
			[
				{ month: '2026-09', total: 100 },
				{ month: '2024-01', total: 900 }
			],
			NOW
		);

		expect(run.total).toBe(1_000);
		expect(run.points.reduce((sum, n) => sum + n, 0)).toBe(100);
	});

	it('reads a deployment with nothing as a run of noughts', () => {
		const run = overMonths([], NOW);

		expect(run.total).toBe(0);
		expect(run.thisMonth).toBe(0);
		expect(run.points).toEqual(new Array(SERIES_MONTHS).fill(0));
	});
});
