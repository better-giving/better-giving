import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { contactConsentUpdateStatements } from '$lib/server/contacts/queries';
import { contact, donation, type NewContact } from '$lib/server/db/schema';
import { mintApiKey } from '$lib/server/integrations/keys';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as surface from './integrations.v1';
import * as donors from './integrations.v1.donors';
import * as gifts from './integrations.v1.gifts';

// the donors an organisation's own system reads with a key, against a real D1 and through the
// surface's own layout. the key check, the method check and the rate limits in front of every list
// are ./integrations.v1.gifts.workers.spec.ts's to hold; this file holds what the donors list adds.

const OWN = 'https://give.example.workers.dev';
const DONORS = `${OWN}/integrations/v1/donors`;

const donorsRoute: RouteRequester = mountRoutes([
	{ path: 'integrations/v1', module: surface },
	{ path: 'donors', module: donors }
]);

const giftsRoute: RouteRequester = mountRoutes([
	{ path: 'integrations/v1', module: surface },
	{ path: 'gifts', module: gifts }
]);

let db: Db;
/** a fresh address per case, for the reason the gifts spec gives for its own. */
let caller = 0;
const address = () => `203.0.113.${caller}`;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	for (const table of [
		'api_key',
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
		'recurring_plan',
		'contact'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	caller += 1;
});

/** a request with a key of its own, as the per-key bucket in the pool is three reads a minute. */
async function keyed(): Promise<RequestInit> {
	const { key } = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
	return { headers: { authorization: `Bearer ${key}`, 'cf-connecting-ip': address() } };
}

/** a donor written at noon on `day` of September 2025, and not touched since. */
async function seedDonor(day: number, over: Partial<NewContact> = {}): Promise<string> {
	const id = uuidv7();
	const at = new Date(Date.UTC(2025, 8, day, 12));
	await db.insert(contact).values({
		id,
		kind: 'individual',
		displayName: 'Ada Okafor',
		primaryEmail: 'ada@example.org',
		createdAt: at,
		updatedAt: at,
		...over
	});
	return id;
}

type Page = {
	data: Record<string, unknown>[];
	next_cursor: string | null;
	resume_updated_since: string | null;
};

describe('a key reading the first page of donors', () => {
	it('answers the donors newest first, each in a fundraiser’s words', async () => {
		const older = await seedDonor(10, { consentedToContact: true });
		const newer = await seedDonor(11, {
			displayName: 'Harbour Trust',
			kind: 'organization',
			primaryEmail: null,
			consentedToContact: false
		});
		const unasked = await seedDonor(12);

		const response = await donorsRoute(new Request(DONORS, await keyed()));

		expect(response.status).toBe(200);
		const page = (await response.json()) as Page;
		expect(page.next_cursor).toBeNull();
		expect(page.data.map((donor) => donor.id)).toEqual([unasked, newer, older]);
		expect(page.data.map((donor) => donor.consent)).toEqual(['unasked', 'declined', 'agreed']);
		expect(page.data[1]).toStrictEqual({
			id: newer,
			name: 'Harbour Trust',
			email: null,
			consent: 'declined',
			created_at: '2025-09-11T12:00:00.000Z',
			updated_at: '2025-09-11T12:00:00.000Z'
		});
	});
});

describe('which donors are listed', () => {
	it('is every donor /admin/donors lists: one with only a pending gift, and not one archived', async () => {
		const pendingOnly = await seedDonor(10);
		await db.insert(donation).values({
			contactId: pendingOnly,
			totalMinor: 5_000,
			currency: 'USD',
			receivedAt: new Date(Date.UTC(2025, 8, 10, 12))
		});
		const typedIn = await seedDonor(11);
		await seedDonor(12, { archivedAt: new Date(Date.UTC(2025, 8, 13)) });

		const listed = idsOf(await walk(''));
		const changed = idsOf(await walk('updated_since=2025-01-01T00:00:00Z'));

		expect(listed).toEqual([typedIn, pendingOnly]);
		expect(changed).toEqual([pendingOnly, typedIn]);
	});
});

/**
 * the donors `query` answers, and each page after by its `next_cursor` until one has none — the
 * gifts spec's walk, over this list.
 */
async function walk(
	query: string,
	between: (pagesRead: number) => Promise<void> = async () => {}
): Promise<Page[]> {
	const pages: Page[] = [];
	let cursor: string | null = null;
	do {
		const url = new URL(`${DONORS}?${query}`);
		if (cursor !== null) url.searchParams.set('cursor', cursor);
		const response = await donorsRoute(new Request(url, await keyed()));
		expect(response.status).toBe(200);
		const page = (await response.json()) as Page;
		pages.push(page);
		cursor = page.next_cursor;
		await between(pages.length);
	} while (cursor !== null && pages.length < 20);
	expect(cursor).toBeNull();
	return pages;
}

