import { expect, it } from 'vitest';
import { inkOn } from './ink';

it.each([
	['#ffffff', 'dark'],
	['#f5d90a', 'dark'],
	['#000000', 'light'],
	['#1d6b4f', 'light'],
	['#8a3b12', 'light']
] as const)('writes on %s in the %s ink', (hex, ink) => {
	expect(inkOn(hex)).toBe(ink);
});

it('splits where black and white stand equally far from the fill', () => {
	// #767676 is 0.181 luminance and #757575 0.178, either side of sqrt(1.05 * 0.05) - 0.05.
	expect(inkOn('#767676')).toBe('dark');
	expect(inkOn('#757575')).toBe('light');
});
