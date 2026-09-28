import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import {
	apiKey as apiKeyTable,
	contact,
	dispute,
	type DisputeOutcome,
	donation,
	type NewDonation,
	type NewPayment,
	payment
} from '$lib/server/db/schema';
import { postableId } from '$lib/server/db/accounts';
import { mintApiKey, revokeApiKey } from '$lib/server/integrations/keys';
import { post, postingStatements } from '$lib/server/ledger/posting';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as surface from './integrations.v1';
import * as gifts from './integrations.v1.gifts';

// the gifts an organisation's own system reads with a key, against a real D1 and through the
// surface's own layout — so the key check stands in front of every case exactly as it does
// deployed (../route-request.testing.ts).

const OWN = 'https://give.example.workers.dev';
const GIFTS = `${OWN}/integrations/v1/gifts`;

const giftsRoute: RouteRequester = mountRoutes([
	{ path: 'integrations/v1', module: surface },
	{ path: 'gifts', module: gifts }
]);

const surfaceRoute: RouteRequester = mountRoutes([{ path: 'integrations/v1', module: surface }]);

let db: Db;
/**
 * the address each case arrives from, a fresh one per case: the layout charges every request to
 * its address on the pool's `API_RATE_LIMITER`, a small bucket (../../vitest.workers.config.ts),
 * and cases sharing one would spend it for each other.
 */
let caller = 0;
const address = () => `198.51.100.${caller}`;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	for (const table of [
		'api_key',
		'ledger_entry',
		'entry_group',
		'dispute',
		'payment',
		'line_item',
		'donation',
		'contact'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	caller += 1;
});

const bearer = (key: string): RequestInit => ({
	headers: { authorization: `Bearer ${key}`, 'cf-connecting-ip': address() }
});

async function apiKey(): Promise<string> {
	return (await mintApiKey(db, { name: 'CRM sync', kind: 'api' })).key;
}

async function seedDonor(): Promise<string> {
	const id = uuidv7();
	await db.insert(contact).values({
		id,
		kind: 'individual',
		displayName: 'Ada Okafor',
		primaryEmail: 'ada@example.org'
	});
	return id;
}

type Gift = { readonly donationId: string; readonly paymentId: string };

/** a $50 cheque from `contactId`, its money moved and recorded at noon on `day` of September 2026. */
async function seedGift(
	contactId: string,
	day: number,
	over: { donation?: Partial<NewDonation>; payment?: Partial<NewPayment> } = {}
): Promise<Gift> {
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const at = new Date(Date.UTC(2026, 8, day, 12));
	await db.insert(donation).values({
		id: donationId,
		contactId,
		totalMinor: 5_000,
		currency: 'USD',
		receivedAt: at,
		...over.donation
	});
	await db.insert(payment).values({
		id: paymentId,
		donationId,
		amountMinor: 5_000,
		currency: 'USD',
		direction: 'inbound',
		method: 'check',
		status: 'succeeded',
		provider: 'manual',
		occurredAt: at,
		createdAt: at,
		...over.payment
	});
	return { donationId, paymentId };
}

/** `amountMinor` of `gift` sent back on `day`, and the dispute on it where `dispute` says. */
async function seedRefund(
	gift: Gift,
	day: number,
	amountMinor: number,
	over: { status?: NewPayment['status']; dispute?: DisputeOutcome | 'open' } = {}
): Promise<void> {
	const id = uuidv7();
	const at = new Date(Date.UTC(2026, 8, day, 12));
	await db.insert(payment).values({
		id,
		donationId: gift.donationId,
		amountMinor,
		currency: 'USD',
		direction: 'refund',
		method: 'check',
		status: over.status ?? 'succeeded',
		provider: 'manual',
		occurredAt: at,
		createdAt: at,
		parentPaymentId: gift.paymentId
	});
	if (over.dispute !== undefined) {
		const closed = over.dispute === 'open' ? {} : { outcome: over.dispute, closedAt: new Date() };
		await db.insert(dispute).values({ paymentId: id, ...closed });
	}
}

type Page = {
	data: Record<string, unknown>[];
	next_cursor: string | null;
	resume_updated_since: string | null;
};

