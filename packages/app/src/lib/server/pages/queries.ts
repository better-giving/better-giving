import { and, eq, inArray, notExists } from 'drizzle-orm';
import type { Db } from '../db/client';
import { chatTurn, form, type Page, page } from '../db/schema';

// one page read by its id, and the one module that deletes a `page`, gated by ./sole-deleter.spec.ts.
//
// a page is deleted only while it is a campaign nobody has ever been shown. once a page has been
// live a gift may point at its owned settings row, and ending it is the campaign's own state rather
// than a delete; the donation page is always live (`page_donation_page_live_check`), so it never
// qualifies. `page` in ../db/schema.ts argues the rest from the table's side.

/** the page with this id, of either type; null where there is none. */
export async function readPage(db: Db, pageId: string): Promise<Page | null> {
	const [row] = await db.select().from(page).where(eq(page.id, pageId));
	return row ?? null;
}

/**
 * deletes a never-published campaign, its chat and the donation-settings row it owns, in one
 * `batch()`. false when the page is missing, is the donation page, or has ever been live.
 *
 * the read only finds which settings row the page owns; every statement carries its own guard, so
 * a campaign published between the read and the batch loses nothing. the settings row goes only
 * once no page owns it, and a gift already naming it fails the batch whole on its foreign key.
 */
export async function deleteNeverPublishedCampaign(db: Db, pageId: string): Promise<boolean> {
	const [found] = await db.select({ formId: page.formId }).from(page).where(eq(page.id, pageId));
	if (!found) return false;

	const deletable = and(
		eq(page.id, pageId),
		eq(page.type, 'campaign'),
		eq(page.state, 'never_published')
	);
	const [, deleted] = await db.batch([
		db
			.delete(chatTurn)
			.where(inArray(chatTurn.pageId, db.select({ id: page.id }).from(page).where(deletable))),
		db.delete(page).where(deletable).returning({ id: page.id }),
		db
			.delete(form)
			.where(
				and(
					eq(form.id, found.formId),
					notExists(db.select({ id: page.id }).from(page).where(eq(page.formId, found.formId)))
				)
			)
	]);
	return deleted.length === 1;
}
