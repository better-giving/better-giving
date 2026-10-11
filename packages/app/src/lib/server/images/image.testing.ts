import type { Db } from '../db/client';
import { type ImageMetadata, newImageStatements } from './queries';

/** a stored image for a spec to place: its metadata and bytes in one `batch()`, and its id. */
export async function createImage(db: Db, meta: ImageMetadata, bytes: Uint8Array): Promise<string> {
	const { id, statements } = newImageStatements(db, meta, bytes);
	await db.batch(statements);
	return id;
}
