import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { image, orgProfile, page, program, supporterPage } from '../db/schema';
import { deleteBytes } from './bytes';

// freeing an image: its metadata row and its bytes deleted together, and only where nothing names it.
//
// the guard is each statement's own `where not exists`, never a read ahead of the write, so a
// reference written between a caller's read and its `batch()` keeps the image rather than racing
// the delete. a holder of an image id added to the schema is added to `unreferenced` below. a key
// column left out refuses the metadata row's delete, and since both deletes ride the caller's one
// `batch()`, that fails the caller's whole write. a JSON holder left out refuses neither, so the
// image it names is freed from under it, bytes and all.

/**
 * no row names `id`, bar the supporter page `besidesSupporterPage` where one is given: no cause's
 * photo, the profile's logo or banner, no page document and no supporter fundraiser's photo. a page
 * document is matched on its text, so an id anywhere in one keeps the image whichever block holds
 * it.
 */
function unreferenced(id: string, besidesSupporterPage?: string): SQL {
	const besides =
		besidesSupporterPage === undefined
			? sql``
			: sql` and ${supporterPage.id} <> ${besidesSupporterPage}`;
	return sql`not exists (select 1 from ${program} where ${program.imageId} = ${id})
		and not exists (select 1 from ${supporterPage} where ${supporterPage.photoId} = ${id}${besides})
		and not exists (select 1 from ${orgProfile} where ${orgProfile.logoImageId} = ${id} or ${orgProfile.bannerImageId} = ${id})
		and not exists (select 1 from ${page} where instr(${page.draft}, ${id}) > 0 or instr(${page.published}, ${id}) > 0 or instr(${page.lastPublished}, ${id}) > 0)`;
}

/**
 * nothing but the supporter page `supporterPageId` names image `id`, by the same holders a free
 * asks after: the guard a supporter's edit writes a posted photo id under (../supporters/pages.ts),
 * so a page takes only an image no other page, page document, profile or cause holds — its own, or
 * one stored through /fundraise/photo and not yet saved, whose id only the browser that stored it
 * was told.
 */
export function unheldBeyond(id: string, supporterPageId: string): SQL {
	return unreferenced(id, supporterPageId);
}

/**
 * the statements freeing `id` where nothing names it, for the caller's `batch()` — after the write
 * that stops naming it, so that write's own reference is gone when they run. bytes first: their key
 * names the metadata row.
 */
export function freeImageStatements(db: Db, id: string) {
	const when = unreferenced(id);
	return [deleteBytes(db, id, when), db.delete(image).where(and(eq(image.id, id), when))] as const;
}

/**
 * `freeImageStatements` for each id `before` names and `after` does not: what a write moving a row
 * from one to the other lets go of, for that write's `batch()` and after it. an id let go of that
 * something else still names is kept by the guard, so `before` and `after` are the written row's
 * own and nothing wider.
 */
export function freeLetGoStatements(
	db: Db,
	before: Iterable<string | null>,
	after: Iterable<string | null>
) {
	const kept = new Set(after);
	return [...new Set(before)].flatMap((id) =>
		id === null || kept.has(id) ? [] : freeImageStatements(db, id)
	);
}