describe('a key reading the first page of gifts', () => {
	it('answers the settled gifts newest first, each with how it stands', async () => {
		const key = await apiKey();
		const donorId = await seedDonor();
		const kept = await seedGift(donorId, 10);
		const halfBack = await seedGift(donorId, 11);
		const allBack = await seedGift(donorId, 12);
		await seedGift(donorId, 13, { payment: { status: 'pending' } });
		await seedRefund(halfBack, 14, 2_000);
		await seedRefund(allBack, 15, 5_000);

		const response = await giftsRoute(new Request(GIFTS, bearer(key)));

		expect(response.status).toBe(200);
		const page = (await response.json()) as Page;
		expect(page.next_cursor).toBeNull();
		expect(page.data.map((gift) => gift.id)).toEqual([
			allBack.paymentId,
			halfBack.paymentId,
			kept.paymentId
		]);
		expect(page.data[0]).toMatchObject({ status: 'refunded', amount_refunded_minor: 5_000 });
		expect(page.data[1]).toMatchObject({
			status: 'partially_refunded',
			amount_refunded_minor: 2_000
		});
		expect(page.data[2]).toStrictEqual({
			id: kept.paymentId,
			donation_id: kept.donationId,
			occurred_at: '2026-09-10T12:00:00.000Z',
			amount: '50.00',
			amount_minor: 5_000,
			currency: 'USD',
			covered_fee_minor: 0,
			method: 'check',
			recurring: false,
			frequency: 'one_time',
			form_id: null,
			form_name: null,
			program_name: null,
			dedication_kind: null,
			dedication_honoree: null,
			note: null,
			donor_id: donorId,
			donor_name: 'Ada Okafor',
			donor_email: 'ada@example.org',
			coin: null,
			coin_amount: null,
			status: 'settled',
			amount_refunded_minor: 0,
			dispute_open: false,
			updated_at: '2026-09-10T12:00:00.000Z'
		});
	});

	it('counts a lost dispute as money sent back, and an open, won or failed one as none', async () => {
		const key = await apiKey();
		const donorId = await seedDonor();
		const open = await seedGift(donorId, 10);
		const lost = await seedGift(donorId, 11);
		const won = await seedGift(donorId, 12);
		const failed = await seedGift(donorId, 13);
		await seedRefund(open, 20, 5_000, { dispute: 'open' });
		await seedRefund(lost, 20, 5_000, { dispute: 'lost' });
		await seedRefund(won, 20, 5_000, { status: 'cancelled', dispute: 'won' });
		await seedRefund(failed, 20, 2_000, { status: 'cancelled' });

		const response = await giftsRoute(new Request(GIFTS, bearer(key)));

		const byId = new Map(((await response.json()) as Page).data.map((gift) => [gift.id, gift]));
		const standing = (gift: Gift) => {
			const { status, amount_refunded_minor, dispute_open } = byId.get(gift.paymentId) ?? {};
			return { status, amount_refunded_minor, dispute_open };
		};
		expect(standing(open)).toEqual({
			status: 'settled',
			amount_refunded_minor: 0,
			dispute_open: true
		});
		expect(standing(lost)).toEqual({
			status: 'refunded',
			amount_refunded_minor: 5_000,
			dispute_open: false
		});
		expect(standing(won)).toEqual({
			status: 'settled',
			amount_refunded_minor: 0,
			dispute_open: false
		});
		expect(standing(failed)).toEqual({
			status: 'settled',
			amount_refunded_minor: 0,
			dispute_open: false
		});
	});

	it('answers 50 by default, the newest, and a cursor to the rest', async () => {
		const key = await apiKey();
		const donorId = await seedDonor();
		const seeded: Gift[] = [];
		for (let day = 1; day <= 26; day++) {
			seeded.push(await seedGift(donorId, day));
			seeded.push(await seedGift(donorId, day));
		}

		const response = await giftsRoute(new Request(GIFTS, bearer(key)));

		const page = (await response.json()) as Page;
		expect(page.data).toHaveLength(50);
		expect(page.data.some((gift) => gift.occurred_at === '2026-09-01T12:00:00.000Z')).toBe(false);
		expect(page.next_cursor).toEqual(expect.any(String));
	});

	it('breaks a tie on when the money moved by id, highest first', async () => {
		const key = await apiKey();
		const donorId = await seedDonor();
		const first = await seedGift(donorId, 10);
		const second = await seedGift(donorId, 10);

		const response = await giftsRoute(new Request(GIFTS, bearer(key)));

		const ids = ((await response.json()) as Page).data.map((gift) => gift.id);
		expect(ids).toEqual([first.paymentId, second.paymentId].sort().reverse());
	});

	it('answers an empty list, not a missing one, before any gift', async () => {
		const key = await apiKey();

		const response = await giftsRoute(new Request(GIFTS, bearer(key)));

		expect(await response.json()).toStrictEqual({
			data: [],
			next_cursor: null,
			resume_updated_since: null
		});
	});

	it('is kept by no cache and readable by no page in a browser', async () => {
		const key = await apiKey();

		const response = await giftsRoute(new Request(GIFTS, bearer(key)));

		expect(response.headers.get('cache-control')).toBe('no-store');
		expect([...response.headers.keys()].filter((h) => h.startsWith('access-control-'))).toEqual([]);
	});
});

