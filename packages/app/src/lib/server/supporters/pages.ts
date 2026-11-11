import { and, desc, eq, exists, inArray, type SQL, sql } from 'drizzle-orm';
import type { SupporterEdit } from '../../supporters/input';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { donation, supporter, supporterPage, type SupporterPageStatus } from '../db/schema';
import { freeLetGoStatements } from '../images/free';
import { giftNetRaised, readRaisedThroughFundraisers } from '../ledger/queries';
import { noteShown } from '../pages/messages';

// a supporter's own fundraisers: what each has raised, the list, one page's manage view, and the
// supporter's edits to it. every read and write takes the signed-in supporter and answers only for
// their own pages, so another supporter's page id is not-found here exactly as an unknown one is.
//
// what a supporter is shown of a gift is its amount, when it came, and — only where the donor ticked
// Show my note and staff have not hidden it (`noteShown` in ../pages/messages.ts) — the name the
// note is signed with and the note. never the donor's email, address, contact or payment method:
// none of them is selected here.

/** what a fundraiser has raised and from how many gifts: a `SUM` on every read, never stored. */
export type Raised = { readonly raisedMinor: number; readonly gifts: number };

const NOTHING_RAISED: Raised = { raisedMinor: 0, gifts: 0 };

/** what each page `where` admits has raised, by page id; a page with no gift reads as nothing. */
export async function raisedByPage(db: Db, where: SQL): Promise<(pageId: string) => Raised> {
	const rows = await readRaisedThroughFundraisers(db, where);
	const byPage = new Map(
		rows.map((row): [string, Raised] => [
			row.pageId,
			{ raisedMinor: row.raisedMinor, gifts: row.gifts }
		])
	);
	return (pageId) => byPage.get(pageId) ?? NOTHING_RAISED;
}

/** what one fundraiser has raised. */
export async function fundraiserRaised(db: Db, pageId: string): Promise<Raised> {
	return (await raisedByPage(db, eq(supporterPage.id, pageId)))(pageId);
}

/** one of a supporter's pages, as their list shows it. */
export type OwnFundraiserListing = Raised & {
	readonly id: string;
	readonly slug: string;
	readonly title: string;
	readonly status: SupporterPageStatus;
	/** staff took it down; it serves nothing and takes no gift until shown again. */
	readonly hidden: boolean;
	readonly goalMinor: number;
	readonly currency: string;
};

/** the supporter's own pages, newest first. */
export async function listOwnFundraisers(
	db: Db,
	supporterId: string
): Promise<OwnFundraiserListing[]> {
	const [rows, raised] = await Promise.all([
		db
			.select({
				id: supporterPage.id,
				slug: supporterPage.slug,
				title: supporterPage.title,
				status: supporterPage.status,
				hiddenAt: supporterPage.hiddenAt,
				goalMinor: supporterPage.goalMinor,
				currency: supporterPage.currency
			})
			.from(supporterPage)
			.where(eq(supporterPage.supporterId, supporterId))
			.orderBy(desc(supporterPage.createdAt), desc(supporterPage.id)),
		raisedByPage(db, eq(supporterPage.supporterId, supporterId))
	]);
	return rows.map(({ hiddenAt, ...row }) => ({
		...row,
		hidden: hiddenAt !== null,
		...raised(row.id)
	}));
}

/** how many gifts the manage view lists, newest first; `gifts` counts every one. */
export const OWN_GIFT_LIST_LIMIT = 50;

/** one gift on a supporter's page, as its supporter sees it. */
export type OwnFundraiserGift = {
	/** what it stands at in the books: partly given back is less, settled only. */
	readonly amountMinor: number;
	readonly receivedAt: Date;
	/** the donor's shown name and note, or null for a gift that reads as an anonymous donor's. */
	readonly shown: { readonly name: string; readonly note: string } | null;
};

/** one of a supporter's pages, whole, as its manage view and edit form read it. */
export type OwnFundraiser = OwnFundraiserListing & {
	readonly story: string;
	/** the supporter's own name, which every page of theirs is signed with. */
	readonly name: string;
	readonly photoId: string | null;
	readonly publishedAt: Date | null;
	readonly endedAt: Date | null;
	readonly giftList: readonly OwnFundraiserGift[];
};

/** `pageId` where `supporterId` owns it, and never otherwise. */
const owned = (supporterId: string, pageId: string) =>
	and(eq(supporterPage.id, pageId), eq(supporterPage.supporterId, supporterId));

