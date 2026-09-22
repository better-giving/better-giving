import { createExecutionContext, env } from 'cloudflare:test';
import { createStaticHandler, type LoaderFunction } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	readQuickbooksConnection,
	saveQuickbooksAccounts
} from '$lib/server/accounting/connection';
import { createDb, type Db } from '$lib/server/db/client';
import {
	failed,
	type AccountingProvider,
	type AccountingResult,
	type CompanyIdentity,
	type LedgerAccount,
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
/** the second hostname the same deployment answers on, and the one an operator pinned it to. */
const PINNED = 'https://donate.example.org';
const REALM = '4620816365';
const STATE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2';

/** a chart holding an account that fits each of the three roles. */
const CHART: readonly LedgerAccount[] = [
	{
		id: '84',
		name: 'Accounts Receivable (A/R)',
		type: 'Accounts Receivable',
		subType: 'AccountsReceivable',
		classification: 'Asset'
	},
	{
		id: '4',
		name: 'Undeposited Funds',
		type: 'Other Current Asset',
		subType: 'UndepositedFunds',
		classification: 'Asset'
	},
	{ id: '35', name: 'Checking', type: 'Bank', subType: 'Checking', classification: 'Asset' },
	{
		id: '79',
		name: 'Donations',
		type: 'Income',
		subType: 'NonProfitIncome',
		classification: 'Revenue'
	},
	{
		id: '80',
		name: 'Bank charges',
		type: 'Expense',
		subType: 'BankCharges',
		classification: 'Expense'
	}
];

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
	accounts: null as AccountingResult<readonly LedgerAccount[]> | null,
	/** a chart read that throws rather than answering, as a D1 or network fault would. */
	chartThrows: false,
	chartReads: 0,
	exchanges: 0,
	/** the address the exchange was made against, which Intuit compares byte for byte. */
	redirectUri: null as string | null
}));

vi.mock('$lib/server/accounting/factory', () => ({
	createAccountingProvider: (): AccountingProvider => {
		// every arm, so the stub is the port rather than a cast over part of it — and the five this
		// route never calls refuse loudly, which is what turns a route that reached for one into a
		// failing case instead of an undefined.
		const unasked = async () => failed('internal_error', 'this route does not call this arm');
		return {
			exchangeCode: async (input) => {
				stub.exchanges += 1;
				stub.redirectUri = input.redirectUri;
				return stub.exchanged ?? failed('internal_error', 'no case set an exchange');
			},
			readCompany: async () => stub.company ?? failed('internal_error', 'no case set a company'),
			listAccounts: async () => {
				stub.chartReads += 1;
				if (stub.chartThrows) throw new Error('D1_ERROR: the chart read fell over');
				return stub.accounts ?? failed('internal_error', 'no case set a chart');
			},
			sendGift: unasked,
			sendCorrection: unasked,
			authorizeUrl: unasked,
			revokeTokens: unasked
		};
	}
}));

let db: Db;

beforeEach(async () => {
	db = createDb(env.DB);
	await env.DB.prepare('delete from quickbooks_connection').run();
	stub.exchanged = { ok: true, value: TOKENS };
	stub.company = { ok: true, value: { companyId: REALM, companyName: 'Hope Foundation' } };
	stub.accounts = null;
	stub.chartThrows = false;
	stub.chartReads = 0;
	stub.exchanges = 0;
	stub.redirectUri = null;
});

