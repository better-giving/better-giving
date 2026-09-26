import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postableId } from '$lib/server/db/accounts';
import { createDb, type Db } from '$lib/server/db/client';
import { contact, donation, orgProfile, payment } from '$lib/server/db/schema';
import { post, postingStatements } from '$lib/server/ledger/posting';
import { makeZapierKey, replaceZapierKey } from '$lib/server/zapier/key';
import {
	donorEventOf,
	readGiftEvents,
	readRefundEvents,
	type GiftEvent
} from '$lib/server/zapier/payload';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as surface from './zapier';
import * as hooks from './zapier.hooks';
import * as hook from './zapier.hooks.$id';
import * as me from './zapier.me';
import * as samples from './zapier.samples.$trigger';

// what Zapier's servers call, against a real D1 and through the surface's own layout — so the
// rate limit and the key check stand in front of every case exactly as they do deployed
// (../route-request.testing.ts).

const OWN = 'https://give.example.workers.dev';

const meRoute: RouteRequester = mountRoutes([
	{ path: 'zapier', module: surface },
	{ path: 'me', module: me }
]);

const hooksRoute: RouteRequester = mountRoutes([
	{ path: 'zapier', module: surface },
	{ path: 'hooks', module: hooks }
]);

const hookRoute: RouteRequester = mountRoutes([
	{ path: 'zapier', module: surface },
	{ path: 'hooks/:id', module: hook }
]);

const unsubscribe = (id: string) =>
	hookRoute(new Request(`${OWN}/zapier/hooks/${id}`, withKey(key, { method: 'DELETE' })));

const samplesRoute: RouteRequester = mountRoutes([
	{ path: 'zapier', module: surface },
	{ path: 'samples/:trigger', module: samples }
]);

const samplesOf = (trigger: string) =>
	samplesRoute(new Request(`${OWN}/zapier/samples/${trigger}`, withKey(key)));

const HOOK = 'https://hooks.zapier.com/hooks/standard/1/2/3/';

/** the id a `new_gift` subscribe for `hookUrl` answers with. */
async function subscribedId(hookUrl: string): Promise<string> {
	const response = await subscribeWith({ trigger: 'new_gift', hook_url: hookUrl });
	return ((await response.json()) as { id: string }).id;
}

const subscribeWith = (body: unknown, presented: string | null = key) =>
	hooksRoute(
		new Request(
			`${OWN}/zapier/hooks`,
			withKey(presented, { method: 'POST', body: JSON.stringify(body) })
		)
	);

let db: Db;
let key: string;
/**
 * the address each case arrives from, a fresh one per case: the pool's `API_RATE_LIMITER` is the
 * real binding with a small bucket (../../vitest.workers.config.ts), and cases sharing one would
 * spend it for each other.
 */
let caller = 0;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	for (const table of [
		'zapier_delivery',
		'zapier_subscription',
		'zapier_key',
		'org_profile',
		'ledger_entry',
		'entry_group',
		'payment',
		'donation',
		'contact'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	const made = await makeZapierKey(db);
	if (!made.ok) throw new Error('a first make was refused');
	key = made.key;
	caller += 1;
});

const withKey = (presented: string | null, init: RequestInit = {}): RequestInit => ({
	...init,
	headers: {
		'content-type': 'application/json',
		'cf-connecting-ip': `203.0.113.${caller}`,
		...(presented === null ? {} : { authorization: `Bearer ${presented}` })
	}
});

describe('the connection test', () => {
	it('answers with the organisation the key belongs to', async () => {
		await db.insert(orgProfile).values({ id: 'default', legalName: 'Riverside Food Bank' });

		const response = await meRoute(new Request(`${OWN}/zapier/me`, withKey(key)));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ organisation: 'Riverside Food Bank' });
	});
});

describe('a request without this deployment\u2019s key', () => {
	it.each([
		['no key', null],
		['a garbled key', 'bgz_not-a-key'],
		['a key that was never made', `bgz_${'A'.repeat(43)}`]
	])('is turned away with the same 401 for %s', async (_what, presented) => {
		const response = await meRoute(new Request(`${OWN}/zapier/me`, withKey(presented)));

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(await refusalBody());
	});

	it.each([
		['subscribing', () => subscribeWith({ trigger: 'new_gift', hook_url: `${HOOK}new/` }, null)],
		[
			'unsubscribing',
			() =>
				hookRoute(
					new Request(`${OWN}/zapier/hooks/${standing}`, withKey(null, { method: 'DELETE' }))
				)
		],
		[
			'reading samples',
			() => samplesRoute(new Request(`${OWN}/zapier/samples/new_gift`, withKey(null)))
		]
	])('is turned away from %s with the same 401 and nothing changed', async (_what, send) => {
		standing = await subscribedId(HOOK);
		const before = await subscriptionTable();

		const response = await send();

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(await refusalBody());
		expect(await subscriptionTable()).toEqual(before);
	});

	it('is turned away once the key it carries has been replaced', async () => {
		await replaceZapierKey(db, async () => new Response(null, { status: 200 }));

		const response = await meRoute(new Request(`${OWN}/zapier/me`, withKey(key)));

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual(await refusalBody());
	});
});

