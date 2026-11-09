import { LONG_SIDE_MAX } from '@better-giving/operator/images/resize';

// the donation page's banner: what shape and size of photo one may be, and what its address
// answers. the crop dialog on Settings holds a crop to this before it posts, and the banner's
// address (../../routes/_app.admin.settings_.banner.ts) holds whatever arrives to it again, since
// that address takes a post from anything holding the deployer's session.
//
// not under `$lib/server/**`, so the screen may name all of it.

/** a banner is this many times as wide as it is tall. */
export const BANNER_RATIO = 4;

/** the narrowest banner, in the photo's own pixels: a 1200 × 300 crop at the least. */
export const BANNER_WIDTH_MIN = 1200;

/** the shortest banner, in the photo's own pixels: the height of the narrowest. */
export const BANNER_HEIGHT_MIN = BANNER_WIDTH_MIN / BANNER_RATIO;

/** the widest banner kept: the resize every photo runs (`LONG_SIDE_MAX`), so 1600 × 400. */
export const BANNER_WIDTH_MAX = LONG_SIDE_MAX;

/**
 * the sentence a photo of `width` × `height` is turned down in as a banner, or null where it is one.
 * a pixel either way of 4:1 is taken, which is the rounding a crop and its resize leave.
 */
export function bannerRefusal(width: number, height: number): string | null {
	if (width < BANNER_WIDTH_MIN) return tooNarrow(width);
	if (width > BANNER_WIDTH_MAX) {
		return `That image is ${width} pixels wide. A banner is kept at most ${BANNER_WIDTH_MAX} wide. Choose it again.`;
	}
	if (Math.abs(height * BANNER_RATIO - width) > BANNER_RATIO) {
		return 'That image is not the banner’s shape. Crop it to 4 to 1 and save it again.';
	}
	return null;
}

/**
 * the sentence an image of `width` × `height` is turned down in before it is cropped, or null where
 * it holds the smallest banner: the crop dialog's rule, over the image a banner is cut from. where
 * both sides are short, the width is the one named.
 */
export function bannerSourceRefusal(width: number, height: number): string | null {
	if (width < BANNER_WIDTH_MIN) return tooNarrow(width);
	if (height < BANNER_HEIGHT_MIN) {
		return `That image is only ${height} pixels tall. A banner needs at least ${BANNER_HEIGHT_MIN}. Choose a taller one.`;
	}
	return null;
}

const tooNarrow = (width: number): string =>
	`That image is only ${width} pixels wide. A banner needs at least ${BANNER_WIDTH_MIN}. Choose a larger one.`;

/** what the banner's address answers: the banner it put on or took off, or why not. */
export type BannerAnswer =
	| { readonly banner: { readonly id: string; readonly src: string } | null }
	| { readonly error: string; readonly reason?: 'failed' };
