import type { Db } from '../db/client';
import { type ImageMetadata, newImageStatements } from '../images/queries';
import { putNewOrgProfileLogo } from './queries';

/** a new photo put on as the profile's logo, as the console's upload puts one; its id. */
export async function putLogo(
	db: Db,
	meta: Omit<ImageMetadata, 'kind' | 'alt'>,
	bytes: Uint8Array = new Uint8Array([1])
): Promise<string> {
	const photo = newImageStatements(db, { ...meta, kind: 'photo', alt: null }, bytes);
	const written = await putNewOrgProfileLogo(db, photo);
	if (written !== 'written') throw new Error(`the fixture logo was not put on: ${written}`);
	return photo.id;
}
