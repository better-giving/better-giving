import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUICKBOOKS_PRODUCTION_URL } from '$lib/server/accounting/quickbooks';
import type { QuickbooksScreen } from '$lib/server/accounting/quickbooks-screen';
import {
	failed,
	type AccountingProvider,
	type AccountingResult,
	type LedgerAccount
} from '$lib/server/accounting/provider';
import { readConnectLink } from '$lib/server/accounting/connect-link';
import { connectQuickbooks, readQuickbooksConnection } from '$lib/server/accounting/connection';
import { postableId } from '$lib/server/db/accounts';
import { readAuthEnv, resolveAuthSecret } from '$lib/server/auth';
import { createDb, type Db } from '$lib/server/db/client';
import { contact, donation, payment, quickbooksSync } from '$lib/server/db/schema';
import { post, postingStatements } from '$lib/server/ledger/posting';
import { client, run, stmt } from '$lib/server/db/database.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { signInAsDeployer, signInAsMember } from '../staff-session.testing';
import { finishSetup } from '../webhook-routes.testing';
import * as layout from './_app';
import * as books from './_app.admin.books';
import * as connectStart from './quickbooks.connect';

// the QuickBooks half of the Books screen, against a real database and through the protected
// layout, since who is signed in is what decides whether the half is there at all.
//
// Intuit is stood in for at the port and nowhere nearer: a refusal is the port's own `failed(...)`.
// the arms a case does not script delegate to the real adapter, which is what lets the connect case
// follow the round trip as far as Intuit's own address.

const ORIGIN = 'https://give.example';
const SCREEN = '/admin/books';
const PASSWORD = 'a-very-long-random-staff-password';
const DEPLOYMENT_ORIGIN = { password: PASSWORD, origin: ORIGIN };

/** the three values a deployment reaches Intuit with, taken off the adapter rather than spelled. */
const KEYS = {
	QUICKBOOKS_CLIENT_ID: 'ABCintuitClientId',
	QUICKBOOKS_CLIENT_SECRET: 'intuit-client-secret',
	QUICKBOOKS_API_URL: QUICKBOOKS_PRODUCTION_URL
};

const stub = vi.hoisted(() => ({
	accounts: null as AccountingResult<readonly LedgerAccount[]> | null,
	revoked: null as AccountingResult<null> | null
}));

vi.mock('$lib/server/accounting/factory', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/accounting/factory')>();
	return {
		...actual,
		createAccountingProvider: (source: unknown, db: Db): AccountingProvider => {
			const real = actual.createAccountingProvider(source, db);
			return {
				...real,
				// null hands the read to the real adapter, which only a case without Intuit's keys
				// does: with none it answers without reaching anywhere.
				listAccounts: async () => stub.accounts ?? real.listAccounts(),
				revokeTokens: async () => stub.revoked ?? failed('internal_error', 'no case set a revoke')
			};
		}
	};
});

let db: Db;
let request: RouteRequester;
let connectRoute: RouteRequester;
let bindings: Env;
let deployer: string;

beforeAll(async () => {
	db = createDb(client);
	bindings = await finishSetup(PASSWORD);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/books', module: books }
	]);
	connectRoute = mountRoutes([{ path: 'quickbooks/connect', module: connectStart }]);
});

beforeEach(async () => {
	for (const table of [
		'quickbooks_sync',
		'ledger_entry',
		'entry_group',
		'payment',
		'donation',
		'contact',
		'quickbooks_connection',
		'auth_member_invitation',
		'auth_session',
		'auth_user'
	]) {
		await run(stmt(`delete from ${table}`));
	}
	stub.accounts = failed('internal_error', 'no case set a chart');
	stub.revoked = null;
	deployer = await signInAsDeployer(db, { env: bindings, ...DEPLOYMENT_ORIGIN });
});

/** the deployment's bindings with `vars` laid over them. */
const envWith = (vars: Record<string, string | undefined> = {}): Env =>
	({ ...bindings, ...vars }) as Env;

function get(cookie: string, env: Env = envWith(KEYS)): Promise<Response> {
	return request(new Request(`${ORIGIN}${SCREEN}`, { headers: { cookie } }), { env });
}

