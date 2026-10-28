import { eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { image, type NewImage } from '../db/schema';
import { putBytes } from './bytes';

/** what the caller knows about a new image; its id and byte size are this module's to set. */
export type ImageMetadata = Pick<NewImage, 'kind' | 'contentType' | 'width' | 'height' | 'alt'>;

/**
 * a new image's id and the two statements storing it, its metadata and its bytes, for a caller's
 * `batch()` — the same batch as the write that names it, so the image lands only with that write.
 */
export function newImageStatements(db: Db, meta: ImageMetadata, bytes: Uint8Array) {
	const id = uuidv7();
	return {
		id,
		statements: [
			db.insert(image).values({ ...meta, id, byteSize: bytes.byteLength }),
			putBytes(db, id, bytes, meta.contentType)
		] as const
	};
}

/** the statements storing one new image, ahead of any that name it in the same `batch()`. */
export type NewImageStatements = ReturnType<typeof newImageStatements>['statements'];

/** the first of `ids` no stored image has, or `null` where every one is stored. */
export async function firstMissingImage(db: Db, ids: readonly string[]): Promise<string | null> {
	if (ids.length === 0) return null;
	const found = await db
		.select({ id: image.id })
		.from(image)
		.where(inArray(image.id, [...ids]));
	const stored = new Set(found.map(({ id }) => id));
	return ids.find((id) => !stored.has(id)) ?? null;
}

/** a stored image's id and shape, as a page draws a logo; null where no image has the id. */
export async function readImageShape(
	db: Db,
	id: string
): Promise<{ imageId: string; width: number; height: number } | null> {
	const [row] = await db
		.select({ imageId: image.id, width: image.width, height: image.height })
		.from(image)
		.where(eq(image.id, id));
	return row ?? null;
}
