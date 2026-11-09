import { type Cropped, cropImage } from './crop-image';
import { type CropSquare, LOGO_REFUSED } from './logo-crop';

// what a save in the logo's crop card does with the square it was handed: the square cropped and
// resized as any crop card's rectangle is (./crop-image.ts), and handed back as the file the logo's
// address takes (packages/app/src/routes/_app.admin.settings_.logo.ts).

/** the square, cropped and resized, or the sentence a refusal of it is said in. */
export type Squared = Cropped;

/** `file` cropped to `crop` and resized, ready to post as the logo. */
export function squareLogo(file: File, crop: CropSquare): Promise<Squared> {
	return cropImage(
		file,
		{ x: crop.x, y: crop.y, width: crop.size, height: crop.size },
		'logo.png',
		LOGO_REFUSED
	);
}
