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

/** the widest banner kept: the resize every photo runs (`LONG_SIDE_MAX`), so 1600 × 400. */
export const BANNER_WIDTH_MAX = LONG_SIDE_MAX;

/**
 * the sentence a photo of `width` × `height` is turned down in as a banner, or null where it is one.
 * a pixel either way of 4:1 is taken, which is the rounding a crop and its resize leave.
 */
export function bannerRefusal(width: number, height: number): string | null {
	if (width < BANNER_WIDTH_MIN) {
		return `That image is only ${width} pixels wide. A banner needs at least ${BANNER_WIDTH_MIN}. Choose a larger one.`;
	}
	if (width > BANNER_WIDTH_MAX) {
		return `That image is ${width} pixels wide. A banner is kept at most ${BANNER_WIDTH_MAX} wide. Choose it again.`;
	}
	if (Math.abs(height * BANNER_RATIO - width) > BANNER_RATIO) {
		return 'That image is not the banner’s shape. Crop it to 4 to 1 and save it again.';
	}
	return null;
}

/** what the banner's address answers: the banner it put on or took off, or why not. */
export type BannerAnswer =
	| { readonly banner: { readonly id: string; readonly src: string } | null }
	| { readonly error: string; readonly reason?: 'failed' };
