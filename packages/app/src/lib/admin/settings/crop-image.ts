import { LONG_SIDE_MAX, resizeImage } from '@better-giving/operator/images/resize';
import { LOGO_REFUSED, type LogoRefusal } from './logo-crop';

// what a save in a crop card does with the rectangle it was handed: the logo's square
// (./logo-square.ts) and the banner's 4:1 band (./banner-image.ts) alike. the rectangle is drawn
// here, in the browser, then resized by the resize every photo pick runs
// (`@better-giving/operator/images/resize`), and handed back as the file the address takes. the
// deployment's intake judges the photo again whatever arrives, so the resize is what keeps a
// phone's twelve-megapixel photo under its cap rather than a rule.

/** a rectangle kept of an image, in the image's own whole pixels. */
export type CropRect = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

/** the rectangle, cropped and resized, or the sentence a refusal of it is said in. */
export type Cropped =
	| { readonly ok: true; readonly blob: Blob }
	| { readonly ok: false; readonly refused: string };

/** whether `crop` lies wholly inside an image of `width` × `height`. */
const inside = (crop: CropRect, width: number, height: number): boolean =>
	crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= width && crop.y + crop.height <= height;

/**
 * `file`'s rectangle drawn as a lossless file for the resize to take, or why it was turned down.
 * drawn no longer on its long side than the resize keeps (`LONG_SIDE_MAX`), so a camera's full
 * frame is never a canvas some browsers refuse to hold.
 */
async function drawn(file: File, crop: CropRect, name: string): Promise<File | LogoRefusal> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		return 'unreadable';
	}
	try {
		if (!inside(crop, bitmap.width, bitmap.height)) return 'crop-outside';
		const scale = Math.min(1, LONG_SIDE_MAX / Math.max(crop.width, crop.height));
		const width = Math.round(crop.width * scale);
		const height = Math.round(crop.height * scale);
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');
		if (context === null) return 'unreadable';
		context.imageSmoothingQuality = 'high';
		context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
		const blob = await canvas.convertToBlob({ type: 'image/png' });
		return new File([blob], name, { type: blob.type });
	} finally {
		bitmap.close();
	}
}

/** `file` cropped to `crop` and resized, ready to post under `name`. */
export async function cropImage(file: File, crop: CropRect, name: string): Promise<Cropped> {
	const kept = await drawn(file, crop, name);
	if (typeof kept === 'string') return { ok: false, refused: LOGO_REFUSED[kept] };
	const resized = await resizeImage(kept);
	return resized.ok
		? { ok: true, blob: resized.blob }
		: { ok: false, refused: LOGO_REFUSED[resized.reason] };
}
