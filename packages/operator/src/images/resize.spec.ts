import { describe, expect, it, vi } from 'vitest';
import {
	describeResized,
	anyTransparent,
	encodeUnder,
	IMAGE_UPLOAD_MAX,
	LONG_SIDE_MAX,
	QUALITY_LADDER,
	resizeImage,
	SCALE_LADDER,
	targetSize
} from './resize';

// the arithmetic and the order of encodes, in node, with the decode and the canvas stood in for.
// what a real browser writes for a real 12 MB photo is measured outside the suite: this package has no
// browser pool.

describe('the size a photo is drawn at', () => {
	it.each([
		[6000, 4000, 1600, 1067],
		[4000, 6000, 1067, 1600],
		[4032, 3024, 1600, 1200],
		[1600, 1600, 1600, 1600],
		[1200, 800, 1200, 800],
		[10_000, 1, 1600, 1]
	])('%i × %i is drawn at %i × %i', (width, height, w, h) => {
		expect(targetSize(width, height)).toEqual({ width: w, height: h });
	});

	it('never has a long side past the cap', () => {
		const { width, height } = targetSize(9999, 7777);
		expect(Math.max(width, height)).toBe(LONG_SIDE_MAX);
	});
});

/** an encoder whose output shrinks with the quality asked for, writing `writes` for every type. */
function encoder(sizeAt: (quality: number) => number, writes?: (type: string) => string) {
	const calls: [string, number | undefined][] = [];
	const encode = async (type: string, quality?: number) => {
		calls.push([type, quality]);
		return new Blob([new Uint8Array(sizeAt(quality ?? 1))], {
			type: writes ? writes(type) : type
		});
	};
	return { calls, drawAt: (_scale: number) => ({ width: 1600, height: 1200, encode }) };
}

const opaque = (max: number) => ({ transparent: false, max });

describe('the encode ladder for an opaque photo', () => {
	it('keeps the first rung that fits', async () => {
		const { calls, drawAt } = encoder(() => 480_000);
		const encoded = await encodeUnder(drawAt, opaque(1000_000));
		expect(encoded?.blob.type).toBe('image/webp');
		expect(calls).toEqual([['image/webp', 0.85]]);
	});

	it('steps down until the photo fits', async () => {
		const { calls, drawAt } = encoder((q) => Math.round(q * 1000));
		const encoded = await encodeUnder(drawAt, opaque(700));
		expect(encoded?.blob.size).toBe(650);
		expect(calls).toEqual([
			['image/webp', 0.85],
			['image/webp', 0.75],
			['image/webp', 0.65]
		]);
	});

	it('takes a photo exactly at the cap', async () => {
		const { drawAt } = encoder(() => 700);
		expect((await encodeUnder(drawAt, opaque(700)))?.blob.size).toBe(700);
	});

	it('goes no lower than the last rung, and refuses what still does not fit', async () => {
		const { calls, drawAt } = encoder(() => 2_000_000);
		expect(await encodeUnder(drawAt, opaque(IMAGE_UPLOAD_MAX))).toBeNull();
		expect(calls.map(([, q]) => q)).toEqual([...QUALITY_LADDER]);
		expect(Math.min(...calls.map(([, q]) => q ?? 1))).toBe(0.5);
	});

	it('writes a jpeg where the browser cannot write webp', async () => {
		// a canvas asked for a type it cannot write hands back a png.
		const { calls, drawAt } = encoder(
			() => 300_000,
			(type) => (type === 'image/webp' ? 'image/png' : type)
		);
		const encoded = await encodeUnder(drawAt, opaque(IMAGE_UPLOAD_MAX));
		expect(encoded?.blob.type).toBe('image/jpeg');
		expect(calls).toEqual([
			['image/webp', 0.85],
			['image/jpeg', 0.85]
		]);
	});

	it('does not fall back to jpeg when webp was written and never fit', async () => {
		const { calls, drawAt } = encoder(() => 2_000_000);
		await encodeUnder(drawAt, opaque(IMAGE_UPLOAD_MAX));
		expect(calls.every(([type]) => type === 'image/webp')).toBe(true);
	});
});

