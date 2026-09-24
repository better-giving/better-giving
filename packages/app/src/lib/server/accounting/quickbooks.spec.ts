import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createQuickbooksProvider,
	INTUIT_ACCOUNTING_SCOPE,
	INTUIT_AUTHORIZE_URL,
	INTUIT_REVOKE_URL,
	INTUIT_TOKEN_URL,
	QUICKBOOKS_SANDBOX_URL
} from './quickbooks';
import type { ConnectionSnapshot, ConnectionStore, TokenPair } from './provider';

// the adapter, exercised through a `fetch` that answers by route.
//
// by route rather than by script, for the reason ../payments/nowpayments.spec.ts gives: `fetch` is
// where this adapter's transport bottoms out — no SDK sits between it and Intuit — so what is
// recorded here is what Intuit would receive. every unscripted request throws, so a case that made
// a call it did not script is a case whose subject did something it was not asked to.
//
// the clock is frozen, because two of the things under test are times derived from it: when an
// access token lapses, and whether the adapter refreshes before spending it.
//
// ../../../../vitest.config.ts sets `unstubGlobals` and `restoreMocks`, so a stub installed here is
// taken back before the next test runs.

type Recorded = {
	readonly url: URL;
	readonly authorization: string | null;
	readonly contentType: string | null;
	readonly body: string;
};

type Answer = { readonly status: number; readonly json?: unknown; readonly text?: string };

const NOW = new Date('2026-09-19T12:00:00.000Z');

function serving(
	route: (method: string, url: URL, body: string) => Answer | undefined
): Recorded[] {
	const calls: Recorded[] = [];
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		const url = new URL(request.url);
		const body = await request.clone().text();
		calls.push({
			url,
			authorization: request.headers.get('authorization'),
			contentType: request.headers.get('content-type'),
			body
		});
		const answer = route(request.method, url, body);
		if (answer === undefined) throw new Error(`unscripted request: ${request.method} ${url}`);
		if (answer.text !== undefined) return new Response(answer.text, { status: answer.status });
		return Response.json(answer.json ?? null, { status: answer.status });
	});
	return calls;
}

const CREDENTIALS = {
	clientId: 'notarealclientid',
	clientSecret: 'notarealclientsecret',
	apiBaseUrl: QUICKBOOKS_SANDBOX_URL
};

/**
 * a connection in memory, so the adapter's own persistence is what the case reads.
 *
 * `saveTokens` compares and sets the way ./connection.ts does over D1, because what several cases
 * below are about is a renewal that lost that comparison — a double that took every write would
 * answer `stored` to a caller the real store refuses. `elsewhere` is the other caller's write —
 * their pair, or the row gone — landing while this provider is mid-renewal.
 */
