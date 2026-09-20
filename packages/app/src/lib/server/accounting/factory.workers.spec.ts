import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '../db/client';
import { connectQuickbooks } from './connection';
import { createAccountingProvider } from './factory';
import { QUICKBOOKS_SANDBOX_URL } from './quickbooks';

// the deployment's configuration becoming a provider, against a real D1.
//
// a workers spec because the half worth proving needs a database: the adapter is handed a store and
// never a `Db` (./provider.ts), so what this file reads is that the store the factory built reaches
// the row this run's database holds. the refusals above it need no binding and sit here anyway,
// because they are the same subject.
//
// ../../../../vitest.workers.config.ts sets `unstubGlobals`, so a stubbed `fetch` is taken back
// before the next case.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from quickbooks_connection').run();
});

const CONFIGURED = {
	QUICKBOOKS_CLIENT_ID: 'notarealclientid',
	QUICKBOOKS_CLIENT_SECRET: 'notarealclientsecret',
	// the sandbox rather than production, so an address defaulted instead of read fails this case.
	QUICKBOOKS_API_URL: QUICKBOOKS_SANDBOX_URL
};

describe('a deployment short of the values Intuit is called with', () => {
	it('refuses as a company nobody has connected, naming all three where it holds none', async () => {
		const provider = createAccountingProvider({}, db);

		expect(await provider.readCompany()).toEqual({
			ok: false,
			reason: 'not_connected',
			retryable: false,
			detail: expect.stringContaining(
				'`QUICKBOOKS_CLIENT_ID` and `QUICKBOOKS_CLIENT_SECRET` and `QUICKBOOKS_API_URL` are not set'
			)
		});
	});

	it('refuses to start a connection, naming the value that has to be set first', async () => {
		const { QUICKBOOKS_CLIENT_ID: _unset, ...halfway } = CONFIGURED;

		// the same sentence every other arm gives, because it is the same absence: the route that
		// sends a browser to Intuit asks the port rather than reading the value itself, so there is
		// one module that knows what a deployment short of a credential is told.
		expect(
			await createAccountingProvider(halfway, db).authorizeUrl({
				redirectUri: 'https://give.example.org/quickbooks/callback',
				state: 'a-minted-state'
			})
		).toMatchObject({
			ok: false,
			reason: 'not_connected',
			detail: expect.stringContaining('`QUICKBOOKS_CLIENT_ID` is not set')
		});
	});

	it('names the one value that is short and not the two the operator has set', async () => {
		const { QUICKBOOKS_API_URL: _unset, ...halfway } = CONFIGURED;

		const refusal = await createAccountingProvider(halfway, db).listAccounts();

		expect(refusal).toMatchObject({
			ok: false,
			reason: 'not_connected',
			detail: expect.stringContaining('`QUICKBOOKS_API_URL` is not set')
		});
		expect(refusal).not.toMatchObject({ detail: expect.stringContaining('CLIENT_ID') });
	});
});

describe('a deployment holding all three', () => {
	it('reaches the address it was configured with, over the connection this run’s database holds', async () => {
		await connectQuickbooks(db, {
			realmId: '4620816365',
			tokens: {
				accessToken: 'access-one',
				accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
				refreshToken: 'refresh-one',
				refreshTokenExpiresAt: new Date(Date.now() + 8_640_000_000)
			},
			startAt: new Date('2026-01-01T00:00:00.000Z')
		});
		const calls: Request[] = [];
		vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(String(input), init);
			calls.push(request);
			return Response.json({
				QueryResponse: { CompanyInfo: [{ CompanyName: 'Riverside Shelter' }] }
			});
		});

		const result = await createAccountingProvider(CONFIGURED, db).readCompany();

		expect(result).toEqual({
			ok: true,
			value: { companyId: '4620816365', companyName: 'Riverside Shelter' }
		});
		const [call] = calls;
		expect(new URL(call?.url ?? '').origin).toBe(QUICKBOOKS_SANDBOX_URL);
		expect(call?.headers.get('authorization')).toBe('Bearer access-one');
	});
});
