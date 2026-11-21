import { describe, expect, it } from 'vitest';
import { MAX_SHARES, sharesFromText, sharesText } from './shares';

// node pool, no database: a share count is a pure function of its text, and back.

describe('sharesFromText', () => {
	it('reads whole and fractional shares as millionths', () => {
		expect(sharesFromText('50')).toBe(50_000_000);
		expect(sharesFromText('12.5')).toBe(12_500_000);
		expect(sharesFromText('0.000001')).toBe(1);
	});

	it('refuses a seventh decimal, zero, a sign and anything that is not a plain decimal', () => {
		for (const text of [
			'1.0000001',
			'0',
			'0.000000',
			'-1',
			'+1',
			'1e3',
			'1.',
			'.5',
			' 1',
			'1,000',
			''
		])
			expect(sharesFromText(text)).toBeNull();
	});

	it('takes the ceiling and refuses a share past it', () => {
		expect(sharesFromText(String(MAX_SHARES))).toBe(MAX_SHARES * 1_000_000);
		expect(sharesFromText(`${MAX_SHARES}.000001`)).toBeNull();
	});
});

describe('sharesText', () => {
	it('writes the count with no trailing zeros', () => {
		expect(sharesText(50_000_000)).toBe('50');
		expect(sharesText(12_500_000)).toBe('12.5');
		expect(sharesText(1)).toBe('0.000001');
	});
});