/** the subscription a keyless case tries to end, opened by that case under the key. */
let standing = '';

async function subscriptionTable() {
	const { results } = await env.DB.prepare(
		'select id, trigger, hook_url, ended_at, ended_reason from zapier_subscription order by id'
	).all();
	return results;
}

describe('subscribing a Zap', () => {
	it('opens a subscription and answers with its id', async () => {
		const response = await subscribeWith({ trigger: 'new_gift', hook_url: HOOK });

		expect(response.status).toBe(201);
		const { id } = (await response.json()) as { id: string };
		const { results } = await env.DB.prepare(
			'select id, trigger, hook_url from zapier_subscription where ended_at is null'
		).all();
		expect(results).toEqual([{ id, trigger: 'new_gift', hook_url: HOOK }]);
	});

	it('stores the hook address as parsed, so two spellings of one hook are one row', async () => {
		const response = await subscribeWith({
			trigger: 'new_gift',
			hook_url: 'HTTPS://Hooks.Zapier.com:443/hooks/standard/1/2/3/'
		});

		expect(response.status).toBe(201);
		expect((await subscribeWith({ trigger: 'new_gift', hook_url: HOOK })).status).toBe(200);
		const { results } = await env.DB.prepare('select hook_url from zapier_subscription').all();
		expect(results).toEqual([{ hook_url: HOOK }]);
	});

	it('answers a repeated subscribe with the id it already has', async () => {
		const first = await subscribedId(HOOK);

		const again = await subscribeWith({ trigger: 'new_gift', hook_url: HOOK });

		expect(again.status).toBe(200);
		expect(await again.json()).toEqual({ id: first });
	});
});

describe('unsubscribing a Zap', () => {
	it('ends that subscription and no other', async () => {
		const leaving = await subscribedId(HOOK);
		await subscribeWith({ trigger: 'new_donor', hook_url: `${HOOK}other/` });

		const response = await unsubscribe(leaving);

		expect(response.status).toBe(204);
		const { results } = await env.DB.prepare(
			'select id, ended_reason from zapier_subscription where ended_at is not null'
		).all();
		expect(results).toEqual([{ id: leaving, ended_reason: 'unsubscribed' }]);
		expect(await openSubscriptions()).toBe(1);
	});

	it('answers 204 for an id it has never heard of', async () => {
		expect((await unsubscribe('0199a0a0-0000-7000-8000-000000000000')).status).toBe(204);
	});
});

describe('a subscribe this deployment refuses', () => {
	it.each([
		['a host that is not Zapier', 'https://hooks.example.com/catch/1/'],
		['plain http', 'http://hooks.zapier.com/hooks/standard/1/2/3/'],
		['a Zapier lookalike', 'https://hooks.zapier.com.example.net/1/'],
		['no URL at all', 'hooks.zapier.com'],
		['a user in the address', 'https://someone@hooks.zapier.com/hooks/standard/1/2/3/'],
		['a port of its own', 'https://hooks.zapier.com:8443/hooks/standard/1/2/3/']
	])('refuses %s with a 422 naming it', async (_what, hookUrl) => {
		const response = await subscribeWith({ trigger: 'new_gift', hook_url: hookUrl });

		expect(response.status).toBe(422);
		expect(JSON.stringify(await response.json())).toContain(hookUrl);
		expect(await openSubscriptions()).toBe(0);
	});

	it('refuses a trigger it does not have, listing the ones it does', async () => {
		const response = await subscribeWith({ trigger: 'new_refund', hook_url: HOOK });

		expect(response.status).toBe(422);
		const body = JSON.stringify(await response.json());
		expect(body).toContain('new_refund');
		expect(body).toContain('new_gift');
		expect(body).toContain('new_donor');
		expect(await openSubscriptions()).toBe(0);
	});

	it('refuses a body that is not JSON', async () => {
		const response = await hooksRoute(
			new Request(`${OWN}/zapier/hooks`, withKey(key, { method: 'POST', body: 'trigger=new_gift' }))
		);

		expect(response.status).toBe(400);
		expect(await openSubscriptions()).toBe(0);
	});
});

async function openSubscriptions(): Promise<number> {
	const row = await env.DB.prepare(
		'select count(*) as open from zapier_subscription where ended_at is null'
	).first<{ open: number }>();
	return row?.open ?? 0;
}

