import { createExecutionContext, env } from 'cloudflare:test';
import { createStaticHandler, type LoaderFunction } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readQuickbooksConnection } from '$lib/server/accounting/connection';
import { createDb, type Db } from '$lib/server/db/client';
import {
	failed,
	type AccountingProvider,
	type AccountingResult,
	type CompanyIdentity,
	type TokenPair
} from '$lib/server/accounting/provider';
import { requestContext } from '../request-context';
import * as callback from './quickbooks.callback';
import type { Route } from './+types/quickbooks.callback';

// the trip back from Intuit, answered inside workerd against a real D1.
//
// a workers spec because what every case here is about is the row: that a refused round trip writes
// nothing at all, and that one that landed leaves a connection carrying the realm Intuit named. the
// provider is stood in for because nothing here is about Intuit's wire —
// $lib/server/accounting/quickbooks.spec.ts holds that side — and a refusal is handed over as the
// port's own `failed(...)` so the two cannot disagree about what a reason is called.
//
// the loader is run through react router's own matcher rather than called, so a refusal's status
// and the `set-cookie` it carries are read off the context the framework builds — the same reason
// ./$formId.workers.spec.ts gives.

const OWN = 'https://give.example.workers.dev';
const REALM = '4620816365';
const STATE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2';

const TOKENS: TokenPair = {
	accessToken: 'access-one',
	accessTokenExpiresAt: new Date('2026-03-01T11:00:00.000Z'),
	refreshToken: 'refresh-one',
	refreshTokenExpiresAt: new Date('2026-06-01T10:00:00.000Z')
};

/** what the port answers this route, per case. the real adapter is never reached. */
const stub = vi.hoisted(() => ({
	exchanged: null as AccountingResult<TokenPair> | null,
	company: null as AccountingResult<CompanyIdentity> | null,
	exchanges: 0
}));

vi.mock('$lib/server/accounting/factory', () => ({
	createAccountingProvider: (): AccountingProvider => {
		// every arm, so the stub is the port rather than a cast over part of it — and the four this
		// route never calls refuse loudly, which is what turns a route that reached for one into a
		// failing case instead of an undefined.
		const unasked = async () => failed('internal_error', 'this route does not call this arm');
		return {
			exchangeCode: async () => {
				stub.exchanges += 1;
				return stub.exchanged ?? failed('internal_error', 'no case set an exchange');
			},
			readCompany: async () => stub.company ?? failed('internal_error', 'no case set a company'),
			listAccounts: unasked,
			sendGift: unasked,
			sendCorrection: unasked,
			revokeTokens: unasked
		};
	}
}));

let db: Db;

beforeEach(async () => {
	db = createDb(env.DB);
	await env.DB.prepare('delete from quickbooks_connection').run();
	stub.exchanged = { ok: true, value: TOKENS };
	stub.company = { ok: true, value: { realmId: REALM, companyName: 'Hope Foundation' } };
	stub.exchanges = 0;
});

const ROUTE_ID = 'quickbooks-callback';
const handler = createStaticHandler([
	{
		id: ROUTE_ID,
		path: 'quickbooks/callback',
		loader: callback.loader as unknown as LoaderFunction
	}
]);

type LoaderData = Route.ComponentProps['loaderData'];

/** the trip back, as Intuit makes it: a code, the realm it is for, and the `state` that went out. */
async function back(
	query: Record<string, string> = { code: 'intuit-code', realmId: REALM, state: STATE },
	cookie: string | null = `quickbooks_connect_state=${STATE}`
): Promise<{ status: number; data: LoaderData; headers: Headers }> {
	const url = new URL(`${OWN}/quickbooks/callback`);
	for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
	const answered = await handler.query(
		new Request(url, { headers: cookie === null ? {} : { cookie } }),
		{ requestContext: requestContext(env, createExecutionContext()) }
	);
	if (answered instanceof Response) throw new Error(`the loader short-circuited`);
	return {
		status: answered.statusCode,
		data: answered.loaderData[ROUTE_ID] as LoaderData,
		headers: answered.loaderHeaders[ROUTE_ID] ?? new Headers()
	};
}

describe('GET /quickbooks/callback', () => {
	it('connects the company Intuit named and labels it with what it is called', async () => {
		const answered = await back();

		expect(answered.status).toBe(200);
		expect(answered.data).toEqual({ outcome: 'connected', companyName: 'Hope Foundation' });
		expect(await readQuickbooksConnection(db)).toMatchObject({
			realmId: REALM,
			companyName: 'Hope Foundation'
		});
	});

	it('leaves the connection standing where the company name could not be read', async () => {
		stub.company = failed('rate_limited', 'Intuit is throttling this app.');

		const answered = await back();

		expect(answered.data).toEqual({ outcome: 'connected', companyName: null });
		expect(await readQuickbooksConnection(db)).toMatchObject({ realmId: REALM, companyName: null });
	});

	it('spends the state cookie whether the trip landed or not', async () => {
		const landed = await back();
		expect(landed.headers.get('set-cookie')).toContain('Max-Age=0');

		const refused = await back({ code: 'intuit-code', realmId: REALM }, null);
		expect(refused.headers.get('set-cookie')).toContain('Max-Age=0');
	});

	it('refuses a browser carrying no state cookie, and exchanges nothing', async () => {
		const answered = await back({ code: 'intuit-code', realmId: REALM, state: STATE }, null);

		expect(answered.status).toBe(403);
		expect(answered.data).toMatchObject({ outcome: 'refused', refusal: 'state' });
		expect(stub.exchanges).toBe(0);
		expect(await readQuickbooksConnection(db)).toBeNull();
	});

	it('refuses a state that is not the one that went out', async () => {
		const answered = await back(
			{ code: 'intuit-code', realmId: REALM, state: STATE },
			'quickbooks_connect_state=someone-elses-state'
		);

		expect(answered.status).toBe(403);
		expect(stub.exchanges).toBe(0);
		expect(await readQuickbooksConnection(db)).toBeNull();
	});

	it('refuses a trip back carrying no company to connect', async () => {
		const answered = await back({ code: 'intuit-code', state: STATE });

		expect(answered.status).toBe(400);
		expect(answered.data).toMatchObject({ outcome: 'refused', refusal: 'request' });
		expect(stub.exchanges).toBe(0);
		expect(await readQuickbooksConnection(db)).toBeNull();
	});

	it('refuses a trip back carrying no code', async () => {
		const answered = await back({ realmId: REALM, state: STATE });

		expect(answered.status).toBe(400);
		expect(stub.exchanges).toBe(0);
		expect(await readQuickbooksConnection(db)).toBeNull();
	});

	it('writes nothing where the code could not be exchanged, and says what Intuit answered', async () => {
		stub.exchanged = failed('reconnect_needed', 'Intuit refused the authorization code.');

		const answered = await back();

		expect(answered.status).toBe(502);
		expect(answered.data).toEqual({
			outcome: 'refused',
			refusal: 'exchange',
			detail: 'Intuit refused the authorization code.'
		});
		expect(await readQuickbooksConnection(db)).toBeNull();
	});
});
