import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rateLimitRefusal } from '$lib/server/api/rate-limit';
import { mountRoutes } from '../route-request.testing';
import * as status from './api.v1.forms.$id.donations.$donationId';
import * as surface from './api.v1';

// a workers spec because every answer here is read off rows — the gift's payments and the form's
// `allowed_origins` — so a stand-in for D1 would be proving the stand-in (CLAUDE.md).
//
// driven through react router with the layout mounted above, as the config endpoint's spec is: the
// limit on this read is the layout's `middleware`, and a spec that called the loader would be a
// spec for an unmetered endpoint. each case arrives from an address of its own for that reason.

const surfaceRoutes = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/donations/:donationId', module: status }
]);

const FORM_ID = 'frm_statusendpoint1';
const OTHER_FORM_ID = 'frm_statusendpoint2';
const ALLOWED = 'https://acme.org';
const OWN = 'https://give.example.workers.dev';
const CONTACT_ID = '01900000-0000-7000-8000-00000000c0de';
const DONATION_ID = '01900000-0000-7000-8000-000000000001';

let revenueAccountId: string;
let nextAddress = 1;

beforeAll(async () => {
	const row = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id;
});

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare('delete from payment'),
		env.DB.prepare('delete from donation'),
		env.DB.prepare('delete from contact'),
		env.DB.prepare('delete from form')
	]);
	for (const id of [FORM_ID, OTHER_FORM_ID]) {
		await env.DB.prepare(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[2500]', ?, 0, 0)`
		)
			.bind(id, revenueAccountId, JSON.stringify([ALLOWED]))
			.run();
	}
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, created_at, updated_at)
		 values (?, 'individual', 'Status Donor', 0, 0)`
	)
		.bind(CONTACT_ID)
		.run();
});

async function insertGift(formId = FORM_ID): Promise<void> {
	await env.DB.prepare(
		`insert into donation (id, contact_id, total_minor, currency, received_at, form_id, created_at)
		 values (?, ?, 10000, 'USD', 0, ?, 0)`
	)
		.bind(DONATION_ID, CONTACT_ID, formId)
		.run();
}

/** one attempt on the gift. `id` doubles as its processor id. */
async function insertPayment(opts: {
	id: string;
	status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
	method?: 'crypto' | 'card';
	coinAmount?: string | null;
}): Promise<void> {
	const crypto = (opts.method ?? 'crypto') === 'crypto';
	await env.DB.prepare(
		`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
		                      provider, provider_txn_id, occurred_at, created_at,
		                      coin, coin_network, coin_amount, valid_until)
		 values (?, ?, 10000, 'USD', 'inbound', ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`
	)
		.bind(
			opts.id,
			DONATION_ID,
			opts.method ?? 'crypto',
			opts.status,
			crypto ? 'nowpayments' : 'stripe',
			crypto ? `${opts.id}` : `pi_${opts.id}`,
			crypto ? 'usdttrc20' : null,
			crypto ? 'trx' : null,
			opts.coinAmount ?? null,
			crypto ? 0 : null
		)
		.run();
}

function ask(
	path: string,
	{ origin, ip, method = 'GET' }: { origin?: string; ip?: string; method?: string } = {}
): Promise<Response> {
	const headers: Record<string, string> = {
		'cf-connecting-ip': ip ?? `203.0.113.${nextAddress++}`
	};
	if (origin !== undefined) headers.origin = origin;
	return surfaceRoutes(new Request(`${OWN}${path}`, { method, headers }), { env });
}

const statusOf = (donationId = DONATION_ID, formId = FORM_ID, options?: { origin?: string }) =>
	ask(`/api/v1/forms/${formId}/donations/${donationId}`, options);

describe('a crypto gift’s standing', () => {
	it('reads received once a payment on the gift succeeded', async () => {
		await insertGift();
		await insertPayment({ id: '5001', status: 'succeeded', coinAmount: '25.5' });

		const response = await statusOf();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ state: 'received' });
	});

	it('reads waiting while the address is watched and nothing has settled', async () => {
		await insertGift();
		await insertPayment({ id: '5002', status: 'pending' });

		const response = await statusOf();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ state: 'waiting' });
	});

	it.each(['cancelled', 'failed'] as const)(
		'reads expired once the attempt ended %s with nothing arrived',
		async (ended) => {
			await insertGift();
			await insertPayment({ id: '5003', status: ended });

			const response = await statusOf();

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ state: 'expired' });
		}
	);
});

describe('a gift this read does not answer for', () => {
	/** a refusal names the id it could not find, and a caller holding only a status learns nothing more. */
	async function expectNotFound(response: Response): Promise<void> {
		expect(response.status).toBe(404);
		const body = (await response.json()) as { message?: string; fix?: string; state?: unknown };
		expect(body.state).toBeUndefined();
		expect(body.message).toContain(DONATION_ID);
		expect(body.fix).toEqual(expect.any(String));
	}

	it('refuses an id no gift carries', async () => {
		await expectNotFound(await statusOf());
	});

	it('refuses a gift made on another form', async () => {
		await insertGift(OTHER_FORM_ID);
		await insertPayment({ id: '5004', status: 'succeeded', coinAmount: '1' });

		await expectNotFound(await statusOf());
	});

	it('refuses a gift that is not a crypto gift', async () => {
		await insertGift();
		await insertPayment({ id: '5005', status: 'succeeded', method: 'card' });

		await expectNotFound(await statusOf());
	});

	it('refuses an id that is not a gift id at all, naming it', async () => {
		const response = await statusOf('5001');

		expect(response.status).toBe(400);
		const body = (await response.json()) as { message?: string; fix?: string; state?: unknown };
		expect(body.state).toBeUndefined();
		expect(body.message).toContain('5001');
		expect(body.fix).toEqual(expect.any(String));
	});
});

describe('who may read the answer', () => {
	beforeEach(async () => {
		await insertGift();
		await insertPayment({ id: '5006', status: 'pending' });
	});

	it('grants the page on a site the form names', async () => {
		const response = await statusOf(DONATION_ID, FORM_ID, { origin: ALLOWED });

		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('grants nothing to a site the form does not name', async () => {
		const response = await statusOf(DONATION_ID, FORM_ID, { origin: 'https://elsewhere.example' });

		expect(response.headers.get('access-control-allow-origin')).toBeNull();
	});

	it('grants a GET to a preflight from a site the form names', async () => {
		const response = await ask(`/api/v1/forms/${FORM_ID}/donations/${DONATION_ID}`, {
			origin: ALLOWED,
			method: 'OPTIONS'
		});

		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
	});
});

describe('the limit on polling', () => {
	/** the pool's bucket is deliberately small (../../vitest.workers.config.ts), so this asks until refused. */
	it('answers a caller that polls too often with the surface’s shared refusal', async () => {
		await insertGift();
		await insertPayment({ id: '5007', status: 'pending' });

		let refused: Response | undefined;
		for (let i = 0; i < 50 && refused === undefined; i++) {
			const response = await ask(`/api/v1/forms/${FORM_ID}/donations/${DONATION_ID}`, {
				ip: '198.51.100.40'
			});
			if (response.status === 429) refused = response;
		}

		expect(refused?.headers.get('retry-after')).toBe('60');
		expect(await refused?.json()).toEqual(await rateLimitRefusal().json());
	});
});
