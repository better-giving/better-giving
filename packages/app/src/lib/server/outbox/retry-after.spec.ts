import { describe, expect, it } from 'vitest';
import { askedWait } from './retry-after';

const ANSWERED = Date.UTC(2026, 8, 28, 12);

describe('askedWait()', () => {
	it('reads delay-seconds as a wait from the answer', () => {
		expect(askedWait('120', ANSWERED)).toBe(120_000);
		expect(askedWait(' 0 ', ANSWERED)).toBe(0);
	});

	it('reads an HTTP-date as the wait until it', () => {
		expect(askedWait('Mon, 28 Sep 2026 13:30:00 GMT', ANSWERED)).toBe(90 * 60_000);
	});

	it('reads a date already past as no wait at all', () => {
		expect(askedWait('Mon, 28 Sep 2026 11:00:00 GMT', ANSWERED)).toBe(0);
	});

	it.each([[null], [''], ['soon'], ['-5'], ['1.5'], ['99999999999999999999']])(
		'reads %j as no ask',
		(value) => {
			expect(askedWait(value, ANSWERED)).toBeUndefined();
		}
	);
});
