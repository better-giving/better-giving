import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment } from '../db/schema';
import { sendDueWebhooks } from '../webhooks/deliver';
import { createDestination } from '../webhooks/destinations';
import { mailPause } from '../webhooks/paused-mail';
import { sendDueZapierEvents } from '../zapier/deliver';
import { MINUTE_RUN, type Share, WEBHOOK_CLAIMS_PER_RUN, ZAPIER_CLAIMS_PER_RUN } from './budget';

// each outbox run at its costliest, counted against its share of the minute cron's invocation
// (./budget.ts): every D1 query the run makes through a real D1, and every external subrequest
// through the `fetch` and the mail transport it is handed. what ./budget.spec.ts sums, this holds
// each feed's run to.

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
		for (let hook = 0; hook < ZAPIER_CLAIMS_PER_RUN + 2; hook++) {
			await failingHook('new_gift', paymentId, now, DAY);
		}
		const counting = counted(env.DB);
		const receivers = failingReceivers();

		await sendDueZapierEvents({ db: counting.db, fetch: receivers.fetch }, new Date(now));

		expect(receivers.requests()).toBe(2 * ZAPIER_CLAIMS_PER_RUN);
		expectWithin(MINUTE_RUN.zapier, {
			queries: counting.queries(),
			external: receivers.requests()
		});
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
		for (let made = 0; made < WEBHOOK_CLAIMS_PER_RUN + 2; made++) {
			await failingDestination('gift.made', paymentId, now, DAY);
		}

		const spent = await run(now);

		expect(spent.mails).toBe(WEBHOOK_CLAIMS_PER_RUN);
		expectWithin(MINUTE_RUN.webhooks, spent);
	});

	it('stays inside its share when its claim renders every kind of subject', async () => {
		const now = Date.now() + 1_000;
		const paymentId = await gift();
		await failingDestination('gift.refunded', uuidv7(), now, 4 * DAY);
		await failingDestination('donor.added', uuidv7(), now, 4 * DAY);
		await failingDestination('recurring_gift.started', uuidv7(), now, 4 * DAY);
		for (let made = 0; made < WEBHOOK_CLAIMS_PER_RUN; made++) {
			await failingDestination('gift.made', paymentId, now, DAY);
		}

		expectWithin(MINUTE_RUN.webhooks, await run(now));
	});
});
