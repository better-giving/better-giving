import { describe, expect, it } from 'vitest';
import { formatMinor, formatMinorBrief } from './money';

// node pool, no database: formatting is a pure function of an integer and a currency code.

describe('formatting a stored amount', () => {
	it('puts the decimal point where the currency puts it', () => {
		// the column holds minor units, so the digits are the money and nothing about them is a
		// fraction until they are shown. an integer rendered raw reads as a hundredfold gift.
		expect(formatMinor(10_000, 'USD')).toBe('$100.00');
		expect(formatMinor(1_234_567, 'USD')).toBe('$12,345.67');
	});

	it('leaves a currency with no minor unit undivided', () => {
		// the exponent is the currency's, not two. dividing yen by a hundred is a gift a
		// hundredth of its size, and every figure on the screen agrees with every other one about
		// it — so nothing about the page looks wrong.
		expect(formatMinor(10_000, 'JPY')).toBe('¥10,000');
	});
});

describe('echoing a stored amount as it was written', () => {
	it('drops the minor units when there are none', () => {
		expect(formatMinorBrief(2000, 'USD')).toBe('$20');
		expect(formatMinorBrief(1000000, 'USD')).toBe('$10,000');
	});

	it('keeps them at full width when there are', () => {
		expect(formatMinorBrief(2050, 'USD')).toBe('$20.50');
		expect(formatMinorBrief(50, 'USD')).toBe('$0.50');
	});

	it('is the plain figure for a currency with no minor unit', () => {
		expect(formatMinorBrief(2500, 'JPY')).toBe('¥2,500');
	});
});
