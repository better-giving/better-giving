import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendDueEntries } from '../accounting/deliver';
import { createAccountingProvider } from '../accounting/factory';
import { connectQuickbooks, saveQuickbooksAccounts } from '../accounting/connection';
import { INTUIT_TOKEN_URL, QUICKBOOKS_SANDBOX_URL } from '../accounting/quickbooks';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment, quickbooksSync } from '../db/schema';
import { chargeEntry, feeEntry } from '../donations/entries';
import { postingStatements } from '../ledger/posting';
import { sendDueWebhooks } from '../webhooks/deliver';
import { createDestination } from '../webhooks/destinations';
import { mailPause } from '../webhooks/paused-mail';
import { sendDueZapierEvents } from '../zapier/deliver';
import {
	ACCOUNTING_RUN_COST,
	MINUTE_RUN,
	PACE,
	type Share,
	WEBHOOK_RUN_COST,
	ZAPIER_RUN_COST
} from './budget';

// each outbox run at its costliest, counted against its share of the minute cron's invocation
// (./budget.ts): every D1 query the run makes through a real D1, and every external subrequest
// through the `fetch` and the mail transport it is handed — the QuickBooks adapter's `fetch` is the
// global one, stubbed here, and ../../../../vitest.workers.config.ts sets `unstubGlobals`. what
// ./budget.spec.ts sums, this holds each feed's run to.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** `d1` with every query made through it counted: a `batch()` once, a lone statement once. */
function counted(d1: D1Database) {
	let queries = 0;
	const unwrapped = new WeakMap<object, D1PreparedStatement>();
	const statement = (inner: D1PreparedStatement): D1PreparedStatement => {
		const outer = new Proxy(inner, {
			get(target, key) {
				const value: unknown = Reflect.get(target, key, target);
				if (typeof value !== 'function') return value;
				if (key === 'bind') {
					return (...values: unknown[]) => statement(value.apply(target, values));
				}
				if (key === 'all' || key === 'run' || key === 'raw' || key === 'first') {
					return (...args: unknown[]) => {
						queries += 1;
						return value.apply(target, args);
					};
				}
				return value.bind(target);
			}
		});
		unwrapped.set(outer, inner);
		return outer;
	};
	const database = new Proxy(d1, {
		get(target, key) {
			const value: unknown = Reflect.get(target, key, target);
			if (typeof value !== 'function') return value;
			if (key === 'prepare') return (query: string) => statement(value.call(target, query));
			if (key === 'batch') {
				return (statements: readonly D1PreparedStatement[]) => {
					queries += 1;
					return value.call(
						target,
						statements.map((s) => unwrapped.get(s) ?? s)
					);
				};
			}
			return value.bind(target);
		}
	});
	return { db: createDb(database), queries: () => queries };
}

/** a `fetch` answering every post 500 and every other request 200, each counted. */
function failingReceivers() {
	let requests = 0;
	const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		requests += 1;
		return new Response('down', { status: init?.method === 'POST' ? 500 : 200 });
	}) as typeof globalThis.fetch;
	return { fetch, requests: () => requests };
}

function expectWithin(share: Share, spent: { queries: number; external: number }) {
	expect(spent.queries).toBeLessThanOrEqual(share.queries);
	expect(spent.external).toBeLessThanOrEqual(share.external);
}

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

/** a settled $50 gift, and its payment's id. */
async function gift(): Promise<string> {
	const contactId = uuidv7();
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const at = new Date('2026-09-10T12:00:00.000Z');
	await db.batch([
		db.insert(contact).values({ id: contactId, kind: 'individual', displayName: 'Ada Okafor' }),
		db
			.insert(donation)
			.values({ id: donationId, contactId, totalMinor: 5_000, currency: 'USD', receivedAt: at }),
		db.insert(payment).values({
			id: paymentId,
			donationId,
			amountMinor: 5_000,
			currency: 'USD',
			direction: 'inbound',
			method: 'check',
			status: 'succeeded',
			provider: 'manual',
			occurredAt: at
		})
	]);
	return paymentId;
}

/** $20 of the gift `paymentId` refunded, and the refund's id. */
async function refundOf(paymentId: string): Promise<string> {
	const refundId = uuidv7();
	const [parent] = await db
		.select({ donationId: payment.donationId })
		.from(payment)
		.where(eq(payment.id, paymentId));
	await db.insert(payment).values({
		id: refundId,
		donationId: parent?.donationId ?? '',
		amountMinor: 2_000,
		currency: 'USD',
		direction: 'refund',
		method: 'check',
		status: 'succeeded',
		provider: 'manual',
		occurredAt: new Date('2026-09-12T08:30:00.000Z'),
		parentPaymentId: paymentId
	});
	return refundId;
}

