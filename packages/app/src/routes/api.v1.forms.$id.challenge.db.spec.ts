import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { first, run, stmt } from '$lib/server/db/database.testing';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { readEnv } from '$lib/server/runtime/env';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';
import { mountRoutes } from '../route-request.testing';
import * as surface from './api.v1';
import * as challenge from './api.v1.forms.$id.challenge';

// a db spec because the CORS echo is read off the form's `allowed_origins` column. driven through
// the layout, so every case pays the surface meter and arrives from an address of its own.

const surfaceRoutes = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/challenge', module: challenge }
]);

const FORM_ID = 'frm_challengeroute1';
const ALLOWED = 'https://acme.org';
const URL_ = `https://give.example.org/api/v1/forms/${FORM_ID}/challenge`;

let addresses = 0;
function nextAddress(): string {
	addresses += 1;
	return `198.51.100.${addresses % 250}`;
}

function get(headers: Record<string, string> = {}, method = 'GET'): Request {
	return new Request(URL_, { method, headers: { [CLIENT_IP_HEADER]: nextAddress(), ...headers } });
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

let env: Env;
beforeEach(() => {
	env = readEnv({}, specRateLimiters());
});

describe('GET /api/v1/forms/:id/challenge', () => {
	it('answers a challenge this deployment accepts once solved, uncached', async () => {
		const response = await surfaceRoutes(get(), { env });

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const issued = await response.json();
		const solution = await solveChallenge({ challenge: issued, deriveKey });
		const payload = btoa(JSON.stringify({ challenge: issued, solution }));
		expect(await env.ALTCHA.verify(payload)).toEqual({ ok: true });
	});

	it('lets a page the form names read it', async () => {
		const response = await surfaceRoutes(get({ origin: ALLOWED }), { env });

		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
	});

	it('issues nothing where Turnstile is the check', async () => {
		const turnstile = readEnv(
			{ TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' },
			specRateLimiters()
		);
		const response = await surfaceRoutes(get({ origin: ALLOWED }), { env: turnstile });

		expect(response.status).toBe(404);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
	});
});

describe('OPTIONS /api/v1/forms/:id/challenge', () => {
	it('grants a page the form names a GET', async () => {
		const response = await surfaceRoutes(
			get({ origin: ALLOWED, 'access-control-request-method': 'GET' }, 'OPTIONS'),
			{ env }
		);

		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
		expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
	});
});