describe('the samples the Zap editor shows', () => {
	it.each([
		['new_gift', (gift: GiftEvent): unknown => gift],
		['new_donor', donorEventOf]
	] as const)('have exactly the fields a live %s event has', async (trigger, eventOf) => {
		const paymentId = await settledGift();
		const live = (await readGiftEvents(db, [paymentId])).get(paymentId);
		if (live === undefined) throw new Error('the gift rendered no event');

		const response = await samplesOf(trigger);

		expect(response.status).toBe(200);
		const { data } = (await response.json()) as { data: unknown[] };
		expect(data).toHaveLength(1);
		expect(fieldsOf(data[0])).toEqual(fieldsOf(eventOf(live)));
	});

	it('answers gift_refunded with the live refund event, never a gift', async () => {
		const giftId = await settledGift();
		const refundId = await refundOf(giftId);
		const live = (await readRefundEvents(db, [refundId])).get(refundId);
		if (live === undefined) throw new Error('the refund rendered no event');

		const response = await samplesOf('gift_refunded');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: [live] });
	});

	it('refuses a trigger it does not have, listing the ones it does', async () => {
		const response = await samplesOf('new_refund');

		expect(response.status).toBe(422);
		const body = JSON.stringify(await response.json());
		expect(body).toContain('new_refund');
		expect(body).toContain('new_gift');
	});
});

/** every key path in `value`, nested objects included — the fields a Zap can map. */
function fieldsOf(value: unknown, at = ''): string[] {
	if (value === null || typeof value !== 'object') return [];
	return Object.entries(value)
		.flatMap(([name, inner]) => [`${at}${name}`, ...fieldsOf(inner, `${at}${name}.`)])
		.sort();
}

/** a settled one-off gift, posted to the books as a settlement posts it, answered with its payment id. */
async function settledGift(): Promise<string> {
	const [contactId, donationId, paymentId] = [uuidv7(), uuidv7(), uuidv7()];
	const at = new Date('2026-09-10T12:00:00.000Z');
	await db.batch([
		db.insert(contact).values({ id: contactId, kind: 'individual', displayName: 'Ada Okafor' }),
		db.insert(donation).values({
			id: donationId,
			contactId,
			totalMinor: 5_000,
			currency: 'USD',
			receivedAt: at
		}),
		db.insert(payment).values({
			id: paymentId,
			donationId,
			amountMinor: 5_000,
			currency: 'USD',
			direction: 'inbound',
			method: 'check',
			status: 'succeeded',
			provider: 'manual',
			occurredAt: at
		}),
		...postingStatements(
			db,
			post({
				sourceType: 'payment',
				sourceId: paymentId,
				currency: 'USD',
				occurredAt: at,
				memo: null,
				lines: [
					{ accountId: postableId('undepositedFunds'), amountMinor: 5_000 },
					{ accountId: postableId('donationsDeductible'), amountMinor: -5_000 }
				]
			})
		)
	]);
	return paymentId;
}

/** $20 of gift `giftId` refunded, and the refund row's id. */
async function refundOf(giftId: string): Promise<string> {
	const [gift] = await db
		.select({ donationId: payment.donationId })
		.from(payment)
		.where(eq(payment.id, giftId));
	const id = uuidv7();
	await db.insert(payment).values({
		id,
		donationId: gift?.donationId ?? '',
		amountMinor: 2_000,
		currency: 'USD',
		direction: 'refund',
		method: 'check',
		status: 'succeeded',
		provider: 'manual',
		occurredAt: new Date('2026-09-12T12:00:00.000Z'),
		parentPaymentId: giftId
	});
	return id;
}

describe('a caller over the limit', () => {
	it('is refused once its keyless requests have spent the bucket', async () => {
		const statuses: number[] = [];
		for (let sent = 0; sent < 30 && !statuses.includes(429); sent += 1) {
			statuses.push((await meRoute(new Request(`${OWN}/zapier/me`, withKey(null)))).status);
		}

		expect(statuses[0]).toBe(401);
		expect(statuses.at(-1)).toBe(429);
	});

	it('still serves the key from an address keyless callers spent', async () => {
		for (let sent = 0; sent < 30; sent += 1) {
			await meRoute(new Request(`${OWN}/zapier/me`, withKey(null)));
		}

		expect((await meRoute(new Request(`${OWN}/zapier/me`, withKey(key)))).status).toBe(200);
	});

	it('never charges a caller holding the key', async () => {
		const statuses: number[] = [];
		for (let sent = 0; sent < 30; sent += 1) {
			statuses.push((await meRoute(new Request(`${OWN}/zapier/me`, withKey(key)))).status);
		}

		expect(new Set(statuses)).toEqual(new Set([200]));
	});
});

/** the body every refusal carries, read off one refusal so the cases compare answers, not text. */
async function refusalBody(): Promise<unknown> {
	const body = (await (await meRoute(new Request(`${OWN}/zapier/me`, withKey(null)))).json()) as {
		message: string;
	};
	expect(body.message).toContain('Authorization: Bearer');
	return body;
}
