import { LONG_SIDE_MAX, type Resized } from '@better-giving/operator/images/resize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGO_REFUSED } from './logo-crop';
import { squareLogo } from './logo-square';

// what a save in the logo's crop card does with its square: the canvas it draws the square on, and
// what it hands the resize. node has neither `createImageBitmap` nor `OffscreenCanvas`, so both are
// stood in for by fakes that record what they were asked to draw; the resize is
// packages/operator/src/images/resize.spec.ts's, and is stood in for by one that hands back what it
// was given.

const resize = vi.hoisted(() => vi.fn<(file: File) => Promise<Resized>>());

vi.mock('@better-giving/operator/images/resize', async (actual) => ({
	...(await actual<typeof import('@better-giving/operator/images/resize')>()),
	resizeImage: resize
}));

/** every canvas made, with the one call drawn on it. */
const canvases: { width: number; height: number; drawn: unknown[] }[] = [];

class FakeCanvas {
	readonly drawing: { width: number; height: number; drawn: unknown[] };
	constructor(width: number, height: number) {
		this.drawing = { width, height, drawn: [] };
		canvases.push(this.drawing);
	}
	getContext() {
		return {
			imageSmoothingQuality: 'low',
			drawImage: (...args: unknown[]) => this.drawing.drawn.push(args.slice(1))
		};
	}
	async convertToBlob({ type }: { type: string }) {
		return new Blob(['drawn'], { type });
	}
}

/** an image of `width` × `height`, as `createImageBitmap` would decode one. */
function decodes(width: number, height: number) {
	vi.stubGlobal(
		'createImageBitmap',
		vi.fn(async () => ({ width, height, close: () => {} }))
	);
}

const PICKED = new File(['png'], 'logo.png', { type: 'image/png' });

beforeEach(() => {
	canvases.length = 0;
	vi.stubGlobal('OffscreenCanvas', FakeCanvas);
	resize.mockImplementation(async (file) => ({ ok: true, blob: file, width: 0, height: 0 }));
});

afterEach(() => {
	vi.unstubAllGlobals();
	resize.mockReset();
});

describe('a saved crop', () => {
	it('draws the square alone on a square canvas, and hands that to the resize', async () => {
		decodes(1200, 800);

		const squared = await squareLogo(PICKED, { x: 300, y: 50, size: 600 });

		expect(canvases).toEqual([
			{ width: 600, height: 600, drawn: [[300, 50, 600, 600, 0, 0, 600, 600]] }
		]);
		const handed = resize.mock.calls[0]?.[0];
		expect(handed?.type).toBe('image/png');
		expect(squared).toEqual({ ok: true, blob: handed });
	});

	it(`draws a square wider than the resize keeps at ${LONG_SIDE_MAX} across`, async () => {
		decodes(4000, 3000);

		await squareLogo(PICKED, { x: 0, y: 0, size: 3000 });

		expect(canvases[0]).toMatchObject({ width: LONG_SIDE_MAX, height: LONG_SIDE_MAX });
	});

	it('refuses a square past the edge of the image, and resizes nothing', async () => {
		decodes(500, 400);

		const squared = await squareLogo(PICKED, { x: 200, y: 0, size: 400 });

		expect(squared).toEqual({ ok: false, refused: LOGO_REFUSED['crop-outside'] });
		expect(resize).not.toHaveBeenCalled();
	});

	it('refuses a file the browser could not decode', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => {
				throw new DOMException('cannot decode', 'InvalidStateError');
			})
		);

		expect(await squareLogo(PICKED, { x: 0, y: 0, size: 100 })).toEqual({
			ok: false,
			refused: LOGO_REFUSED.unreadable
		});
	});

	it('says the resize’s refusal in the logo’s words', async () => {
		decodes(1000, 1000);
		resize.mockResolvedValue({ ok: false, reason: 'too-large-after-resize' });

		expect(await squareLogo(PICKED, { x: 0, y: 0, size: 1000 })).toEqual({
			ok: false,
			refused: LOGO_REFUSED['too-large-after-resize']
		});
	});
});
