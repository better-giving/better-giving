import { and, eq, sql } from 'drizzle-orm';
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
// bytes are immutable: `put` inserts and never updates, so a second put under one id is refused
// by the primary key, and a changed image is a new id. that is what lets a reader cache an image
// by id forever.
//
// `putBytes` is the D1 adapter's one write, exported for ./queries.ts's `createImage`, which
// batches it with the metadata row so that neither lands without the other. it names its content
// type and is refused unless the metadata row says the same, so bytes are never filed under a type
// their image does not claim.

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