/** the supporter's page `pageId`, or null where it is not theirs or not there. */
export async function readOwnFundraiser(
	db: Db,
	supporterId: string,
	pageId: string
): Promise<OwnFundraiser | null> {
	const [row] = await db
		.select({
			id: supporterPage.id,
			slug: supporterPage.slug,
			title: supporterPage.title,
			story: supporterPage.story,
			name: supporter.name,
			photoId: supporterPage.photoId,
			status: supporterPage.status,
			hiddenAt: supporterPage.hiddenAt,
			goalMinor: supporterPage.goalMinor,
			currency: supporterPage.currency,
			publishedAt: supporterPage.publishedAt,
			endedAt: supporterPage.endedAt
		})
		.from(supporterPage)
		.innerJoin(supporter, eq(supporter.id, supporterPage.supporterId))
		.where(owned(supporterId, pageId));
	if (!row) return null;
	const [raised, giftList] = await Promise.all([
		fundraiserRaised(db, pageId),
		readOwnGifts(db, pageId)
	]);
	const { hiddenAt, ...page } = row;
	return { ...page, hidden: hiddenAt !== null, ...raised, giftList };
}

/**
 * the join to the page is what makes drizzle name every column with its table in the select list,
 * which the subqueries in `giftNetRaised` and `noteShown` need: unqualified, `amount_minor` is
 * ambiguous between `donation` and the `ledger_entry` they read.
 */
async function readOwnGifts(db: Db, pageId: string): Promise<OwnFundraiserGift[]> {
	const net = giftNetRaised();
	const rows = await db
		.select({
			amountMinor: net,
			receivedAt: donation.receivedAt,
			shown: sql<number>`${noteShown(db)}`,
			name: donation.noteShownName,
			note: donation.note
		})
		.from(donation)
		.innerJoin(supporterPage, eq(supporterPage.id, donation.supporterPageId))
		.where(and(eq(supporterPage.id, pageId), sql`${net} > 0`))
		.orderBy(desc(donation.receivedAt), desc(donation.id))
		.limit(OWN_GIFT_LIST_LIMIT);
	return rows.map((row) => ({
		amountMinor: row.amountMinor,
		receivedAt: row.receivedAt,
		shown: row.shown ? { name: row.name ?? 'Anonymous', note: row.note ?? '' } : null
	}));
}

/**
 * an edit written; `not_found` where the page is not the supporter's, and `photo_missing` for a
 * photo id no stored image carries. the address and the email are not the supporter's to change.
 */
export type OwnEdit = 'saved' | 'not_found' | 'photo_missing';

/**
 * writes a supporter's edit: their name, which signs every page of theirs, and the page's title,
 * goal, story and photo, in one `batch()` with the photo it let go of freed where nothing else
 * names it (../images/free.ts). both updates are guarded on the page being the supporter's.
 */
export async function editOwnFundraiser(
	db: Db,
	supporterId: string,
	pageId: string,
	input: SupporterEdit,
	now: Date
): Promise<OwnEdit> {
	const [before] = await db
		.select({ photoId: supporterPage.photoId })
		.from(supporterPage)
		.where(owned(supporterId, pageId));
	if (!before) return 'not_found';
	try {
		const [, written] = await db.batch([
			db
				.update(supporter)
				.set({ name: input.name })
				.where(
					and(
						eq(supporter.id, supporterId),
						exists(
							db
								.select({ id: supporterPage.id })
								.from(supporterPage)
								.where(owned(supporterId, pageId))
						)
					)
				),
			db
				.update(supporterPage)
				.set({
					title: input.title,
					goalMinor: input.goal,
					story: input.story,
					photoId: input.photo_id,
					updatedAt: now
				})
				.where(owned(supporterId, pageId))
				.returning({ id: supporterPage.id }),
			...freeLetGoStatements(db, [before.photoId], [input.photo_id])
		]);
		return written.length > 0 ? 'saved' : 'not_found';
	} catch (error) {
		if (sqliteResultCode(error) === 'SQLITE_CONSTRAINT_FOREIGNKEY') return 'photo_missing';
		throw error;
	}
}

/**
 * ends a supporter's page for good: pending or live to `ended`, stamped `now`. `ended` too for a page
 * already ended, which keeps its first stamp; `not_found` where it is not the supporter's.
 */
export async function endOwnFundraiser(
	db: Db,
	supporterId: string,
	pageId: string,
	now: Date
): Promise<'ended' | 'not_found'> {
	const written = await db
		.update(supporterPage)
		.set({ status: 'ended', endedAt: now, updatedAt: now })
		.where(and(owned(supporterId, pageId), inArray(supporterPage.status, ['pending', 'live'])))
		.returning({ id: supporterPage.id });
	if (written.length > 0) return 'ended';
	const [still] = await db
		.select({ id: supporterPage.id })
		.from(supporterPage)
		.where(owned(supporterId, pageId));
	return still ? 'ended' : 'not_found';
}
