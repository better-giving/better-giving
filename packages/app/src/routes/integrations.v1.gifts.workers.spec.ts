import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import {
	contact,
	dispute,
	type DisputeOutcome,
	donation,
	type NewDonation,
	type NewPayment,
	payment
} from '$lib/server/db/schema';
import { mintApiKey, revokeApiKey } from '$lib/server/integrations/keys';
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
});

const bearer = (key: string): RequestInit => ({ headers: { authorization: `Bearer ${key}` } });

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

/** a $50 cheque from `contactId`, its money moved at noon on `day` of September 2026. */
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
	await db.insert(payment).values({
		id,
		donationId: gift.donationId,
		amountMinor,
		currency: 'USD',
		direction: 'refund',
		method: 'check',
		status: over.status ?? 'succeeded',
		provider: 'manual',
		occurredAt: new Date(Date.UTC(2026, 8, day, 12)),
		parentPaymentId: gift.paymentId
	});
	if (over.dispute !== undefined) {
		const closed = over.dispute === 'open' ? {} : { outcome: over.dispute, closedAt: new Date() };
		await db.insert(dispute).values({ paymentId: id, ...closed });
	}
}

type Page = { data: Record<string, unknown>[]; next_cursor: string | null };

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
			dispute_open: false
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

	it('answers no more than the first 50, the newest', async () => {
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
		expect(page.next_cursor).toBeNull();
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

		expect(await response.json()).toStrictEqual({ data: [], next_cursor: null });
	});

	it('is kept by no cache and readable by no page in a browser', async () => {
		const key = await apiKey();

		const response = await giftsRoute(new Request(GIFTS, bearer(key)));

		expect(response.headers.get('cache-control')).toBe('no-store');
		expect([...response.headers.keys()].filter((h) => h.startsWith('access-control-'))).toEqual([]);
	});
});

type Refusal = { error: string; message: string; fix: string };

/** a 401 from the key check, with its body, asserting what every one of them carries. */
async function refusedWith(authorization: string | null): Promise<Refusal> {
	const headers: Record<string, string> = authorization === null ? {} : { authorization };
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

	it('refuses Zapier’s key exactly as it refuses one never made', async () => {
		const zapier = await mintApiKey(db, { name: 'Zapier', kind: 'zapier' });

		expect(await refusedWith(`Bearer ${zapier.key}`)).toStrictEqual(
			await refusedWith(`Bearer bgk_${'A'.repeat(43)}`)
		);
	});

	it('admits a live key with the scheme in any case', async () => {
		const key = await apiKey();

		const response = await giftsRoute(
			new Request(GIFTS, { headers: { authorization: `bearer  ${key}` } })
		);

		expect(response.status).toBe(200);
		expect(((await response.json()) as Page).data).toHaveLength(1);
	});
});

describe('a method other than GET', () => {
	it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
		'is %s refused with 405, naming GET',
		async (method) => {
			const key = await apiKey();

			const response = await giftsRoute(new Request(GIFTS, { method, ...bearer(key) }));

			expect(response.status).toBe(405);
			expect(response.headers.get('allow')).toBe('GET');
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
		const response = await surfaceRoute(new Request(`${OWN}/integrations/v1`));

		expect(response.status).toBe(401);
	});
});
