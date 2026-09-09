import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney } from './format';

describe('formatMoney', () => {
	// the code, never the symbol: `$100.00` is four different currencies this app can hold.
	it('prints the ISO code rather than a symbol', () => {
		expect(formatMoney(10_000, 'USD')).toBe('USD 100.00');
		expect(formatMoney(10_000, 'CAD')).toBe('CAD 100.00');
	});

	/**
	 * the exponent comes from the currency. JPY has no minor unit, so 10000 minor units is
	 * ¥10,000 and not ¥100 — a naive `/ 100` understates a gift by two orders of magnitude on
	 * a document somebody files with a tax authority.
	 */
	it('uses the currency’s own exponent, not hundredths', () => {
		expect(formatMoney(10_000, 'JPY')).toBe('JPY 10,000');
	});

	/**
	 * no U+00A0. ICU separates the code from the number with a non-breaking space, which is
	 * invisible in every editor and is not the character a donor's accountant types into a
	 * spreadsheet search. it is normalised, and this is what catches it coming back on an ICU
	 * change — the assertion above would pass either way in a terminal.
	 */
	it('separates the code with a plain space, never a non-breaking one', () => {
		expect(formatMoney(10_000, 'USD')).not.toContain('\u00A0');
	});

	it('prints minor units below one major unit', () => {
		expect(formatMoney(5, 'USD')).toBe('USD 0.05');
		expect(formatMoney(0, 'USD')).toBe('USD 0.00');
	});

	/**
	 * a lowercase code is a code, and unnormalised it takes the fallback. the pattern is anchored
	 * uppercase, so `'jpy'` fails it and falls through to the only float path in the function —
	 * which hard-codes hundredths and prints `jpy 100.00` for a gift of ¥10,000, on the one
	 * document somebody files. uppercasing before the test keeps it on the ICU path.
	 */
	it.each([
		{ code: 'usd', expected: 'USD 100.00' },
		{ code: 'Usd', expected: 'USD 100.00' },
		{ code: 'jpy', expected: 'JPY 10,000' }
	])('normalises $code before deciding it is a currency', ({ code, expected }) => {
		expect(formatMoney(10_000, code)).toBe(expected);
	});

	// the database check makes this unreachable from a stored row. it is here because the
	// fallback exists so that a bad value prints a wrong-looking number instead of throwing
	// a `RangeError` out of a template and killing a send — and it quotes what was stored.
	it('falls back rather than throwing on a value that is not a currency code', () => {
		expect(() => formatMoney(10_000, 'dollars')).not.toThrow();
		expect(formatMoney(10_000, 'dollars')).toBe('dollars 100.00');
	});
});

describe('formatDate', () => {
	// spelled out, because `01/05/2026` is the 5th of January to an American and the 1st of
	// May to nearly everybody else, and a receipt is read by both.
	it('spells the month out', () => {
		expect(formatDate(new Date('2026-01-05T12:00:00Z'))).toBe('January 5, 2026');
	});

	/**
	 * UTC, pinned. every time column here is Unix ms UTC, and a formatter left to the
	 * runtime's zone renders a gift received at 23:30 UTC on 31 December as 1 January —
	 * moving it into the wrong tax year on the one document where the year is the whole point.
	 */
	it('renders in UTC, so a late-December gift keeps its year', () => {
		expect(formatDate(new Date('2025-12-31T23:30:00Z'))).toBe('December 31, 2025');
	});
});