/** the donor who made the gift `paymentId`. */
async function donorOf(paymentId: string): Promise<string> {
	const [row] = await db
		.select({ contactId: donation.contactId })
		.from(payment)
		.innerJoin(donation, eq(donation.id, payment.donationId))
		.where(eq(payment.id, paymentId));
	if (row === undefined) throw new Error(`no gift ${paymentId}`);
	return row.contactId;
}

/** a $25 monthly commitment from a donor of its own, on a form of its own, and its id. */
async function commitment(): Promise<string> {
	const formId = `frm_${uuidv7()}`;
	const contactId = uuidv7();
	const planId = uuidv7();
	const account = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	await env.DB.batch([
		env.DB.prepare(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
		).bind(formId, account?.id),
		env.DB.prepare(
			`insert into contact (id, kind, display_name, created_at, updated_at)
			 values (?, 'individual', 'Grace Hopper', 0, 0)`
		).bind(contactId),
		env.DB.prepare(
			`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
			                             status, provider, provider_subscription_id,
			                             provider_customer_id, started_at, next_charge_at, ended_at,
			                             created_at, updated_at)
			 values (?, ?, ?, 2500, 'USD', 'monthly', 'active', 'stripe', ?, ?, ?, ?, null, 0, 0)`
		).bind(
			planId,
			contactId,
			formId,
			`sub_${planId}`,
			`cus_${planId}`,
			Date.parse('2026-09-03T12:00:00.000Z'),
			Date.parse('2026-10-03T12:00:00.000Z')
		)
	]);
	return planId;
}

describe('the Zapier run', () => {
	beforeEach(async () => {
		await env.DB.prepare('delete from zapier_delivery').run();
		await env.DB.prepare('delete from zapier_subscription').run();
	});

	/** a hook failing for four days, owed one retry of `paymentId` queued `age` ago. */
	async function failingHook(trigger: string, paymentId: string, now: number, age: number) {
		const id = uuidv7();
		await env.DB.batch([
			env.DB.prepare(
				`insert into zapier_subscription (id, trigger, hook_url, failing_since, created_at, updated_at)
				 values (?, ?, ?, ?, 0, 0)`
			).bind(id, trigger, `https://hooks.zapier.com/hooks/standard/1/${id}/`, now - 4 * DAY),
			env.DB.prepare(
				`insert into zapier_delivery
				 (subscription_id, event_id, payment_id, status, attempts, next_attempt_at, created_at, updated_at)
				 values (?, ?, ?, 'pending', 1, ?, ?, 0)`
			).bind(id, uuidv7(), paymentId, now - age, now - age)
		]);
	}

	it('stays inside its share when every row it claims fails and ends its hook', async () => {
		const now = Date.now() + 1_000;
		const paymentId = await gift();
		await failingHook('gift_refunded', await refundOf(paymentId), now, 2 * DAY);
		for (let hook = 0; hook < PACE.zapier + 2; hook++) {
			await failingHook('new_gift', paymentId, now, DAY);
		}
		const counting = counted(env.DB);
		const receivers = failingReceivers();

		await sendDueZapierEvents({ db: counting.db, fetch: receivers.fetch }, new Date(now));

		expect(receivers.requests()).toBe(
			ZAPIER_RUN_COST.external + PACE.zapier * ZAPIER_RUN_COST.externalPerRow
		);
		expectWithin(MINUTE_RUN.zapier, {
			queries: counting.queries(),
			external: receivers.requests()
		});
		expect(counting.queries() - PACE.zapier * ZAPIER_RUN_COST.queriesPerRow).toBe(
			ZAPIER_RUN_COST.queries
		);
	});
});