/**
 * the gifts `query` answers, and each page after by its `next_cursor` until one has none. each
 * page is read with a key of its own, as the per-key bucket in the pool is three reads a minute.
 */
async function walk(
	query: string,
	between: (pagesRead: number) => Promise<void> = async () => {}
): Promise<Page[]> {
	const pages: Page[] = [];
	let cursor: string | null = null;
	do {
		const url = new URL(`${GIFTS}?${query}`);
		if (cursor !== null) url.searchParams.set('cursor', cursor);
		const response = await giftsRoute(new Request(url, bearer(await apiKey())));
		expect(response.status).toBe(200);
		const page = (await response.json()) as Page;
		pages.push(page);
		cursor = page.next_cursor;
		await between(pages.length);
	} while (cursor !== null && pages.length < 20);
	expect(cursor).toBeNull();
	return pages;
}

const idsOf = (pages: readonly Page[]) => pages.flatMap((page) => page.data.map((gift) => gift.id));

describe('a walk over every gift, newest first', () => {
	it('answers each gift once, a page at a time, and one recorded mid-walk behind the cursor too', async () => {
		const donorId = await seedDonor();
		const seeded: Gift[] = [];
		for (let day = 10; day <= 14; day++) seeded.push(await seedGift(donorId, day));
		let backDated: Gift | undefined;

		const pages = await walk('limit=2', async (read) => {
			if (read === 1)
				backDated = await seedGift(donorId, 11, { payment: { createdAt: new Date() } });
		});

		const ids = idsOf(pages);
		expect(pages.map((page) => page.data.length)).toEqual([2, 2, 2]);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.toSorted()).toEqual(
			[...seeded, backDated].map((gift) => gift?.paymentId).toSorted()
		);
	});
});

describe('a walk over every change since an instant, oldest change first', () => {
	it('answers each gift once, and one recorded mid-walk once, after the rest', async () => {
		const donorId = await seedDonor();
		const seeded: Gift[] = [];
		for (let day = 10; day <= 14; day++) seeded.push(await seedGift(donorId, day));
		let recorded: Gift | undefined;

		const pages = await walk('limit=2&updated_since=2026-09-01T00:00:00Z', async (read) => {
			if (read === 1) recorded = await seedGift(donorId, 20);
		});

		const ids = idsOf(pages);
		expect(ids).toEqual([...seeded, recorded].map((gift) => gift?.paymentId));
		expect(pages.flatMap((page) => page.data.map((gift) => gift.updated_at))).toEqual([
			'2026-09-10T12:00:00.000Z',
			'2026-09-11T12:00:00.000Z',
			'2026-09-12T12:00:00.000Z',
			'2026-09-13T12:00:00.000Z',
			'2026-09-14T12:00:00.000Z',
			'2026-09-20T12:00:00.000Z'
		]);
	});
});

/** the `updated_at` of the last gift a walk from `since` served: where the next read resumes. */
async function lastChange(since = '2026-09-01T00:00:00Z'): Promise<string> {
	const served = (await walk(`updated_since=${since}`)).flatMap((page) => page.data);
	const last = served[served.length - 1]?.updated_at;
	if (typeof last !== 'string') throw new Error('the walk served no gift');
	return last;
}

async function changedSince(since: string): Promise<Page['data']> {
	return (await walk(`updated_since=${encodeURIComponent(since)}`)).flatMap((page) => page.data);
}

