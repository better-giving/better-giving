import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { run, first, stmt } from '$lib/server/db/database.testing';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { readEnv } from '$lib/server/runtime/env';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';
import { mountRoutes } from '../route-request.testing';
import * as surface from './api.v1';
import * as estimate from './api.v1.forms.$id.estimate';

// a db spec because the CORS echo is read off the form's `allowed_origins` column. the coin list and
// the estimate come from the real NOWPayments adapter behind a scripted `fetch`, and the list is kept
// in the process's cache under `__payable-coins`, which every case clears. driven through the layout,
// so every case pays the surface meter and arrives from an address of its own.

const surfaceRoutes = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/estimate', module: estimate }
]);

const FORM_ID = 'frm_estimateroute01';
const ALLOWED = 'https://acme.org';
const ORIGIN = 'https://give.example.org';
const COIN_KEY = new Request(`${ORIGIN}/__payable-coins`);

const NOWPAYMENTS = {
	NOWPAYMENTS_API_KEY: 'notarealnowpaymentskey',
	NOWPAYMENTS_OUTCOME_CURRENCY: 'btc',
	NOWPAYMENTS_IPN_SECRET: 'notarealipnsecret'
};

const BTC = {
	code: 'BTC',
	name: 'Bitcoin',
	enable: true,
	network: 'btc',
	ticker: 'btc',
	extra_id_exists: false,
	extra_id_optional: false,
	available_for_payment: true
};

let addresses = 0;
function nextAddress(): string {
	addresses += 1;
	return `198.51.100.${addresses % 250}`;
}

/** the paths NOWPayments was asked for, in order. */
let asked: string[] = [];

/** an account enabling BTC alone, whose estimate answers `estimated` for any amount of it. */
function accountPricing(estimated: Response | (() => Response)): void {
	asked = [];
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		const url = new URL(request.url);
		asked.push(`${url.pathname}${url.search}`);
		if (url.pathname === '/v1/merchant/coins')
			return Response.json({ selectedCurrencies: ['BTC'] });
		if (url.pathname === '/v1/full-currencies') return Response.json({ currencies: [BTC] });
		if (url.pathname === '/v1/estimate') {
			return typeof estimated === 'function' ? estimated() : estimated.clone();
		}
		return Response.json({ message: 'unscripted' }, { status: 500 });
	});
}

function get(
	query: Record<string, string>,
	headers: Record<string, string> = {},
	{ method = 'GET', id = FORM_ID, vars = NOWPAYMENTS as Record<string, string> } = {}
): Promise<Response> {
	const url = new URL(`${ORIGIN}/api/v1/forms/${id}/estimate`);
	for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
	const request = new Request(url, {
		method,
		headers: { [CLIENT_IP_HEADER]: nextAddress(), ...headers }
	});
	return surfaceRoutes(request, { env: { ...readEnv({}, specRateLimiters()), ...vars } as Env });
}

beforeAll(async () => {
	await run(stmt('delete from page'));
	await run(stmt('delete from form'));
	const account = await first<{ id: string }>(
		stmt(`select id from account where is_postable = 1 and code = '4110'`)
	);
	if (!account) throw new Error('no 4110 account in migrations/0000_initial_schema.sql');
	await run(
		stmt(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[2500]', ?, 0, 0)`,
			FORM_ID,
			account.id,
			JSON.stringify([ALLOWED])
		)
	);
});

afterEach(async () => {
	await edgeCache().delete(COIN_KEY);
});

const PRICED = Response.json({
	currency_from: 'btc',
	amount_from: 0.005,
	currency_to: 'usd',
	estimated_amount: '482.0961'
});

describe('GET /api/v1/forms/:id/estimate', () => {
	it('answers what an amount of a served coin is worth, in cents', async () => {
		accountPricing(PRICED);

		const response = await get({ coin: 'btc', amount: '0.005' });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ estimateMinor: 48210 });
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('lets a page the form names read it, and echoes nothing to another site', async () => {
		accountPricing(PRICED);

		const named = await get({ coin: 'btc', amount: '0.005' }, { origin: ALLOWED });
		const other = await get({ coin: 'btc', amount: '0.005' }, { origin: 'https://attacker.test' });

		expect(named.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(other.status).toBe(200);
		expect(other.headers.has('access-control-allow-origin')).toBe(false);
	});

	it('answers an id nothing matches as the config read does, echoing it to no other site', async () => {
		accountPricing(PRICED);

		const response = await get(
			{ coin: 'btc', amount: '0.005' },
			{ origin: ALLOWED },
			{ id: 'frm_nosuchformatall1' }
		);

		expect(response.status).toBe(404);
		expect(response.headers.has('access-control-allow-origin')).toBe(false);
		expect(await response.json()).toMatchObject({ error: 'form_not_found' });
		expect(asked).toEqual([]);
	});

	it('answers no estimate, asking NOWPayments nothing, where the deployment holds no keys for it', async () => {
		accountPricing(PRICED);

		const response = await get({ coin: 'btc', amount: '0.005' }, { origin: ALLOWED }, { vars: {} });

		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(await response.json()).toEqual({ estimateMinor: null });
		expect(asked).toEqual([]);
	});

	it('answers no estimate for a coin the deployment does not serve, pricing nothing', async () => {
		accountPricing(PRICED);

		const response = await get({ coin: 'sol', amount: '0.005' }, { origin: ALLOWED });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ estimateMinor: null });
		expect(asked.some((path) => path.startsWith('/v1/estimate'))).toBe(false);
	});

	it.each([
		['no amount', null],
		['an empty amount', ''],
		['an amount that is not a number', 'abc'],
		['a zero amount', '0'],
		['an amount longer than 32 characters', `0.${'1'.repeat(31)}`]
	])('answers no estimate, pricing nothing, for %s', async (_, amount) => {
		accountPricing(PRICED);

		const response = await get(
			{ coin: 'btc', ...(amount === null ? {} : { amount }) },
			{ origin: ALLOWED }
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(await response.json()).toEqual({ estimateMinor: null });
		expect(asked.some((path) => path.startsWith('/v1/estimate'))).toBe(false);
	});

	it('prices an amount of exactly 32 characters', async () => {
		accountPricing(PRICED);

		const response = await get({ coin: 'btc', amount: `0.${'1'.repeat(30)}` });

		expect(await response.json()).toEqual({ estimateMinor: 48210 });
	});

	it.each([
		['a fault', () => Response.json({ message: 'Internal server error' }, { status: 500 })],
		[
			'no answer',
			() => {
				throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
			}
		]
	])('answers no estimate where NOWPayments gives %s', async (_, answer) => {
		accountPricing(answer);

		const response = await get({ coin: 'btc', amount: '0.005' }, { origin: ALLOWED });

		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(await response.json()).toEqual({ estimateMinor: null });
	});
});

describe('OPTIONS /api/v1/forms/:id/estimate', () => {
	const preflight = (origin: string) =>
		get(
			{ coin: 'btc', amount: '0.005' },
			{ origin, 'access-control-request-method': 'GET' },
			{ method: 'OPTIONS' }
		);

	it('grants a page the form names a GET', async () => {
		const response = await preflight(ALLOWED);

		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
	});

	it('grants another site nothing', async () => {
		const response = await preflight('https://attacker.test');

		expect(response.status).toBe(204);
		expect(response.headers.has('access-control-allow-origin')).toBe(false);
	});
});
