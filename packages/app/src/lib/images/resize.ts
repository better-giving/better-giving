/* a photo chosen on the operator's device, made small enough to post before it leaves: no more than
   `LONG_SIDE_MAX` on its long side, as webp (jpeg where the browser cannot write webp), and no
   heavier than the database takes one image to be.
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

/** the qualities tried in turn until the photo fits, and never lower than the last. */
export const QUALITY_LADDER = [0.85, 0.75, 0.65, 0.5] as const;

/* webp first. a browser that cannot write it hands back a png for the asking, and then the photo
   goes as a jpeg: both are types the image table stores. */
const ENCODINGS = ['image/webp', 'image/jpeg'] as const;

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

type Encode = (type: string, quality: number) => Promise<Blob>;

/**
 * the first encode down `QUALITY_LADDER` that weighs no more than `max`, or null when the last
 * rung still does not. jpeg is tried only where webp could not be written at all.
 */
export async function encodeUnder(encode: Encode, max = IMAGE_UPLOAD_MAX): Promise<Blob | null> {
	for (const type of ENCODINGS) {
		let written = false;
		for (const quality of QUALITY_LADDER) {
			const blob = await encode(type, quality);
			if (blob.type !== type) break;
			written = true;
			if (blob.size <= max) return blob;
		}
		if (written) return null;
	}
	return null;
}

function draw(
	context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null,
	bitmap: ImageBitmap,
	width: number,
	height: number
) {
	if (context === null) throw new Error('no 2d context to draw the photo on');
	context.imageSmoothingQuality = 'high';
	context.drawImage(bitmap, 0, 0, width, height);
}

function canvasEncoder(bitmap: ImageBitmap, width: number, height: number): Encode {
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(width, height);
		draw(canvas.getContext('2d'), bitmap, width, height);
		return (type, quality) => canvas.convertToBlob({ type, quality });
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	draw(canvas.getContext('2d'), bitmap, width, height);
	return (type, quality) =>
		new Promise((resolve, reject) =>
			canvas.toBlob(
				(blob) => (blob === null ? reject(new Error('the canvas wrote no blob')) : resolve(blob)),
				type,
				quality
			)
		);
}

const refused = (reason: ResizeRefusal): Resized => ({ ok: false, reason });

/**
 * `file` decoded the right way up (its camera orientation applied), drawn at `targetSize` and
 * encoded under `IMAGE_UPLOAD_MAX`. never rejects: every way it can fail is a refusal. a file typed
 * as something other than an image is refused before it is decoded; one with no type at all is
 * given the chance to decode, since some devices send a photo untyped.
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
		const { width, height } = targetSize(bitmap.width, bitmap.height);
		const blob = await encodeUnder(canvasEncoder(bitmap, width, height));
		return blob === null ? refused('too-large-after-resize') : { ok: true, blob, width, height };
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
