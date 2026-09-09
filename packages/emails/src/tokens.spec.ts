import { describe, expect, it } from 'vitest';
import { box, hexFromOklch, INK, LINK, pxFromLength } from './tokens';

// the conversion ./tokens.ts performs, checked against values decided outside this repository.
//
// what makes it checkable is that the arithmetic is not this project's: the three sRGB primaries
// have published oklch coordinates (CSS Color 4, https://www.w3.org/TR/css-color-4/), and their hex
// is the one thing every reader of this file already knows. a conversion that reproduces all three
// to the byte is the conversion a browser performs on the operator surfaces, which is what makes a
// mail and a screen the same colour.

describe('oklch to the hex a mail client renders', () => {
	it('converts the ends of the ramp', () => {
		expect(hexFromOklch('oklch(1 0 0)')).toBe('#ffffff');
		expect(hexFromOklch('oklch(0 0 0)')).toBe('#000000');
	});

	it('reproduces the three sRGB primaries from their published coordinates', () => {
		expect(hexFromOklch('oklch(0.62796 0.25768 29.234)')).toBe('#ff0000');
		expect(hexFromOklch('oklch(0.86644 0.29483 142.495)')).toBe('#00ff00');
		expect(hexFromOklch('oklch(0.45201 0.31321 264.052)')).toBe('#0000ff');
	});

	it('clips a colour outside sRGB into it', () => {
		// no token needs this — every colour the operator system authors is inside sRGB — and a
		// channel that came back outside 0–255 would be a hex nobody could render at all.
		expect(hexFromOklch('oklch(0.7 0.4 30)')).toMatch(/^#[0-9a-f]{6}$/);
	});

	it('refuses what it cannot convert', () => {
		expect(() => hexFromOklch('#ff0000')).toThrow();
	});

	/**
	 * the two colours a reader of a mail actually meets: the ink every sentence is set in, and the
	 * word an invitation is opened by.
	 *
	 * pinned to the hex rather than to the token, so that a mail's own colour is a thing this suite
	 * states. the token moving is a deliberate change to the design system and lands here as a
	 * failure; the arithmetic moving is not, and lands here the same way.
	 */
	it('draws the mails in the operator ink and the operator link colour', () => {
		expect(INK).toBe('#22272d');
		expect(LINK).toBe('#0077c5');
	});
});

describe('the lengths and boxes a style object states', () => {
	it('resolves a rem against the root size the operator surfaces resolve one against', () => {
		expect(pxFromLength('1rem')).toBe(16);
		expect(pxFromLength('0.875rem')).toBe(14);
		expect(pxFromLength('34rem')).toBe(544);
	});

	it('takes a px as it stands', () => {
		expect(pxFromLength('2px')).toBe(2);
	});

	it('refuses a unit it does not resolve', () => {
		// a mail client resolves none of these either, and a size it cannot resolve is a size it
		// drops — which is a document that renders and is wrong.
		expect(() => pxFromLength('64ch')).toThrow();
		expect(() => pxFromLength('1.5')).toThrow();
	});

	it('writes a box shorthand with a bare zero', () => {
		expect(box(0, 0, 16)).toBe('0 0 16px');
		expect(box(24, 0)).toBe('24px 0');
	});
});
