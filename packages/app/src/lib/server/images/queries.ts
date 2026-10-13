import { and, eq, inArray } from 'drizzle-orm';
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

/**
 * writes a new image's metadata and its bytes in one `batch()`, so neither lands without the
 * other, and returns its id. a blob past `IMAGE_BYTES_MAX` fails the batch whole.
 */
export async function createImage(db: Db, meta: ImageMetadata, bytes: Uint8Array): Promise<string> {
	const { id, statements } = newImageStatements(db, meta, bytes);
	await db.batch(statements);
	return id;
}

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

/**
 * how many ids one read of their kinds binds. D1 refuses a query at 100 bound parameters (the
 * arithmetic `SITES_PER_STATEMENT` in ../sites/queries.ts states), and the kind is one more. a page
 * holds no cap on its photo blocks, so a page past this is read in more than one query.
 */
const KIND_IDS_PER_QUERY = 90;

/**
 * which of `ids` are illustrations, each id bound once. a page's photo is marked as one by the kind
 * its image was stored with, never by the page, so a replaced picture takes its mark with it.
 */
export async function illustrationsAmong(db: Db, ids: readonly string[]): Promise<Set<string>> {
	const distinct = [...new Set(ids)];
	const chunks: string[][] = [];
	for (let start = 0; start < distinct.length; start += KIND_IDS_PER_QUERY) {
		chunks.push(distinct.slice(start, start + KIND_IDS_PER_QUERY));
	}
	const found = await Promise.all(
		chunks.map((chunk) =>
			db
				.select({ id: image.id })
				.from(image)
				.where(and(eq(image.kind, 'illustration'), inArray(image.id, chunk)))
		)
	);
	return new Set(found.flat().map(({ id }) => id));
}
