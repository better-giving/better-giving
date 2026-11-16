import { desc, eq, inArray, sql } from 'drizzle-orm';
import { href } from 'react-router';
import type { Db } from '../db/client';
import { type KeysetCursor, keysetCursorText } from '../db/keyset-cursor';
import { supporter, supporterPage, type SupporterPageStatus } from '../db/schema';
import { type Raised, raisedByPage } from './pages';

// staff's side of supporter fundraisers: every page, and hiding one or showing it again. each is
// behind the staff gate, and the routes that call these gate on it; the organisation setting is
// `supporterFundraisersEnabled` and `setSupporterFundraisersEnabled` in ../org/queries.ts, gated
// on `STAFF_USER_ID` like the deployer's other settings.

/** one fundraiser as staff's list shows it. */
export type FundraiserListing = Raised & {
	readonly id: string;
	readonly supporterName: string;
	readonly supporterEmail: string;
	readonly title: string;
	readonly slug: string;
	readonly goalMinor: number;
	readonly currency: string;
	readonly status: SupporterPageStatus;
	readonly hidden: boolean;
	readonly hiddenNote: string | null;
	/** whether its confirm link was ever opened: a page never published has no public face. */
	readonly published: boolean;
	readonly createdAt: Date;
};

/**
 * how many fundraisers staff's list holds at a time. the batch's ids are bound into the read of what
 * each has raised, one parameter per id, which keeps that read far under SQLite's
 * `SQLITE_MAX_VARIABLE_NUMBER` (https://www.sqlite.org/limits.html).
 */
export const SUPPORTER_PAGE_LIST_LIMIT = 50;

/** one batch of staff's list, how many fundraisers there are in all, and the cursor past it. */
export type FundraiserBatch = {
	readonly pages: readonly FundraiserListing[];
	readonly total: number;
	readonly next: string | null;
};

/**
 * the batch of fundraisers after `after`, or from the newest, newest first by when each was started
 * and then by id; `supporter_page_created_idx` is the order.
 */
export async function listAllFundraisers(
	db: Db,
	after: KeysetCursor | null
): Promise<FundraiserBatch> {
	const [rows, [counted]] = await Promise.all([
		db
			.select({
				id: supporterPage.id,
				supporterName: supporter.name,
				supporterEmail: supporter.email,
				title: supporterPage.title,
				slug: supporterPage.slug,
				goalMinor: supporterPage.goalMinor,
				currency: supporterPage.currency,
				status: supporterPage.status,
				hiddenAt: supporterPage.hiddenAt,
				hiddenNote: supporterPage.hiddenNote,
				publishedAt: supporterPage.publishedAt,
				createdAt: supporterPage.createdAt
			})
			.from(supporterPage)
			.innerJoin(supporter, eq(supporter.id, supporterPage.supporterId))
			.where(
				after === null
					? undefined
					: sql`(${supporterPage.createdAt}, ${supporterPage.id}) < (${after.at}, ${after.id})`
			)
			.orderBy(desc(supporterPage.createdAt), desc(supporterPage.id))
			.limit(SUPPORTER_PAGE_LIST_LIMIT + 1),
		db.select({ total: sql<number>`count(*)` }).from(supporterPage)
	]);
	const batch = rows.slice(0, SUPPORTER_PAGE_LIST_LIMIT);
	const raised = await raisedByPage(
		db,
		inArray(
			supporterPage.id,
			batch.map((row) => row.id)
		)
	);
	const last = batch.at(-1);
	return {
		pages: batch.map(({ hiddenAt, publishedAt, ...row }) => ({
			...row,
			...raised(row.id),
			hidden: hiddenAt !== null,
			published: publishedAt !== null
		})),
		total: counted?.total ?? 0,
		next:
			rows.length > SUPPORTER_PAGE_LIST_LIMIT && last !== undefined
				? keysetCursorText({ at: last.createdAt.getTime(), id: last.id })
				: null
	};
}

/**
 * a fundraiser as staff's list is handed it, by the screen's loader and by Show more alike. Open goes
 * to the public address, or to the staff preview for a page the public cannot see: hidden, or never
 * published by its confirm link.
 */
export function listedRow(page: FundraiserListing) {
	const address = href('/f/:slug', { slug: page.slug });
	const unseen = page.hidden || !page.published;
	return {
		id: page.id,
		supporterName: page.supporterName,
		supporterEmail: page.supporterEmail,
		title: page.title,
		address,
		openHref: unseen ? href('/admin/supporter-pages/:id/preview', { id: page.id }) : address,
		goalMinor: page.goalMinor,
		raisedMinor: page.raisedMinor,
		currency: page.currency,
		status: page.status,
		hidden: page.hidden
	};
}

/**
 * takes a fundraiser off its address: it reads as not found to the public and takes no gift
 * (./gifts.ts) until shown again. a second hide keeps the first one's time and writes the note it
 * carries, null for none.
 */
export async function hideFundraiser(
	db: Db,
	pageId: string,
	note: string | null,
	now: Date
): Promise<'hidden' | 'not_found'> {
	const written = await db
		.update(supporterPage)
		.set({
			hiddenAt: sql`coalesce(${supporterPage.hiddenAt}, ${now.getTime()})`,
			hiddenNote: note,
			updatedAt: now
		})
		.where(eq(supporterPage.id, pageId))
		.returning({ id: supporterPage.id });
	return written.length > 0 ? 'hidden' : 'not_found';
}

/** puts a hidden fundraiser back as it stands, its note cleared. */
export async function showFundraiser(db: Db, pageId: string): Promise<'shown' | 'not_found'> {
	const written = await db
		.update(supporterPage)
		.set({ hiddenAt: null, hiddenNote: null })
		.where(eq(supporterPage.id, pageId))
		.returning({ id: supporterPage.id });
	return written.length > 0 ? 'shown' : 'not_found';
}
