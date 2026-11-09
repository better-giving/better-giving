import { describe, expect, it } from 'vitest';
import { bandResizeDelta, centredBanner, naturalBanner, shownBannerMinimum } from './banner-crop';

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
		const band = naturalBanner(
			{ x: 0, y: 0, width: 401, height: 100.25 },
			{ width: 800, height: 600 },
			{ width: 2402, height: 1800 }
		);
		expect(band.width % 4).toBe(0);
		expect(band.height * 4).toBe(band.width);
	});

	it('holds a band dragged to the edge inside the photo', () => {
		const band = naturalBanner(
			{ x: 400.4, y: 499.9, width: 400, height: 100 },
			{ width: 800, height: 600 },
			{ width: 1601, height: 1201 }
		);
		expect(band.x + band.width).toBeLessThanOrEqual(1601);
		expect(band.y + band.height).toBeLessThanOrEqual(1201);
	});
});

describe('bandResizeDelta()', () => {
	it('hands a growing band its change, and a shrinking one a quarter of it', () => {
		expect(bandResizeDelta(10)).toBe(10);
		expect(bandResizeDelta(-10)).toBe(-2.5);
	});
});
