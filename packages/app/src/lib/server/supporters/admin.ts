import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { supporter, supporterPage, type SupporterPageStatus } from '../db/schema';
import { type Raised, raisedByPage } from './pages';

// staff's side of supporter fundraisers: every page, and hiding one or showing it again. each is
// behind the staff gate, and the routes that call these gate on it; the organisation setting is
// `supporterFundraisersEnabled` and `updateSupporterFundraisersEnabled` in ../org/queries.ts, gated
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
	readonly createdAt: Date;
};

/** every fundraiser, newest first. */
export async function listAllFundraisers(db: Db): Promise<FundraiserListing[]> {
	const [rows, raised] = await Promise.all([
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
				createdAt: supporterPage.createdAt
			})
			.from(supporterPage)
			.innerJoin(supporter, eq(supporter.id, supporterPage.supporterId))
			.orderBy(desc(supporterPage.createdAt), desc(supporterPage.id)),
		raisedByPage(db, sql`1`)
	]);
	return rows.map(({ hiddenAt, ...row }) => ({
		...row,
		...raised(row.id),
		hidden: hiddenAt !== null
	}));
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