describe('the webhook run', () => {
	beforeEach(async () => {
		await env.DB.prepare('delete from webhook_delivery').run();
		await env.DB.prepare('delete from webhook_destination_event').run();
		await env.DB.prepare('delete from webhook_destination').run();
		await env.DB.prepare('delete from org_profile').run();
		await env.DB.prepare(
			`insert into org_profile (id, legal_name, notification_email, created_at, updated_at)
			 values ('default', 'Hope Foundation', 'ops@hope.example', 0, 0)`
		).run();
	});

	let made = 0;

	/** a destination failing for four days, owed one retry of `event` on `subjectId`, queued `age` ago. */
	async function failingDestination(event: string, subjectId: string, now: number, age: number) {
		made += 1;
		const created = await createDestination(db, {
			url: `https://crm.example.org/hooks/${made}`,
			events: ['gift.made']
		});
		if (!created.ok) throw new Error(created.box);
		const { id } = created.destination;
		await env.DB.batch([
			env.DB.prepare('update webhook_destination set failing_since = ? where id = ?').bind(
				now - 4 * DAY,
				id
			),
			env.DB.prepare(
				`insert into webhook_delivery
				 (id, destination_id, event, subject_id, status, attempts, next_attempt_at, created_at, updated_at)
				 values (?, ?, ?, ?, 'pending', 1, ?, ?, 0)`
			).bind(`msg_${crypto.randomUUID()}`, id, event, subjectId, now - age, now - age)
		]);
	}

	/** a run at `now`, its queries and its external subrequests — posts, and pause mails sent. */
	async function run(now: number) {
		const counting = counted(env.DB);
		const receivers = failingReceivers();
		let mails = 0;
		await sendDueWebhooks(
			{
				db: counting.db,
				fetch: receivers.fetch,
				onPaused: mailPause({
					db: counting.db,
					email: {
						async send() {
							mails += 1;
							return { ok: true };
						}
					},
					origin: null
				})
			},
			new Date(now)
		);
		return { queries: counting.queries(), external: receivers.requests() + mails, mails };
	}

	it('stays inside its share when every row it claims fails and pauses its destination', async () => {
		const now = Date.now() + 1_000;
		const paymentId = await gift();
		for (let made = 0; made < PACE.webhooks + 2; made++) {
			await failingDestination('gift.made', paymentId, now, DAY);
		}

		const spent = await run(now);

		expect(spent.mails).toBe(PACE.webhooks);
		expectWithin(MINUTE_RUN.webhooks, spent);
	});

	it('stays inside its share when its claim renders every kind of subject', async () => {
		const now = Date.now() + 1_000;
		const paymentId = await gift();
		await failingDestination('gift.refunded', await refundOf(paymentId), now, 4 * DAY);
		await failingDestination('donor.added', await donorOf(paymentId), now, 4 * DAY);
		await failingDestination('recurring_gift.started', await commitment(), now, 4 * DAY);
		for (let made = 0; made < PACE.webhooks; made++) {
			await failingDestination('gift.made', paymentId, now, DAY);
		}

		const spent = await run(now);

		expect(spent.mails).toBe(PACE.webhooks);
		expectWithin(MINUTE_RUN.webhooks, spent);
		expect(spent.queries - PACE.webhooks * WEBHOOK_RUN_COST.queriesPerRow).toBe(
			WEBHOOK_RUN_COST.queries
		);
		expect(spent.external - PACE.webhooks * WEBHOOK_RUN_COST.externalPerRow).toBe(
			WEBHOOK_RUN_COST.external
		);
	});
});

