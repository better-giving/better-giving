import { and, eq, inArray } from 'drizzle-orm';
import { FORM_CURRENCY, majorText } from '../../forms/amounts';
import { readAccountingDate } from '../../ledger/input-schema';
import { countDonorsWithin, matchesDonorText, readDonorGiving } from '../contacts/queries';
import { MAX_DONOR_SEARCH } from '../../contacts/input-schema';
import type { Db } from '../db/client';
import { page } from '../db/schema';
import { readGiftsByFormWithin } from '../donations/queries';
import { readRaisedByFormWithin, type TimeWindow } from '../ledger/queries';
import { type ApiDonor, DONOR_ORDERS, readDonorPage, readDonors } from '../integrations/donor';
import { type ApiGift, readNarrowedGiftPage } from '../integrations/gift';
import {
	type ApiRecurringGift,
	RECURRING_GIFT_ORDERS,
	readRecurringGiftPage
} from '../integrations/recurring-gift';
import { decodeCursor, encodeCursor, type Keyset, type PageOf } from '../integrations/paging';
import { readCampaigns } from '../pages/campaign';
import type { Refused } from './campaigns';

// the reads of `/connector/v1` over money: the dashboard's figures, gifts list, donor file and
// recurring gifts, in the contract's terms. nothing here sums or renders a gift of its own. the
// figures are the dashboard's reads over a window (`readRaisedByMonth`'s raised in
// ../ledger/queries.ts, `readGiftsByMonth`'s count in ../donations/queries.ts, `readDonorSummary`'s
// donors in ../contacts/queries.ts), and each gift, donor and recurring gift is the read API's own
// rendering (../integrations/gift.ts, donor.ts, recurring-gift.ts), so the connector and an
// organisation's systems are never told two different things about one gift.
//
// a query parameter no read takes is refused rather than ignored: a misspelt filter left unread
// would answer every gift as though it had filtered them, and the chat would report that figure.

type Money = { readonly amount: string; readonly currency: string };

const money = (minor: number): Money => ({
	amount: majorText(minor, FORM_CURRENCY),
	currency: FORM_CURRENCY
});

type Issue = { readonly path: string; readonly message: string };

function refused(issues: readonly Issue[]): Refused {
	return {
		ok: false,
		status: 422,
		code: 'invalid',
		detail: `The request was refused: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}.`,
		errors: issues
	};
}

function strayParameters(url: URL, known: readonly string[]): Issue[] {
	return [...new Set(url.searchParams.keys())]
		.filter((name) => !known.includes(name))
		.map((name) => ({
			path: name,
			message: `is not a parameter this action reads; it reads ${known.join(', ')}`
		}));
}

const DAY = 86_400_000;

/**
 * `from` and `to`, each a `YYYY-MM-DD` and both optional, as the window of business time they
 * close: `to` inclusive, so up to the midnight after it, read as the books read a day.
 */
function readWindow(url: URL, issues: Issue[]): TimeWindow {
	const day = (name: 'from' | 'to'): Date | null => {
		const text = url.searchParams.get(name);
		if (text === null) return null;
		const { at, problem } = readAccountingDate(text);
		if (at === null) issues.push({ path: name, message: `${problem}, written YYYY-MM-DD` });
		return at;
	};
	const from = day('from');
	const to = day('to');
	if (from !== null && to !== null && from > to)
		issues.push({ path: 'to', message: 'is a day on or after from' });
	return { from, before: to === null ? null : new Date(to.getTime() + DAY) };
}

const LIMIT_DEFAULT = 25;
const LIMIT_MAX = 100;

/** the page a list request asks for. */
type ListQuery = { readonly limit: number; readonly after: Keyset | null };

/**
 * `?limit` and `?cursor`: the limit held to 1..100, 25 where it is absent or not a number, as every
 * list on this surface holds it; the cursor one the read API's paging issued for `order`
 * (../integrations/paging.ts), so a page continues strictly after the last row of the one before.
 */
function readListQuery(url: URL, order: string, issues: Issue[]): ListQuery {
	const limit = Math.min(
		Math.max(Number(url.searchParams.get('limit') ?? LIMIT_DEFAULT) || LIMIT_DEFAULT, 1),
		LIMIT_MAX
	);
	const raw = url.searchParams.get('cursor');
	if (raw === null) return { limit, after: null };
	const decoded = decodeCursor(raw);
	if (decoded === null || decoded.order !== order || decoded.since !== undefined) {
		issues.push({
			path: 'cursor',
			message:
				'is not one this list issued; send back next_cursor as it came, or none for the first page'
		});
		return { limit, after: null };
	}
	return { limit, after: decoded.keyset };
}