describe('a read of what changed since the last walk', () => {
	it('answers a gift refunded since, refunded, and not a gift untouched since', async () => {
		const donorId = await seedDonor();
		const refunded = await seedGift(donorId, 10);
		const untouched = await seedGift(donorId, 11);
		const last = await seedGift(donorId, 12);
		const since = await lastChange();

		await seedRefund(refunded, 20, 5_000);

		const changed = await changedSince(since);
		expect(changed.map((gift) => gift.id)).toEqual([last.paymentId, refunded.paymentId]);
		expect(changed[1]).toMatchObject({
			status: 'refunded',
			amount_refunded_minor: 5_000,
			updated_at: '2026-09-20T12:00:00.000Z'
		});
		expect(changed.map((gift) => gift.id)).not.toContain(untouched.paymentId);
	});

	it('answers a gift that settled since, though it was opened before the walk', async () => {
		const donorId = await seedDonor();
		await seedGift(donorId, 12);
		const opened = await seedGift(donorId, 5, { payment: { status: 'pending' } });
		const since = await lastChange();

		await db.batch([
			db.update(payment).set({ status: 'succeeded' }).where(eq(payment.id, opened.paymentId)),
			...postingStatements(
				db,
				post({
					sourceType: 'payment',
					sourceId: opened.paymentId,
					currency: 'USD',
					occurredAt: new Date(Date.UTC(2026, 8, 5, 12)),
					lines: [
						{ accountId: postableId('undepositedFunds'), amountMinor: 5_000 },
						{ accountId: postableId('donationsDeductible'), amountMinor: -5_000 }
					]
				})
			)
		]);

		const changed = await changedSince(since);
		expect(changed.map((gift) => gift.id)).toContain(opened.paymentId);
		expect(Date.parse(String(changed.at(-1)?.updated_at))).toBeGreaterThan(Date.parse(since));
	});

	it('answers a gift whose refund failed since, with its money back', async () => {
		const donorId = await seedDonor();
		const gift = await seedGift(donorId, 10);
		await seedRefund(gift, 11, 5_000);
		const since = await lastChange();
		const [refund] = await db
			.select({ id: payment.id })
			.from(payment)
			.where(eq(payment.parentPaymentId, gift.paymentId));
		const refundId = String(refund?.id);

		await db.batch([
			db.update(payment).set({ status: 'cancelled' }).where(eq(payment.id, refundId)),
			...postingStatements(
				db,
				post({
					sourceType: 'payment',
					sourceId: refundId,
					currency: 'USD',
					occurredAt: new Date(Date.UTC(2026, 8, 12, 12)),
					lines: [
						{ accountId: postableId('undepositedFunds'), amountMinor: 5_000 },
						{ accountId: postableId('donationsDeductible'), amountMinor: -5_000 }
					]
				})
			)
		]);

		const changed = await changedSince(since);
		expect(changed.at(-1)).toMatchObject({
			id: gift.paymentId,
			status: 'settled',
			amount_refunded_minor: 0
		});
		expect(Date.parse(String(changed.at(-1)?.updated_at))).toBeGreaterThan(Date.parse(since));
	});

	it('answers a gift whose dispute was won since, with its money back', async () => {
		const donorId = await seedDonor();
		const disputed = await seedGift(donorId, 10);
		await seedRefund(disputed, 11, 5_000, { dispute: 'open' });
		const since = await lastChange();
		const [withdrawal] = await db
			.select({ id: payment.id })
			.from(payment)
			.where(eq(payment.parentPaymentId, disputed.paymentId));

		await db.batch([
			db
				.update(payment)
				.set({ status: 'cancelled' })
				.where(eq(payment.id, String(withdrawal?.id))),
			db
				.update(dispute)
				.set({ outcome: 'won', closedAt: new Date() })
				.where(eq(dispute.paymentId, String(withdrawal?.id)))
		]);

		const changed = await changedSince(since);
		expect(changed.at(-1)).toMatchObject({
			id: disputed.paymentId,
			status: 'settled',
			dispute_open: false
		});
		expect(Date.parse(String(changed.at(-1)?.updated_at))).toBeGreaterThan(Date.parse(since));
	});
});