/** the screen's loader data as it crosses the wire. */
async function drawn(cookie: string = deployer, env?: Env): Promise<Screen> {
	const response = await get(cookie, env);
	expect(response.status).toBe(200);
	return (await response.json()) as Screen;
}

/** the loader's answer, with the QuickBooks half drawn rather than refused: no case here refuses it. */
type Screen = Omit<Awaited<ReturnType<typeof books.loader>>, 'quickbooks'> & {
	quickbooks: QuickbooksScreen | null;
};

describe('a member’s session', () => {
	it('draws Corrections and Entries and no QuickBooks, which the deployer is drawn', async () => {
		const member = await signInAsMember(db, { env: bindings, ...DEPLOYMENT_ORIGIN });

		const theirs = await drawn(member);
		const ours = await drawn(deployer);

		expect(theirs.quickbooks).toBeNull();
		expect(theirs.accounts.length).toBeGreaterThan(0);
		expect(ours.quickbooks).not.toBeNull();
	});
});

describe('the setup step', () => {
	it('says the keys are not on the server, and names the address to register at Intuit', async () => {
		const screen = await drawn(deployer, envWith());

		expect(screen.quickbooks).toMatchObject({
			keys: false,
			callback: `${ORIGIN}/quickbooks/callback`,
			company: null
		});
	});

	it('names that address at the one this deployment is pinned to', async () => {
		const screen = await drawn(
			deployer,
			envWith({ ...KEYS, BETTER_AUTH_URL: 'https://donate.example.org' })
		);

		expect(screen.quickbooks?.callback).toBe('https://donate.example.org/quickbooks/callback');
	});

	it('says the keys are there once all three are set', async () => {
		expect((await drawn()).quickbooks?.keys).toBe(true);
		expect(
			(await drawn(deployer, envWith({ ...KEYS, QUICKBOOKS_API_URL: '' }))).quickbooks?.keys
		).toBe(false);
	});
});

const REALM = '4620816365';
const CONNECTED_FROM = new Date('2026-01-01T00:00:00.000Z');

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