describe('reading transparency', () => {
	const pixels = (...alphas: number[]) =>
		new Uint8ClampedArray(alphas.flatMap((alpha) => [255, 255, 255, alpha]));

	it('finds one pixel short of opaque anywhere in the image', () => {
		expect(anyTransparent(pixels(255, 255, 255, 254))).toBe(true);
		expect(anyTransparent(pixels(0, 255))).toBe(true);
	});

	it('calls a fully opaque image opaque, whatever its colours', () => {
		expect(anyTransparent(pixels(255, 255, 255))).toBe(false);
		expect(anyTransparent(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]))).toBe(false);
	});
});

const photo = (type: string, name = 'IMG_2231.jpg') =>
	new File([new Uint8Array(64)], name, { type });

/**
 * a decoded bitmap, and a canvas that records every call made on its context beyond the drawing
 * itself. `alpha` is what every pixel's alpha reads back as; `weigh` is how many bytes the canvas
 * writes for a type at its own width; `writes` is the type it actually writes when asked for one.
 */
function fakeBrowser({
	width,
	height,
	alpha = 255,
	weigh = () => 1,
	writes = (type) => type
}: {
	width: number;
	height: number;
	alpha?: number;
	weigh?: (type: string, canvasWidth: number) => number;
	writes?: (type: string) => string;
}) {
	const bitmap = { width, height, close: vi.fn() };
	const drawn: number[][] = [];
	const encodes: [string, number | undefined, number][] = [];
	const painted: string[] = [];
	vi.stubGlobal(
		'createImageBitmap',
		vi.fn(async () => bitmap)
	);
	vi.stubGlobal(
		'OffscreenCanvas',
		class {
			readonly width: number;
			constructor(width: number) {
				this.width = width;
			}
			getContext() {
				const context = {
					imageSmoothingQuality: 'low',
					drawImage: (_: unknown, x: number, y: number, w: number, h: number) =>
						drawn.push([x, y, w, h]),
					getImageData: (_x: number, _y: number, w: number, h: number) => ({
						data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? alpha : 255))
					})
				};
				// anything else asked of the context — a fill, a composite mode — is paint under the photo.
				return new Proxy(context, {
					get: (target, key) => {
						if (key in target) return target[key as keyof typeof target];
						painted.push(String(key));
						return () => {};
					},
					set: (target, key, value) => {
						if (key !== 'imageSmoothingQuality') painted.push(String(key));
						return Reflect.set(target, key, value);
					}
				});
			}
			async convertToBlob({ type, quality }: { type: string; quality?: number }) {
				encodes.push([type, quality, this.width]);
				return new Blob([new Uint8Array(weigh(type, this.width))], { type: writes(type) });
			}
		}
	);
	return { bitmap, drawn, encodes, painted };
}

describe('resizing a chosen file', () => {
	it('refuses a file that is not an image without decoding it', async () => {
		const decode = vi.fn();
		vi.stubGlobal('createImageBitmap', decode);
		expect(await resizeImage(photo('application/pdf', 'budget.pdf'))).toEqual({
			ok: false,
			reason: 'not-an-image'
		});
		expect(decode).not.toHaveBeenCalled();
	});

	it('calls an image the browser cannot open unreadable', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn().mockRejectedValue(new DOMException('', 'InvalidStateError'))
		);
		expect(await resizeImage(photo('image/heic', 'IMG_2231.HEIC'))).toEqual({
			ok: false,
			reason: 'unreadable'
		});
	});

	it('calls an untyped file the browser cannot open not an image', async () => {
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn().mockRejectedValue(new DOMException('', 'InvalidStateError'))
		);
		expect(await resizeImage(photo('', 'notes'))).toEqual({ ok: false, reason: 'not-an-image' });
	});

	it('draws a large photo at the capped size and reports it', async () => {
		const { bitmap, drawn } = fakeBrowser({ width: 6000, height: 4000, weigh: () => 480_000 });
		const result = await resizeImage(photo('image/jpeg'));
		expect(result).toMatchObject({ ok: true, width: 1600, height: 1067 });
		expect(drawn).toEqual([[0, 0, 1600, 1067]]);
		expect(bitmap.close).toHaveBeenCalled();
	});

	it('refuses a photo still past the cap at the lowest quality', async () => {
		fakeBrowser({ width: 1600, height: 1200, weigh: () => IMAGE_UPLOAD_MAX + 1 });
		expect(await resizeImage(photo('image/png'))).toEqual({
			ok: false,
			reason: 'too-large-after-resize'
		});
	});
});

