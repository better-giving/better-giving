import type { CropSquare } from './org-fields';
import { LOGO_CROP_MIN, type LogoRefusal } from './org-logo';

// the arithmetic between the square an operator drags over a logo on the screen and the square the
// press posts (./logo-crop-dialog.tsx draws the one, ./org-fields.ts's `LOGO_CROP_*` boxes carry
// the other, and ./org-logo.ts's `putLogo` crops by it).
//
// **the image is drawn whole, at no zoom, filling the box the square is dragged in.** so a point on
// the screen and a pixel of the image are one scale apart on each axis, and that scale is the whole
// of the conversion: the cropper's own geometry is in the box's pixels, the post is in the image's.

/** a width and a height, in whichever pixels the caller is speaking in. */
export type Size = { readonly width: number; readonly height: number };

/** a rectangle in the box the image is drawn in, as the cropper reports one. */
export type Rect = Size & { readonly x: number; readonly y: number };

/** the largest square that fits a box of `size`, centred in it: the square a crop opens on. */
export function centredSquare(size: Size): Rect {
	const side = Math.min(size.width, size.height);
	return {
		x: (size.width - side) / 2,
		y: (size.height - side) / 2,
		width: side,
		height: side
	};
}

/**
 * the smallest square the cropper may be dragged down to, in the box's pixels: `LOGO_CROP_MIN` of
 * the image's own, drawn at `shown`. never more than the box's short side, so an image too small to
 * keep a logo from still opens on a square that fits it — the press stays closed over it instead
 * ({@link cropRefusal}).
 */
export function shownMinimum(shown: Size, natural: Size): number {
	return Math.min((LOGO_CROP_MIN * shown.width) / natural.width, shown.width, shown.height);
}

/**
 * the square `crop` keeps, in the image's own pixels, written as the whole numbers the press posts.
 * the corner is held inside the image, so a square dragged to the edge never rounds to one a pixel
 * past it — which the crop would refuse (`crop-outside` in ./org-logo.ts).
 */
export function naturalSquare(crop: Rect, shown: Size, natural: Size): CropSquare {
	const across = natural.width / shown.width;
	const down = natural.height / shown.height;
	const size = Math.min(Math.round(crop.width * across), natural.width, natural.height);
	const within = (at: number, room: number) => Math.min(Math.max(Math.round(at), 0), room - size);
	return {
		x: within(crop.x * across, natural.width),
		y: within(crop.y * down, natural.height),
		size
	};
}

/** why an image that opened, or failed to, cannot be saved as the logo, or `null` where it can. */
export function cropRefusal(natural: Size | null, failed: LogoRefusal | null): LogoRefusal | null {
	if (failed !== null) return failed;
	if (natural !== null && Math.min(natural.width, natural.height) < LOGO_CROP_MIN) {
		return 'crop-too-small';
	}
	return null;
}

/**
 * the one file a drop puts on the logo: the first one dropped, whatever its type — a file that is
 * not an image is refused in the crop, in the words the press would refuse it in, rather than
 * dropped on the floor here.
 */
export function droppedFile(files: ArrayLike<File> | null | undefined): File | null {
	return files?.[0] ?? null;
}
