import { IMAGE_BYTES_MAX } from '$lib/server/db/schema';
import { describe, expect, it, vi } from 'vitest';
import {
	describeResized,
	encodeUnder,
	IMAGE_UPLOAD_MAX,
	LONG_SIDE_MAX,
	QUALITY_LADDER,
	resizeImage,
	targetSize
} from './resize';

// the arithmetic and the order of encodes, in node, with the decode and the canvas stood in for.
// what a real browser writes for a real 12 MB photo is measured outside the suite: this app has no
// browser pool.

it('posts no more than the database will hold', () => {
	expect(IMAGE_UPLOAD_MAX).toBe(IMAGE_BYTES_MAX);
});

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
	const calls: [string, number][] = [];
	const encode = async (type: string, quality: number) => {
		calls.push([type, quality]);
		return new Blob([new Uint8Array(sizeAt(quality))], { type: writes ? writes(type) : type });
	};
	return { calls, encode };
}

describe('the encode ladder', () => {
	it('keeps the first rung that fits', async () => {
		const { calls, encode } = encoder(() => 480_000);
		const blob = await encodeUnder(encode, 1000_000);
		expect(blob?.type).toBe('image/webp');
		expect(calls).toEqual([['image/webp', 0.85]]);
	});

	it('steps down until the photo fits', async () => {
		const { calls, encode } = encoder((q) => Math.round(q * 1000));
		const blob = await encodeUnder(encode, 700);
		expect(blob?.size).toBe(650);
		expect(calls).toEqual([
			['image/webp', 0.85],
			['image/webp', 0.75],
			['image/webp', 0.65]
		]);
	});

	it('takes a photo exactly at the cap', async () => {
		const { encode } = encoder(() => 700);
		expect((await encodeUnder(encode, 700))?.size).toBe(700);
	});

	it('goes no lower than the last rung, and refuses what still does not fit', async () => {
		const { calls, encode } = encoder(() => 2_000_000);
		expect(await encodeUnder(encode, IMAGE_UPLOAD_MAX)).toBeNull();
		expect(calls.map(([, q]) => q)).toEqual([...QUALITY_LADDER]);
		expect(Math.min(...calls.map(([, q]) => q))).toBe(0.5);
	});

	it('writes a jpeg where the browser cannot write webp', async () => {
		// a canvas asked for a type it cannot write hands back a png.
		const { calls, encode } = encoder(
			() => 300_000,
			(type) => (type === 'image/webp' ? 'image/png' : type)
		);
		const blob = await encodeUnder(encode, IMAGE_UPLOAD_MAX);
		expect(blob?.type).toBe('image/jpeg');
		expect(calls).toEqual([
			['image/webp', 0.85],
			['image/jpeg', 0.85]
		]);
	});

	it('does not fall back to jpeg when webp was written and never fit', async () => {
		const { calls, encode } = encoder(() => 2_000_000);
		await encodeUnder(encode, IMAGE_UPLOAD_MAX);
		expect(calls.every(([type]) => type === 'image/webp')).toBe(true);
	});
});

const photo = (type: string, name = 'IMG_2231.jpg') =>
	new File([new Uint8Array(64)], name, { type });

/** a decoded bitmap and a canvas that records what was drawn and writes `bytes` of `type`. */
function fakeBrowser({
	width,
	height,
	bytes,
	type = 'image/webp'
}: Record<string, number> & { type?: string }) {
	const bitmap = { width, height, close: vi.fn() };
	const drawn: number[][] = [];
	vi.stubGlobal(
		'createImageBitmap',
		vi.fn(async () => bitmap)
	);
	vi.stubGlobal(
		'OffscreenCanvas',
		class {
			getContext() {
				return {
					imageSmoothingQuality: 'low',
					drawImage: (_: unknown, x: number, y: number, w: number, h: number) =>
						drawn.push([x, y, w, h])
				};
			}
			async convertToBlob() {
				return new Blob([new Uint8Array(bytes ?? 1)], { type });
			}
		}
	);
	return { bitmap, drawn };
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
		const { bitmap, drawn } = fakeBrowser({ width: 6000, height: 4000, bytes: 480_000 });
		const result = await resizeImage(photo('image/jpeg'));
		expect(result).toMatchObject({ ok: true, width: 1600, height: 1067 });
		expect(drawn).toEqual([[0, 0, 1600, 1067]]);
		expect(bitmap.close).toHaveBeenCalled();
	});

	it('refuses a photo still past the cap at the lowest quality', async () => {
		fakeBrowser({ width: 1600, height: 1200, bytes: IMAGE_UPLOAD_MAX + 1 });
		expect(await resizeImage(photo('image/png'))).toEqual({
			ok: false,
			reason: 'too-large-after-resize'
		});
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
