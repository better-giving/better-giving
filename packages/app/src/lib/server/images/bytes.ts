import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { image, imageBytes, type ImageContentType } from '../db/schema';

// the one module that reads or writes an image's bytes, gated by ./sole-bytes-owner.spec.ts.
//
// `BytesPort` is the seam an object store replaces: moving the bytes to R2 is a second adapter of
// this interface, a copy of `image_bytes` into it, and `createImage` in ./queries.ts putting the
// bytes before its metadata insert instead of batching `putBytes` beside it — every image URL names
// an id, never a location, and `image` holds the metadata in D1 either way. the bytes are in D1
// because R2 needs a card-gated checkout on the account, and a worker config naming an R2 bucket
// fails its whole deploy on an account without one (./no-object-store.config.spec.ts).
//
// an image is deleted whole or not at all, and never rewritten: `put` inserts and never updates, so
// a second put under one id is refused by the primary key, and a changed image is a new id. that is
// what lets a reader cache an image by id forever — an id it holds names the same bytes or none.
//
// the D1 adapter's two writes are statements for a caller's `batch()`, so neither lands without the
// metadata row's own write. `putBytes` is `createImage`'s in ./queries.ts; it names its content type
// and is refused unless the metadata row says the same, so bytes are never filed under a type their
// image does not claim. `deleteBytes` is `freeImageStatements`' in ./free.ts, under the condition
// the metadata row's delete carries.

/** an image's bytes, stored once under the image's id. */
export interface BytesPort {
	/** stores `bytes` under `id`; refuses an id that already has bytes, or one with no metadata row of that type. */
	put(id: string, bytes: Uint8Array, contentType: ImageContentType): Promise<void>;
	/** the bytes stored under `id` and their content type, or null when there are none. */
	get(id: string): Promise<{ bytes: Uint8Array; contentType: ImageContentType } | null>;
}

/** the insert behind `put`, as one statement a caller may place in a `batch()`. */
export function putBytes(db: Db, id: string, bytes: Uint8Array, contentType: ImageContentType) {
	return db.insert(imageBytes).select(
		db
			.select({ imageId: image.id, bytes: sql`${bytes}`.as('bytes') })
			.from(image)
			.where(and(eq(image.id, id), eq(image.contentType, contentType)))
	);
}

/** the delete of `id`'s bytes where `when` holds, as one statement a caller places in a `batch()`. */
export function deleteBytes(db: Db, id: string, when: SQL) {
	return db.delete(imageBytes).where(and(eq(imageBytes.imageId, id), when));
}

export function d1BytesPort(db: Db): BytesPort {
	return {
		async put(id, bytes, contentType) {
			const result = await putBytes(db, id, bytes, contentType);
			if (result.meta.changes !== 1) {
				throw new Error(`no ${contentType} image ${id} to put bytes under`);
			}
		},
		async get(id) {
			const [row] = await db
				.select({ bytes: imageBytes.bytes, contentType: image.contentType })
				.from(imageBytes)
				.innerJoin(image, eq(image.id, imageBytes.imageId))
				.where(eq(imageBytes.imageId, id));
			return row ?? null;
		}
	};
}
