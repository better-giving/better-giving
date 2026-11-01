import { describe, expect, it } from 'vitest';
import { box, hexColour, INK, INK_MUTED, LINK, pxFromLength } from './tokens';

// the conversions ./tokens.ts performs. a colour arrives from the operator system already as the
// six-digit hex a mail client renders, so what is checked for a colour is that nothing else gets
// through; a length still resolves, and is checked against the root size.

describe('the hex a mail client renders', () => {
	it('takes a six-digit hex as it stands, in lowercase', () => {
		expect(hexColour('#0d74ce')).toBe('#0d74ce');
		expect(hexColour('#0D74CE')).toBe('#0d74ce');
	});

	it('refuses a colour a mail client may not read', () => {
		// a mail is written in the one colour form every client reads, so nothing else passes.
		expect(() => hexColour('#fff')).toThrow();
		expect(() => hexColour('#0d74ce80')).toThrow();
		expect(() => hexColour('oklch(0.556 0.15 247.3)')).toThrow();
		expect(() => hexColour('var(--admin-ink)')).toThrow();
	});

	/**
	 * the colours a reader of a mail actually meets: the ink every sentence is set in, the small
	 * print under the rule, and the word an invitation is opened by.
	 *
	 * pinned to the hex rather than to the token, so that a mail's own colour is a thing this suite
	 * states. the token moving is a deliberate change to the design system and lands here as a
	 * failure. each is the radix step its operator alias names in
	 * packages/operator/src/styles/tokens.css: slate 12, slate 11 and blue 11.
	 */
	it('draws the mails in the operator ink, small print and link colour', () => {
		expect(INK).toBe('#1c2024');
		expect(INK_MUTED).toBe('#60646c');
		expect(LINK).toBe('#0d74ce');
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