/** the pool's env with this deployment's values, as a proxy rather than a copy. */
function envWith(values: Record<string, string | undefined>): Env {
	return new Proxy(env, {
		get: (target, property) =>
			typeof property === 'string' && property in values
				? values[property]
				: Reflect.get(target, property)
	}) as Env;
}

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
	cookie: string | null = `quickbooks_connect_state=${STATE}`,
	vars: Record<string, string | undefined> = {}
): Promise<{ status: number; data: LoaderData; headers: Headers }> {
	const url = new URL(`${OWN}/quickbooks/callback`);
	for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
	const answered = await handler.query(
		new Request(url, { headers: cookie === null ? {} : { cookie } }),
		{ requestContext: requestContext(envWith(vars), createExecutionContext()) }
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

	// Intuit compares the `redirect_uri` on the exchange against the one the consent screen was
	// opened with, byte for byte. both are built from the pin where there is one, so a deployment
	// answering on a second hostname exchanges against the address it registered rather than the
	// one this browser happened to arrive on.
	it('exchanges against the address this deployment is pinned to', async () => {
		await back(undefined, undefined, { BETTER_AUTH_URL: PINNED });

		expect(stub.redirectUri).toBe(`${PINNED}/quickbooks/callback`);
	});

	it('exchanges against the host it was reached on where nothing is pinned', async () => {
		await back();

		expect(stub.redirectUri).toBe(`${OWN}/quickbooks/callback`);
	});

	it('leaves the connection standing where the company name could not be read', async () => {
		stub.company = failed('rate_limited', 'Intuit is throttling this app.');

		const answered = await back();

		expect(answered.data).toEqual({ outcome: 'connected', companyName: null });
		expect(await readQuickbooksConnection(db)).toMatchObject({ realmId: REALM, companyName: null });
	});

	it('fills the three accounts from the company’s own chart', async () => {
		stub.accounts = { ok: true, value: CHART };

		const answered = await back();

		expect(answered.data).toEqual({ outcome: 'connected', companyName: 'Hope Foundation' });
		expect(await readQuickbooksConnection(db)).toMatchObject({
			income: { id: '79', name: 'Donations' },
			fee: { id: '80', name: 'Bank charges' },
			deposit: { id: '35', name: 'Checking' }
		});
	});

	it('fills the roles the chart names and leaves the one it names none for unpicked', async () => {
		stub.accounts = { ok: true, value: CHART.filter((account) => account.type !== 'Expense') };

		const answered = await back();

		expect(answered.data).toEqual({ outcome: 'connected', companyName: 'Hope Foundation' });
		expect(await readQuickbooksConnection(db)).toMatchObject({
			realmId: REALM,
			income: { id: '79', name: 'Donations' },
			fee: null,
			deposit: { id: '35', name: 'Checking' }
		});
	});

	it('logs why the chart could not be read, without its detail, and answers connected', async () => {
		stub.accounts = failed('rate_limited', 'Intuit is throttling realm 4620816365.');
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		const answered = await back();

		expect(answered.status).toBe(200);
		expect(answered.data).toEqual({ outcome: 'connected', companyName: 'Hope Foundation' });
		expect(logged).toHaveBeenCalledTimes(1);
		const line = logged.mock.calls[0]?.join(' ') ?? '';
		expect(line).toContain('rate_limited');
		expect(line).not.toContain('throttling');
		logged.mockRestore();
	});

	it('logs a fill that threw, without its message, and answers connected', async () => {
		stub.chartThrows = true;
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		const answered = await back();

		expect(answered.status).toBe(200);
		expect(answered.data).toEqual({ outcome: 'connected', companyName: 'Hope Foundation' });
		expect(await readQuickbooksConnection(db)).toMatchObject({ realmId: REALM, deposit: null });
		expect(logged).toHaveBeenCalledTimes(1);
		const line = logged.mock.calls[0]?.join(' ') ?? '';
		expect(line).toContain('Error');
		expect(line).not.toContain('fell over');
		logged.mockRestore();
	});

	it('reads no chart when the same company is connected again with a role already filled', async () => {
		stub.accounts = { ok: true, value: CHART.filter((account) => account.type !== 'Bank') };
		await back();

		await back();

		expect(stub.chartReads).toBe(1);
	});

	it('keeps what was picked when the same company is connected again', async () => {
		stub.accounts = { ok: true, value: CHART };
		await back();
		await saveQuickbooksAccounts(db, {
			income: { id: '79', name: 'Donations' },
			fee: { id: '80', name: 'Bank charges' },
			deposit: { id: '36', name: 'Savings' }
		});

		await back();

		expect(await readQuickbooksConnection(db)).toMatchObject({
			deposit: { id: '36', name: 'Savings' }
		});
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