describe('where the next walk of changes resumes', () => {
	it('is answered on the last page, a minute before the last change it served, and on no other', async () => {
		const donorId = await seedDonor();
		for (let day = 10; day <= 12; day++) await seedGift(donorId, day);

		const pages = await walk('limit=2&updated_since=2026-09-01T00:00:00Z');

		expect(pages.map((page) => page.resume_updated_since)).toEqual([
			null,
			'2026-09-12T11:59:00.000Z'
		]);
	});

	it('is the instant sent, where nothing has changed since it', async () => {
		const donorId = await seedDonor();
		await seedGift(donorId, 10);

		const [page] = await walk(`updated_since=${encodeURIComponent('2026-09-20T02:00:00+02:00')}`);

		expect(page?.data).toEqual([]);
		expect(page?.resume_updated_since).toBe('2026-09-20T00:00:00.000Z');
	});

	it('serves a change a walk resumed from it would otherwise pass over', async () => {
		const donorId = await seedDonor();
		await seedGift(donorId, 12);
		const [first] = await walk('updated_since=2026-09-01T00:00:00Z');
		const committedLate = await seedGift(donorId, 12, {
			payment: { createdAt: new Date(Date.UTC(2026, 8, 12, 11, 59, 30)) }
		});

		const changed = await changedSince(String(first?.resume_updated_since));

		expect(changed.map((gift) => gift.id)).toContain(committedLate.paymentId);
	});

	it('is taken from the order the page was read in, so a change committing while its gifts were read passes nothing over', async () => {
		const donorId = await seedDonor();
		await seedGift(donorId, 10);
		const refunded = await seedGift(donorId, 12);
		const url = `${GIFTS}?updated_since=2026-09-01T00:00:00Z`;
		const env = envWritingAfterTheOrder(() => seedRefund(refunded, 20, 5_000));

		const response = await giftsRoute(new Request(url, bearer(await apiKey())), { env });
		const page = (await response.json()) as Page;
		const committedLate = await seedGift(donorId, 15);

		expect(page.data.at(-1)).toMatchObject({
			id: refunded.paymentId,
			updated_at: '2026-09-20T12:00:00.000Z'
		});
		expect(page.resume_updated_since).toBe('2026-09-12T11:59:00.000Z');
		const changed = await changedSince(String(page.resume_updated_since));
		expect(changed.map((gift) => gift.id)).toContain(committedLate.paymentId);
	});

	it('is never answered in the newest-first walk', async () => {
		const donorId = await seedDonor();
		for (let day = 10; day <= 12; day++) await seedGift(donorId, day);

		const pages = await walk('limit=2');

		expect(pages.map((page) => page.resume_updated_since)).toEqual([null, null]);
	});
});

describe('a walk across rows that share one time', () => {
	it('answers each once, a page apiece, in either order', async () => {
		const donorId = await seedDonor();
		const first = await seedGift(donorId, 10);
		const second = await seedGift(donorId, 10);
		const ids = [first.paymentId, second.paymentId].toSorted();

		const newest = await walk('limit=1');
		const changed = await walk('limit=1&updated_since=2026-09-01T00:00:00Z');

		expect(idsOf(newest)).toEqual(ids.toReversed());
		expect(idsOf(changed)).toEqual(ids);
	});
});

describe('the oldest gift', () => {
	it('is reached by a walk in either order, with no date floor', async () => {
		const donorId = await seedDonor();
		const oldest = await seedGift(donorId, 1, {
			payment: {
				occurredAt: new Date(Date.UTC(2001, 0, 2)),
				createdAt: new Date(Date.UTC(2001, 0, 2))
			}
		});
		await seedGift(donorId, 10);
		await seedGift(donorId, 11);

		const newest = idsOf(await walk('limit=1'));
		const changed = idsOf(await walk('limit=1&updated_since=1970-01-01T00:00:00Z'));

		expect(newest.at(-1)).toBe(oldest.paymentId);
		expect(changed[0]).toBe(oldest.paymentId);
	});
});

/** a 400 for `query`, with its body, asserting what every one of them carries. */
async function refusedQuery(query: string): Promise<Refusal> {
	const response = await giftsRoute(new Request(`${GIFTS}?${query}`, bearer(await apiKey())));
	expect(response.status).toBe(400);
	expect(response.headers.get('cache-control')).toBe('no-store');
	return (await response.json()) as Refusal;
}

