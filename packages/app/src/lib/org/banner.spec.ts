import { describe, expect, it } from 'vitest';
import { bannerRefusal, bannerSourceRefusal } from './banner';

// the banner's pixel rule, which the crop dialog and the banner's address
// (../../routes/_app.admin.settings_.banner.ts) both state.

describe('bannerRefusal()', () => {
	it('takes a 4:1 photo from 1200 to 1600 pixels wide', () => {
		expect(bannerRefusal(1200, 300)).toBeNull();
		expect(bannerRefusal(1600, 400)).toBeNull();
	});

	it('takes a photo a pixel off 4:1, the rounding a crop and a resize leave', () => {
		expect(bannerRefusal(1600, 401)).toBeNull();
		expect(bannerRefusal(1203, 300)).toBeNull();
	});

	it('names the width of a photo narrower than 1200', () => {
		expect(bannerRefusal(900, 225)).toBe(
			'That image is only 900 pixels wide. A banner needs at least 1200. Choose a larger one.'
		);
	});

	it('refuses a photo more than a pixel off 4:1', () => {
		expect(bannerRefusal(1600, 402)).toBe(
			'That image is not the banner’s shape. Crop it to 4 to 1 and save it again.'
		);
		expect(bannerRefusal(1200, 1200)).not.toBeNull();
	});

	it('refuses a photo wider than the 1600 a banner is kept at', () => {
		expect(bannerRefusal(2400, 600)).toBe(
			'That image is 2400 pixels wide. A banner is kept at most 1600 wide. Choose it again.'
		);
	});
});

describe('bannerSourceRefusal()', () => {
	it('takes an image that holds a 1200 × 300 crop, of any shape', () => {
		expect(bannerSourceRefusal(1200, 300)).toBeNull();
		expect(bannerSourceRefusal(4000, 3000)).toBeNull();
		expect(bannerSourceRefusal(1200, 1600)).toBeNull();
	});

	it('names the width of an image narrower than 1200', () => {
		expect(bannerSourceRefusal(900, 600)).toBe(
			'That image is only 900 pixels wide. A banner needs at least 1200. Choose a larger one.'
		);
	});

	it('names the height of an image wide enough but shorter than 300', () => {
		expect(bannerSourceRefusal(2000, 250)).toBe(
			'That image is only 250 pixels tall. A banner needs at least 300. Choose a taller one.'
		);
	});

	it('names the width where both are short', () => {
		expect(bannerSourceRefusal(900, 200)).toBe(
			'That image is only 900 pixels wide. A banner needs at least 1200. Choose a larger one.'
		);
	});
});
