import type { Db } from '../db/client';
import { d1BytesPort } from './bytes';
import { firstMissingImage, type ImageMetadata, newImageStatements } from './queries';

/** a stored image for a spec to place: its metadata and bytes in one `batch()`, and its id. */
export async function createImage(db: Db, meta: ImageMetadata, bytes: Uint8Array): Promise<string> {
	const { id, statements } = newImageStatements(db, meta, bytes);
	await db.batch(statements);
	return id;
}

/** whether the image's metadata row and its bytes are each still stored. */
export async function stored(db: Db, id: string): Promise<{ row: boolean; bytes: boolean }> {
	return {
		row: (await firstMissingImage(db, [id])) === null,
		bytes: (await d1BytesPort(db).get(id)) !== null
	};
}