function store(over: Partial<ConnectionSnapshot> = {}): ConnectionStore & {
	saved: TokenPair[];
	snapshot: ConnectionSnapshot | null;
	elsewhere(tokens: TokenPair | null): void;
} {
	const held: { snapshot: ConnectionSnapshot | null; saved: TokenPair[] } = {
		snapshot: {
			companyId: '4620816365',
			accessToken: 'access-one',
			accessTokenExpiresAt: new Date(NOW.getTime() + 3_600_000),
			refreshToken: 'refresh-one',
			refreshTokenExpiresAt: new Date(NOW.getTime() + 8_640_000_000),
			incomeAccountId: '79',
			feeAccountId: '80',
			depositAccountId: '35',
			...over
		},
		saved: []
	};
	return {
		read: async () => held.snapshot,
		saveTokens: async (presented, tokens) => {
			if (held.snapshot === null || held.snapshot.refreshToken !== presented) return 'superseded';
			held.saved.push(tokens);
			held.snapshot = { ...held.snapshot, ...tokens };
			return 'stored';
		},
		elsewhere: (tokens) => {
			held.snapshot =
				tokens === null || held.snapshot === null ? null : { ...held.snapshot, ...tokens };
		},
		get saved() {
			return held.saved;
		},
		get snapshot() {
			return held.snapshot;
		}
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('starting the connection', () => {
	it('builds Intuit’s consent address with the app’s client id, the scope and the caller’s state', async () => {
		serving(() => undefined);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const started = await provider.authorizeUrl({
			redirectUri: 'https://give.example.org/quickbooks/callback',
			state: 'a-minted-state'
		});

		if (!started.ok) throw new Error(`refused: ${started.detail}`);
		const sent = new URL(started.value);
		expect(sent.origin).toBe(new URL(INTUIT_AUTHORIZE_URL).origin);
		expect(sent.searchParams.get('client_id')).toBe(CREDENTIALS.clientId);
		expect(sent.searchParams.get('response_type')).toBe('code');
		expect(sent.searchParams.get('scope')).toBe(INTUIT_ACCOUNTING_SCOPE);
		expect(sent.searchParams.get('redirect_uri')).toBe(
			'https://give.example.org/quickbooks/callback'
		);
		expect(sent.searchParams.get('state')).toBe('a-minted-state');
	});
});

describe('exchanging the authorization code', () => {
	it('posts the grant to Intuit’s token endpoint and dates both tokens from the answer', async () => {
		const calls = serving((method, url) =>
			method === 'POST' && url.href === INTUIT_TOKEN_URL
				? {
						status: 200,
						json: {
							token_type: 'bearer',
							access_token: 'access-one',
							expires_in: 3600,
							refresh_token: 'refresh-one',
							x_refresh_token_expires_in: 8_726_400
						}
					}
				: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.exchangeCode({
			code: 'the-code',
			redirectUri: 'https://give.example.org/admin/quickbooks/callback'
		});

		expect(result).toEqual({
			ok: true,
			value: {
				accessToken: 'access-one',
				accessTokenExpiresAt: new Date(NOW.getTime() + 3_600_000),
				refreshToken: 'refresh-one',
				refreshTokenExpiresAt: new Date(NOW.getTime() + 8_726_400_000)
			}
		});
		expect(calls).toHaveLength(1);
		const [call] = calls;
		expect(call?.contentType).toBe('application/x-www-form-urlencoded');
		expect(call?.authorization).toBe(`Basic ${btoa('notarealclientid:notarealclientsecret')}`);
		expect(Object.fromEntries(new URLSearchParams(call?.body ?? ''))).toEqual({
			grant_type: 'authorization_code',
			code: 'the-code',
			redirect_uri: 'https://give.example.org/admin/quickbooks/callback'
		});
	});

	it('reports a refused code as a connection nobody can retry into', async () => {
		serving(() => ({ status: 400, json: { error: 'invalid_grant' } }));
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.exchangeCode({ code: 'spent', redirectUri: 'https://x/cb' });

		expect(result).toMatchObject({ ok: false, reason: 'reconnect_needed', retryable: false });
	});
});

/** the company read, which is the shortest arm that has to hold a token to make its call. */
const COMPANY_QUERY = { QueryResponse: { CompanyInfo: [{ CompanyName: 'Riverside Shelter' }] } };

describe('reading the company', () => {
	it('queries the realm with the stored token and the pinned minor version', async () => {
		const calls = serving((method, url) =>
			method === 'POST' && url.pathname === '/v3/company/4620816365/query'
				? { status: 200, json: COMPANY_QUERY }
				: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.readCompany();

		expect(result).toEqual({
			ok: true,
			value: { companyId: '4620816365', companyName: 'Riverside Shelter' }
		});
		const [call] = calls;
		expect(call?.url.origin).toBe(QUICKBOOKS_SANDBOX_URL);
		expect(call?.url.searchParams.get('minorversion')).toBe('75');
		// the statement rides in the body, under the content type Intuit's query endpoint takes.
		expect(call?.body).toBe('select * from CompanyInfo');
		expect(call?.contentType).toBe('application/text');
		expect(call?.authorization).toBe('Bearer access-one');
	});

	it('refuses where no company is connected, without calling Intuit', async () => {
		serving(() => undefined);
		const provider = createQuickbooksProvider(CREDENTIALS, {
			read: async () => null,
			saveTokens: async () => 'superseded'
		});

		expect(await provider.readCompany()).toMatchObject({
			ok: false,
			reason: 'not_connected',
			retryable: false
		});
	});
});

describe('the access token', () => {
	it('is refreshed before a call where it has lapsed, and the rotated pair is persisted', async () => {
		const calls = serving((method, url) => {
			if (method === 'POST' && url.href === INTUIT_TOKEN_URL) {
				return {
					status: 200,
					json: {
						access_token: 'access-two',
						expires_in: 3600,
						// Intuit rotates the refresh token on some refreshes and retires the old one.
						refresh_token: 'refresh-two',
						x_refresh_token_expires_in: 8_726_400
					}
				};
			}
			return url.pathname === '/v3/company/4620816365/query'
				? { status: 200, json: COMPANY_QUERY }
				: undefined;
		});
		const held = store({ accessTokenExpiresAt: new Date(NOW.getTime() - 1) });
		const provider = createQuickbooksProvider(CREDENTIALS, held);

		const result = await provider.readCompany();

		expect(result).toMatchObject({ ok: true });
		expect(held.saved).toEqual([
			{
				accessToken: 'access-two',
				accessTokenExpiresAt: new Date(NOW.getTime() + 3_600_000),
				refreshToken: 'refresh-two',
				refreshTokenExpiresAt: new Date(NOW.getTime() + 8_726_400_000)
			}
		]);
		expect(Object.fromEntries(new URLSearchParams(calls[0]?.body ?? ''))).toEqual({
			grant_type: 'refresh_token',
			refresh_token: 'refresh-one'
		});
		// the call that followed spent the token the refresh issued, never the lapsed one.
		expect(calls[1]?.authorization).toBe('Bearer access-two');
	});

	it('is refreshed once and only once for several calls on one provider', async () => {
		const calls = serving((method, url) =>
			method === 'POST' && url.href === INTUIT_TOKEN_URL
				? {
						status: 200,
						json: { access_token: 'access-two', expires_in: 3600, refresh_token: 'refresh-two' }
					}
				: { status: 200, json: COMPANY_QUERY }
		);
		const held = store({ accessTokenExpiresAt: new Date(NOW.getTime() - 1) });
		const provider = createQuickbooksProvider(CREDENTIALS, held);

		await Promise.all([provider.readCompany(), provider.readCompany()]);

		// two refreshes racing would have Intuit retire the token the other just took.
		expect(calls.filter((call) => call.url.href === INTUIT_TOKEN_URL)).toHaveLength(1);
		expect(held.saved).toHaveLength(1);
	});

	it('continues on the credential a renewal that got there first stored', async () => {
		const held = store({ accessTokenExpiresAt: new Date(NOW.getTime() - 1) });
		const theirs = {
			accessToken: 'access-theirs',
			accessTokenExpiresAt: new Date(NOW.getTime() + 3_600_000),
			refreshToken: 'refresh-theirs',
			refreshTokenExpiresAt: null
		};
		const calls = serving((method, url) => {
			if (method === 'POST' && url.href === INTUIT_TOKEN_URL) {
				// the other caller renews while this one's token request is in flight, so by the time
				// this one writes, `refresh-one` is not what the connection holds any more.
				held.elsewhere(theirs);
				return {
					status: 200,
					json: { access_token: 'access-mine', expires_in: 3600, refresh_token: 'refresh-mine' }
				};
			}
			return url.pathname === '/v3/company/4620816365/query'
				? { status: 200, json: COMPANY_QUERY }
				: undefined;
		});
		const provider = createQuickbooksProvider(CREDENTIALS, held);

		expect(await provider.readCompany()).toMatchObject({ ok: true });

		// the loser's pair is against a token Intuit retired when it issued the winner's, so storing
		// it would be this deployment holding a dead credential with nothing saying so.
		expect(held.snapshot).toMatchObject(theirs);
		expect(calls[1]?.authorization).toBe('Bearer access-theirs');
	});

	it('reports a pair it could not store as a connection to be made again', async () => {
		serving((method, url) =>
			method === 'POST' && url.href === INTUIT_TOKEN_URL
				? {
						status: 200,
						json: { access_token: 'access-two', expires_in: 3600, refresh_token: 'refresh-two' }
					}
				: undefined
		);
		const held = store({ accessTokenExpiresAt: new Date(NOW.getTime() - 1) });
		const provider = createQuickbooksProvider(CREDENTIALS, {
			read: held.read,
			saveTokens: async () => {
				throw new Error('D1_ERROR');
			}
		});

		// Intuit retired the presented token the moment it issued this pair, so a pair that could
		// not be written is a connection nothing revives — and the caller is told rather than made
		// to catch: a console read promises a 200 whatever the books answer.
		const result = await provider.readCompany();

		expect(result).toMatchObject({
			ok: false,
			reason: 'reconnect_needed',
			retryable: false,
			detail: expect.stringContaining('connected again')
		});
	});

	it('reports a company disconnected mid-renewal as one there is nothing to send to', async () => {
		const held = store({ accessTokenExpiresAt: new Date(NOW.getTime() - 1) });
		serving((method, url) => {
			if (method === 'POST' && url.href === INTUIT_TOKEN_URL) {
				// the disconnect press lands while the token request is in flight.
				held.elsewhere(null);
				return {
					status: 200,
					json: { access_token: 'access-two', expires_in: 3600, refresh_token: 'refresh-two' }
				};
			}
			return undefined;
		});
		const provider = createQuickbooksProvider(CREDENTIALS, held);

		expect(await provider.readCompany()).toMatchObject({
			ok: false,
			reason: 'not_connected',
			retryable: false
		});
	});

	it('reports a refresh Intuit refuses as a connection to be made again', async () => {
		serving((method, url) =>
			method === 'POST' && url.href === INTUIT_TOKEN_URL
				? { status: 400, json: { error: 'invalid_grant' } }
				: undefined
		);
		const held = store({ accessTokenExpiresAt: new Date(NOW.getTime() - 1) });
		const provider = createQuickbooksProvider(CREDENTIALS, held);

		const result = await provider.readCompany();

		expect(result).toMatchObject({ ok: false, reason: 'reconnect_needed', retryable: false });
		expect(held.saved).toEqual([]);
	});

	it('refreshes once and retries where a call is refused with a token still dated ahead', async () => {
		let refused = 0;
		const calls = serving((method, url) => {
			if (method === 'POST' && url.href === INTUIT_TOKEN_URL) {
				return {
					status: 200,
					json: { access_token: 'access-two', expires_in: 3600, refresh_token: 'refresh-two' }
				};
			}
			// a token revoked from inside QuickBooks lapses before the expiry this app holds for it.
			refused += 1;
			return refused === 1
				? { status: 401, json: { Fault: { type: 'AUTHENTICATION' } } }
				: { status: 200, json: COMPANY_QUERY };
		});
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		expect(await provider.readCompany()).toMatchObject({ ok: true });
		expect(calls.map((call) => call.authorization)).toEqual([
			'Bearer access-one',
			`Basic ${btoa('notarealclientid:notarealclientsecret')}`,
			'Bearer access-two'
		]);
	});

	it('reports a call still refused after that one refresh as a connection to be made again', async () => {
		serving((method, url) =>
			method === 'POST' && url.href === INTUIT_TOKEN_URL
				? {
						status: 200,
						json: { access_token: 'access-two', expires_in: 3600, refresh_token: 'refresh-two' }
					}
				: { status: 401, json: { Fault: { type: 'AUTHENTICATION' } } }
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		expect(await provider.readCompany()).toMatchObject({
			ok: false,
			reason: 'reconnect_needed',
			retryable: false
		});
	});
});

const GIFT = {
	key: '019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9',
	occurredAt: new Date('2026-03-01T22:30:00.000Z'),
	currency: 'USD',
	donor: { displayName: 'Ada Lovelace', email: 'ada@example.org' },
	memo: 'donation 019fb0d2-7d57-7c5e-a7df-baed1f27b405',
	incomeMinor: 10_000,
	feeMinor: 320
};

/** the queue row's `updated_at` as a claim read it, which is what the delivery hands every send. */
const REVISION = '1790000000000';

/** a company's currency posture, as Intuit's Preferences carry it. */
function keeping(homeCurrency: string, over: { multicurrency: boolean }) {
	return {
		QueryResponse: {
			Preferences: [
				{
					CurrencyPrefs: {
						HomeCurrency: { value: homeCurrency },
						MultiCurrencyEnabled: over.multicurrency
					}
				}
			]
		}
	};
}

/**
 * a company that answers every read this adapter makes and takes whatever it posts.
 *
 * `over` answers first, so a case states only the arm it is about rather than restating the
 * customer lookup and the duplicate probe in every routing lambda. anything neither answers is
 * still unscripted, and still throws.
 */
function servingCompany(
	over: (statement: string, path: string) => Answer | undefined = () => undefined
): Recorded[] {
	return serving((_method, url, body) => {
		const statement = url.pathname.endsWith('/query') ? body : '';
		const answer = over(statement, url.pathname);
		if (answer !== undefined) return answer;
		if (statement.startsWith('select * from Preferences')) {
			return { status: 200, json: keeping('USD', { multicurrency: true }) };
		}
		if (statement !== '') return { status: 200, json: { QueryResponse: {} } };
		if (url.pathname.endsWith('/customer'))
			return { status: 200, json: { Customer: { Id: '77' } } };
		if (url.pathname.endsWith('/deposit')) return { status: 200, json: { Deposit: { Id: '987' } } };
		if (url.pathname.endsWith('/journalentry')) {
			return { status: 200, json: { JournalEntry: { Id: '1200' } } };
		}
		return undefined;
	});
}

/** the statement a recorded call asked for, which is how these cases route. */
function asked(call: Recorded | undefined): string {
	return call?.url.pathname.endsWith('/query') === true ? call.body : '';
}

/** whether a recorded call created anything, which several cases assert nothing did. */
function isCreate(call: Recorded): boolean {
	return !call.url.pathname.endsWith('/query');
}

describe('sending a gift', () => {
	it('deposits the gift into the chosen accounts, the processor’s cut as a line against it', async () => {
		const calls = servingCompany((statement) =>
			statement.startsWith('select * from Customer')
				? { status: 200, json: { QueryResponse: { Customer: [{ Id: '12' }] } } }
				: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendGift(GIFT, 'first', REVISION);

		expect(result).toEqual({ ok: true, value: { remoteId: '987' } });
		const post = calls.find((call) => call.url.pathname.endsWith('/deposit'));
		expect(post?.url.pathname).toBe('/v3/company/4620816365/deposit');
		expect(JSON.parse(post?.body ?? '{}')).toEqual({
			TxnDate: '2026-03-01',
			CurrencyRef: { value: 'USD' },
			PrivateNote: `better-giving ${GIFT.key}\ndonation 019fb0d2-7d57-7c5e-a7df-baed1f27b405`,
			DepositToAccountRef: { value: '35' },
			Line: [
				{
					DetailType: 'DepositLineDetail',
					Amount: 100,
					Description: 'Donation from Ada Lovelace',
					DepositLineDetail: {
						AccountRef: { value: '79' },
						Entity: { value: '12', type: 'Customer' }
					}
				},
				{
					DetailType: 'DepositLineDetail',
					Amount: -3.2,
					Description: 'Processing fee',
					DepositLineDetail: { AccountRef: { value: '80' } }
				}
			]
		});
	});

	it('carries no fee line where the processor took nothing', async () => {
		const calls = servingCompany((statement) =>
			statement.startsWith('select * from Customer')
				? { status: 200, json: { QueryResponse: { Customer: [{ Id: '12' }] } } }
				: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift({ ...GIFT, feeMinor: 0 }, 'first', REVISION);

		const post = calls.find((call) => call.url.pathname.endsWith('/deposit'));
		expect(JSON.parse(post?.body ?? '{}').Line).toHaveLength(1);
	});

	it('names the gift’s own currency on the deposit', async () => {
		const calls = servingCompany();
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift(
			{ ...GIFT, currency: 'GBP', incomeMinor: 4_500, feeMinor: 0 },
			'first',
			REVISION
		);

		const post = calls.find((call) => call.url.pathname.endsWith('/deposit'));
		expect(JSON.parse(post?.body ?? '{}')).toMatchObject({
			CurrencyRef: { value: 'GBP' },
			Line: [{ Amount: 45 }]
		});
	});

	it('refuses a gift the company keeps no books in, naming both currencies', async () => {
		const calls = servingCompany((statement) =>
			statement.startsWith('select * from Preferences')
				? { status: 200, json: keeping('USD', { multicurrency: false }) }
				: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendGift({ ...GIFT, currency: 'GBP' }, 'first', REVISION);

		// a company with multicurrency off holds one currency, and a GBP figure posted into USD
		// books is a wrong amount nothing downstream reads as wrong.
		expect(result).toMatchObject({ ok: false, reason: 'invalid_record', retryable: false });
		expect(result).toMatchObject({ detail: expect.stringContaining('GBP') });
		expect(result).toMatchObject({ detail: expect.stringContaining('USD') });
		expect(calls.some(isCreate)).toBe(false);
	});

	it('reads the company’s currency once however many gifts one provider sends', async () => {
		const calls = servingCompany();
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift(GIFT, 'first', REVISION);
		await provider.sendGift(
			{ ...GIFT, key: '019fb0b4-ec6c-7fbb-aa36-000000000002' },
			'first',
			REVISION
		);

		// a read is what Intuit meters this app on, and a delivery run sends a batch through one
		// provider.
		expect(
			calls.map(asked).filter((statement) => statement.startsWith('select * from Preferences'))
		).toHaveLength(1);
	});

	it('refuses before any call where the accounts have not been picked, naming them', async () => {
		serving(() => undefined);
		const provider = createQuickbooksProvider(
			CREDENTIALS,
			store({ incomeAccountId: null, feeAccountId: null })
		);

		const result = await provider.sendGift(GIFT, 'first', REVISION);

		expect(result).toMatchObject({ ok: false, reason: 'accounts_not_chosen', retryable: false });
		expect(result).toMatchObject({ detail: expect.stringContaining('income') });
		expect(result).toMatchObject({ detail: expect.stringContaining('fee') });
	});
});

describe('matching the donor', () => {
	it('finds them by email where they left one', async () => {
		const calls = servingCompany((statement) =>
			statement.startsWith('select * from Customer')
				? { status: 200, json: { QueryResponse: { Customer: [{ Id: '12' }] } } }
				: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift(GIFT, 'first', REVISION);

		expect(calls.map(asked).filter((query) => query.startsWith('select * from Customer'))).toEqual([
			"select * from Customer where PrimaryEmailAddr = 'ada@example.org' and Active = true"
		]);
	});

	it('falls back to the display name where they left none', async () => {
		const calls = servingCompany((statement) =>
			statement.startsWith('select * from Customer')
				? { status: 200, json: { QueryResponse: { Customer: [{ Id: '44' }] } } }
				: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift(
			{ ...GIFT, donor: { displayName: "Bridget O'Hara", email: null } },
			'first',
			REVISION
		);

		// the apostrophe is escaped with a backslash, which is what Intuit's query language takes;
		// unescaped, the statement ends mid-name and the read is refused.
		expect(calls.map(asked).filter((query) => query.startsWith('select * from Customer'))).toEqual([
			"select * from Customer where DisplayName = 'Bridget O\\'Hara' and Active = true"
		]);
	});

	it('creates them where neither lookup finds anything', async () => {
		const calls = servingCompany();
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift(GIFT, 'first', REVISION);

		const created = calls.find((call) => call.url.pathname.endsWith('/customer'));
		expect(JSON.parse(created?.body ?? '{}')).toEqual({
			DisplayName: 'Ada Lovelace',
			PrimaryEmailAddr: { Address: 'ada@example.org' }
		});
		const deposit = calls.find((call) => call.url.pathname.endsWith('/deposit'));
		expect(JSON.parse(deposit?.body ?? '{}').Line[0].DepositLineDetail.Entity).toEqual({
			value: '77',
			type: 'Customer'
		});
	});

	/** Intuit's refusal when a display name is held by any customer, vendor or employee. */
	const DUPLICATE_NAME = {
		status: 400,
		json: {
			Fault: {
				type: 'ValidationFault',
				Error: [
					{
						Message: 'Duplicate Name Exists Error',
						Detail:
							'The name supplied already exists. : Another customer, vendor or employee is already using this name.',
						code: '6240'
					}
				]
			}
		}
	};

	it('gives a donor whose name is already a supplier’s a name of their own', async () => {
		let creates = 0;
		const calls = servingCompany((_statement, path) => {
			if (!path.endsWith('/customer')) return undefined;
			creates += 1;
			return creates === 1 ? DUPLICATE_NAME : { status: 200, json: { Customer: { Id: '77' } } };
		});
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendGift(
			{ ...GIFT, donor: { displayName: 'Ada Lovelace', email: null } },
			'first',
			REVISION
		);

		// a display name is unique across every customer, vendor and employee a company holds, so a
		// donor who is also a supplier — or an archived contact — has no name of their own until one
		// is made for them. the gift reaches the books either way.
		expect(result).toMatchObject({ ok: true });
		expect(
			calls
				.filter((call) => call.url.pathname.endsWith('/customer'))
				.map((call) => JSON.parse(call.body).DisplayName)
		).toEqual(['Ada Lovelace', 'Ada Lovelace (donor)']);
		const deposit = calls.find((call) => call.url.pathname.endsWith('/deposit'));
		expect(JSON.parse(deposit?.body ?? '{}').Line[0].DepositLineDetail.Entity).toEqual({
			value: '77',
			type: 'Customer'
		});
	});

	it('finds that donor again on their next gift rather than minting a third name', async () => {
		const calls = servingCompany((statement, path) => {
			if (path.endsWith('/customer')) return DUPLICATE_NAME;
			return statement.includes("DisplayName = 'Ada Lovelace (donor)'")
				? { status: 200, json: { QueryResponse: { Customer: [{ Id: '77' }] } } }
				: undefined;
		});
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendGift(
			{ ...GIFT, donor: { displayName: 'Ada Lovelace', email: null } },
			'first',
			REVISION
		);

		expect(result).toMatchObject({ ok: true });
		expect(calls.filter((call) => call.url.pathname.endsWith('/customer'))).toHaveLength(1);
	});

	it('names the donor in no url it builds', async () => {
		const calls = servingCompany();
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift(GIFT, 'first', REVISION);

		expect(calls.length).toBeGreaterThan(0);
		for (const call of calls) {
			const address = decodeURIComponent(call.url.href);
			expect(address).not.toContain('Lovelace');
			expect(address).not.toContain('ada@example.org');
		}
	});

	it('looks a nameless donor up by a display name QuickBooks will accept', async () => {
		const calls = servingCompany();
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		// a colon, a tab and a newline are refused in a DisplayName, and the lookup has to ask for
		// the same name the create would write or every repeat gift mints another customer.
		await provider.sendGift(
			{ ...GIFT, donor: { displayName: 'Acme: Widgets\tLtd', email: null } },
			'first',
			REVISION
		);

		expect(calls.map(asked).filter((query) => query.startsWith('select * from Customer'))).toEqual([
			"select * from Customer where DisplayName = 'Acme Widgets Ltd' and Active = true"
		]);
		const created = calls.find((call) => call.url.pathname.endsWith('/customer'));
		expect(JSON.parse(created?.body ?? '{}').DisplayName).toBe('Acme Widgets Ltd');
	});
});

/** the request id the deposit among `calls` was posted under. */
function requestId(calls: Recorded[]): string | null | undefined {
	return calls
		.find((call) => call.url.pathname.endsWith('/deposit'))
		?.url.searchParams.get('requestid');
}

describe('a post that already landed', () => {
	it('is not looked for on a row nothing has tried yet', async () => {
		const calls = servingCompany();
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift(GIFT, 'first', REVISION);

		// the queue counts an attempt as it claims a row, so a first attempt is a row nothing has
		// ever sent and the scan below — every deposit the company took that day, page by page,
		// metered — would find nothing. it is what a retry pays and a first attempt does not.
		expect(
			calls.map(asked).some((statement) => statement.startsWith('select * from Deposit'))
		).toBe(false);
		expect(calls.some(isCreate)).toBe(true);
	});

	it('is answered with the record QuickBooks already holds, and nothing is posted again', async () => {
		const calls = servingCompany((statement) =>
			statement.startsWith('select * from Deposit')
				? {
						status: 200,
						json: {
							QueryResponse: {
								Deposit: [
									{ Id: '500', PrivateNote: 'better-giving some-other-entry' },
									{ Id: '987', PrivateNote: `better-giving ${GIFT.key}\nwhatever` }
								]
							}
						}
					}
				: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendGift(GIFT, 'again', REVISION);

		expect(result).toEqual({ ok: true, value: { remoteId: '987' } });
		expect(calls.some(isCreate)).toBe(false);
	});

	it('is posted under the same request id on every send, so Intuit answers a repeat with the first record', async () => {
		const first = servingCompany();
		await createQuickbooksProvider(CREDENTIALS, store()).sendGift(GIFT, 'first', REVISION);
		const again = servingCompany();
		await createQuickbooksProvider(CREDENTIALS, store()).sendGift(GIFT, 'again', REVISION);

		expect(requestId(first)).toMatch(new RegExp(`^${GIFT.key}-`));
		expect(requestId(first)?.length).toBeLessThanOrEqual(50);
		expect(requestId(again)).toBe(requestId(first));
	});

	it('is posted under a new request id once what it sends has changed, so a refusal is not replayed', async () => {
		const refused = servingCompany();
		await createQuickbooksProvider(CREDENTIALS, store()).sendGift(GIFT, 'first', REVISION);
		const repicked = servingCompany();
		await createQuickbooksProvider(CREDENTIALS, store({ depositAccountId: '36' })).sendGift(
			GIFT,
			'again',
			REVISION
		);

		expect(requestId(repicked)).toMatch(new RegExp(`^${GIFT.key}-`));
		expect(requestId(repicked)).not.toBe(requestId(refused));
	});

	it('is posted under a new request id once the queue row has been answered since', async () => {
		const refused = servingCompany();
		await createQuickbooksProvider(CREDENTIALS, store()).sendGift(GIFT, 'first', REVISION);
		const retried = servingCompany();
		// the refusal was written to the row, which moved it; what the operator fixed was inside
		// QuickBooks, so the body is the same byte for byte.
		await createQuickbooksProvider(CREDENTIALS, store()).sendGift(GIFT, 'again', '1790000060000');

		expect(requestId(retried)).toMatch(new RegExp(`^${GIFT.key}-`));
		expect(requestId(retried)).not.toBe(requestId(refused));
	});

	it('gives the donor it creates and the record it posts a request id each', async () => {
		const calls = servingCompany();
		await createQuickbooksProvider(CREDENTIALS, store()).sendGift(GIFT, 'first', REVISION);

		const ids = calls.filter(isCreate).map((call) => call.url.searchParams.get('requestid'));
		expect(calls.filter(isCreate).map((call) => call.url.pathname.split('/').at(-1))).toEqual([
			'customer',
			'deposit'
		]);
		expect(ids.every((id) => id?.startsWith(`${GIFT.key}-`))).toBe(true);
		expect(new Set(ids).size).toBe(2);
	});
});

describe('what a refusal costs the queued entry', () => {
	it.each([
		{ status: 429, json: {}, reason: 'rate_limited', retryable: true },
		{ status: 503, json: {}, reason: 'provider_error', retryable: true },
		{
			status: 400,
			json: {
				Fault: {
					type: 'ValidationFault',
					Error: [
						{
							Message: 'Invalid Reference Id',
							Detail: 'Account element id 79 not found',
							code: '610'
						}
					]
				}
			},
			reason: 'invalid_record',
			retryable: false
		}
	])('reads $status as $reason', async ({ status, json, reason, retryable }) => {
		servingCompany((statement) =>
			statement.startsWith('select * from Customer')
				? { status: 200, json: { QueryResponse: { Customer: [{ Id: '12' }] } } }
				: statement === ''
					? { status, json }
					: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		expect(await provider.sendGift(GIFT, 'first', REVISION)).toMatchObject({
			ok: false,
			reason,
			retryable
		});
	});

	it('reports a fault Intuit named, so the console can show why', async () => {
		servingCompany((statement) =>
			statement.startsWith('select * from Customer')
				? { status: 200, json: { QueryResponse: { Customer: [{ Id: '12' }] } } }
				: statement === ''
					? {
							status: 400,
							json: {
								Fault: {
									Error: [
										{
											Message: 'Invalid Reference Id',
											Detail: 'Account element id 79 not found',
											code: '610'
										}
									]
								}
							}
						}
					: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendGift(GIFT, 'first', REVISION);

		expect(result).toMatchObject({
			detail: expect.stringContaining('Account element id 79 not found')
		});
	});

	it('reports a call that never answered as worth making again', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new DOMException('The operation was aborted', 'TimeoutError');
		});
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		expect(await provider.sendGift(GIFT, 'first', REVISION)).toMatchObject({
			ok: false,
			reason: 'unreachable',
			retryable: true
		});
	});
});

const CORRECTION = {
	key: '019fb0d2-7d59-7612-9df3-962bd680f619',
	occurredAt: new Date('2026-04-30T00:00:00.000Z'),
	currency: 'USD',
	memo: 'gift posted to the wrong fund',
	lines: [
		{ role: 'income', posting: 'debit', amountMinor: 2_500 },
		{ role: 'deposit', posting: 'credit', amountMinor: 2_500 }
	]
} as const;

describe('sending a correction', () => {
	it('posts a journal entry whose sides name the chosen accounts', async () => {
		const calls = servingCompany();
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendCorrection(CORRECTION, 'first', REVISION);

		expect(result).toEqual({ ok: true, value: { remoteId: '1200' } });
		const post = calls.find((call) => call.url.pathname.endsWith('/journalentry'));
		expect(post?.url.pathname).toBe('/v3/company/4620816365/journalentry');
		expect(post?.url.searchParams.get('requestid')).toMatch(new RegExp(`^${CORRECTION.key}-`));
		expect(JSON.parse(post?.body ?? '{}')).toEqual({
			TxnDate: '2026-04-30',
			CurrencyRef: { value: 'USD' },
			PrivateNote: `better-giving ${CORRECTION.key}\ngift posted to the wrong fund`,
			Line: [
				{
					DetailType: 'JournalEntryLineDetail',
					Amount: 25,
					Description: 'gift posted to the wrong fund',
					JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: '79' } }
				},
				{
					DetailType: 'JournalEntryLineDetail',
					Amount: 25,
					Description: 'gift posted to the wrong fund',
					JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: '35' } }
				}
			]
		});
	});

	it('is answered with the entry QuickBooks already holds where it was posted before', async () => {
		const calls = servingCompany((statement) =>
			statement.startsWith('select * from JournalEntry')
				? {
						status: 200,
						json: {
							QueryResponse: {
								JournalEntry: [{ Id: '1200', PrivateNote: `better-giving ${CORRECTION.key}` }]
							}
						}
					}
				: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		expect(await provider.sendCorrection(CORRECTION, 'again', REVISION)).toEqual({
			ok: true,
			value: { remoteId: '1200' }
		});
		expect(calls.some(isCreate)).toBe(false);
	});

	it('refuses a correction whose two sides land in one account', async () => {
		serving(() => undefined);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendCorrection(
			{
				...CORRECTION,
				lines: [
					{ role: 'income', posting: 'debit', amountMinor: 2_500 },
					{ role: 'income', posting: 'credit', amountMinor: 2_500 }
				]
			},
			'first',
			REVISION
		);

		// both of this app's accounts map to the one QuickBooks account, so the entry would move
		// nothing — and an entry that moves nothing is worse than none: it reads as a correction made.
		expect(result).toMatchObject({ ok: false, reason: 'invalid_record', retryable: false });
	});
});

describe('the chart of accounts', () => {
	it('lists what the connection screen picks from, page by page', async () => {
		servingCompany((statement) =>
			statement.includes('from Account')
				? {
						status: 200,
						json: {
							QueryResponse: {
								Account: [
									{
										Id: '79',
										Name: 'Donations',
										AccountType: 'Income',
										Classification: 'Revenue',
										Active: true
									},
									{
										Id: '35',
										Name: 'Checking',
										AccountType: 'Bank',
										AccountSubType: 'Checking',
										Classification: 'Asset',
										Active: true
									},
									{ Id: '99', Name: 'Closed fund', AccountType: 'Income', Active: false }
								]
							}
						}
					}
				: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.listAccounts();

		// an inactive account cannot be posted to, so offering one is offering a choice that refuses
		// every gift afterwards.
		expect(result).toEqual({
			ok: true,
			value: [
				{
					id: '79',
					name: 'Donations',
					type: 'Income',
					subType: null,
					classification: 'Revenue'
				},
				{
					id: '35',
					name: 'Checking',
					type: 'Bank',
					subType: 'Checking',
					classification: 'Asset'
				}
			]
		});
	});
});

describe('disconnecting', () => {
	it('revokes the stored refresh token at Intuit', async () => {
		const calls = serving((method, url) =>
			method === 'POST' && url.href === INTUIT_REVOKE_URL ? { status: 200, json: {} } : undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		expect(await provider.revokeTokens()).toEqual({ ok: true, value: null });
		const [call] = calls;
		expect(call?.authorization).toBe(`Basic ${btoa('notarealclientid:notarealclientsecret')}`);
		expect(JSON.parse(call?.body ?? '{}')).toEqual({ token: 'refresh-one' });
	});

	it('has nothing to revoke where no company is connected', async () => {
		serving(() => undefined);
		const provider = createQuickbooksProvider(CREDENTIALS, {
			read: async () => null,
			saveTokens: async () => 'superseded'
		});

		expect(await provider.revokeTokens()).toMatchObject({ ok: false, reason: 'not_connected' });
	});
});