describe('a request naming a page the endpoint cannot serve', () => {
	it.each(['101', '0', '-1', '1.5', 'ten', ''])(
		'refuses limit=%s, naming it and the ceiling',
		async (value) => {
			const body = await refusedQuery(`limit=${value}`);

			expect(body.error).toBe('invalid_limit');
			expect(body.message).toContain(`\`limit=${value}\``);
			expect(body.fix).toContain('from 1 to 100');
		}
	);

	it('serves a page of the ceiling exactly', async () => {
		const response = await giftsRoute(new Request(`${GIFTS}?limit=100`, bearer(await apiKey())));

		expect(response.status).toBe(200);
	});

	it.each([
		'not-a-cursor!',
		'bm90IGpzb24',
		btoa(JSON.stringify(['gifts.newest', 'noon', 'x'])).replace(/=+$/, '')
	])('refuses cursor=%s as one this endpoint never issued', async (value) => {
		const body = await refusedQuery(`cursor=${value}`);

		expect(body.error).toBe('invalid_cursor');
		expect(body.message).toContain(`\`cursor=${value}\``);
		expect(body.fix).toContain('`next_cursor`');
	});

	it('refuses a cursor from the newest-first walk in a walk of changes, and the other way', async () => {
		const donorId = await seedDonor();
		await seedGift(donorId, 10);
		await seedGift(donorId, 11);
		const since = 'updated_since=2026-09-01T00:00:00Z';
		const newest = (await walk('limit=1'))[0]?.next_cursor;
		const changed = (await walk(`limit=1&${since}`))[0]?.next_cursor;

		const intoChanges = await refusedQuery(`${since}&cursor=${newest}`);
		const intoNewest = await refusedQuery(`cursor=${changed}`);

		expect(intoChanges.error).toBe('invalid_cursor');
		expect(intoChanges.message).toContain('another order');
		expect(intoNewest.error).toBe('invalid_cursor');
		expect(intoNewest.message).toContain('another order');
	});

	it.each([
		{ value: 'yesterday', what: 'a word' },
		{ value: '2026-09-10', what: 'a date with no time' },
		{ value: '2026-09-10T12:00:00', what: 'no offset' },
		{ value: '2026-02-30T12:00:00Z', what: 'a day the month does not have' },
		{ value: '2026-09-10T12:00:00 02:00', what: 'a `+` a query string read as a space' }
	])('refuses updated_since as $what, naming it and the form', async ({ value }) => {
		const body = await refusedQuery(`updated_since=${encodeURIComponent(value)}`);

		expect(body.error).toBe('invalid_updated_since');
		expect(body.message).toContain(`\`updated_since=${value}\``);
		expect(body.message).toContain('2026-09-10T12:00:00Z');
		expect(body.fix).toContain('`resume_updated_since`');
		expect(body.fix).toContain('%2B');
	});

	it('reads updated_since with an offset as the instant it names', async () => {
		const donorId = await seedDonor();
		await seedGift(donorId, 10);
		const later = await seedGift(donorId, 11);

		const changed = await changedSince('2026-09-11T14:00:00+02:00');

		expect(changed.map((gift) => gift.id)).toEqual([later.paymentId]);
	});

	it('refuses a parameter the endpoint does not read, naming it and those it does', async () => {
		const body = await refusedQuery('since=2026-09-10T12:00:00Z&limit=10&page=2');

		expect(body.error).toBe('unknown_parameter');
		expect(body.message).toContain('`since`');
		expect(body.message).toContain('`page`');
		expect(body.fix).toContain('`updated_since`');
	});
});

type Refusal = { error: string; message: string; fix: string };

/** a 401 from the key check, with its body, asserting what every one of them carries. */
async function refusedWith(authorization: string | null): Promise<Refusal> {
	const headers: Record<string, string> = {
		'cf-connecting-ip': address(),
		...(authorization === null ? {} : { authorization })
	};
	const response = await giftsRoute(new Request(GIFTS, { headers }));
	expect(response.status).toBe(401);
	expect(response.headers.get('www-authenticate')).toBe('Bearer');
	expect(response.headers.get('cache-control')).toBe('no-store');
	return (await response.json()) as Refusal;
}

describe('a request whose key does not check out', () => {
	// a gift is on the books in every case, so a refusal that let the read run would show it
	beforeEach(async () => {
		await seedGift(await seedDonor(), 10);
	});

	it('is refused when it carries no key, and told where the key goes', async () => {
		const body = await refusedWith(null);

		expect(body.error).toBe('missing_key');
		expect(body.fix).toContain('Authorization: Bearer <key>');
		expect(body).not.toHaveProperty('data');
	});

	it.each([
		{ what: 'another scheme', value: 'Basic dXNlcjpwYXNz', says: '`Bearer` scheme' },
		{ what: 'a key cut short', value: 'Bearer bgk_x7Qp', says: '47 characters' },
		{ what: 'a quoted key', value: `Bearer "bgk_${'Q'.repeat(43)}"`, says: '47 characters' }
	])('is refused as malformed for $what, without echoing it', async ({ value, says }) => {
		const body = await refusedWith(value);

		expect(body.error).toBe('malformed_key');
		expect(body.message).toContain(says);
		expect(JSON.stringify(body)).not.toContain(value.split(' ')[1]?.slice(0, 8));
	});

	it('is refused as malformed for the scheme with nothing after it', async () => {
		expect((await refusedWith('Bearer')).error).toBe('malformed_key');
	});

	it('is refused as unknown for a key this deployment never made', async () => {
		const body = await refusedWith(`Bearer bgk_${'A'.repeat(43)}`);

		expect(body.error).toBe('unknown_key');
		expect(body.message).toBe('The API key presented is not one this deployment made.');
	});

	it('is refused as revoked, naming when', async () => {
		const minted = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
		const revokedAt = await revokeApiKey(db, minted.id);

		const body = await refusedWith(`Bearer ${minted.key}`);

		expect(body.error).toBe('revoked_key');
		expect(body.message).toContain(`revoked at ${revokedAt?.toISOString()}`);
	});

	it('refuses Zapier’s key exactly as it refuses one of its shape never made', async () => {
		const zapier = await mintApiKey(db, { name: 'Zapier', kind: 'zapier' });

		expect(await refusedWith(`Bearer ${zapier.key}`)).toStrictEqual(
			await refusedWith(`Bearer bgz_${'A'.repeat(43)}`)
		);
	});

	it('admits a live key with the scheme in any case', async () => {
		const key = await apiKey();

		const response = await giftsRoute(
			new Request(GIFTS, {
				headers: { authorization: `bearer  ${key}`, 'cf-connecting-ip': address() }
			})
		);

		expect(response.status).toBe(200);
		expect(((await response.json()) as Page).data).toHaveLength(1);
	});
});

