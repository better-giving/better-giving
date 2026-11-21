import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client, first, run, stmt } from '$lib/server/db/database.testing';
import { replaceTickers } from '$lib/server/donations/tickers';
import { disablePledgeRail, enablePledgeRail } from '$lib/server/payments/pledge-rails';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { readEnv } from '$lib/server/runtime/env';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';
import { mountRoutes } from '../route-request.testing';
import * as surface from './api.v1';
import * as tickers from './api.v1.forms.$id.tickers';

// a db spec because the CORS echo is read off the form's `allowed_origins` column, the rail off
// `pledge_rail` and the answer out of `ticker`. driven through the layout, so every case pays the
// surface meter and arrives from an address of its own.

const surfaceRoutes = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/tickers', module: tickers }
]);

const FORM_ID = 'frm_tickersroute001';
const ALLOWED = 'https://acme.org';

let addresses = 0;
function nextAddress(): string {
	addresses += 1;
	return `198.51.100.${addresses % 250}`;
}

function get(
	q: string | null,
	headers: Record<string, string> = {},
	{ method = 'GET', id = FORM_ID } = {}
): Request {
	const url = new URL(`https://give.example.org/api/v1/forms/${id}/tickers`);
	if (q !== null) url.searchParams.set('q', q);
	return new Request(url, { method, headers: { [CLIENT_IP_HEADER]: nextAddress(), ...headers } });
}

let db: Db;
beforeAll(async () => {
	db = createDb(client);
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
	await replaceTickers(db, [
		{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'Nasdaq', kind: 'company' },
		...Array.from({ length: 12 }, (_, n) => ({
			symbol: `AAPL${n}`,
			name: null,
			exchange: null,
			kind: 'fund' as const
		}))
	]);
});

let env: Env;
beforeEach(async () => {
	env = readEnv({}, specRateLimiters());
	await enablePledgeRail(db, {
		rail: 'stock',
		details: {
			brokerageName: 'Fidelity',
			dtcNumber: '0226',
			accountNumber: 'Z12345678',
			accountName: 'Hope Foundation'
		}
	});
});

describe('GET /api/v1/forms/:id/tickers', () => {
	it('answers at most eight tickers for what the donor typed, a fund with no name', async () => {
		const response = await surfaceRoutes(get('aapl'), { env });

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toHaveLength(8);
		expect(body.slice(0, 2)).toEqual([
			{ symbol: 'AAPL', name: 'Apple Inc.' },
			{ symbol: 'AAPL0', name: null }
		]);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('lets a page the form names read it, and echoes nothing to another site', async () => {
		const named = await surfaceRoutes(get('aapl', { origin: ALLOWED }), { env });
		const other = await surfaceRoutes(get('aapl', { origin: 'https://attacker.test' }), { env });

		expect(named.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(other.status).toBe(200);
		expect(other.headers.has('access-control-allow-origin')).toBe(false);
	});

	it('answers an id nothing matches as the config read does, echoing it to no other site', async () => {
		const response = await surfaceRoutes(
			get('aapl', { origin: ALLOWED }, { id: 'frm_nosuchformatall1' }),
			{ env }
		);

		expect(response.status).toBe(404);
		expect(response.headers.has('access-control-allow-origin')).toBe(false);
		expect(await response.json()).toMatchObject({
			error: 'form_not_found',
			message: expect.stringContaining('frm_nosuchformatall1')
		});
	});

	it.each([
		['no query', null],
		['an empty query', ''],
		['a query longer than 40 characters', `AAPL${' '.repeat(37)}`]
	])('answers an empty list to %s', async (_, q) => {
		const response = await surfaceRoutes(get(q, { origin: ALLOWED }), { env });

		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(await response.json()).toEqual([]);
	});

	it('searches a query of exactly 40 characters', async () => {
		const response = await surfaceRoutes(get(`AAPL${' '.repeat(36)}`), { env });

		expect((await response.json())[0]).toEqual({ symbol: 'AAPL', name: 'Apple Inc.' });
	});

	it('answers an empty list while the stock rail is off', async () => {
		await disablePledgeRail(db, 'stock');

		const response = await surfaceRoutes(get('aapl', { origin: ALLOWED }), { env });

		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(await response.json()).toEqual([]);
	});
});

describe('OPTIONS /api/v1/forms/:id/tickers', () => {
	it('grants a page the form names a GET', async () => {
		const response = await surfaceRoutes(
			get(
				'aapl',
				{ origin: ALLOWED, 'access-control-request-method': 'GET' },
				{ method: 'OPTIONS' }
			),
			{ env }
		);

		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
	});

	it('grants another site nothing', async () => {
		const response = await surfaceRoutes(
			get(
				'aapl',
				{ origin: 'https://attacker.test', 'access-control-request-method': 'GET' },
				{ method: 'OPTIONS' }
			),
			{ env }
		);

		expect(response.status).toBe(204);
		expect(response.headers.has('access-control-allow-origin')).toBe(false);
	});
});