async function connect(realmId = REALM): Promise<void> {
	await connectQuickbooks(db, {
		realmId,
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
async function givenUp(): Promise<void> {
	const at = new Date('2026-02-01T00:00:00.000Z');
	// through `post()`: a group written straight in has no lines, which
	// $lib/server/ledger/sole-writer.spec.ts exists to refuse.
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
}

/**
 * a gift given up on, refunded in full, and the refund queued behind it: the payment rows written
 * the way the settlement and the refund write them, since a refund is found by its parent payment.
 */
async function refundBehindGivenUp(): Promise<void> {
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
}

describe('a connected company', () => {
	it('is drawn beside the chart its accounts are picked from, each account with the roles it fits', async () => {
		await connect();
		stub.accounts = { ok: true, value: CHART };

		const { quickbooks } = await drawn();

		expect(quickbooks?.company).toEqual({
			name: REALM,
			awaitingAccounts: false,
			startOn: '2026-01-01',
			picks: {
				income: null,
				fee: null,
				stripeBalance: null,
				paypalBalance: null,
				chariotBalance: null,
				nowpaymentsBalance: null,
				undepositedFunds: null
			}
		});
		expect(quickbooks?.chart).toEqual({
			state: 'read',
			accounts: [
				{ id: '79', label: 'Contributions — Income', roles: ['income'] },
				{ id: '80', label: 'Merchant fees — Expense', roles: ['fee'] },
				{ id: '35', label: 'Checking — Bank', roles: [] },
				{
					id: '140',
					label: 'Stripe balance — Other Current Asset',
					roles: [
						'stripeBalance',
						'paypalBalance',
						'chariotBalance',
						'nowpaymentsBalance',
						'undepositedFunds'
					]
				},
				{ id: '4', label: 'Undeposited Funds — Other Current Asset', roles: ['undepositedFunds'] }
			]
		});
	});

	it('draws a picker for each processor gifts are taken through, and for gifts recorded by hand', async () => {
		await connect();
		stub.accounts = { ok: true, value: CHART };

		// the bindings hold Stripe's pair and no other processor's.
		expect((await drawn()).quickbooks?.holdings).toEqual(['stripeBalance', 'undepositedFunds']);
	});

	it('says a lapsed credential is one to connect again, and a provider out of reach one to wait on', async () => {
		await connect();
		stub.accounts = failed('reconnect_needed', 'The stored credential was refused.');
		const lapsed = (await drawn()).quickbooks?.chart;
		stub.accounts = failed('unreachable', 'Intuit did not answer.');
		const away = (await drawn()).quickbooks?.chart;

		expect(lapsed).toEqual({
			state: 'unreadable',
			recourse: 'reconnect',
			detail: 'The stored credential was refused.'
		});
		expect(away).toMatchObject({ state: 'unreadable', recourse: 'wait' });
	});

	it('says the keys a connected company is short of go in `.env`, never on a console', async () => {
		await connect();
		stub.accounts = null;

		const chart = (await drawn(deployer, envWith())).quickbooks?.chart;

		expect(chart).toMatchObject({ state: 'unreadable', recourse: null });
		const detail = chart?.state === 'unreadable' ? chart.detail : '';
		expect(detail).toContain('`.env`');
		expect(detail).not.toContain('console');
	});

	it('counts the gifts that did not sync, and only while a company is connected', async () => {
		await givenUp();
		const alone = (await drawn()).quickbooks?.backlog;
		await connect();
		stub.accounts = { ok: true, value: CHART };

		const backlog = (await drawn()).quickbooks?.backlog;

		expect(alone).toBeNull();
		expect(backlog).toMatchObject({ failed: 1, held: null });
		expect(backlog?.behind).toMatch(/days$/);
	});

	it('counts the refunds held behind a gift that did not sync, and the gifts they wait on', async () => {
		await refundBehindGivenUp();
		await connect();
		stub.accounts = { ok: true, value: CHART };

		const backlog = (await drawn()).quickbooks?.backlog;

		expect(backlog).toMatchObject({ failed: 1, held: { refunds: 1, gifts: 1 } });
	});
});

function press(
	form: string,
	boxes: Record<string, string> = {},
	cookie: string = deployer,
	env: Env = envWith(KEYS)
): Promise<Response> {
	const body = new FormData();
	body.set('__form_id__', form);
	for (const [name, value] of Object.entries(boxes)) body.set(name, value);
	return request(
		new Request(`${ORIGIN}${SCREEN}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body
		}),
		{ env }
	);
}

/** an accounts press naming every role: income and fee, Stripe's holding and undeposited funds. */
const PICKS = {
	income: '79',
	fee: '80',
	stripeBalance: '140',
	paypalBalance: '',
	chariotBalance: '',
	nowpaymentsBalance: '',
	undepositedFunds: '4'
};

describe('a member’s press', () => {
	it.each([
		['quickbooks-connect', {}],
		['quickbooks-disconnect', {}],
		['quickbooks-accounts', PICKS],
		['quickbooks-start-date-preview', { start_on: '2026-03-01' }],
		['quickbooks-start-date', { start_on: '2026-03-01' }],
		['quickbooks-retry', {}]
	])('on %s gets not-found, and changes nothing', async (form, boxes) => {
		await connect();
		await givenUp();
		stub.accounts = { ok: true, value: CHART };
		const member = await signInAsMember(db, { env: bindings, ...DEPLOYMENT_ORIGIN });

		const answered = await press(form, boxes, member);

		expect(answered.status).toBe(404);
		const kept = await readQuickbooksConnection(db);
		expect(kept?.startAt).toEqual(CONNECTED_FROM);
		expect(kept?.accounts.income).toBeNull();
		const [row] = await db.select({ status: quickbooksSync.status }).from(quickbooksSync);
		expect(row).toEqual({ status: 'failed' });
	});
});

describe('the connect press', () => {
	it('sends the deployer’s browser to a start address this deployment honours, and on to Intuit', async () => {
		const answered = await press('quickbooks-connect');

		expect(answered.status).toBe(302);
		// a whole-document load: the trip leaves this app for Intuit's own page.
		expect(answered.headers.get('x-remix-reload-document')).toBe('true');
		const start = new URL(answered.headers.get('location') ?? '');
		const key = await resolveAuthSecret(db, readAuthEnv(envWith(KEYS)));
		if (!key.ok) throw new Error(key.cause);
		expect(await readConnectLink({ secret: key.secret, url: start, now: new Date() })).toBe(true);

		const onward = await connectRoute(new Request(start), { env: envWith(KEYS) });
		expect(onward.status).toBe(302);
		expect(new URL(onward.headers.get('location') ?? '').hostname).toMatch(/intuit\.com$/);
	});

	it('mints it at the address this deployment is pinned to', async () => {
		const answered = await press(
			'quickbooks-connect',
			{},
			deployer,
			envWith({ ...KEYS, BETTER_AUTH_URL: 'https://donate.example.org' })
		);

		expect(new URL(answered.headers.get('location') ?? '').origin).toBe(
			'https://donate.example.org'
		);
	});
});

describe('the disconnect press', () => {
	it('revokes the credential and forgets the company', async () => {
		await connect();
		stub.revoked = { ok: true, value: null };

		const answered = await press('quickbooks-disconnect');

		expect(await answered.json()).toEqual({ disconnected: { revoked: true } });
		expect(await readQuickbooksConnection(db)).toBeNull();
	});

	it('forgets the company even where Intuit refused the revoke, and says what Intuit said', async () => {
		await connect();
		stub.revoked = failed('unreachable', 'Intuit did not answer.');

		const answered = await press('quickbooks-disconnect');

		expect(answered.status).toBe(200);
		expect(await answered.json()).toEqual({
			disconnected: { revoked: false, detail: 'Intuit did not answer.' }
		});
		expect(await readQuickbooksConnection(db)).toBeNull();
	});
});

/** a refusal's sentences under each box, as the screen reads them back. */
async function refusedBoxes(response: Response): Promise<Record<string, string[]>> {
	const answer = (await response.json()) as {
		form?: { result?: { error?: Record<string, string[]> } };
	};
	return answer.form?.result?.error ?? {};
}

describe('the accounts press', () => {
	beforeEach(() => {
		stub.accounts = { ok: true, value: CHART };
	});

	it('stores each pick under the name it carries in the company’s own books', async () => {
		await connect();

		const answered = await press('quickbooks-accounts', PICKS);

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

	it('refuses a bank account as a holding, under its picker, and stores nothing', async () => {
		await connect();

		const answered = await press('quickbooks-accounts', { ...PICKS, stripeBalance: '35' });

		expect(answered.status).toBe(400);
		expect(await refusedBoxes(answered)).toEqual({
			stripeBalance: ['pick an Other Current Asset account, never a bank account']
		});
		expect((await readQuickbooksConnection(db))?.accounts.income).toBeNull();
	});

	it('refuses an account in the wrong place for income, and one the chart does not hold', async () => {
		await connect();

		const answered = await press('quickbooks-accounts', { ...PICKS, income: '80', fee: '999' });

		expect(answered.status).toBe(400);
		expect(Object.keys(await refusedBoxes(answered)).sort()).toEqual(['fee', 'income']);
		expect((await readQuickbooksConnection(db))?.accounts.income).toBeNull();
	});

	it('refuses a body that leaves a role out, so a save never clears one by omission', async () => {
		await connect();
		const { paypalBalance: _left, ...short } = PICKS;

		const answered = await press('quickbooks-accounts', short);

		expect(answered.status).toBe(400);
		expect((await readQuickbooksConnection(db))?.accounts.income).toBeNull();
	});

	it('ends the hold a move to another company put on sending', async () => {
		await connect();
		await connect('9130357744');
		const held = (await drawn()).quickbooks?.company?.awaitingAccounts;

		await press('quickbooks-accounts', PICKS);

		expect(held).toBe(true);
		expect((await drawn()).quickbooks?.company?.awaitingAccounts).toBe(false);
	});

	it('says the chart could not be read, and stores nothing', async () => {
		await connect();
		stub.accounts = failed('unreachable', 'Intuit did not answer.');

		const answered = await press('quickbooks-accounts', PICKS);

		expect(answered.status).toBe(500);
		expect(await refusedBoxes(answered)).toEqual({ '': ['Intuit did not answer.'] });
		expect((await readQuickbooksConnection(db))?.accounts.income).toBeNull();
	});

	it('refuses the press where no company is connected', async () => {
		expect((await press('quickbooks-accounts', PICKS)).status).toBe(409);
	});
});

/** one record owed to QuickBooks dated `at`, queued `pending` or not queued at all. */
async function owed(at: string, queued: boolean): Promise<void> {
	const occurredAt = new Date(at);
	const entry = post({
		sourceType: 'payment',
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

type Preview = { preview: { startOn: string; ask: { title: string; lines: string[] } | null } };

describe('the date gifts sync from', () => {
	it('asks before sending past gifts, naming what a move earlier sends, and moves nothing', async () => {
		await connect();
		await owed('2025-11-15T00:00:00.000Z', false);
		await owed('2025-12-10T00:00:00.000Z', false);

		const answered = await press('quickbooks-start-date-preview', { start_on: '2025-11-01' });

		expect(await answered.json()).toEqual({
			preview: {
				startOn: '2025-11-01',
				ask: {
					title: 'Send past gifts?',
					press: 'Send gifts',
					rank: 'exit',
					lines: [
						'Gifts · 2',
						'Dated · 15 November to 10 December 2025',
						`Company · ${REALM}`,
						'Any of these already entered in QuickBooks by hand will appear there twice.'
					]
				}
			}
		});
		expect((await readQuickbooksConnection(db))?.startAt).toEqual(CONNECTED_FROM);
	});

	it('asks before skipping unsent gifts a move later drops', async () => {
		await connect();
		await owed('2026-02-01T00:00:00.000Z', true);

		const answered = (await (
			await press('quickbooks-start-date-preview', { start_on: '2026-03-01' })
		).json()) as Preview;

		expect(answered.preview.ask).toMatchObject({
			title: 'Skip unsent gifts?',
			lines: ['Gifts · 1', 'Dated · 1 February 2026', `These won’t be sent to ${REALM}.`]
		});
	});

	it('asks nothing of a move that touches nothing', async () => {
		await connect();

		const answered = (await (
			await press('quickbooks-start-date-preview', { start_on: '2026-03-01' })
		).json()) as Preview;

		expect(answered.preview).toEqual({ startOn: '2026-03-01', ask: null });
	});

	it('moves the date to the first instant of the day in UTC', async () => {
		await connect();

		const answered = await press('quickbooks-start-date', { start_on: '2026-04-01' });

		expect(answered.status).toBe(200);
		expect((await readQuickbooksConnection(db))?.startAt).toEqual(
			new Date('2026-04-01T00:00:00.000Z')
		);
	});

	it.each(['2026-02-31', 'April 1', '1', '2026-04-01T00:00:00Z'])(
		'refuses %j under the box, and moves nothing',
		async (day) => {
			await connect();

			const answered = await press('quickbooks-start-date', { start_on: day });

			expect(answered.status).toBe(400);
			expect(Object.keys(await refusedBoxes(answered))).toEqual(['start_on']);
			expect((await readQuickbooksConnection(db))?.startAt).toEqual(CONNECTED_FROM);
		}
	);

	it('refuses both presses where no company is connected', async () => {
		const day = { start_on: '2026-03-01' };
		expect((await press('quickbooks-start-date-preview', day)).status).toBe(409);
		expect((await press('quickbooks-start-date', day)).status).toBe(409);
	});
});

describe('the retry press', () => {
	it('queues every gift that was given up on again', async () => {
		await connect();
		await givenUp();

		const answered = await press('quickbooks-retry');

		expect(await answered.json()).toEqual({ retried: 1 });
		const [row] = await db
			.select({ status: quickbooksSync.status, notifiedAt: quickbooksSync.notifiedAt })
			.from(quickbooksSync);
		expect(row).toEqual({ status: 'pending', notifiedAt: null });
	});

	it('refuses the press where no company is connected, and repairs nothing', async () => {
		await givenUp();

		const answered = await press('quickbooks-retry');

		expect(answered.status).toBe(409);
		const [row] = await db.select({ status: quickbooksSync.status }).from(quickbooksSync);
		expect(row).toEqual({ status: 'failed' });
	});
});
