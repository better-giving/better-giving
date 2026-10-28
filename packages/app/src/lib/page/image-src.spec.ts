import { describe, expect, it } from 'vitest';
import { placedImageIds, shareImage } from './image-src';

const HERO = 'a1b2c3d4-0000-7000-8000-000000000001';
const IMAGE = 'a1b2c3d4-0000-7000-8000-000000000002';

describe('placedImageIds', () => {
	it('names the cover photo, then each photo beside it in order', () => {
		expect(
			placedImageIds({
				hero: { imageId: HERO, alt: null },
				photos: [{ imageId: IMAGE, alt: 'Vans' }]
			})
		).toEqual([HERO, IMAGE]);
	});

	it('names the campaign’s logo after its photos', () => {
		const LOGO = 'a1b2c3d4-0000-7000-8000-000000000003';
		expect(
			placedImageIds({
				hero: { imageId: HERO, alt: null },
				photos: [{ imageId: IMAGE, alt: 'Vans' }],
				logo: { imageId: LOGO, alt: null }
			})
		).toEqual([HERO, IMAGE, LOGO]);
	});

	it('names nothing for a page with no photo', () => {
		expect(placedImageIds({})).toEqual([]);
	});
});

describe('shareImage', () => {
	it('is the cover photo, absolute against the page’s address', () => {
		expect(shareImage({ hero: { imageId: HERO, alt: null } }, 'https://give.test/coats')).toBe(
			`https://give.test/image/${HERO}`
		);
	});

	it('is none without a cover photo', () => {
		expect(shareImage({}, 'https://give.test/coats')).toBeNull();
	});
});
