import { afterEach, describe, expect, it, vi } from 'vitest';
import { localDay } from './local-day';

// `localDay` reads the process's zone, so each case builds its instant from local fields (or pins
// `TZ`) and expects a literal day.

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('localDay', () => {
	it('pads the month and the day to two digits', () => {
		expect(localDay(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
	});

	it('keeps the last minute of a day on that day and the next minute on the next', () => {
		expect(localDay(new Date(2026, 10, 18, 23, 59, 59))).toBe('2026-11-18');
		expect(localDay(new Date(2026, 10, 19, 0, 0, 0))).toBe('2026-11-19');
	});

	it('rolls over a month and a year at local midnight', () => {
		expect(localDay(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
		expect(localDay(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01');
	});

	it('reads the zone, not UTC: one instant is two days in two zones', () => {
		const instant = new Date('2026-11-18T23:30:00Z');
		vi.stubEnv('TZ', 'Pacific/Kiritimati');
		expect(localDay(instant)).toBe('2026-11-19');
		vi.stubEnv('TZ', 'Pacific/Pago_Pago');
		expect(localDay(instant)).toBe('2026-11-18');
	});
});