describe('a method other than GET', () => {
	it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
		'is %s refused with 405, naming GET and HEAD',
		async (method) => {
			const key = await apiKey();

			const response = await giftsRoute(new Request(GIFTS, { method, ...bearer(key) }));

			expect(response.status).toBe(405);
			expect(response.headers.get('allow')).toBe('GET, HEAD');
			expect(await response.json()).toMatchObject({ error: 'method_not_allowed' });
		}
	);
});

describe('the bare surface address', () => {
	it('answers a keyed request with a 404 naming the surface', async () => {
		const key = await apiKey();

		const response = await surfaceRoute(new Request(`${OWN}/integrations/v1`, bearer(key)));

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({
			error: 'not_found',
			fix: 'Call an endpoint on it, such as GET /integrations/v1/gifts.'
		});
	});

	it('checks the key there too', async () => {
		const response = await surfaceRoute(
			new Request(`${OWN}/integrations/v1`, { headers: { 'cf-connecting-ip': address() } })
		);

		expect(response.status).toBe(401);
	});
});

/** asks with `init` until refused, and answers the refusal; fails if `asks` are all answered. */
async function askUntilRefused(init: RequestInit, asks = 10): Promise<Response> {
	for (let ask = 0; ask < asks; ask++) {
		const response = await giftsRoute(new Request(GIFTS, init));
		if (response.status === 429) return response;
	}
	throw new Error(`${asks} asks and none refused`);
}

describe('the rate limit on each key', () => {
	it('holds each key to a budget of its own, so a spent key slows no other', async () => {
		const spent = await apiKey();
		const other = await apiKey();

		await askUntilRefused(bearer(spent));

		expect((await giftsRoute(new Request(GIFTS, bearer(other)))).status).toBe(200);
		expect((await giftsRoute(new Request(GIFTS, bearer(spent)))).status).toBe(429);
	});

	it('refuses a spent key with a 429 that says when to retry and names the per-key limit', async () => {
		const refused = await askUntilRefused(bearer(await apiKey()));

		expect(refused.headers.get('retry-after')).toBe('60');
		expect(refused.headers.get('cache-control')).toBe('no-store');
		const body = (await refused.json()) as Refusal;
		expect(body.error).toBe('rate_limited');
		expect(body.message).toContain('120 requests a minute, which is counted per key');
	});
});

describe('the rate limit on each address', () => {
	const malformed = (): RequestInit => ({
		headers: { authorization: 'Bearer bgk_x7Qp', 'cf-connecting-ip': address() }
	});

	it('is spent by a key that never reaches the lookup, and refuses with a 429 naming the per-address limit', async () => {
		const refused = await askUntilRefused(malformed(), 40);

		expect(refused.headers.get('retry-after')).toBe('60');
		expect(refused.headers.get('cache-control')).toBe('no-store');
		const body = (await refused.json()) as Refusal;
		expect(body.error).toBe('rate_limited');
		expect(body.message).toContain('600 requests a minute, which is counted per address');
	});

	it('skips a caller the edge gave no address, rather than pooling every such caller in one bucket', async () => {
		const unattributed = { headers: { authorization: 'Bearer bgk_x7Qp' } };
		const statuses = new Set<number>();

		for (let ask = 0; ask < 40; ask++)
			statuses.add((await giftsRoute(new Request(GIFTS, unattributed))).status);

		expect([...statuses]).toEqual([401]);
	});

	it('refuses a live key from a spent address, and answers it from another', async () => {
		const key = await apiKey();
		await askUntilRefused(malformed(), 40);

		expect((await giftsRoute(new Request(GIFTS, bearer(key)))).status).toBe(429);
		caller += 1;
		expect((await giftsRoute(new Request(GIFTS, bearer(key)))).status).toBe(200);
	});
});