/** a page as every list on this surface answers it. */
function listOf<T, U>(page: PageOf<T>, order: string, render: (row: T) => U) {
	return {
		data: page.rows.map(render),
		next_cursor: page.next === null ? null : encodeCursor(order, page.next, null)
	};
}

/** a list answer, or the refusal of its query. */
type Listed<U> = { ok: true; list: { data: U[]; next_cursor: string | null } } | Refused;

function noSuchCampaign(id: string): Refused {
	return {
		ok: false,
		status: 404,
		code: 'not_found',
		detail: `Campaign ${id} does not exist on this deployment.`
	};
}

/** the settings row campaign `id` owns, or `null` where no campaign has the id. */
async function campaignForm(db: Db, id: string): Promise<string | null> {
	const [row] = await db
		.select({ formId: page.formId })
		.from(page)
		.where(and(eq(page.type, 'campaign'), eq(page.id, id)));
	return row?.formId ?? null;
}

/** a gift as `donations.list` answers it: the read API's, and the campaign it was given through. */
export type ConnectorGift = ApiGift & { readonly campaign_id: string | null };

/** each of a page's gifts with its campaign. */
async function withCampaigns(db: Db, gifts: readonly ApiGift[]) {
	const owning = await campaignsOwning(
		db,
		gifts.map((gift) => gift.form_id)
	);
	return (gift: ApiGift): ConnectorGift => ({
		...gift,
		campaign_id: gift.form_id === null ? null : (owning.get(gift.form_id) ?? null)
	});
}

/** the order `donations.list` and `donors.get` page gifts in: the read API's newest first. */
const GIFTS_NEWEST = 'gifts.newest';

const DONATIONS_PARAMETERS = ['campaign_id', 'from', 'to', 'cursor', 'limit'] as const;

/** `donations.list`: settled gifts newest first, narrowed to a campaign and a window of days. */
export async function listDonations(db: Db, url: URL): Promise<Listed<ConnectorGift>> {
	const issues = strayParameters(url, DONATIONS_PARAMETERS);
	const window = readWindow(url, issues);
	const query = readListQuery(url, GIFTS_NEWEST, issues);
	if (issues.length > 0) return refused(issues);
	const only = url.searchParams.get('campaign_id');
	const formId = only === null ? undefined : await campaignForm(db, only);
	if (formId === null) return noSuchCampaign(only ?? '');
	const page = await readNarrowedGiftPage(db, query, {
		window,
		...(formId === undefined ? {} : { formId })
	});
	return { ok: true, list: listOf(page, GIFTS_NEWEST, await withCampaigns(db, page.rows)) };
}

/** a donor as `donors.list` and `donors.get` answer one: the read API's, with what they have given. */
export type ConnectorDonor = ApiDonor & {
	readonly gift_count: number;
	readonly total_given: Money;
};

/** each of a page's donors with what they have given, on the donor file's rule. */
async function withGiving(db: Db, donors: readonly ApiDonor[]) {
	const giving = await readDonorGiving(
		db,
		donors.map((donor) => donor.id)
	);
	return (donor: ApiDonor): ConnectorDonor => {
		const given = giving.get(donor.id);
		return { ...donor, gift_count: given?.gifts ?? 0, total_given: money(given?.given ?? 0) };
	};
}

const DONORS_PARAMETERS = ['q', 'cursor', 'limit'] as const;

/**
 * `donors.list`: the donor file newest first, as the read API walks it, narrowed by `q` to the
 * donors the dashboard's donor search would offer for the same text (`searchDonors` in
 * ../contacts/queries.ts), every one of them rather than its first ten.
 */
export async function listDonors(db: Db, url: URL): Promise<Listed<ConnectorDonor>> {
	const issues = strayParameters(url, DONORS_PARAMETERS);
	const query = readListQuery(url, DONOR_ORDERS.newest, issues);
	const typed = url.searchParams.get('q')?.trim() ?? '';
	if (typed.length > MAX_DONOR_SEARCH)
		issues.push({ path: 'q', message: `is at most ${MAX_DONOR_SEARCH} characters` });
	if (issues.length > 0) return refused(issues);
	const page = await readDonorPage(
		db,
		{ order: 'newest', ...query },
		typed.length === 0 ? undefined : matchesDonorText(typed)
	);
	return { ok: true, list: listOf(page, DONOR_ORDERS.newest, await withGiving(db, page.rows)) };
}

/** a donor as `donors.get` answers one: with a page of their gifts, newest first. */
export type ConnectorDonorDetail = ConnectorDonor & {
	readonly gifts: { data: ConnectorGift[]; next_cursor: string | null };
};

/**
 * `donors.get`: donor `id` and a page of their settled gifts, `?cursor` and `?limit` paging the
 * gifts; `null` where no donor has the id.
 */
