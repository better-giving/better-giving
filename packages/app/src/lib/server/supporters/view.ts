import { eq, type SQL } from 'drizzle-orm';
import type { DonorMessages } from '../../donate/messages';
import type { Db } from '../db/client';
import { supporter, supporterPage, type SupporterPageStatus } from '../db/schema';
import { readShownMessages } from '../pages/messages';
import { fundraiserRaised } from './pages';

// a supporter's fundraiser as the public reads it at /f/<slug>, and as staff preview it.
//
// the public read answers one of three: live, ended, or `not_found` — and a page that is hidden or
// still pending is `not_found` exactly as an address nobody holds, so no title, name or total of one
// reaches a browser. nothing here names the donor of a gift but a message its donor chose to show.

/** a live fundraiser, whole, and the settings row its donation form takes gifts through. */
export type LiveFundraiser = {
	readonly kind: 'live';
	readonly title: string;
	readonly story: string;
	/** the supporter's name. */
	readonly name: string;
	/** when it went live. */
	readonly startedAt: Date;
	readonly photoId: string | null;
	readonly raisedMinor: number;
	readonly goalMinor: number;
	readonly currency: string;
	readonly gifts: number;
	readonly goalReached: boolean;
	/** its own gifts' shown messages, the first page of them; null where there are none. */
	readonly messages: DonorMessages | null;
	/** the `form` id the donation element on the page is given. */
	readonly formId: string;
};

export type EndedFundraiser = {
	readonly kind: 'ended';
	readonly title: string;
	readonly name: string;
	readonly raisedMinor: number;
	readonly goalMinor: number;
	readonly currency: string;
	readonly gifts: number;
};

export type PublicFundraiser = LiveFundraiser | EndedFundraiser | { readonly kind: 'not_found' };

const NOT_FOUND = { kind: 'not_found' } as const;

function readPage(db: Db, where: SQL) {
	return db
		.select({
			id: supporterPage.id,
			title: supporterPage.title,
			story: supporterPage.story,
			name: supporter.name,
			photoId: supporterPage.photoId,
			goalMinor: supporterPage.goalMinor,
			currency: supporterPage.currency,
			formId: supporterPage.formId,
			status: supporterPage.status,
			publishedAt: supporterPage.publishedAt,
			endedAt: supporterPage.endedAt,
			hiddenAt: supporterPage.hiddenAt,
			hiddenNote: supporterPage.hiddenNote
		})
		.from(supporterPage)
		.innerJoin(supporter, eq(supporter.id, supporterPage.supporterId))
		.where(where)
		.limit(1);
}

type PageRow = Awaited<ReturnType<typeof readPage>>[number];

/** the live arm's figures for any page row, whatever its state. */
async function drawnLive(db: Db, row: PageRow): Promise<Omit<LiveFundraiser, 'startedAt'>> {
	const [raised, messages] = await Promise.all([
		fundraiserRaised(db, row.id),
		readShownMessages(db, null, row.id)
	]);
	return {
		kind: 'live',
		title: row.title,
		story: row.story,
		name: row.name,
		photoId: row.photoId,
		...raised,
		goalMinor: row.goalMinor,
		currency: row.currency,
		goalReached: raised.raisedMinor >= row.goalMinor,
		messages: messages.total > 0 ? messages : null,
		formId: row.formId
	};
}

/** the fundraiser at `/f/<slug>`, as the public may see it. */
export async function readPublicFundraiser(db: Db, slug: string): Promise<PublicFundraiser> {
	const [row] = await readPage(db, eq(supporterPage.slug, slug));
	if (!row || row.hiddenAt !== null || row.status === 'pending') return NOT_FOUND;
	if (row.status === 'ended') {
		const raised = await fundraiserRaised(db, row.id);
		return {
			kind: 'ended',
			title: row.title,
			name: row.name,
			...raised,
			goalMinor: row.goalMinor,
			currency: row.currency
		};
	}
	// unreachable: `supporter_page_published_check` holds a live page to a publish time.
	if (row.publishedAt === null) throw new Error(`live fundraiser ${row.id} has no publish time`);
	return { ...(await drawnLive(db, row)), startedAt: row.publishedAt };
}

/** staff's preview of any fundraiser: drawn as live, with what keeps the public from it. */
export type FundraiserPreview = Omit<LiveFundraiser, 'kind' | 'startedAt'> & {
	readonly startedAt: Date | null;
	readonly status: SupporterPageStatus;
	readonly endedAt: Date | null;
	readonly hidden: boolean;
	readonly hiddenNote: string | null;
};

/**
 * the fundraiser `pageId` drawn for staff whatever its state, or null for no such page. the route
 * that serves it gates it on a staff session.
 */
export async function readFundraiserPreview(
	db: Db,
	pageId: string
): Promise<FundraiserPreview | null> {
	const [row] = await readPage(db, eq(supporterPage.id, pageId));
	if (!row) return null;
	const { kind: _live, ...drawn } = await drawnLive(db, row);
	return {
		...drawn,
		startedAt: row.publishedAt,
		status: row.status,
		endedAt: row.endedAt,
		hidden: row.hiddenAt !== null,
		hiddenNote: row.hiddenNote
	};
}
