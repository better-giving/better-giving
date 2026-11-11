import { describe, expect, it } from 'vitest';
import {
	centredFrame,
	frameResizeDelta,
	naturalFrame,
	PHOTO_HEIGHT_MIN,
	photoSourceRefusal,
	shownFrameMinimum
} from './photo-crop';

describe('a page photo’s 16:9 frame', () => {
	it('turns down a photo narrower or shorter than the smallest frame', () => {
		expect(PHOTO_HEIGHT_MIN).toBe(675);
		expect(photoSourceRefusal(640, 480)).toBe(
			'That image is only 640 pixels wide. A photo needs at least 1200. Choose a larger one.'
		);
		expect(photoSourceRefusal(1600, 600)).toBe(
			'That image is only 600 pixels tall. A photo needs at least 675. Choose a taller one.'
		);
		expect(photoSourceRefusal(1200, 675)).toBeNull();
	});

	it('opens on the widest centred frame', () => {
		expect(centredFrame({ width: 800, height: 800 })).toEqual({
			x: 0,
			y: 175,
			width: 800,
			height: 450
		});
	});

	it('keeps a frame of whole pixels, sixteen to nine exactly, inside the photo', () => {
		const kept = naturalFrame(
			{ x: 10, y: 10, width: 401, height: 225.5 },
			{ width: 800, height: 600 },
			{ width: 3200, height: 2400 }
		);
		expect(kept.width % 16).toBe(0);
		expect(kept.height).toBe((kept.width / 16) * 9);
		expect(kept.x + kept.width).toBeLessThanOrEqual(3200);
		expect(kept.y + kept.height).toBeLessThanOrEqual(2400);
	});

	it('never lets the frame shrink under the smallest a page takes', () => {
		const least = shownFrameMinimum({ width: 800, height: 600 }, { width: 2400, height: 1800 });
		expect(least.width).toBe(400);
	});

	it('resizes a shrinking frame from its height', () => {
		expect(frameResizeDelta(16)).toBe(16);
		expect(frameResizeDelta(-16)).toBe(-9);
	});
});
