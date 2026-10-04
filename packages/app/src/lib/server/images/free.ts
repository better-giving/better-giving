import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { chatTurn, image, orgProfile, page, program } from '../db/schema';
import { deleteBytes } from './bytes';

// freeing an image: its metadata row and its bytes deleted together, and only where nothing names it.
//
// the guard is each statement's own `where not exists`, never a read ahead of the write, so a
// reference written between a caller's read and its `batch()` keeps the image rather than racing
// the delete. a holder of an image id added to the schema is added to `unreferenced` below, or an
// image it names can be freed from under it — a key column refuses the metadata row's delete,
// but nothing refuses the bytes', and a JSON holder refuses neither.

/**
 * no row names `id`: no cause's photo, the profile's logo, no page document and no chat turn's
 * photos. a page document is matched on its text, so an id anywhere in one keeps the image whichever
 * block holds it.
 */
function unreferenced(id: string): SQL {
	return sql`not exists (select 1 from ${program} where ${program.imageId} = ${id})
		and not exists (select 1 from ${orgProfile} where ${orgProfile.logoImageId} = ${id})
		and not exists (select 1 from ${page} where instr(${page.draft}, ${id}) > 0 or instr(${page.published}, ${id}) > 0 or instr(${page.lastPublished}, ${id}) > 0)
		and not exists (select 1 from ${chatTurn}, json_each(${chatTurn.imageIds}) where json_each.value = ${id})`;
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
