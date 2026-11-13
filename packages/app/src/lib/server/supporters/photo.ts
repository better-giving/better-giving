import { photoTooNarrow } from '../../supporter/area/copy';
import { PHOTO_WIDTH_MIN } from '../../supporter/area/photo-crop';
import type { Db } from '../db/client';
import { checkPostedPhoto, type PostedPhoto } from '../images/intake';

/**
 * a supporter's page photo as posted, held to the photo intake's rule (../images/intake.ts) and to a
 * page photo's width (`PHOTO_WIDTH_MIN`), with the statements storing it: the rule
 * src/routes/fundraise.photo.ts and a start (./start.ts) both hold a supporter's photo to.
 */
export async function checkSupporterPhoto(
	db: Db,
	file: FormDataEntryValue | null,
	name: string
): Promise<PostedPhoto> {
	const photo = await checkPostedPhoto(db, file, name);
	if (photo.ok && photo.width < PHOTO_WIDTH_MIN) {
		return { ok: false, refusal: 'refused', error: photoTooNarrow(photo.width, PHOTO_WIDTH_MIN) };
	}
	return photo;
}
