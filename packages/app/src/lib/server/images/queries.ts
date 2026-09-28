import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { image, type NewImage } from '../db/schema';
import { putBytes } from './bytes';

/** what the caller knows about a new image; its id and byte size are this module's to set. */
export type ImageMetadata = Pick<NewImage, 'kind' | 'contentType' | 'width' | 'height' | 'alt'>;

/**
 * writes a new image's metadata and its bytes in one `batch()`, so neither lands without the
 * other, and returns its id. a blob past `IMAGE_BYTES_MAX` fails the batch whole.
 */
export async function createImage(db: Db, meta: ImageMetadata, bytes: Uint8Array): Promise<string> {
	const id = uuidv7();
	await db.batch([
		db.insert(image).values({ ...meta, id, byteSize: bytes.byteLength }),
		putBytes(db, id, bytes, meta.contentType)
	]);
	return id;
}
