import { describe, expect, it } from 'vitest';
import { brandHue, groundHue, pageHue2 } from './palette';

// node pool: the hue arithmetic the page root's inline style carries is pure, and the colours it
// stands for are measured in $lib/donate/page.spec.ts.

describe("the brand colour's oklch hue", () => {
	// the three sRGB primaries' oklch hues as https://www.w3.org/TR/css-color-4/#ok-lab publishes
	// them, which is a source independent of the conversion under test.
	it('reads the published hue of each sRGB primary', () => {
		expect(brandHue('#ff0000')).toBeCloseTo(29.23, 1);
		expect(brandHue('#00ff00')).toBeCloseTo(142.5, 1);
		expect(brandHue('#0000ff')).toBeCloseTo(264.05, 1);
	});

	it('reads a hue past 180 as a positive angle', () => {
		expect(brandHue('#ff00ff')).toBeCloseTo(328.36, 1);
	});
});

describe("the hue a palette draws a ground at the brand's own hue", () => {
	it('keeps a hue outside the red and amber window', () => {
		expect(groundHue(150)).toBe(150);
		expect(groundHue(264.05)).toBe(264.05);
		expect(groundHue(1.9)).toBe(1.9);
		expect(groundHue(105.1)).toBe(105.1);
	});

	it('moves a hue from 2 to 105 inclusive to 115', () => {
		expect(groundHue(2)).toBe(115);
		expect(groundHue(29.23)).toBe(115);
		expect(groundHue(85)).toBe(115);
		expect(groundHue(105)).toBe(115);
	});
});

describe("a palette's second hue", () => {
	it('is the brand hue plus 150 on duo', () => {
		expect(pageHue2(200, 'duo')).toBe(350);
		expect(pageHue2(29.23, 'duo')).toBeCloseTo(179.23, 5);
	});

	it('is the brand hue plus 60 on bright', () => {
		expect(pageHue2(264.05, 'bright')).toBeCloseTo(324.05, 5);
		expect(pageHue2(50, 'bright')).toBe(110);
	});

	it('wraps past 360', () => {
		expect(pageHue2(300, 'bright')).toBe(0);
		expect(pageHue2(330, 'duo')).toBe(120);
		expect(pageHue2(250, 'duo')).toBe(115);
	});

	it('moves a landing hue from 2 to 105 inclusive to 115', () => {
		expect(pageHue2(264.05, 'duo')).toBe(115);
		expect(pageHue2(330, 'bright')).toBe(115);
		expect(pageHue2(45, 'bright')).toBe(115);
		expect(pageHue2(302, 'bright')).toBe(115);
		expect(pageHue2(301.9, 'bright')).toBeCloseTo(1.9, 5);
	});

	it('is none on a palette that draws no second hue', () => {
		expect(pageHue2(264.05, 'plain')).toBeNull();
		expect(pageHue2(264.05, 'tint')).toBeNull();
		expect(pageHue2(264.05, 'bold')).toBeNull();
	});
});
