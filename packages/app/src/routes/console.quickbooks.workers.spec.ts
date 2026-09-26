import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CONSOLE_SESSION_SECONDS,
	CONSOLE_TOKEN_MIN_RANDOM,
	formatConsoleToken
} from '@better-giving/operator/console/token';
import type {
	QuickbooksPressReport,
	QuickbooksReport
} from '@better-giving/operator/console/quickbooks';
import { readConnectLink } from '$lib/server/accounting/connect-link';
import { QUICKBOOKS_PRODUCTION_URL } from '$lib/server/accounting/quickbooks';
import { connectQuickbooks, readQuickbooksConnection } from '$lib/server/accounting/connection';
import {
	failed,
	type AccountingProvider,
	type AccountingResult,
	type LedgerAccount
} from '$lib/server/accounting/provider';
import { postableId } from '$lib/server/db/accounts';
import { createDb, type Db } from '$lib/server/db/client';
import { contact, donation, payment, quickbooksSync } from '$lib/server/db/schema';
import { post, postingStatements } from '$lib/server/ledger/posting';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as quickbooks from './console.quickbooks';
import * as surface from './console';

// the console's QuickBooks address, against a real D1.
//
// a workers spec because every answer is assembled out of rows — the connection, the picks, the
// queue — and standing in for D1 would prove the stand-in (CLAUDE.md). the request is mounted
// through the surface's own layout rather than handed to a handler, which is what puts the
// credential check in front of it: ../route-request.testing.ts states why.
//
// the provider is stood in for because nothing here is about Intuit's wire
// ($lib/server/accounting/quickbooks.spec.ts holds that), and a refusal is handed over as the
// port's own `failed(...)` so the two cannot disagree about what a reason is called.

const OWN = 'https://give.example.workers.dev';
/** the second hostname the same deployment answers on, and the one an operator pinned it to. */
const PINNED = 'https://donate.example.org';
const REALM = '4620816365';

const EXPIRES_AT = new Date(
	Math.floor((Date.now() + CONSOLE_SESSION_SECONDS * 1000) / 1000) * 1000
);
const TOKEN = formatConsoleToken(EXPIRES_AT, 'z'.repeat(CONSOLE_TOKEN_MIN_RANDOM));

const SECRET = 'a-signing-key-as-long-as-a-real-one-would-be';
const DEPLOYMENT = {
	CONSOLE_TOKEN: TOKEN,
	BETTER_AUTH_SECRET: SECRET,
	QUICKBOOKS_CLIENT_ID: 'ABCintuitClientId',
	QUICKBOOKS_CLIENT_SECRET: 'intuit-client-secret',
	// taken off the adapter rather than spelled: no Intuit address is written a second time
	// anywhere in this repository ($lib/server/accounting/sole-importer.spec.ts).
	QUICKBOOKS_API_URL: QUICKBOOKS_PRODUCTION_URL
};

const CHART: readonly LedgerAccount[] = [
	{ id: '79', name: 'Contributions', type: 'Income', subType: null, classification: 'Revenue' },
	{ id: '80', name: 'Merchant fees', type: 'Expense', subType: null, classification: 'Expense' },
	{ id: '35', name: 'Checking', type: 'Bank', subType: null, classification: 'Asset' },
	{
		id: '140',
		name: 'Stripe balance',
		type: 'Other Current Asset',
		subType: 'OtherCurrentAssets',
		classification: 'Asset'
	},
	{
		id: '4',
		name: 'Undeposited Funds',
		type: 'Other Current Asset',
		subType: 'UndepositedFunds',
		classification: 'Asset'
	}
];

/** an accounts press naming every role: income and fee, Stripe's holding and undeposited funds. */
const PICKS = {
	press: 'accounts',
	income: '79',
	fee: '80',
	stripeBalance: '140',
	paypalBalance: null,
	chariotBalance: null,
	nowpaymentsBalance: null,
	undepositedFunds: '4'
};

const stub = vi.hoisted(() => ({
	accounts: null as AccountingResult<readonly LedgerAccount[]> | null,
	revoked: null as AccountingResult<null> | null
}));

