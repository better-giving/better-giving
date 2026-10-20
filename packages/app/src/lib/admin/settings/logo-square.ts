import { LONG_SIDE_MAX, resizeImage } from '@better-giving/operator/images/resize';
import { type CropSquare, LOGO_REFUSED, type LogoRefusal } from './logo-crop';

// what a save in the logo's crop card does with the square it was handed: the square drawn here,
// in the browser, then resized by the resize every photo pick runs
// (`@better-giving/operator/images/resize`), and handed back as the file the logo's address takes.
// the deployment's intake judges the photo again whatever arrives
// (packages/app/src/routes/_app.admin.settings_.logo.ts), so the resize is what keeps a phone's
// twelve-megapixel photo under its cap rather than a rule.

/** the square, cropped and resized, or the sentence a refusal of it is said in. */
export type Squared =
	| { readonly ok: true; readonly blob: Blob }
	| { readonly ok: false; readonly refused: string };

/** whether `crop` lies wholly inside an image of `width` × `height`. */
const inside = (crop: CropSquare, width: number, height: number): boolean =>
	crop.x >= 0 && crop.y >= 0 && crop.x + crop.size <= width && crop.y + crop.size <= height;

/**
 * `file`'s square drawn as a lossless file for the resize to take, or why it was turned down.
 * drawn no wider than the resize keeps (`LONG_SIDE_MAX`), so a camera's full-height square is never
 * a canvas some browsers refuse to hold.
 */
async function cropped(file: File, crop: CropSquare): Promise<File | LogoRefusal> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		return 'unreadable';
	}
	try {
		if (!inside(crop, bitmap.width, bitmap.height)) return 'crop-outside';
		const side = Math.min(crop.size, LONG_SIDE_MAX);
		const canvas = new OffscreenCanvas(side, side);
		const context = canvas.getContext('2d');
		if (context === null) return 'unreadable';
		context.imageSmoothingQuality = 'high';
		context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, side, side);
		const drawn = await canvas.convertToBlob({ type: 'image/png' });
		return new File([drawn], 'logo.png', { type: drawn.type });
	} finally {
		bitmap.close();
	}
}

/** `file` cropped to `crop` and resized, ready to post as the logo. */
export async function squareLogo(file: File, crop: CropSquare): Promise<Squared> {
	const square = await cropped(file, crop);
	if (typeof square === 'string') return { ok: false, refused: LOGO_REFUSED[square] };
	const resized = await resizeImage(square);
	return resized.ok
		? { ok: true, blob: resized.blob }
		: { ok: false, refused: LOGO_REFUSED[resized.reason] };
}
