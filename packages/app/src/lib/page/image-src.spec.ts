import { describe, expect, it } from 'vitest';
import type { Block } from './catalog';
import { placedImageIds } from './image-src';

const HERO = 'a1b2c3d4-0000-7000-8000-000000000001';
const IMAGE = 'a1b2c3d4-0000-7000-8000-000000000002';

describe('placedImageIds', () => {
	it('names each hero’s and image block’s photo in page order, and skips a block holding none', () => {
		const blocks: Block[] = [
			{ id: 'hero', type: 'hero', variant: 'wide', background: 'none', imageId: HERO, alt: null },
			{ id: 'title', type: 'title', variant: 'left', background: 'none', heading: 'Coats' },
			{
				id: 'empty',
				type: 'image',
				variant: 'column',
				background: 'none',
				imageId: null,
				alt: null
			},
			{
				id: 'pic',
				type: 'image',
				variant: 'wide',
				background: 'none',
				imageId: IMAGE,
				alt: 'Vans'
			},
			{ id: 'donate', type: 'donation-box', background: 'none' }
		];

		expect(placedImageIds({ blocks })).toEqual([HERO, IMAGE]);
	});
});