vi.mock('$lib/server/accounting/factory', () => ({
	createAccountingProvider: (): AccountingProvider => {
		// every arm, so the stub is the port rather than a cast over part of it — and the six this
		// route never calls refuse loudly, which is what turns a route that reached for one into a
		// failing case instead of an undefined.
		const unasked = async () => failed('internal_error', 'this route does not call this arm');
		return {
			listAccounts: async () => stub.accounts ?? failed('internal_error', 'no case set a chart'),
			revokeTokens: async () => stub.revoked ?? failed('internal_error', 'no case set a revoke'),
			readCompany: unasked,
			sendGift: unasked,
			sendCorrection: unasked,
			sendReversal: unasked,
			authorizeUrl: unasked,
			exchangeCode: unasked,
			createHoldingAccount: unasked
		};
	}
}));

const routes: RouteRequester = mountRoutes([
	{ path: 'console', module: surface },
	{ path: 'quickbooks', module: quickbooks }
]);

function envWith(values: Record<string, string | undefined>): Env {
	return new Proxy(env, {
		get: (target, property) =>
			typeof property === 'string' && property in values
				? values[property]
				: Reflect.get(target, property)
	}) as Env;
}

const headers = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };

// every request arrives on `OWN`, so a case handing `vars` a pin is asking what this address says
// about a deployment reachable on a hostname other than the one the console reached it on.
const read = (vars: Record<string, string | undefined> = DEPLOYMENT): Promise<Response> =>
	routes(new Request(`${OWN}/console/quickbooks`, { headers }), {
		env: envWith(vars)
	});

const press = (
	body: unknown,
	vars: Record<string, string | undefined> = DEPLOYMENT
): Promise<Response> =>
	routes(
		new Request(`${OWN}/console/quickbooks`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
		}),
		{ env: envWith(vars) }
	);

let db: Db;

