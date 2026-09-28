import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RecurringPlanStatus } from '$lib/recurring/statuses';
import { createDb, type Db } from '$lib/server/db/client';
import { donation, recurringPlan } from '$lib/server/db/schema';
import { mintApiKey } from '$lib/server/integrations/keys';
import { stopRecurringPlan } from '$lib/server/recurring/queries';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as surface from './integrations.v1';
import * as gifts from './integrations.v1.gifts';
import * as recurringGifts from './integrations.v1.recurring-gifts';

// the recurring gifts an organisation's own system reads with a key, against a real D1 and through
// the surface's own layout. the key check, the method check and the rate limits in front of every
// list are ./integrations.v1.gifts.workers.spec.ts's to hold; this file holds what this list adds.

const OWN = 'https://give.example.workers.dev';
const RECURRING_GIFTS = `${OWN}/integrations/v1/recurring-gifts`;

const recurringRoute: RouteRequester = mountRoutes([
	{ path: 'integrations/v1', module: surface },
	{ path: 'recurring-gifts', module: recurringGifts }
]);

const giftsRoute: RouteRequester = mountRoutes([
	{ path: 'integrations/v1', module: surface },
	{ path: 'gifts', module: gifts }
]);

const FORM_ID = 'frm_integrations_recurring';

let db: Db;
/** a fresh address per case, for the reason the gifts spec gives for its own. */
let caller = 0;
const address = () => `192.0.2.${caller}`;
let donorId: string;

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
		'contact',
		'form'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	caller += 1;
	const revenue = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(FORM_ID, revenue?.id)
		.run();
	donorId = uuidv7();
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
		 values (?, 'individual', 'Ada Okafor', 'ada@example.org', 0, 0)`
	)
		.bind(donorId)
		.run();
});

/** a request with a key of its own, as the per-key bucket in the pool is three reads a minute. */
async function keyed(): Promise<RequestInit> {
	const { key } = await mintApiKey(db, { name: 'CRM sync', kind: 'api' });
	return { headers: { authorization: `Bearer ${key}`, 'cf-connecting-ip': address() } };
}

const noon = (day: number) => Date.UTC(2025, 8, day, 12);

/**
 * a $25 monthly gift from the seeded donor, its row written at noon on `day` of September 2025
 * and not touched since, written in raw SQL as `sole-inserter.spec.ts` asks of a fixture.
 */
async function seedPlan(
	day: number,
	over: {
		status?: RecurringPlanStatus;
		interval?: 'monthly' | 'yearly';
		amountMinor?: number;
		nextChargeAt?: number | null;
	} = {}
): Promise<string> {
	const id = uuidv7();
	const {
		status = 'active',
		interval = 'monthly',
		amountMinor = 2_500,
		nextChargeAt = Date.UTC(2025, 9, day, 12)
	} = over;
	await env.DB.prepare(
		`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
		                             status, provider, provider_subscription_id,
		                             provider_customer_id, started_at, next_charge_at, ended_at,
		                             created_at, updated_at)
		 values (?, ?, ?, ?, 'USD', ?, ?, 'stripe', ?, ?, ?, ?, ?, ?, ?)`
	)
		.bind(
			id,
			donorId,
			FORM_ID,
			amountMinor,
			interval,
			status,
			`sub_${id}`,
			`cus_${id}`,
			noon(day),
			status === 'active' ? nextChargeAt : null,
			status === 'active' ? null : noon(day),
			noon(day),
			noon(day)
		)
		.run();
	return id;
}

type Page = {
	data: Record<string, unknown>[];
	next_cursor: string | null;
	resume_updated_since: string | null;
};

describe('a key reading the first page of recurring gifts', () => {
	it('answers them newest first, each with its status as the dashboard names it', async () => {
		const active = await seedPlan(10);
		const stopped = await seedPlan(11, { status: 'cancelled' });
		const failed = await seedPlan(12, { status: 'lapsed', interval: 'yearly' });

		const response = await recurringRoute(new Request(RECURRING_GIFTS, await keyed()));

		expect(response.status).toBe(200);
		const page = (await response.json()) as Page;
		expect(page.next_cursor).toBeNull();
		expect(page.data.map((gift) => gift.id)).toEqual([failed, stopped, active]);
		expect(page.data.map((gift) => gift.status)).toEqual(['payment_failed', 'stopped', 'active']);
		expect(page.data[0]).toMatchObject({ frequency: 'yearly', next_charge_at: null });
		expect(page.data[2]).toStrictEqual({
			id: active,
			donor_id: donorId,
			amount: '25.00',
			amount_minor: 2_500,
			currency: 'USD',
			frequency: 'monthly',
			status: 'active',
			next_charge_at: '2025-10-10T12:00:00.000Z',
			started_at: '2025-09-10T12:00:00.000Z',
			updated_at: '2025-09-10T12:00:00.000Z'
		});
	});
});

describe('which recurring gifts are listed', () => {
	it('is every commitment /admin/recurring lists, and no one-off gift', async () => {
		const plan = await seedPlan(10);
		await db.insert(donation).values({
			contactId: donorId,
			totalMinor: 5_000,
			currency: 'USD',
			receivedAt: new Date(noon(11))
		});

		expect(idsOf(await walk(''))).toEqual([plan]);
		expect(idsOf(await walk('updated_since=2025-01-01T00:00:00Z'))).toEqual([plan]);
	});
});

/**
 * the recurring gifts `query` answers, and each page after by its `next_cursor` until one has
 * none — the gifts spec's walk, over this list.
 */
async function walk(
	query: string,
	between: (pagesRead: number) => Promise<void> = async () => {}
): Promise<Page[]> {
	const pages: Page[] = [];
	let cursor: string | null = null;
	do {
		const url = new URL(`${RECURRING_GIFTS}?${query}`);
		if (cursor !== null) url.searchParams.set('cursor', cursor);
		const response = await recurringRoute(new Request(url, await keyed()));
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

describe('a walk over every recurring gift, newest first', () => {
	it('answers each once, a page at a time, and one recorded mid-walk behind the cursor too', async () => {
		const seeded: string[] = [];
		for (let day = 10; day <= 14; day++) seeded.push(await seedPlan(day));
		let backDated: string | undefined;

		const pages = await walk('limit=2', async (read) => {
			if (read === 1) backDated = await seedPlan(11);
		});

		const ids = idsOf(pages);
		expect(pages.map((page) => page.data.length)).toEqual([2, 2, 2]);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.toSorted()).toEqual([...seeded, backDated].toSorted());
	});
});

describe('a walk over every change since an instant, oldest change first', () => {
	it('answers each once, and one recorded mid-walk once, after the rest', async () => {
		const seeded: string[] = [];
		for (let day = 10; day <= 14; day++) seeded.push(await seedPlan(day));
		let recorded: string | undefined;

		const pages = await walk('limit=2&updated_since=2025-09-01T00:00:00Z', async (read) => {
			if (read === 1) recorded = await seedPlan(20);
		});

		expect(idsOf(pages)).toEqual([...seeded, recorded]);
		expect(pages.flatMap((page) => page.data.map((gift) => gift.updated_at))).toEqual([
			'2025-09-10T12:00:00.000Z',
			'2025-09-11T12:00:00.000Z',
			'2025-09-12T12:00:00.000Z',
			'2025-09-13T12:00:00.000Z',
			'2025-09-14T12:00:00.000Z',
			'2025-09-20T12:00:00.000Z'
		]);
	});
});

/** every recurring gift changed at or after `since`, walked to the end. */
async function changedSince(since: string): Promise<Page['data']> {
	return (await walk(`updated_since=${since}`)).flatMap((page) => page.data);
}

describe('a read of what changed since the last walk', () => {
	it('answers a gift the organisation stopped since, stopped, and not one untouched since', async () => {
		const toStop = await seedPlan(10);
		const untouched = await seedPlan(11);
		const last = await seedPlan(12);
		const since = String((await changedSince('2025-09-01T00:00:00Z')).at(-1)?.updated_at);

		expect(await stopRecurringPlan(db, toStop, new Date())).toBe(true);

		const changed = await changedSince(since);
		expect(changed.map((gift) => gift.id)).toEqual([last, toStop]);
		expect(changed[1]).toMatchObject({ status: 'stopped', next_charge_at: null });
		expect(Date.parse(String(changed[1]?.updated_at))).toBeGreaterThan(Date.parse(since));
		expect(changed.map((gift) => gift.id)).not.toContain(untouched);
	});

	it('answers a gift whose payments failed since, as the processor gave up on it', async () => {
		const lapsing = await seedPlan(10);
		await seedPlan(11);
		const since = String((await changedSince('2025-09-01T00:00:00Z')).at(-1)?.updated_at);

		// `recordStanding`'s statement in $lib/server/donations/collect.ts, as the processor gives up
		await db
			.update(recurringPlan)
			.set({ status: 'lapsed', endedAt: new Date(), nextChargeAt: null })
			.where(and(eq(recurringPlan.id, lapsing), eq(recurringPlan.status, 'active')));

		const changed = await changedSince(since);
		expect(changed.at(-1)).toMatchObject({
			id: lapsing,
			status: 'payment_failed',
			next_charge_at: null
		});
		expect(Date.parse(String(changed.at(-1)?.updated_at))).toBeGreaterThan(Date.parse(since));
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
		const recurringSaid = await refusal(recurringRoute, 'recurring-gifts', query);
		const giftsSaid = await refusal(giftsRoute, 'gifts', query);

		expect(recurringSaid).toStrictEqual(giftsSaid);
	});

	it('refuses a cursor the gifts list issued, naming that list and to start without one', async () => {
		const giftsCursor = btoa(JSON.stringify(['gifts.newest', 0, 'x'])).replace(/=+$/, '');

		const body = await refusal(recurringRoute, 'recurring-gifts', `cursor=${giftsCursor}`);

		expect(body.error).toBe('invalid_cursor');
		expect(body.message).toContain('/integrations/v1/gifts');
		expect(body.fix).toContain('without a `cursor`');
	});
});