describe('an image with transparent pixels', () => {
	it('comes out a png, drawn on nothing, so its alpha survives', async () => {
		const { encodes, painted } = fakeBrowser({
			width: 1200,
			height: 400,
			alpha: 0,
			weigh: () => 90_000
		});
		const result = await resizeImage(photo('image/png', 'logo.png'));
		expect(result).toMatchObject({ ok: true, width: 1200, height: 400 });
		expect(result.ok && result.blob.type).toBe('image/png');
		expect(encodes).toEqual([['image/png', undefined, 1200]]);
		expect(painted).toEqual([]);
	});

	it('is a png on a browser that writes no webp, where an opaque photo is a jpeg', async () => {
		const safari = (type: string) => (type === 'image/webp' ? 'image/png' : type);
		fakeBrowser({ width: 800, height: 800, alpha: 128, weigh: () => 50_000, writes: safari });
		const logo = await resizeImage(photo('image/png', 'logo.png'));
		expect(logo.ok && logo.blob.type).toBe('image/png');
	});

	it('steps down by scale, not quality, until the png fits', async () => {
		// a png's weight falls with its pixels: 1600 wide weighs 3.2 MB, 1024 wide 1.3 MB.
		const { encodes, drawn } = fakeBrowser({
			width: 2000,
			height: 1500,
			alpha: 0,
			weigh: (_, w) => Math.round((w * w * 3) / 2.4)
		});
		const result = await resizeImage(photo('image/png', 'cutout.png'));
		expect(encodes).toEqual([
			['image/png', undefined, 1600],
			['image/png', undefined, 1280],
			['image/png', undefined, 1024]
		]);
		expect(drawn.map(([, , w, h]) => [w, h])).toEqual([
			[1600, 1200],
			[1280, 960],
			[1024, 768]
		]);
		expect(result).toMatchObject({ ok: true, width: 1024, height: 768 });
		expect(result.ok && result.blob.size).toBeLessThanOrEqual(IMAGE_UPLOAD_MAX);
	});

	it('is refused, never flattened, when it will not fit at the smallest scale', async () => {
		const { encodes, painted } = fakeBrowser({
			width: 1600,
			height: 1600,
			alpha: 0,
			weigh: () => IMAGE_UPLOAD_MAX + 1
		});
		expect(await resizeImage(photo('image/png', 'poster.png'))).toEqual({
			ok: false,
			reason: 'too-large-after-resize'
		});
		expect(encodes.map(([, , w]) => w / 1600)).toEqual([...SCALE_LADDER]);
		expect(encodes.every(([type]) => type === 'image/png')).toBe(true);
		expect(painted).toEqual([]);
	});
});

describe('an opaque image', () => {
	it('still goes as webp', async () => {
		const { encodes } = fakeBrowser({ width: 4032, height: 3024, weigh: () => 480_000 });
		const result = await resizeImage(photo('image/jpeg'));
		expect(result.ok && result.blob.type).toBe('image/webp');
		expect(encodes).toEqual([['image/webp', 0.85, 1600]]);
	});

	it('goes as jpeg where webp cannot be written', async () => {
		const safari = (type: string) => (type === 'image/webp' ? 'image/png' : type);
		const { encodes } = fakeBrowser({
			width: 4032,
			height: 3024,
			weigh: () => 480_000,
			writes: safari
		});
		const result = await resizeImage(photo('image/jpeg'));
		expect(result.ok && result.blob.type).toBe('image/jpeg');
		expect(encodes).toEqual([
			['image/webp', 0.85, 1600],
			['image/jpeg', 0.85, 1600]
		]);
	});
});

it('describes a resized photo by its size and weight', () => {
	expect(describeResized({ width: 1600, height: 1200, bytes: 480_400 })).toBe(
		'1600 × 1200, 480 KB'
	);
	expect(describeResized({ width: 1600, height: 1067, bytes: 1_412_000 })).toBe(
		'1600 × 1067, 1.4 MB'
	);
	expect(describeResized({ width: 20, height: 20, bytes: 300 })).toBe('20 × 20, 1 KB');
});