beforeEach(async () => {
	db = createDb(env.DB);
	// the lines before the group they hang off, and the queue before both: both are foreign keys,
	// so any other order is a constraint violation rather than an empty table.
	for (const table of [
		'quickbooks_sync',
		'ledger_entry',
		'entry_group',
		'payment',
		'donation',
		'contact',
		'quickbooks_connection'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	stub.accounts = { ok: true, value: CHART };
	stub.revoked = { ok: true, value: null };
});

const CONNECTED_FROM = new Date('2026-01-01T00:00:00.000Z');

async function connect(): Promise<void> {
	await connectQuickbooks(db, {
		realmId: REALM,
		tokens: {
			accessToken: 'access-one',
			accessTokenExpiresAt: new Date('2026-03-01T11:00:00.000Z'),
			refreshToken: 'refresh-one',
			refreshTokenExpiresAt: null
		},
		startAt: CONNECTED_FROM
	});
}

/** one gift given up on, so the backlog and the retry press have something to act on. */
async function givenUp(): Promise<string> {
	const at = new Date('2026-02-01T00:00:00.000Z');
	// through `post()` rather than around it: a group written straight in is a group with no lines,
	// which is the unbalanced write $lib/server/ledger/sole-writer.spec.ts exists to refuse.
	const entry = post({
		sourceType: 'donation',
		sourceId: crypto.randomUUID(),
		currency: 'USD',
		occurredAt: at,
		memo: null,
		lines: [
			{ accountId: postableId('undepositedFunds'), amountMinor: 10_000 },
			{ accountId: postableId('donationsDeductible'), amountMinor: -10_000 }
		]
	});
	const id = entry.group.id;
	if (id === undefined) throw new Error('post() minted no entry group id');
	await db.batch([
		...postingStatements(db, entry),
		db.insert(quickbooksSync).values({
			entryGroupId: id,
			status: 'failed',
			attempts: 3,
			lastError: 'Intuit refused the payload.',
			notifiedAt: at,
			createdAt: at,
			updatedAt: at
		})
	]);
	return id;
}

/**
 * a gift given up on, refunded in full, and the refund queued behind it: the payment rows written
 * the way the settlement and the refund write them, since a refund is found by its parent payment.
 */
async function refundBehindGivenUp(): Promise<{ gift: string; refund: string }> {
	const at = new Date('2026-02-01T00:00:00.000Z');
	const contactId = crypto.randomUUID();
	const donationId = crypto.randomUUID();
	const giftId = crypto.randomUUID();
	const refundId = crypto.randomUUID();
	const moved = (sourceType: 'payment' | 'refund', sourceId: string, sign: 1 | -1) =>
		post({
			sourceType,
			sourceId,
			currency: 'USD',
			occurredAt: at,
			memo: null,
			lines: [
				{ accountId: postableId('undepositedFunds'), amountMinor: sign * 10_000 },
				{ accountId: postableId('donationsDeductible'), amountMinor: -sign * 10_000 }
			]
		});
	const gift = moved('payment', giftId, 1);
	const refund = moved('refund', refundId, -1);
	const giftGroup = gift.group.id;
	const refundGroup = refund.group.id;
	if (giftGroup === undefined || refundGroup === undefined)
		throw new Error('post() minted no entry group id');
	const paid = {
		donationId,
		amountMinor: 10_000,
		currency: 'USD',
		method: 'card',
		status: 'succeeded',
		provider: 'stripe',
		occurredAt: at
	} as const;
	await db.batch([
		db.insert(contact).values({ id: contactId, kind: 'individual', displayName: 'Ada Lovelace' }),
		db
			.insert(donation)
			.values({ id: donationId, contactId, totalMinor: 10_000, currency: 'USD', receivedAt: at }),
		db
			.insert(payment)
			.values({ ...paid, id: giftId, direction: 'inbound', providerTxnId: `pi_${giftId}` }),
		db.insert(payment).values({
			...paid,
			id: refundId,
			direction: 'refund',
			parentPaymentId: giftId,
			providerTxnId: `re_${refundId}`
		}),
		...postingStatements(db, gift),
		...postingStatements(db, refund),
		db.insert(quickbooksSync).values({
			entryGroupId: giftGroup,
			status: 'failed',
			attempts: 3,
			lastError: 'Intuit refused the payload.',
			createdAt: at,
			updatedAt: at
		}),
		db.insert(quickbooksSync).values({ entryGroupId: refundGroup, createdAt: at, updatedAt: at })
	]);
	return { gift: giftGroup, refund: refundGroup };
}

describe('GET /console/quickbooks', () => {
	it('says no company is connected, and asks Intuit nothing', async () => {
		const answered = await read();

		expect(answered.status).toBe(200);
		expect(await answered.json<QuickbooksReport>()).toEqual({
			connection: { state: 'disconnected' },
			accounts: null,
			backlog: { failed: 0, oldestWaitingAt: null, heldBehindFailed: [] },
			callbackAddress: `${OWN}/quickbooks/callback`
		});
	});

	// what an operator registers at Intuit is this sentence, and what is sent on the round trip is
	// built from the same value — so a pinned deployment naming the host the console happened to
	// reach would have them register an address Intuit then refuses.
	it('names the callback at the address this deployment is pinned to', async () => {
		const report = await (
			await read({ ...DEPLOYMENT, BETTER_AUTH_URL: PINNED })
		).json<QuickbooksReport>();

		expect(report.callbackAddress).toBe(`${PINNED}/quickbooks/callback`);
	});

	it('draws the connected company beside the chart its accounts are picked out of', async () => {
		await connect();
		await givenUp();

		const report = await (await read()).json<QuickbooksReport>();

		expect(report.connection).toEqual({
			state: 'connected',
			realmId: REALM,
			companyName: null,
			income: null,
			fee: null,
			stripeBalance: null,
			paypalBalance: null,
			chariotBalance: null,
			nowpaymentsBalance: null,
			undepositedFunds: null,
			awaitingAccounts: false,
			startAt: CONNECTED_FROM.toISOString()
		});
		// the bank account fits no role: nothing this deployment sends is posted to the bank.
		expect(report.accounts).toEqual({
			state: 'read',
			accounts: [
				{ ...CHART[0], roles: ['income'] },
				{ ...CHART[1], roles: ['fee'] },
				{ ...CHART[2], roles: [] },
				{
					...CHART[3],
					roles: [
						'stripeBalance',
						'paypalBalance',
						'chariotBalance',
						'nowpaymentsBalance',
						'undepositedFunds'
					]
				},
				{ ...CHART[4], roles: ['undepositedFunds'] }
			]
		});
		expect(report.backlog).toEqual({
			failed: 1,
			oldestWaitingAt: new Date('2026-02-01T00:00:00.000Z').toISOString(),
			heldBehindFailed: []
		});
	});

	it('names each refund held behind a gift that was given up on, and the gift it waits on', async () => {
		const held = await refundBehindGivenUp();

		const report = await (await read()).json<QuickbooksReport>();

		expect(report.backlog.heldBehindFailed).toEqual([
			{ entryGroupId: held.refund, waitsOn: held.gift }
		]);
	});

	it('says a lapsed credential is one to connect again', async () => {
		await connect();
		stub.accounts = failed('reconnect_needed', 'The stored credential was refused.');

		const response = await read();

		// a dead credential is the one refusal this address has to answer *with* rather than fail
		// on: it is what a console shows an operator the way out of.
		expect(response.status).toBe(200);
		expect((await response.json<QuickbooksReport>()).accounts).toEqual({
			state: 'unreadable',
			recourse: 'reconnect',
			detail: 'The stored credential was refused.'
		});
	});

	it('says a provider it could not reach is one to wait on', async () => {
		await connect();
		stub.accounts = failed('unreachable', 'Intuit did not answer.');

		const report = await (await read()).json<QuickbooksReport>();

		expect(report.accounts).toEqual({
			state: 'unreadable',
			recourse: 'wait',
			detail: 'Intuit did not answer.'
		});
	});

	it('names no way out of a refusal that is neither', async () => {
		await connect();
		stub.accounts = failed('rate_limited', 'Intuit is shedding load.');

		const report = await (await read()).json<QuickbooksReport>();

		expect(report.accounts).toEqual({
			state: 'unreadable',
			recourse: null,
			detail: 'Intuit is shedding load.'
		});
	});
});

describe('the connect press', () => {
	it('answers an address this deployment will honour', async () => {
		const answered = await press({ press: 'connect' });

		expect(answered.status).toBe(200);
		const report = await answered.json<QuickbooksPressReport>();
		if (report.press !== 'connect') throw new Error(`answered ${report.press}`);
		expect(
			await readConnectLink({ secret: SECRET, url: new URL(report.url), now: new Date() })
		).toBe(true);
	});

	it('mints it at the address this deployment is pinned to, not the one the press arrived on', async () => {
		const answered = await press({ press: 'connect' }, { ...DEPLOYMENT, BETTER_AUTH_URL: PINNED });

		const report = await answered.json<QuickbooksPressReport>();
		if (report.press !== 'connect') throw new Error(`answered ${report.press}`);
		expect(new URL(report.url).origin).toBe(PINNED);
	});
});

describe('the accounts', () => {
	it('stores each pick with the name it carries in the company’s own books', async () => {
		await connect();

		const answered = await press(PICKS);

		expect(answered.status).toBe(200);
		expect((await readQuickbooksConnection(db))?.accounts).toEqual({
			income: { id: '79', name: 'Contributions' },
			fee: { id: '80', name: 'Merchant fees' },
			stripeBalance: { id: '140', name: 'Stripe balance' },
			paypalBalance: null,
			chariotBalance: null,
			nowpaymentsBalance: null,
			undepositedFunds: { id: '4', name: 'Undeposited Funds' }
		});
	});

	it('refuses a pick the company’s books do not hold', async () => {
		await connect();

		const answered = await press({ ...PICKS, stripeBalance: '999' });

		expect(answered.status).toBe(400);
		expect((await readQuickbooksConnection(db))?.accounts.income).toBeNull();
	});

	// a console a release behind still sends `deposit`; clearing every holding over it would hold
	// every gift with nothing saying why.
	it('refuses a body that leaves a role out, naming the roles it needs', async () => {
		await connect();

		const answered = await press({ press: 'accounts', income: '79', fee: '80', deposit: '35' });

		expect(answered.status).toBe(400);
		const refusal = await answered.json<{ error: string; message: string }>();
		expect(refusal.message).toContain('`stripeBalance`');
		expect(refusal.message).toContain('`undepositedFunds`');
		expect((await readQuickbooksConnection(db))?.accounts.income).toBeNull();
	});

	it('refuses a bank account as a holding, since no payout reaches QuickBooks from here', async () => {
		await connect();

		const answered = await press({ ...PICKS, stripeBalance: '35' });

		expect(answered.status).toBe(400);
		const refusal = await answered.json<{ error: string; message: string; fix: string }>();
		expect(refusal.error).toBe('account_wrong_type');
		expect(refusal.message).toContain('Checking');
		expect(refusal.message).toContain('Bank');
		expect(refusal.fix).toContain('Other Current Asset');
		expect(`${refusal.message} ${refusal.fix}`).not.toContain('usual choice');
		expect((await readQuickbooksConnection(db))?.accounts.stripeBalance).toBeNull();
	});

	it('refuses undeposited funds as a processor’s holding', async () => {
		await connect();

		const answered = await press({ ...PICKS, stripeBalance: '4' });

		expect(answered.status).toBe(400);
		const refusal = await answered.json<{ error: string; message: string }>();
		expect(refusal.error).toBe('account_wrong_type');
		expect(refusal.message).toContain('received in hand');
		expect((await readQuickbooksConnection(db))?.accounts.stripeBalance).toBeNull();
	});

	it('refuses an account the company holds but the role does not take', async () => {
		await connect();
		const receivable: LedgerAccount = {
			id: '84',
			name: 'Accounts Receivable (A/R)',
			type: 'Accounts Receivable',
			subType: 'AccountsReceivable',
			classification: 'Asset'
		};
		stub.accounts = { ok: true, value: [...CHART, receivable] };

		const answered = await press({ ...PICKS, undepositedFunds: '84' });

		expect(answered.status).toBe(400);
		const refusal = await answered.json<{ error: string; message: string }>();
		expect(refusal.error).toBe('account_wrong_type');
		expect(refusal.message).toContain('Accounts Receivable (A/R)');
		expect((await readQuickbooksConnection(db))?.accounts.undepositedFunds).toBeNull();
	});

	it('ends the hold a move to another company put on sending', async () => {
		await connect();
		await connectQuickbooks(db, {
			realmId: '9130357744',
			tokens: {
				accessToken: 'access-two',
				accessTokenExpiresAt: new Date('2026-03-01T11:00:00.000Z'),
				refreshToken: 'refresh-two',
				refreshTokenExpiresAt: null
			},
			startAt: new Date('2026-02-01T00:00:00.000Z')
		});
		const held = await (await read()).json<QuickbooksReport>();

		await press(PICKS);

		const saved = await (await read()).json<QuickbooksReport>();
		expect(held.connection).toMatchObject({ awaitingAccounts: true });
		expect(saved.connection).toMatchObject({ awaitingAccounts: false });
	});

	it('refuses the press where no company is connected', async () => {
		const answered = await press(PICKS);

		expect(answered.status).toBe(409);
	});
});

describe('the date gifts are sent from', () => {
	it('moves the date gifts are sent from', async () => {
		await connect();

		const answered = await press({ press: 'start-date', startAt: '2026-04-01T00:00:00.000Z' });

		expect(answered.status).toBe(200);
		expect((await readQuickbooksConnection(db))?.startAt).toEqual(
			new Date('2026-04-01T00:00:00.000Z')
		);
	});

	it('moves to a calendar date as its first instant in UTC', async () => {
		await connect();

		await press({ press: 'start-date', startAt: '2026-04-01' });

		expect((await readQuickbooksConnection(db))?.startAt).toEqual(
			new Date('2026-04-01T00:00:00.000Z')
		);
	});

	it('reads an instant with an offset as the moment it names', async () => {
		await connect();

		await press({ press: 'start-date', startAt: '2026-04-01T09:30:00+02:00' });

		expect((await readQuickbooksConnection(db))?.startAt).toEqual(
			new Date('2026-04-01T07:30:00.000Z')
		);
	});

	// most of these `new Date` reads without complaint: `April 1` and `1` land in 2001 and `0` in
	// 2000, February 31 rolls into March, 24:00 into the next day, and an instant with no offset is
	// read in the runtime's own zone. a move to 2001 queues the deployment's whole history.
	it.each([
		['the first of April'],
		['April 1'],
		[1],
		['0'],
		['2026-02-31'],
		['2026-02-31T00:00:00.000Z'],
		['2026-04-01T24:00:00Z'],
		['2026-04-01T00:00:00'],
		[null]
	])('refuses %j, names it, and moves nothing', async (startAt) => {
		await connect();

		const answered = await press({ press: 'start-date', startAt });

		expect(answered.status).toBe(400);
		const refusal = await answered.json<{ error: string; message: string }>();
		expect(refusal.error).toBe('bad_body');
		expect(refusal.message).toContain(JSON.stringify(startAt));
		expect(refusal.message).toContain('YYYY-MM-DD');
		expect((await readQuickbooksConnection(db))?.startAt).toEqual(CONNECTED_FROM);
	});
});

/** one record owed to QuickBooks dated `at`, queued `pending` or not queued at all. */
async function owed(
	sourceType: 'payment' | 'adjustment',
	at: string,
	queued: boolean
): Promise<void> {
	const occurredAt = new Date(at);
	const entry = post({
		sourceType,
		sourceId: crypto.randomUUID(),
		currency: 'USD',
		occurredAt,
		memo: null,
		lines: [
			{ accountId: postableId('undepositedFunds'), amountMinor: 10_000 },
			{ accountId: postableId('donationsDeductible'), amountMinor: -10_000 }
		]
	});
	const id = entry.group.id;
	if (id === undefined) throw new Error('post() minted no entry group id');
	await db.batch([
		...postingStatements(db, entry),
		...(queued
			? [
					db.insert(quickbooksSync).values({
						entryGroupId: id,
						status: 'pending',
						attempts: 0,
						createdAt: occurredAt,
						updatedAt: occurredAt
					})
				]
			: [])
	]);
}

const TOUCHES_NOTHING = { gifts: 0, corrections: 0, reversals: 0, earliest: null, latest: null };

describe('the preview of a date move', () => {
	it('counts what an earlier date would queue', async () => {
		await connect();
		await owed('payment', '2025-11-15T00:00:00.000Z', false);
		await owed('adjustment', '2025-12-10T00:00:00.000Z', false);

		const answered = await press({
			press: 'start-date-preview',
			startAt: '2025-11-01T00:00:00.000Z'
		});

		expect(await answered.json<QuickbooksPressReport>()).toEqual({
			press: 'start-date-preview',
			startAt: '2025-11-01T00:00:00.000Z',
			queues: {
				gifts: 1,
				corrections: 1,
				reversals: 0,
				earliest: '2025-11-15T00:00:00.000Z',
				latest: '2025-12-10T00:00:00.000Z'
			},
			drops: TOUCHES_NOTHING
		});
	});

	it('counts what a later date would drop', async () => {
		await connect();
		await owed('payment', '2026-02-01T00:00:00.000Z', true);
		await owed('payment', '2026-02-20T00:00:00.000Z', true);
		await owed('payment', '2026-03-15T00:00:00.000Z', true);

		const answered = await press({
			press: 'start-date-preview',
			startAt: '2026-03-01T00:00:00.000Z'
		});

		expect(await answered.json<QuickbooksPressReport>()).toEqual({
			press: 'start-date-preview',
			startAt: '2026-03-01T00:00:00.000Z',
			queues: TOUCHES_NOTHING,
			drops: {
				gifts: 2,
				corrections: 0,
				reversals: 0,
				earliest: '2026-02-01T00:00:00.000Z',
				latest: '2026-02-20T00:00:00.000Z'
			}
		});
	});

	it('names the date it counted, as the instant it read', async () => {
		await connect();

		const answered = await press({ press: 'start-date-preview', startAt: '2026-03-01' });

		expect(await answered.json<QuickbooksPressReport>()).toMatchObject({
			startAt: '2026-03-01T00:00:00.000Z'
		});
	});

	it('moves nothing and queues nothing', async () => {
		await connect();
		await owed('payment', '2025-11-15T00:00:00.000Z', false);
		await owed('payment', '2026-02-01T00:00:00.000Z', true);

		await press({ press: 'start-date-preview', startAt: '2026-03-01T00:00:00.000Z' });
		await press({ press: 'start-date-preview', startAt: '2025-11-01T00:00:00.000Z' });

		expect((await readQuickbooksConnection(db))?.startAt).toEqual(CONNECTED_FROM);
		const rows = await db.select({ status: quickbooksSync.status }).from(quickbooksSync);
		expect(rows).toEqual([{ status: 'pending' }]);
	});

	it.each([['the first of April'], ['April 1'], [1], ['0'], ['2026-02-31']])(
		'refuses %j, and names it',
		async (startAt) => {
			await connect();

			const answered = await press({ press: 'start-date-preview', startAt });

			expect(answered.status).toBe(400);
			const refusal = await answered.json<{ error: string; message: string }>();
			expect(refusal.error).toBe('bad_body');
			expect(refusal.message).toContain(JSON.stringify(startAt));
		}
	);

	it('refuses the press where no company is connected', async () => {
		const answered = await press({
			press: 'start-date-preview',
			startAt: '2026-03-01T00:00:00.000Z'
		});

		expect(answered.status).toBe(409);
	});
});

describe('the retry press', () => {
	it('refuses the press where no company is connected', async () => {
		await givenUp();

		const answered = await press({ press: 'retry' });

		expect(answered.status).toBe(409);
		// and repairs nothing: a row put back to `pending` on a deployment with nowhere to send it
		// is a count reported over a press that did nothing.
		const [row] = await db.select({ status: quickbooksSync.status }).from(quickbooksSync);
		expect(row).toEqual({ status: 'failed' });
	});

	it('queues every gift that was given up on again', async () => {
		await connect();
		await givenUp();

		const answered = await press({ press: 'retry' });

		expect(await answered.json<QuickbooksPressReport>()).toEqual({ press: 'retry', retried: 1 });
		const [row] = await db
			.select({ status: quickbooksSync.status, notifiedAt: quickbooksSync.notifiedAt })
			.from(quickbooksSync);
		expect(row).toEqual({ status: 'pending', notifiedAt: null });
	});
});

describe('the disconnect press', () => {
	it('leaves no credential behind even where Intuit refused the revoke, and says where to finish it', async () => {
		await connect();
		stub.revoked = failed('unreachable', 'Intuit did not answer.');

		const answered = await press({ press: 'disconnect' });

		expect(answered.status).toBe(200);
		expect(await readQuickbooksConnection(db)).toBeNull();
		const report = await answered.json<QuickbooksPressReport>();
		const revoke = report.press === 'disconnect' ? report.revoke : null;
		expect(revoke).toMatchObject({ state: 'not_revoked' });
		expect(revoke?.state === 'not_revoked' && revoke.detail).toContain('Intuit did not answer.');
		expect(revoke?.state === 'not_revoked' && revoke.fix).toContain('My Apps');
	});

	it('says the revoke landed where Intuit took it', async () => {
		await connect();

		const answered = await press({ press: 'disconnect' });

		expect(await answered.json()).toEqual({ press: 'disconnect', revoke: { state: 'revoked' } });
		expect(await readQuickbooksConnection(db)).toBeNull();
	});
});

describe('a press this address does not take', () => {
	it('refuses a body naming no press at all', async () => {
		expect((await press({})).status).toBe(400);
	});

	it('refuses a press by a name nothing here answers to', async () => {
		expect((await press({ press: 'reconnect' })).status).toBe(400);
	});
});
