/* a photo chosen on the operator's device, made small enough to post before it leaves: no more than
   `LONG_SIDE_MAX` on its long side, as webp (jpeg where the browser cannot write webp), or as png
   when any pixel of it is transparent, and no heavier than the database takes one image to be.
   browser code only — it decodes and draws with the page's own canvas, so nothing on the server
   ever holds the photo at the size the camera took it.

   the chat's attach press (../admin/chat/attach-control.tsx) and a placed photo's replace press
   (../admin/editor/replace-photo.tsx) run it; the route they report to posts what it returns. */

/**
 * the most one image's bytes may weigh: `IMAGE_BYTES_MAX` in ../server/db/schema.ts, which argues
 * the number. restated rather than imported, because that module is the server's schema and this
 * one ships to the browser; ./resize.spec.ts holds the two equal.
 */
export const IMAGE_UPLOAD_MAX = 1_900_000;

export const LONG_SIDE_MAX = 1600;

/** the qualities an opaque photo is tried at in turn until it fits, and never lower than the last. */
export const QUALITY_LADDER = [0.85, 0.75, 0.65, 0.5] as const;

/**
 * the scales, of `targetSize`, a transparent image is drawn at in turn until it fits, and never
 * smaller than the last. png has no quality to lower, so it is the pixels that step down.
 */
export const SCALE_LADDER = [1, 0.8, 0.64, 0.5] as const;

/* an opaque photo: webp first. a browser that cannot write it hands back a png for the asking, and
   then the photo goes as a jpeg. safari writes no webp, so there every opaque photo is a jpeg. */
const ENCODINGS = ['image/webp', 'image/jpeg'] as const;

/* a transparent one: jpeg has no alpha, and its transparent pixels would be written black. every
   canvas writes png. all three are types the image table stores. */
const TRANSPARENT_ENCODING = 'image/png';

export type ResizeRefusal = 'not-an-image' | 'too-large-after-resize' | 'unreadable';

export type Resized =
	| { readonly ok: true; readonly blob: Blob; readonly width: number; readonly height: number }
	| { readonly ok: false; readonly reason: ResizeRefusal };

/** the size a `width` × `height` photo is drawn at: scaled down to the cap, never up. */
export function targetSize(width: number, height: number) {
	const scale = Math.min(1, LONG_SIDE_MAX / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

type Encode = (type: string, quality?: number) => Promise<Blob>;

/** the image drawn at one size, and its encoder. */
export interface Drawing {
	readonly width: number;
	readonly height: number;
	readonly encode: Encode;
}

export interface Encoded {
	readonly blob: Blob;
	readonly width: number;
	readonly height: number;
}

/**
 * the first encode that weighs no more than `max`, or null when the last rung still does not.
 * `drawAt(scale)` draws the image at that fraction of its target size.
 *
 * opaque: drawn once, down `QUALITY_LADDER` as webp, and as jpeg only where webp could not be
 * written at all. transparent: png, redrawn down `SCALE_LADDER`, and never flattened onto a ground
 * to fit.
 */
export async function encodeUnder(
	drawAt: (scale: number) => Drawing,
	{ transparent, max = IMAGE_UPLOAD_MAX }: { transparent: boolean; max?: number }
): Promise<Encoded | null> {
	if (transparent) {
		for (const scale of SCALE_LADDER) {
			const { width, height, encode } = drawAt(scale);
			const blob = await encode(TRANSPARENT_ENCODING);
			if (blob.size <= max) return { blob, width, height };
		}
		return null;
	}
	const { width, height, encode } = drawAt(1);
	for (const type of ENCODINGS) {
		let written = false;
		for (const quality of QUALITY_LADDER) {
			const blob = await encode(type, quality);
			if (blob.type !== type) break;
			written = true;
			if (blob.size <= max) return { blob, width, height };
		}
		if (written) return null;
	}
	return null;
}

/** whether any pixel of `rgba` (a canvas's `ImageData.data`) is less than fully opaque. */
export function anyTransparent(rgba: Uint8ClampedArray) {
	for (let alpha = 3; alpha < rgba.length; alpha += 4) {
		if ((rgba[alpha] ?? 255) < 255) return true;
	}
	return false;
}

type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function draw(context: Context | null, bitmap: ImageBitmap, width: number, height: number) {
	if (context === null) throw new Error('no 2d context to draw the photo on');
	context.imageSmoothingQuality = 'high';
	context.drawImage(bitmap, 0, 0, width, height);
	return context;
}

/** `bitmap` drawn on a canvas of `width` × `height`, the context it was drawn with, and its encoder. */
function canvasAt(bitmap: ImageBitmap, width: number, height: number) {
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(width, height);
		const context = draw(canvas.getContext('2d'), bitmap, width, height);
		const encode: Encode = (type, quality) =>
			canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
		return { width, height, encode, context };
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = draw(canvas.getContext('2d'), bitmap, width, height);
	const encode: Encode = (type, quality) =>
		new Promise((resolve, reject) =>
			canvas.toBlob(
				(blob) => (blob === null ? reject(new Error('the canvas wrote no blob')) : resolve(blob)),
				type,
				quality
			)
		);
	return { width, height, encode, context };
}

const refused = (reason: ResizeRefusal): Resized => ({ ok: false, reason });

/**
 * `file` decoded the right way up (its camera orientation applied), drawn at `targetSize` and
 * encoded under `IMAGE_UPLOAD_MAX`. never rejects: every way it can fail is a refusal. a file typed
 * as something other than an image is refused before it is decoded; one with no type at all is
 * given the chance to decode, since some devices send a photo untyped.
 *
 * transparency is read once, off the drawing at `targetSize`: one `getImageData` of at most
 * `LONG_SIDE_MAX` squared pixels.
 */
export async function resizeImage(file: File): Promise<Resized> {
	if (file.type !== '' && !file.type.startsWith('image/')) return refused('not-an-image');
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		return refused(file.type === '' ? 'not-an-image' : 'unreadable');
	}
	try {
		const target = targetSize(bitmap.width, bitmap.height);
		const full = canvasAt(bitmap, target.width, target.height);
		const transparent = anyTransparent(
			full.context.getImageData(0, 0, full.width, full.height).data
		);
		const drawAt = (scale: number) => {
			if (scale === 1) return full;
			return canvasAt(
				bitmap,
				Math.max(1, Math.round(target.width * scale)),
				Math.max(1, Math.round(target.height * scale))
			);
		};
		const encoded = await encodeUnder(drawAt, { transparent });
		return encoded === null ? refused('too-large-after-resize') : { ok: true, ...encoded };
	} catch {
		return refused('unreadable');
	} finally {
		bitmap.close();
	}
}

/** a resized photo's size and weight as the chat names it: `1600 × 1200, 480 KB`. */
export function describeResized({
	width,
	height,
	bytes
}: {
	width: number;
	height: number;
	bytes: number;
}) {
	const weight =
		bytes < 1_000_000
			? `${Math.max(1, Math.round(bytes / 1000))} KB`
			: `${(bytes / 1_000_000).toFixed(1)} MB`;
	return `${width} × ${height}, ${weight}`;
}