const idsOf = (pages: readonly Page[]) =>
	pages.flatMap((page) => page.data.map((donor) => donor.id));

describe('a walk over every donor, newest first', () => {
	it('answers each donor once, a page at a time, and one recorded mid-walk behind the cursor too', async () => {
		const seeded: string[] = [];
		for (let day = 10; day <= 14; day++) seeded.push(await seedDonor(day));
		let backDated: string | undefined;

		const pages = await walk('limit=2', async (read) => {
			if (read === 1) backDated = await seedDonor(11);
		});

		const ids = idsOf(pages);
		expect(pages.map((page) => page.data.length)).toEqual([2, 2, 2]);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.toSorted()).toEqual([...seeded, backDated].toSorted());
	});
});

describe('a walk over every change since an instant, oldest change first', () => {
	it('answers each donor once, and one recorded mid-walk once, after the rest', async () => {
		const seeded: string[] = [];
		for (let day = 10; day <= 14; day++) seeded.push(await seedDonor(day));
		let recorded: string | undefined;

		const pages = await walk('limit=2&updated_since=2025-09-01T00:00:00Z', async (read) => {
			if (read === 1) recorded = await seedDonor(20);
		});

		expect(idsOf(pages)).toEqual([...seeded, recorded]);
		expect(pages.flatMap((page) => page.data.map((donor) => donor.updated_at))).toEqual([
			'2025-09-10T12:00:00.000Z',
			'2025-09-11T12:00:00.000Z',
			'2025-09-12T12:00:00.000Z',
			'2025-09-13T12:00:00.000Z',
			'2025-09-14T12:00:00.000Z',
			'2025-09-20T12:00:00.000Z'
		]);
	});
});

describe('a walk across donors recorded and changed at one time', () => {
	it('answers each once, a page apiece, in either order', async () => {
		const ids = [await seedDonor(10), await seedDonor(10)].toSorted();

		const newest = await walk('limit=1');
		const changed = await walk('limit=1&updated_since=2025-09-01T00:00:00Z');

		expect(idsOf(newest)).toEqual(ids.toReversed());
		expect(idsOf(changed)).toEqual(ids);
	});
});

describe('a read of what changed since the last walk', () => {
	it('answers a donor whose consent changed since, with the new answer, and not a donor untouched since', async () => {
		const withdrawn = await seedDonor(10, { consentedToContact: true });
		const untouched = await seedDonor(11, { consentedToContact: true });
		const last = await seedDonor(12);
		const walked = await walk('updated_since=2025-09-01T00:00:00Z');
		const since = String(walked.at(-1)?.resume_updated_since);
		expect(since).toBe('2025-09-12T11:59:00.000Z');

		await db.batch(contactConsentUpdateStatements(db, withdrawn, false));

		const changed = (await walk(`updated_since=${since}`)).flatMap((page) => page.data);
		expect(changed.map((donor) => donor.id)).toEqual([last, withdrawn]);
		expect(changed[1]?.consent).toBe('declined');
		expect(Date.parse(String(changed[1]?.updated_at))).toBeGreaterThan(Date.parse(since));
		expect(changed.map((donor) => donor.id)).not.toContain(untouched);
	});
});

type Refusal = { error: string; message: string; fix: string };

/** what `route` answers `query` with: a 400, whose body the caller compares. */
async function refusal(route: RouteRequester, list: string, query: string): Promise<Refusal> {
	const response = await route(
		new Request(`${OWN}/integrations/v1/${list}?${query}`, await keyed())
	);
	expect(response.status).toBe(400);
	expect(response.headers.get('cache-control')).toBe('no-store');
	return (await response.json()) as Refusal;
}

describe('a request naming a page the list cannot serve', () => {
	it.each([
		'limit=101',
		'limit=ten',
		'cursor=not-a-cursor!',
		'updated_since=2026-09-10',
		'since=2026-09-10T12:00:00Z&page=2'
	])('refuses %s word for word as the gifts list does', async (query) => {
		const donorsSaid = await refusal(donorsRoute, 'donors', query);
		const giftsSaid = await refusal(giftsRoute, 'gifts', query);

		expect(donorsSaid).toStrictEqual(giftsSaid);
	});

	it('refuses a cursor the gifts list issued, naming that list and to start without one', async () => {
		const giftsCursor = btoa(JSON.stringify(['gifts.newest', 0, 'x'])).replace(/=+$/, '');

		const body = await refusal(donorsRoute, 'donors', `cursor=${giftsCursor}`);

		expect(body.error).toBe('invalid_cursor');
		expect(body.message).toContain('/integrations/v1/gifts');
		expect(body.fix).toContain('without a `cursor`');
	});
});
