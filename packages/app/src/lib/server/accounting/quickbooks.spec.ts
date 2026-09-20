import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createQuickbooksProvider,
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
	readonly method: string;
	readonly url: URL;
	readonly authorization: string | null;
	readonly contentType: string | null;
	readonly body: string;
};

type Answer = { readonly status: number; readonly json?: unknown; readonly text?: string };

const NOW = new Date('2026-09-19T12:00:00.000Z');

function serving(route: (method: string, url: URL) => Answer | undefined): Recorded[] {
	const calls: Recorded[] = [];
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		const url = new URL(request.url);
		calls.push({
			method: request.method,
			url,
			authorization: request.headers.get('authorization'),
			contentType: request.headers.get('content-type'),
			body: await request.clone().text()
		});
		const answer = route(request.method, url);
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

/** a connection in memory, so the adapter's own persistence is what the case reads. */
function store(over: Partial<ConnectionSnapshot> = {}): ConnectionStore & {
	saved: TokenPair[];
	snapshot: ConnectionSnapshot | null;
} {
	const held: { snapshot: ConnectionSnapshot | null; saved: TokenPair[] } = {
		snapshot: {
			realmId: '4620816365',
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
		saveTokens: async (tokens) => {
			held.saved.push(tokens);
			held.snapshot = held.snapshot === null ? null : { ...held.snapshot, ...tokens };
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
			method === 'GET' && url.pathname === '/v3/company/4620816365/query'
				? { status: 200, json: COMPANY_QUERY }
				: undefined
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.readCompany();

		expect(result).toEqual({
			ok: true,
			value: { realmId: '4620816365', companyName: 'Riverside Shelter' }
		});
		const [call] = calls;
		expect(call?.url.origin).toBe(QUICKBOOKS_SANDBOX_URL);
		expect(call?.url.searchParams.get('minorversion')).toBe('75');
		expect(call?.url.searchParams.get('query')).toBe('select * from CompanyInfo');
		expect(call?.authorization).toBe('Bearer access-one');
	});

	it('refuses where no company is connected, without calling Intuit', async () => {
		serving(() => undefined);
		const provider = createQuickbooksProvider(CREDENTIALS, {
			read: async () => null,
			saveTokens: async () => {}
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

/** what the query in a recorded call asked for, which is how these cases route. */
function asked(call: Recorded | undefined): string {
	return call?.url.searchParams.get('query') ?? '';
}

describe('sending a gift', () => {
	it('deposits the gift into the chosen accounts, the processor’s cut as a line against it', async () => {
		const calls = serving((method, url) => {
			if (method === 'POST') return { status: 200, json: { Deposit: { Id: '987' } } };
			const query = url.searchParams.get('query') ?? '';
			if (query.startsWith('select * from Customer')) {
				return { status: 200, json: { QueryResponse: { Customer: [{ Id: '12' }] } } };
			}
			return { status: 200, json: { QueryResponse: {} } };
		});
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendGift(GIFT);

		expect(result).toEqual({ ok: true, value: { remoteId: '987' } });
		const post = calls.find((call) => call.method === 'POST');
		expect(post?.url.pathname).toBe('/v3/company/4620816365/deposit');
		expect(JSON.parse(post?.body ?? '{}')).toEqual({
			TxnDate: '2026-03-01',
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
		const calls = serving((method, url) =>
			method === 'POST'
				? { status: 200, json: { Deposit: { Id: '988' } } }
				: {
						status: 200,
						json: (url.searchParams.get('query') ?? '').startsWith('select * from Customer')
							? { QueryResponse: { Customer: [{ Id: '12' }] } }
							: { QueryResponse: {} }
					}
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift({ ...GIFT, feeMinor: 0 });

		const post = calls.find((call) => call.method === 'POST');
		expect(JSON.parse(post?.body ?? '{}').Line).toHaveLength(1);
	});

	it('refuses before any call where the accounts have not been picked, naming them', async () => {
		serving(() => undefined);
		const provider = createQuickbooksProvider(
			CREDENTIALS,
			store({ incomeAccountId: null, feeAccountId: null })
		);

		const result = await provider.sendGift(GIFT);

		expect(result).toMatchObject({ ok: false, reason: 'accounts_not_chosen', retryable: false });
		expect(result).toMatchObject({ detail: expect.stringContaining('income') });
		expect(result).toMatchObject({ detail: expect.stringContaining('fee') });
	});
});

describe('matching the donor', () => {
	it('finds them by email where they left one', async () => {
		const calls = serving((method, url) =>
			method === 'POST'
				? { status: 200, json: { Deposit: { Id: '987' } } }
				: {
						status: 200,
						json: (url.searchParams.get('query') ?? '').startsWith('select * from Customer')
							? { QueryResponse: { Customer: [{ Id: '12' }] } }
							: { QueryResponse: {} }
					}
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift(GIFT);

		expect(calls.map(asked).filter((query) => query.startsWith('select * from Customer'))).toEqual([
			"select * from Customer where PrimaryEmailAddr = 'ada@example.org'"
		]);
	});

	it('falls back to the display name where they left none', async () => {
		const calls = serving((method, url) =>
			method === 'POST'
				? { status: 200, json: { Deposit: { Id: '987' } } }
				: {
						status: 200,
						json: (url.searchParams.get('query') ?? '').startsWith('select * from Customer')
							? { QueryResponse: { Customer: [{ Id: '44' }] } }
							: { QueryResponse: {} }
					}
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift({
			...GIFT,
			donor: { displayName: "Bridget O'Hara", email: null }
		});

		// the apostrophe is escaped with a backslash, which is what Intuit's query language takes;
		// unescaped, the statement ends mid-name and the read is refused.
		expect(calls.map(asked).filter((query) => query.startsWith('select * from Customer'))).toEqual([
			"select * from Customer where DisplayName = 'Bridget O\\'Hara'"
		]);
	});

	it('creates them where neither lookup finds anything', async () => {
		const calls = serving((method, url) => {
			if (method === 'POST' && url.pathname.endsWith('/customer')) {
				return { status: 200, json: { Customer: { Id: '77' } } };
			}
			if (method === 'POST') return { status: 200, json: { Deposit: { Id: '987' } } };
			return { status: 200, json: { QueryResponse: {} } };
		});
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		await provider.sendGift(GIFT);

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

	it('looks a nameless donor up by a display name QuickBooks will accept', async () => {
		const calls = serving((method, url) => {
			if (method === 'POST' && url.pathname.endsWith('/customer')) {
				return { status: 200, json: { Customer: { Id: '77' } } };
			}
			if (method === 'POST') return { status: 200, json: { Deposit: { Id: '987' } } };
			return { status: 200, json: { QueryResponse: {} } };
		});
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		// a colon, a tab and a newline are refused in a DisplayName, and the lookup has to ask for
		// the same name the create would write or every repeat gift mints another customer.
		await provider.sendGift({
			...GIFT,
			donor: { displayName: 'Acme: Widgets\tLtd', email: null }
		});

		expect(calls.map(asked).filter((query) => query.startsWith('select * from Customer'))).toEqual([
			"select * from Customer where DisplayName = 'Acme Widgets Ltd'"
		]);
		const created = calls.find((call) => call.url.pathname.endsWith('/customer'));
		expect(JSON.parse(created?.body ?? '{}').DisplayName).toBe('Acme Widgets Ltd');
	});
});

describe('a post that already landed', () => {
	it('is answered with the record QuickBooks already holds, and nothing is posted again', async () => {
		const calls = serving((_method, url) => {
			const query = url.searchParams.get('query') ?? '';
			if (query.startsWith('select * from Deposit')) {
				return {
					status: 200,
					json: {
						QueryResponse: {
							Deposit: [
								{ Id: '500', PrivateNote: 'better-giving some-other-entry' },
								{ Id: '987', PrivateNote: `better-giving ${GIFT.key}\nwhatever` }
							]
						}
					}
				};
			}
			return undefined;
		});
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendGift(GIFT);

		expect(result).toEqual({ ok: true, value: { remoteId: '987' } });
		expect(calls.every((call) => call.method === 'GET')).toBe(true);
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
		serving((method, url) =>
			method === 'GET' && (url.searchParams.get('query') ?? '').startsWith('select * from Customer')
				? { status: 200, json: { QueryResponse: { Customer: [{ Id: '12' }] } } }
				: method === 'GET'
					? { status: 200, json: { QueryResponse: {} } }
					: { status, json }
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		expect(await provider.sendGift(GIFT)).toMatchObject({ ok: false, reason, retryable });
	});

	it('reports a fault Intuit named, so the console can show why', async () => {
		serving((method, url) =>
			method === 'GET' && (url.searchParams.get('query') ?? '').startsWith('select * from Customer')
				? { status: 200, json: { QueryResponse: { Customer: [{ Id: '12' }] } } }
				: method === 'GET'
					? { status: 200, json: { QueryResponse: {} } }
					: {
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
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendGift(GIFT);

		expect(result).toMatchObject({
			detail: expect.stringContaining('Account element id 79 not found')
		});
	});

	it('reports a call that never answered as worth making again', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new DOMException('The operation was aborted', 'TimeoutError');
		});
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		expect(await provider.sendGift(GIFT)).toMatchObject({
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
		const calls = serving((method) =>
			method === 'POST'
				? { status: 200, json: { JournalEntry: { Id: '1200' } } }
				: { status: 200, json: { QueryResponse: {} } }
		);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendCorrection(CORRECTION);

		expect(result).toEqual({ ok: true, value: { remoteId: '1200' } });
		const post = calls.find((call) => call.method === 'POST');
		expect(post?.url.pathname).toBe('/v3/company/4620816365/journalentry');
		expect(JSON.parse(post?.body ?? '{}')).toEqual({
			TxnDate: '2026-04-30',
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
		const calls = serving((method, url) =>
			method === 'GET' &&
			(url.searchParams.get('query') ?? '').startsWith('select * from JournalEntry')
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

		expect(await provider.sendCorrection(CORRECTION)).toEqual({
			ok: true,
			value: { remoteId: '1200' }
		});
		expect(calls.every((call) => call.method === 'GET')).toBe(true);
	});

	it('refuses a correction whose two sides land in one account', async () => {
		serving(() => undefined);
		const provider = createQuickbooksProvider(CREDENTIALS, store());

		const result = await provider.sendCorrection({
			...CORRECTION,
			lines: [
				{ role: 'income', posting: 'debit', amountMinor: 2_500 },
				{ role: 'income', posting: 'credit', amountMinor: 2_500 }
			]
		});

		// both of this app's accounts map to the one QuickBooks account, so the entry would move
		// nothing — and an entry that moves nothing is worse than none: it reads as a correction made.
		expect(result).toMatchObject({ ok: false, reason: 'invalid_record', retryable: false });
	});
});

describe('the chart of accounts', () => {
	it('lists what the connection screen picks from, page by page', async () => {
		serving((method, url) =>
			method === 'GET' && (url.searchParams.get('query') ?? '').includes('from Account')
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
				{ id: '79', name: 'Donations', type: 'Income', classification: 'Revenue' },
				{ id: '35', name: 'Checking', type: 'Bank', classification: 'Asset' }
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
			saveTokens: async () => {}
		});

		expect(await provider.revokeTokens()).toMatchObject({ ok: false, reason: 'not_connected' });
	});
});
