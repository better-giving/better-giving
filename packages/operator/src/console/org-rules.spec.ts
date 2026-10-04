import { describe, expect, it } from 'vitest';
import { EIN, einAsTyped } from './org-rules';

describe('the EIN box as it is typed', () => {
	it.each([
		['', ''],
		['1', '1'],
		['12', '12'],
		['123', '12-3'],
		['12-', '12'],
		['123456789', '12-3456789'],
		['12-3456789', '12-3456789']
	])('spells %j as %j', (typed, shown) => {
		expect(einAsTyped(typed)).toBe(shown);
	});

	it('drops what is not a digit', () => {
		expect(einAsTyped('12-34a56b789')).toBe('12-3456789');
	});

	it('drops a tenth digit', () => {
		expect(einAsTyped('12-3456789x')).toBe('12-3456789');
		expect(einAsTyped('1234567890')).toBe('12-3456789');
	});

	it('reads a pasted number written with spaces', () => {
		expect(einAsTyped('12 345 6789')).toBe('12-3456789');
	});

	it('hands back a complete number in a spelling the stored rule accepts', () => {
		expect(EIN.test(einAsTyped('123456789'))).toBe(true);
	});
});
