import type { CropRect } from '$lib/admin/settings/crop-image';
import type { Rect, Size } from '$lib/admin/settings/logo-crop';
import { photoTooNarrow, photoTooShort } from './copy';

// the arithmetic between the 16:9 frame a supporter drags over a photo and the rectangle a save
// crops the photo to — the banner's (`$lib/admin/settings/banner-crop.ts`) at a page photo's
// shape. the photo is drawn whole at no zoom, so one scale on each axis is the whole conversion.

/** a page photo is this many times as wide as it is tall. */
export const PHOTO_RATIO = 16 / 9;

/** the narrowest photo kept, in the photo's own pixels. */
export const PHOTO_WIDTH_MIN = 1200;

/** the shortest photo kept: the height of the narrowest. */
export const PHOTO_HEIGHT_MIN = Math.ceil(PHOTO_WIDTH_MIN / PHOTO_RATIO);

/** the sentence an image of `width` × `height` is turned down in before it is cropped, or null. */
export function photoSourceRefusal(width: number, height: number): string | null {
	if (width < PHOTO_WIDTH_MIN) return photoTooNarrow(width, PHOTO_WIDTH_MIN);
	if (height < PHOTO_HEIGHT_MIN) return photoTooShort(height, PHOTO_HEIGHT_MIN);
	return null;
}

/** the widest 16:9 frame a box of `size` holds, centred in it: the frame a crop opens on. */
export function centredFrame(size: Size): Rect {
	const width = Math.min(size.width, size.height * PHOTO_RATIO);
	const height = width / PHOTO_RATIO;
	return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height };
}

/** the smallest frame the cropper may be dragged down to, in the box's pixels. */
export function shownFrameMinimum(shown: Size, natural: Size): Size {
	const width = Math.min(
		(PHOTO_WIDTH_MIN * shown.width) / natural.width,
		shown.width,
		shown.height * PHOTO_RATIO
	);
	return { width, height: width / PHOTO_RATIO };
}

/**
 * the frame `crop` keeps, in the photo's own whole pixels: its width a multiple of 16, so its height
 * is exactly nine sixteenths of it, never under `PHOTO_WIDTH_MIN` (itself a multiple of 16, which
 * the server refuses a photo below in $lib/server/supporters/photo.ts), and its corner held inside
 * the photo. the cropper's own minimum is in the box's pixels and can land a fraction under it.
 */
export function naturalFrame(crop: Rect, shown: Size, natural: Size): CropRect {
	const across = natural.width / shown.width;
	const down = natural.height / shown.height;
	const widest = Math.min(natural.width, natural.height * PHOTO_RATIO);
	const width = Math.max(
		PHOTO_WIDTH_MIN,
		Math.floor(Math.min(Math.round(crop.width * across), widest) / 16) * 16
	);
	const height = (width / 16) * 9;
	const within = (at: number, room: number, side: number) =>
		Math.min(Math.max(Math.round(at), 0), room - side);
	return {
		x: within(crop.x * across, natural.width, width),
		y: within(crop.y * down, natural.height, height),
		width,
		height
	};
}

/**
 * the delta the cropper's corner resize takes for a change of `change` in the frame's width: a
 * growing frame is held from its width, a shrinking one from its height, which moves nine
 * sixteenths as far.
 */
export function frameResizeDelta(change: number): number {
	return change > 0 ? change : change / PHOTO_RATIO;
}