describe('the QuickBooks run', () => {
	beforeEach(async () => {
		for (const table of [
			'zapier_delivery',
			'webhook_delivery',
			'quickbooks_sync',
			'quickbooks_connection',
			'ledger_entry',
			'entry_group',
			'payment',
			'donation',
			'recurring_plan',
			'contact',
			'org_profile'
		]) {
			await env.DB.prepare(`delete from ${table}`).run();
		}
		await env.DB.prepare(
			`insert into org_profile (id, legal_name, notification_email, created_at, updated_at)
			 values ('default', 'Hope Foundation', 'ops@hope.example', 0, 0)`
		).run();
	});

	const REALM = '4620816365';
	const account = (id: string) => ({ id, name: `Account ${id}` });

	/** a company connected on a credential that has lapsed, every account a card gift needs chosen. */
	async function connected(): Promise<void> {
		await connectQuickbooks(db, {
			realmId: REALM,
			tokens: {
				accessToken: 'lapsed',
				accessTokenExpiresAt: new Date(0),
				refreshToken: 'refresh-one',
				refreshTokenExpiresAt: null
			},
			startAt: new Date('2026-01-01T00:00:00.000Z')
		});
		await saveQuickbooksAccounts(db, {
			income: account('1'),
			fee: account('2'),
			stripeBalance: account('3'),
			paypalBalance: null,
			chariotBalance: null,
			nowpaymentsBalance: null,
			undepositedFunds: null
		});
	}

	/**
	 * a settled card gift from a donor with an email, owed to the books, `status` after `attempts`
	 * sends, the last of them long enough ago that its wait is over.
	 */
	async function owedGift(attempts: number, status: 'pending' | 'failed'): Promise<void> {
		const contactId = uuidv7();
		const donationId = uuidv7();
		const paymentId = uuidv7();
		const occurredAt = new Date('2026-09-10T12:00:00.000Z');
		const settled = {
			providerTxnId: `ch_${paymentId}`,
			status: 'succeeded',
			method: 'card',
			amountMinor: 10_000,
			currency: 'USD',
			feeMinor: 320,
			metadata: {},
			occurredAt,
			arrival: null
		} as const;
		const charged = {
			paymentId,
			donationId,
			revenue: [{ accountId: postableId('donationsDeductible'), amountMinor: 10_000 }]
		} as const;
		const charge = chargeEntry(charged, settled);
		const fee = feeEntry(charged, settled);
		if (fee === null) throw new Error('the fixture settlement carried a fee and none was posted');
		const entryGroupId = charge.group.id;
		if (entryGroupId === undefined) throw new Error('the fixture posting carries no id');
		const queuedAt = new Date(Date.now() - DAY);
		const statements: BatchItem<'sqlite'>[] = [
			db.insert(contact).values({
				id: contactId,
				kind: 'individual',
				displayName: 'Ada Lovelace',
				primaryEmail: 'ada@example.org'
			}),
			db.insert(donation).values({
				id: donationId,
				contactId,
				totalMinor: 10_000,
				currency: 'USD',
				receivedAt: occurredAt
			}),
			db.insert(payment).values({
				id: paymentId,
				donationId,
				amountMinor: 10_000,
				currency: 'USD',
				direction: 'inbound',
				method: 'card',
				status: 'succeeded',
				provider: 'stripe',
				providerTxnId: settled.providerTxnId,
				occurredAt
			}),
			...postingStatements(db, charge),
			...postingStatements(db, fee),
			db.insert(quickbooksSync).values({
				entryGroupId,
				status,
				attempts,
				createdAt: queuedAt,
				updatedAt: queuedAt
			})
		];
		const [first, ...rest] = statements;
		if (first === undefined) throw new Error('nothing to commit');
		await db.batch([first, ...rest]);
	}

	/**
	 * Intuit answering every call the costliest way it can and still take the gift: the credential
	 * renewed, nothing found by any search, and every donor's own name already taken.
	 */
	function costliestIntuit() {
		let requests = 0;
		let customersMade = 0;
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			requests += 1;
			const url = String(input instanceof Request ? input.url : input);
			if (url === INTUIT_TOKEN_URL) {
				return Response.json({
					access_token: 'renewed',
					refresh_token: 'refresh-two',
					expires_in: 3600
				});
			}
			const path = new URL(url).pathname;
			if (path.endsWith('/query')) {
				const statement = String(init?.body ?? '');
				return Response.json({
					QueryResponse: statement.startsWith('select * from Preferences')
						? { Preferences: [{ CurrencyPrefs: { HomeCurrency: { value: 'USD' } } }] }
						: {}
				});
			}
			if (path.endsWith('/customer')) {
				customersMade += 1;
				return customersMade % 2 === 1
					? Response.json({ Fault: { Error: [{ code: '6240' }] } }, { status: 400 })
					: Response.json({ Customer: { Id: `c${customersMade}` } });
			}
			return Response.json({ JournalEntry: { Id: `j${requests}` } });
		});
		return { requests: () => requests };
	}

	it('stays inside its share when every entry it sends costs its most and the run ends in a notice', async () => {
		await connected();
		await owedGift(3, 'failed');
		for (let gift = 0; gift < PACE.books + 2; gift++) await owedGift(1, 'pending');
		const intuit = costliestIntuit();
		const counting = counted(env.DB);
		let mails = 0;

		await sendDueEntries(
			{
				db: counting.db,
				provider: createAccountingProvider(
					{
						QUICKBOOKS_CLIENT_ID: 'notarealclientid',
						QUICKBOOKS_CLIENT_SECRET: 'notarealclientsecret',
						QUICKBOOKS_API_URL: QUICKBOOKS_SANDBOX_URL
					},
					counting.db
				),
				email: {
					async send() {
						mails += 1;
						return { ok: true };
					}
				}
			},
			new Date()
		);

		const sent = await env.DB.prepare(
			`select count(*) as n from quickbooks_sync where status = 'sent'`
		).first<{ n: number }>();
		expect(sent?.n).toBe(PACE.books);
		expect(mails).toBe(1);
		const spent = { queries: counting.queries(), external: intuit.requests() + mails };
		expectWithin(MINUTE_RUN.books, spent);
		expect(spent.queries - PACE.books * ACCOUNTING_RUN_COST.queriesPerRow).toBe(
			ACCOUNTING_RUN_COST.queries
		);
		expect(spent.external - PACE.books * ACCOUNTING_RUN_COST.externalPerRow).toBe(
			ACCOUNTING_RUN_COST.external
		);
	});
});
