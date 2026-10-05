import {
	LONG_SIDE_MAX,
	type ResizeRefusal,
	resizeImage
} from '@better-giving/operator/images/resize';
import { logoRefused, readOrgLogo, uploadOrgLogo } from '../api/client';
import type { OrgWrite } from '../api/types';
import type { CropSquare, LogoPress, LogoSource } from './org-fields';

// what the logo press does with the image it names: the square the operator kept, drawn here, in
// the browser, then resized by the resize the dashboard's photo picks run
// (`@better-giving/operator/images/resize`), then uploaded. the deployment's intake judges the
// photo again whatever arrives (`packages/app/src/lib/server/images/`), so the resize is what keeps
// a phone's twelve-megapixel photo under its cap rather than a rule.

/**
 * the smallest side a cropped logo may have, in the image's own pixels: twice the 44px row a donor
 * page draws the logo in (`.page-mast-logo` in `packages/app/src/lib/donate/page.css`), so a phone
 * screen, at two device pixels to each of the row's, draws it sharp. a square under it is most
 * often a drag that shrank the box by accident.
 */
export const LOGO_CROP_MIN = 88;

/** each way a logo press is turned down at the logo: by the crop, or by the resize after it. */
export type LogoRefusal =
	| ResizeRefusal
	| 'no-source'
	| 'no-crop'
	| 'crop-too-small'
	| 'crop-outside'
	| 'no-stored-logo';

/** what each refusal says at the logo. */
export const LOGO_REFUSED: Readonly<Record<LogoRefusal, string>> = {
	'not-an-image': 'That file isn’t an image. Choose a PNG, JPEG or WebP.',
	unreadable:
		'That image couldn’t be opened here. Save it as a PNG, JPEG or WebP and choose it again.',
	'too-large-after-resize': 'That image is too large even after resizing. Choose a smaller one.',
	'no-source': 'Choose an image for the logo, or crop the one it has.',
	'no-crop': 'Choose the square of the image to keep as the logo.',
	'crop-too-small': `That square is too small to show clearly. Keep a square at least ${LOGO_CROP_MIN} pixels across, or choose a larger image.`,
	'crop-outside': 'That square runs past the edge of the image. Move it inside the image.',
	'no-stored-logo': 'There’s no logo to crop any more. Choose an image instead.'
};

/** whether `crop` lies wholly inside an image of `width` × `height`. */
const inside = (crop: CropSquare, width: number, height: number): boolean =>
	crop.x >= 0 && crop.y >= 0 && crop.x + crop.size <= width && crop.y + crop.size <= height;

/**
 * `source` decoded the right way up, or why not — read as the resize reads a file
 * (`resizeImage` in `@better-giving/operator/images/resize`): one typed as something other than an
 * image is refused unopened, and one with no type at all is given the chance to decode.
 */
async function decoded(source: Blob): Promise<ImageBitmap | ResizeRefusal> {
	if (source.type !== '' && !source.type.startsWith('image/')) return 'not-an-image';
	try {
		return await createImageBitmap(source, { imageOrientation: 'from-image' });
	} catch {
		return source.type === '' ? 'not-an-image' : 'unreadable';
	}
}

/**
 * `source`'s square drawn as a lossless file for the resize to take, or why it was turned down.
 * drawn no wider than the resize keeps (`LONG_SIDE_MAX`), so a camera's full-height square is never
 * a canvas some browsers refuse to hold.
 */
async function cropped(source: Blob, crop: CropSquare): Promise<File | LogoRefusal> {
	const bitmap = await decoded(source);
	if (typeof bitmap === 'string') return bitmap;
	try {
		if (!inside(crop, bitmap.width, bitmap.height)) return 'crop-outside';
		const side = Math.min(crop.size, LONG_SIDE_MAX);
		const canvas = new OffscreenCanvas(side, side);
		const context = canvas.getContext('2d');
		if (context === null) throw new Error('no 2d context to crop the logo on');
		context.imageSmoothingQuality = 'high';
		context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, side, side);
		const drawn = await canvas.convertToBlob({ type: 'image/png' });
		return new File([drawn], 'logo.png', { type: drawn.type });
	} finally {
		bitmap.close();
	}
}

/**
 * the bytes a press crops: the file the operator chose, or the logo the deployment holds now, read
 * back from it.
 */
async function sourceImage(source: LogoSource, pressed: AbortSignal): Promise<Blob | LogoRefusal> {
	if (source.from === 'stored') return (await readOrgLogo(pressed)) ?? 'no-stored-logo';
	return source.file instanceof File ? source.file : 'not-an-image';
}

/**
 * the image a press names, cropped to its square, resized and put on as the logo, or the refusal
 * at the logo that stopped it.
 *
 * `pressed` is the press's request signal. the upload is a write out from the moment it is sent
 * (`writesAnswered` in ../api/client.ts) and the resize before it is not, so a press the router
 * abandoned while the photo was resizing throws its abort rather than uploading behind the reading
 * that was not made to wait for it.
 */
export async function putLogo(press: LogoPress, pressed: AbortSignal): Promise<OrgWrite> {
	const { source, crop } = press;
	if (crop === null) return logoRefused(LOGO_REFUSED['no-crop']);
	if (crop.size < LOGO_CROP_MIN) return logoRefused(LOGO_REFUSED['crop-too-small']);
	if (source === null) return logoRefused(LOGO_REFUSED['no-source']);
	const image = await sourceImage(source, pressed);
	if (typeof image === 'string') return logoRefused(LOGO_REFUSED[image]);
	const square = await cropped(image, crop);
	if (typeof square === 'string') return logoRefused(LOGO_REFUSED[square]);
	const resized = await resizeImage(square);
	if (!resized.ok) return logoRefused(LOGO_REFUSED[resized.reason]);
	pressed.throwIfAborted();
	return uploadOrgLogo(resized.blob);
}