/** reads `init` as a key would and waits out what the read left running after its answer. */
async function readAndSettle(init: RequestInit, options: { env?: Env } = {}): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await giftsRoute(new Request(GIFTS, init), { ...options, ctx });
	await waitOnExecutionContext(ctx);
	return response;
}

async function lastUsed(id: string): Promise<Date | null> {
	const [row] = await db
		.select({ lastUsedAt: apiKeyTable.lastUsedAt })
		.from(apiKeyTable)
		.where(eq(apiKeyTable.id, id));
	if (row === undefined) throw new Error(`no key ${id}`);
	return row.lastUsedAt;
}

describe('when a key was last used', () => {
	it('is recorded on a use, and stays unwritten on a key never used', async () => {
		const used = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
		const unused = await mintApiKey(db, { name: 'Warehouse', kind: 'api' });
		const before = Date.now();

		expect((await readAndSettle(bearer(used.key))).status).toBe(200);

		expect((await lastUsed(used.id))?.getTime()).toBeGreaterThanOrEqual(before);
		expect(await lastUsed(unused.id)).toBeNull();
	});

	it('moves on a use more than a minute after the last', async () => {
		const minted = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
		await db
			.update(apiKeyTable)
			.set({ lastUsedAt: new Date(Date.now() - 120_000) })
			.where(eq(apiKeyTable.id, minted.id));
		const before = Date.now();

		await readAndSettle(bearer(minted.key));

		expect((await lastUsed(minted.id))?.getTime()).toBeGreaterThanOrEqual(before);
	});

	it('is written after the gifts are read, so the answer never waits on it', async () => {
		const minted = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
		const statements: string[] = [];

		await readAndSettle(bearer(minted.key), { env: envWatchingStatements(statements) });

		const write = statements.findIndex((sql) => /^update "api_key"/i.test(sql));
		const giftsRead = statements.findIndex((sql) => /from "payment"/i.test(sql));
		expect(giftsRead).toBeGreaterThan(-1);
		expect(write).toBeGreaterThan(giftsRead);
	});

	it('writes nothing on a second use inside the minute', async () => {
		const minted = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
		const statements: string[] = [];
		const watched = { env: envWatchingStatements(statements) };
		const writes = () => statements.filter((sql) => /^update "api_key"/i.test(sql));

		await readAndSettle(bearer(minted.key), watched);
		const first = await lastUsed(minted.id);
		expect(writes()).toHaveLength(1);

		await readAndSettle(bearer(minted.key), watched);

		expect(writes()).toHaveLength(1);
		expect(await lastUsed(minted.id)).toEqual(first);
	});
});

/**
 * the pool's env with `write` run once, after the statement that reads a walk of changes' order
 * and before the next statement runs — the moment between the two reads of a page of gifts.
 */
function envWritingAfterTheOrder(write: () => Promise<void>): Env {
	let ordered = false;
	let written: Promise<void> | undefined;
	const gated = (statement: D1PreparedStatement, orders: boolean): D1PreparedStatement =>
		new Proxy(statement, {
			get(target, property) {
				const value: unknown = Reflect.get(target, property);
				if (typeof value !== 'function') return value;
				if (property === 'bind')
					return (...values: unknown[]) => gated(target.bind(...values), orders);
				return async (...args: unknown[]) => {
					if (ordered) {
						written ??= write();
						await written;
					}
					const answer: unknown = await value.apply(target, args);
					if (orders) ordered = true;
					return answer;
				};
			}
		});
	const db = new Proxy(env.DB, {
		get(target, property) {
			if (property === 'prepare')
				return (sql: string) => gated(target.prepare(sql), /\) "changes"/.test(sql));
			const value: unknown = Reflect.get(target, property);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	return new Proxy(env, {
		get: (target, property) => (property === 'DB' ? db : Reflect.get(target, property))
	}) as Env;
}

/**
 * the pool's env with every statement prepared on its D1 pushed onto `statements`, and run there
 * unchanged. proxies rather than copies: `env` is the runtime's own object, and a spread keeps
 * only its enumerable members.
 */
function envWatchingStatements(statements: string[]): Env {
	const watched = new Proxy(env.DB, {
		get(target, property) {
			if (property === 'prepare')
				return (sql: string) => {
					statements.push(sql);
					return target.prepare(sql);
				};
			const value: unknown = Reflect.get(target, property);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	return new Proxy(env, {
		get: (target, property) => (property === 'DB' ? watched : Reflect.get(target, property))
	}) as Env;
}