export async function readDonor(
	db: Db,
	id: string,
	url: URL
): Promise<{ ok: true; donor: ConnectorDonorDetail } | Refused | null> {
	const issues = strayParameters(url, ['cursor', 'limit']);
	const query = readListQuery(url, GIFTS_NEWEST, issues);
	if (issues.length > 0) return refused(issues);
	const found = (await readDonors(db, [id])).get(id);
	if (found === undefined) return null;
	const [render, page] = await Promise.all([
		withGiving(db, [found]),
		readNarrowedGiftPage(db, query, { contactId: id })
	]);
	return {
		ok: true,
		donor: {
			...render(found),
			gifts: listOf(page, GIFTS_NEWEST, await withCampaigns(db, page.rows))
		}
	};
}

/** `recurring.list`: every recurring gift newest first, in the read API's rendering. */
export async function listRecurring(db: Db, url: URL): Promise<Listed<ApiRecurringGift>> {
	const issues = strayParameters(url, ['cursor', 'limit']);
	const query = readListQuery(url, RECURRING_GIFT_ORDERS.newest, issues);
	if (issues.length > 0) return refused(issues);
	const page = await readRecurringGiftPage(db, { order: 'newest', ...query });
	return { ok: true, list: listOf(page, RECURRING_GIFT_ORDERS.newest, (row) => row) };
}

/** a campaign's figures, as `results.summary` lists it. */
export type CampaignResult = {
	readonly id: string;
	readonly title: string;
	readonly total: Money;
	readonly gift_count: number;
	readonly goal: Money | null;
};

/** what `results.summary` answers. */
export type ResultsSummary = {
	readonly total: Money;
	readonly gift_count: number;
	readonly donor_count: number;
	readonly campaigns: readonly CampaignResult[];
};

const RESULTS_PARAMETERS = ['campaign_id', 'from', 'to'] as const;

/**
 * what was raised, from how many gifts and donors, over the window `url` names: the whole
 * deployment's, with each campaign's beside it, or one campaign's alone where `campaign_id` names
 * it. a campaign's gifts are the ones made through its own settings row, as its goal bar counts
 * them (`campaignRaised` in ../pages/goal.ts).
 */
export async function readResults(
	db: Db,
	url: URL,
	now: Date
): Promise<{ ok: true; results: ResultsSummary } | Refused> {
	const issues = strayParameters(url, RESULTS_PARAMETERS);
	const window = readWindow(url, issues);
	if (issues.length > 0) return refused(issues);
	const only = url.searchParams.get('campaign_id');

	const [listed, owned] = await Promise.all([
		readCampaigns(db, now.getTime()),
		db
			.select({ id: page.id, formId: page.formId })
			.from(page)
			.where(and(eq(page.type, 'campaign'), only === null ? undefined : eq(page.id, only)))
	]);
	const formOf = new Map(owned.map((row) => [row.id, row.formId]));
	const campaigns = listed.filter((row) => formOf.has(row.id));
	if (only !== null && campaigns.length === 0) return noSuchCampaign(only);
	const onlyForm = only === null ? null : (formOf.get(only) ?? null);

	const [raised, gifts, donors] = await Promise.all([
		readRaisedByFormWithin(db, window),
		readGiftsByFormWithin(db, window),
		countDonorsWithin(db, window, onlyForm)
	]);
	const raisedBy = new Map(raised.map((row) => [row.formId, row.raisedMinor]));
	const giftsBy = new Map(gifts.map((row) => [row.formId, row.gifts]));
	const sum = (rows: readonly number[]) => rows.reduce((total, n) => total + n, 0);

	return {
		ok: true,
		results: {
			total: money(
				onlyForm === null
					? sum(raised.map((row) => row.raisedMinor))
					: (raisedBy.get(onlyForm) ?? 0)
			),
			gift_count:
				onlyForm === null ? sum(gifts.map((row) => row.gifts)) : (giftsBy.get(onlyForm) ?? 0),
			donor_count: donors,
			campaigns: campaigns.map((row) => {
				const formId = formOf.get(row.id) ?? null;
				return {
					id: row.id,
					title: row.name,
					total: money(raisedBy.get(formId) ?? 0),
					gift_count: giftsBy.get(formId) ?? 0,
					goal: row.goalMinor === null ? null : money(row.goalMinor)
				};
			})
		}
	};
}

/** the campaign each of `formIds` is the settings row of, by form id; a form no campaign owns has none. */
export async function campaignsOwning(
	db: Db,
	formIds: readonly (string | null)[]
): Promise<Map<string, string>> {
	const ids = [...new Set(formIds.filter((id): id is string => id !== null))];
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ id: page.id, formId: page.formId })
		.from(page)
		.where(and(eq(page.type, 'campaign'), inArray(page.formId, ids)));
	return new Map(rows.map((row) => [row.formId, row.id]));
}
