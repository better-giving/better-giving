import { BANNER_REFUSED } from './banner-crop';
import { type CropRect, type Cropped, cropImage } from './crop-image';

// what a save in the banner's crop card does with the 4:1 band it was handed: the band cropped and
// resized as any crop card's rectangle is (./crop-image.ts), so a kept banner is at most
// 1600 × 400, and handed back as the file the banner's address takes
// (packages/app/src/routes/_app.admin.settings_.banner.ts), which holds it to `bannerRefusal`
// ($lib/org/banner.ts) again.

/** `file` cropped to the band `crop` and resized, or refused in `BANNER_REFUSED`'s words. */
export function cropBanner(file: File, crop: CropRect): Promise<Cropped> {
	return cropImage(file, crop, 'banner.png', BANNER_REFUSED);
}
