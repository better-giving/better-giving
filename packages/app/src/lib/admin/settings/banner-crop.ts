import { BANNER_RATIO, BANNER_WIDTH_MIN } from '$lib/org/banner';
import type { CropRect, CropRefusal } from './crop-image';
import { LOGO_REFUSED, type Rect, type Size } from './logo-crop';

// the arithmetic between the 4:1 band an operator drags over a photo on the screen and the band a
// save crops the photo to (./banner-crop-dialog.tsx draws the one, ./banner-image.ts crops by the
// other), and the words each refusal of a banner is said in. the photo is drawn whole, at no zoom,
// filling the box the band is dragged in, as the logo's is (./logo-crop.ts), so one scale on each
// axis is the whole of the conversion.

/**
 * what each refusal says, in the crop card or under the banner's press: the logo's words where they
 * name no shape, and the band's own where the logo's say square. a photo too small for a banner is
 * `bannerSourceRefusal`'s ($lib/org/banner.ts).
 */
export const BANNER_REFUSED: Readonly<Record<CropRefusal | 'not-a-logo-type', string>> = {
	'not-an-image': LOGO_REFUSED['not-an-image'],
	'not-a-logo-type': LOGO_REFUSED['not-a-logo-type'],
	unreadable: LOGO_REFUSED.unreadable,
	'too-large-after-resize': LOGO_REFUSED['too-large-after-resize'],
	'crop-outside': 'That band runs past the edge of the image. Move it inside the image.'
};

/** the widest 4:1 band that fits a box of `size`, centred in it: the band a crop opens on. */
export function centredBanner(size: Size): Rect {
	const width = Math.min(size.width, size.height * BANNER_RATIO);
	const height = width / BANNER_RATIO;
	return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height };
}

/**
 * the smallest band the cropper may be dragged down to, in the box's pixels: `BANNER_WIDTH_MIN` of
 * the photo's own, drawn at `shown`. never more than the widest band the box holds, so a photo too
 * small to keep a banner from still opens on a band that fits it — the save stays closed over it
 * instead (`bannerSourceRefusal` in $lib/org/banner.ts).
 */
export function shownBannerMinimum(shown: Size, natural: Size): Size {
	const width = Math.min(
		(BANNER_WIDTH_MIN * shown.width) / natural.width,
		shown.width,
		shown.height * BANNER_RATIO
	);
	return { width, height: width / BANNER_RATIO };
}

/**
 * the band `crop` keeps, in the photo's own pixels, as the whole numbers a save crops by: its width
 * a multiple of `BANNER_RATIO`, so its height is exactly a quarter of it, and its corner held inside
 * the photo, so a band dragged to the edge never rounds to one a pixel past it.
 */
export function naturalBanner(crop: Rect, shown: Size, natural: Size): CropRect {
	const across = natural.width / shown.width;
	const down = natural.height / shown.height;
	const widest = Math.min(natural.width, natural.height * BANNER_RATIO);
	const width =
		Math.floor(Math.min(Math.round(crop.width * across), widest) / BANNER_RATIO) * BANNER_RATIO;
	const height = width / BANNER_RATIO;
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
 * the delta handed to the cropper's corner resize for a change of `change` in the band's width, in
 * the box's pixels. the cropper moves both sides of the corner by the delta and then holds the
 * ratio from whichever side is shorter for it: a growing band is held from its width, so the delta
 * is the change, and a shrinking one from its height, which moves a quarter as far for the same
 * width, so the delta is a quarter of the change.
 */
export function bandResizeDelta(change: number): number {
	return change > 0 ? change : change / BANNER_RATIO;
}
