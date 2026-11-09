import { describe, expect, it } from 'vitest';
import { BANNER_RATIO } from '$lib/org/banner';
import { bandResizeDelta, centredBanner, naturalBanner, shownBannerMinimum } from './banner-crop';
import { NUDGE, type Rect, resizeCorner } from './logo-crop';

// the banner's crop arithmetic: the band a crop opens on, how small it may be dragged, and the band
// a save posts in the photo's own pixels.

describe('centredBanner()', () => {
	it('opens on the full width of a photo taller than 4:1, centred top to bottom', () => {
		expect(centredBanner({ width: 800, height: 400 })).toEqual({
			x: 0,
			y: 100,
			width: 800,
			height: 200
		});
	});

	it('opens on the full height of a photo wider than 4:1, centred side to side', () => {
		expect(centredBanner({ width: 1000, height: 100 })).toEqual({
			x: 300,
			y: 0,
			width: 400,
			height: 100
		});
	});
});

describe('shownBannerMinimum()', () => {
	it('is 1200 of the photo’s own pixels, drawn at the box’s scale, at 4:1', () => {
		expect(shownBannerMinimum({ width: 800, height: 600 }, { width: 3200, height: 2400 })).toEqual({
			width: 300,
			height: 75
		});
	});

	it('is never wider than the widest band the box holds', () => {
		expect(shownBannerMinimum({ width: 600, height: 400 }, { width: 900, height: 600 })).toEqual({
			width: 600,
			height: 150
		});
	});
});

describe('naturalBanner()', () => {
	it('scales the band to the photo’s pixels at exactly 4:1', () => {
		expect(
			naturalBanner(
				{ x: 0, y: 70, width: 800, height: 200 },
				{ width: 800, height: 600 },
				{ width: 1600, height: 1200 }
			)
		).toEqual({ x: 0, y: 140, width: 1600, height: 400 });
	});

	it('rounds the width down to a multiple of 4, so the height is a whole quarter of it', () => {
		// 402 shown is 1206.9 of the photo’s pixels, which rounds to 1207 and floors to 1204.
		expect(
			naturalBanner(
				{ x: 0, y: 0, width: 402, height: 100.5 },
				{ width: 800, height: 600 },
				{ width: 2402, height: 1800 }
			)
		).toEqual({ x: 0, y: 0, width: 1204, height: 301 });
	});

	it('holds a band dragged to the edge inside the photo', () => {
		// unclamped the corner rounds to (802, 1002): a pixel past where an 800 × 200 band still fits.
		expect(
			naturalBanner(
				{ x: 400.9, y: 500.4, width: 400, height: 100 },
				{ width: 800, height: 600 },
				{ width: 1601, height: 1201 }
			)
		).toEqual({ x: 801, y: 1001, width: 800, height: 200 });
	});

	it('keeps a band wider than the photo allows to the widest 4:1 band the photo holds', () => {
		expect(
			naturalBanner(
				{ x: 0, y: 0, width: 800, height: 200 },
				{ width: 800, height: 600 },
				{ width: 1600, height: 300 }
			)
		).toEqual({ x: 0, y: 0, width: 1200, height: 300 });
	});
});

describe('the corner a band grows from at the keyboard', () => {
	// an 800 × 600 box, and a 400 × 100 band 5 above its bottom edge.
	const box = { width: 800, height: 600 };
	const band = (below: number): Rect => ({ x: 100, y: 500 - below, width: 400, height: 100 });

	it('is the bottom right where there is a quarter of the step below it, as a drag would grow it', () => {
		expect(resizeCorner(band(5), box, NUDGE.shift, BANNER_RATIO)).toBe('se');
	});

	it('is the top right where there is less than a quarter of the step below it', () => {
		expect(resizeCorner(band(2), box, NUDGE.shift, BANNER_RATIO)).toBe('ne');
	});
});

describe('bandResizeDelta()', () => {
	it('hands a growing band its change, and a shrinking one a quarter of it', () => {
		expect(bandResizeDelta(10)).toBe(10);
		expect(bandResizeDelta(-10)).toBe(-2.5);
	});
});
