import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { contact, dispute, donation, payment, type ZapierTrigger } from '../db/schema';
import { MINUTE_RUN, PACE } from '../outbox/budget';
import { sendDueZapierEvents } from './deliver';
import { giftRefundedStatements, zapierStatements } from './events';
import { subscribe, type SubscribeRequest, type Subscribed } from './subscriptions';

// the delivery run against a real D1, with the hooks answered by a `fetch` written here.
//
// every gift is settled through `zapierStatements`, the statement the money path splices in, so
// the rows a run reads are the rows production writes. the clock is the run's `now`: each run is
// handed a time, the way the cron hands it `scheduledTime`. the one exception is a 429's delay in
// seconds, which counts from the answer, on the wall clock.

/** the hash of the key every subscribe here is verified under, the live `zapier` api_key's. */
const KEY_HASH = 'a'.repeat(64);

/** a subscribe under the current key, which never comes back `null`. */
async function subscribeUnderKey(request: SubscribeRequest): Promise<Subscribed> {
	const subscribed = await subscribe(db, request, KEY_HASH);
	if (subscribed === null) throw new Error('the subscribe was refused under the current key');
	return subscribed;
}

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from zapier_delivery').run();
	await env.DB.prepare('delete from zapier_subscription').run();
	await env.DB.prepare('delete from api_key').run();
	await env.DB.prepare(
		`insert into api_key (id, name, kind, key_hash, prefix, last_four, created_at)
		 values ('0192f0c4-7d2a-7000-8000-000000000000', 'Zapier', 'zapier', ?, 'bgz_AAAA', 'AAAA', 0)`
	)
		.bind(KEY_HASH)
		.run();
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let hooks = 0;

/** an open subscription to `trigger` on a hook of its own, and that hook's url. */
async function listen(trigger: ZapierTrigger = 'new_gift') {
	hooks += 1;
	const hookUrl = `https://hooks.zapier.com/hooks/standard/1/${hooks}/`;
	const { id } = await subscribeUnderKey({ trigger, hookUrl });
	return { id, hookUrl };
}

/** a gift from a new donor, settled with its fan-out the way every caller commits one. */
async function settle(): Promise<{ paymentId: string; contactId: string }> {
	const contactId = uuidv7();
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const at = new Date('2026-09-10T12:00:00.000Z');
	await db.batch([
		db.insert(contact).values({ id: contactId, kind: 'individual', displayName: 'Ada Okafor' }),
		db.insert(donation).values({
			id: donationId,
			contactId,
			totalMinor: 5_000,
			currency: 'USD',
			receivedAt: at
		}),
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
		}),
		...zapierStatements(db, { paymentId, contactId })
	]);
	return { paymentId, contactId };
}

/**
 * $20 of `gift` refunded — or withdrawn by a dispute the organisation lost, where `lost` — its rows
 * and its fan-out committed together as ../donations/reverse.ts does.
 */
async function refund(gift: { paymentId: string }, lost = false): Promise<string> {
	const refundId = uuidv7();
	const [parent] = await db
		.select({ donationId: payment.donationId })
		.from(payment)
		.where(eq(payment.id, gift.paymentId));
	await db.batch([
		db.insert(payment).values({
			id: refundId,
			donationId: parent?.donationId ?? '',
			amountMinor: 2_000,
			currency: 'USD',
			direction: 'refund',
			method: 'check',
			status: 'succeeded',
			provider: 'manual',
			occurredAt: new Date('2026-09-12T08:30:00.000Z'),
			parentPaymentId: gift.paymentId
		}),
		...(lost
			? [
					db.insert(dispute).values({
						paymentId: refundId,
						outcome: 'lost',
						closedAt: new Date('2026-09-30T10:00:00.000Z')
					})
				]
			: []),
		giftRefundedStatements(db, refundId)
	]);
	return refundId;
}

type Post = { readonly url: string; readonly body: Record<string, unknown> };

/**
 * a `fetch` standing in for Zapier's hooks: each url answers with the status `answer` gives it
 * (200 by default). every post is recorded, and every DELETE — a pause — apart from them.
 */
function hooksAnswering(answer: (url: string) => number | Error = () => 200) {
	const posts: Post[] = [];
	const pauses: string[] = [];
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (init?.method === 'DELETE') pauses.push(url);
		else posts.push({ url, body: JSON.parse(String(init?.body)) });
		const status = answer(url);
		if (status instanceof Error) throw status;
		return new Response(status === 200 ? '{"status":"success"}' : 'nope', { status });
	}) as typeof globalThis.fetch;
	return { fetch, posts, pauses };
}

async function deliveryRows() {
	const { results } = await env.DB.prepare(
		`select subscription_id, event_id, status, attempts, next_attempt_at, leased_until, last_error
		 from zapier_delivery order by subscription_id, event_id`
	).all<{
		subscription_id: string;
		event_id: string;
		status: string;
		attempts: number;
		next_attempt_at: number;
		leased_until: number | null;
		last_error: string | null;
	}>();
	return results;
}

/** when `subscriptionId`'s hook began failing, as stored. */
async function failingSince(subscriptionId: string): Promise<number | null> {
	const row = await env.DB.prepare('select failing_since from zapier_subscription where id = ?')
		.bind(subscriptionId)
		.first<{ failing_since: number | null }>();
	return row?.failing_since ?? null;
}

async function markFailingSince(subscriptionId: string, at: number): Promise<void> {
	await env.DB.prepare('update zapier_subscription set failing_since = ? where id = ?')
		.bind(at, subscriptionId)
		.run();
}

/** every row still owed to `subscriptionId` as if its first post had already failed. */
async function failedOnceAlready(subscriptionId: string): Promise<void> {
	await env.DB.prepare('update zapier_delivery set attempts = 1 where subscription_id = ?')
		.bind(subscriptionId)
		.run();
}

/**
 * a `Db` over the test database with the rows D1 reports reading for every `batch()` made through
 * it summed: the figure the Free plan's five million rows read a day is counted in.
 */
function batchRowsRead() {
	let total = 0;
	const counting = new Proxy(env.DB, {
		get(target, key) {
			const value: unknown = Reflect.get(target, key, target);
			if (typeof value !== 'function') return value;
			if (key !== 'batch') return value.bind(target);
			return async (statements: D1PreparedStatement[]) => {
				const results = (await value.call(target, statements)) as D1Result[];
				for (const result of results) total += result.meta.rows_read;
				return results;
			};
		}
	});
	return { db: createDb(counting), total: () => total };
}

const HOOK_FAILED_FOR_THREE_DAYS =
	'Not sent: every post to its hook had failed for three days, and its subscription was ended.';

describe('sendDueZapierEvents()', () => {
	it('posts a due gift to its hook once and marks it sent', async () => {
		const hook = await listen();
		const gift = await settle();
		const zapier = hooksAnswering();
		const now = new Date(Date.now() + 1_000);

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, now);
		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(now.getTime() + MINUTE));

		expect(zapier.posts.map((p) => [p.url, p.body.id, p.body.donor_name])).toEqual([
			[hook.hookUrl, gift.paymentId, 'Ada Okafor']
		]);
		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'sent', attempts: 1, leased_until: null })
		]);
	});

	it('posts a refund to its gift_refunded hook: the amount refunded, and the gift it came out of', async () => {
		const gift = await settle();
		const hook = await listen('gift_refunded');
		const refundId = await refund(gift);
		const zapier = hooksAnswering();

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(Date.now() + 1_000));

		expect(zapier.posts).toEqual([
			{
				url: hook.hookUrl,
				body: {
					id: refundId,
					occurred_at: '2026-09-12T08:30:00.000Z',
					amount: '20.00',
					amount_minor: 2_000,
					currency: 'USD',
					source: 'refund',
					gift: expect.objectContaining({
						id: gift.paymentId,
						amount: '50.00',
						donor_id: gift.contactId,
						donor_name: 'Ada Okafor'
					})
				}
			}
		]);
	});

	it('posts a dispute the organisation lost as a dispute, not a refund', async () => {
		const gift = await settle();
		await listen('gift_refunded');
		const withdrawalId = await refund(gift, true);
		const zapier = hooksAnswering();

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(Date.now() + 1_000));

		expect(zapier.posts.map((p) => [p.body.id, p.body.source])).toEqual([
			[withdrawalId, 'dispute']
		]);
	});

	it('drops a refund that stopped standing while its row waited, unposted, and says why', async () => {
		const gift = await settle();
		await listen('gift_refunded');
		const refundId = await refund(gift);
		await db.update(payment).set({ status: 'cancelled' }).where(eq(payment.id, refundId));
		const zapier = hooksAnswering();

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(Date.now() + 1_000));

		expect(zapier.posts).toEqual([]);
		expect(await deliveryRows()).toEqual([
			expect.objectContaining({
				event_id: refundId,
				status: 'dropped',
				leased_until: null,
				last_error:
					'The refund this event was queued for no longer stands: it failed, or its dispute no longer reads as lost. It was not sent.'
			})
		]);
	});

	it('still posts a gift to its new_gift hook when the gift was refunded while its row waited', async () => {
		const hook = await listen('new_gift');
		const gift = await settle();
		await refund(gift);
		const zapier = hooksAnswering();

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(Date.now() + 1_000));

		expect(zapier.posts.map((p) => [p.url, p.body.id, p.body.amount])).toEqual([
			[hook.hookUrl, gift.paymentId, '50.00']
		]);
	});

	it('waits out a minute after a 500, then delivers exactly once', async () => {
		await listen();
		await settle();
		let up = false;
		const zapier = hooksAnswering(() => (up ? 200 : 500));
		const now = Date.now() + 1_000;
		const run = (at: number) => sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(at));

		await run(now);
		expect(await deliveryRows()).toEqual([
			expect.objectContaining({
				status: 'pending',
				attempts: 1,
				next_attempt_at: now + MINUTE,
				leased_until: null,
				last_error: '500 Internal Server Error — nope'
			})
		]);

		up = true;
		await run(now + MINUTE - 1);
		expect(zapier.posts).toHaveLength(1);

		await run(now + MINUTE);
		await run(now + 2 * MINUTE);
		expect(zapier.posts).toHaveLength(2);
		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'sent', attempts: 2, last_error: null })
		]);
	});

	it('waits as long as a 429 asks in seconds before trying again', async () => {
		await listen();
		await settle();
		const posts: string[] = [];
		const throttled = (async (input: RequestInfo | URL) => {
			posts.push(String(input));
			return new Response('slow down', { status: 429, headers: { 'retry-after': '600' } });
		}) as typeof fetch;
		const now = Date.now() + 1_000;
		const run = (at: number) => sendDueZapierEvents({ db, fetch: throttled }, new Date(at));

		// the seconds count from the answer, which lands on the wall clock between these two.
		const before = Date.now();
		await run(now);
		const after = Date.now();
		const [row] = await deliveryRows();
		expect(row).toEqual(
			expect.objectContaining({
				status: 'pending',
				attempts: 1,
				last_error: '429 Too Many Requests — slow down'
			})
		);
		const asked = row?.next_attempt_at ?? 0;
		expect(asked).toBeGreaterThanOrEqual(before + 10 * MINUTE);
		expect(asked).toBeLessThanOrEqual(after + 10 * MINUTE);

		await run(asked - 1);
		expect(posts).toHaveLength(1);
		await run(asked);
		expect(posts).toHaveLength(2);
	});

	it("holds back the rest of a run's rows for a hook once it answers 429, until the time it asked", async () => {
		await listen();
		for (let gift = 0; gift < PACE.free.zapier; gift++) await settle();
		const zapier = hooksAnswering(() => 200);
		const throttled = (async (input: RequestInfo | URL, init?: RequestInit) => {
			await zapier.fetch(input, init);
			return new Response('', { status: 429, headers: { 'retry-after': '600' } });
		}) as typeof fetch;

		const before = Date.now();
		await sendDueZapierEvents({ db, fetch: throttled }, new Date(Date.now() + 1_000));
		const after = Date.now();

		// the lanes post before any answer is back; the rest of the claim is never posted.
		const lanes = MINUTE_RUN.zapier.lanes;
		expect(zapier.posts).toHaveLength(lanes);
		const heldBack = (await deliveryRows()).filter((r) => r.attempts === 0);
		expect(heldBack).toHaveLength(PACE.free.zapier - lanes);
		for (const row of heldBack) {
			expect(row.status).toBe('pending');
			expect(row.next_attempt_at).toBeGreaterThanOrEqual(before + 10 * MINUTE);
			expect(row.next_attempt_at).toBeLessThanOrEqual(after + 10 * MINUTE);
		}
	});

	it('waits until the time a 429 names before trying again', async () => {
		await listen();
		await settle();
		const now = Date.now() + 1_000;
		const until = new Date(now + 20 * MINUTE).toUTCString();
		const throttled = (async () =>
			new Response('', { status: 429, headers: { 'retry-after': until } })) as typeof fetch;

		await sendDueZapierEvents({ db, fetch: throttled }, new Date(now));

		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'pending', next_attempt_at: Date.parse(until) })
		]);
	});

	it('waits out the fixed backoff when a 429 asks for a time no clock can hold', async () => {
		await listen();
		await settle();
		const now = Date.now() + 1_000;
		const throttled = (async () =>
			new Response('', {
				status: 429,
				headers: { 'retry-after': '99999999999999999' }
			})) as typeof fetch;

		await sendDueZapierEvents({ db, fetch: throttled }, new Date(now));

		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'pending', attempts: 1, next_attempt_at: now + MINUTE })
		]);
	});

	it('waits no longer than the moment the row is given up on, whatever a 429 asks', async () => {
		await listen();
		await settle();
		const now = Date.now() + 1_000;
		const queuedAt = now - 71 * HOUR;
		await env.DB.prepare('update zapier_delivery set created_at = ?').bind(queuedAt).run();
		const until = new Date(now + 5 * 24 * HOUR).toUTCString();
		const throttled = (async () =>
			new Response('', { status: 429, headers: { 'retry-after': until } })) as typeof fetch;

		await sendDueZapierEvents({ db, fetch: throttled }, new Date(now));

		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'pending', next_attempt_at: queuedAt + 72 * HOUR })
		]);
	});

	it('rides out a hook unreachable for a quarter hour on a doubling wait, and delivers it once', async () => {
		await listen();
		await settle();
		let up = false;
		const zapier = hooksAnswering(() => (up ? 200 : new TypeError('Network connection lost.')));
		const start = Date.now() + 1_000;

		// the cron's every-minute runs across the outage.
		for (let minute = 0; minute < 15; minute++) {
			await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(start + minute * MINUTE));
		}
		// tried at 0, 1, 3 and 7 minutes; the next is due at 15.
		expect(zapier.posts).toHaveLength(4);
		expect(await deliveryRows()).toEqual([
			expect.objectContaining({
				status: 'pending',
				attempts: 4,
				next_attempt_at: start + 15 * MINUTE,
				last_error: 'TypeError: Network connection lost.'
			})
		]);

		up = true;
		for (let minute = 15; minute < 20; minute++) {
			await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(start + minute * MINUTE));
		}
		expect(zapier.posts).toHaveLength(5);
		expect(await deliveryRows()).toEqual([expect.objectContaining({ status: 'sent' })]);
	});

	it('ends a subscription whose hook answers 410 and drops what it was owed, the other Zaps untouched', async () => {
		const gone = await listen();
		const live = await listen();
		await settle();
		await settle();
		const zapier = hooksAnswering((url) => (url === gone.hookUrl ? 410 : 200));
		const now = Date.now() + 1_000;

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(now));
		const posted = zapier.posts.length;
		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(now + HOUR));

		expect(zapier.posts).toHaveLength(posted);
		const { results: subscriptions } = await env.DB.prepare(
			'select id, ended_reason from zapier_subscription order by id'
		).all<{ id: string; ended_reason: string | null }>();
		expect(subscriptions).toEqual([
			{ id: gone.id, ended_reason: 'gone' },
			{ id: live.id, ended_reason: null }
		]);
		const rows = await deliveryRows();
		expect(rows.filter((r) => r.subscription_id === gone.id).map((r) => r.status)).toEqual([
			'dropped',
			'dropped'
		]);
		expect(rows.filter((r) => r.subscription_id === live.id).map((r) => r.status)).toEqual([
			'sent',
			'sent'
		]);
	});

	it('marks when a hook began failing, and keeps that mark through its later failures', async () => {
		const hook = await listen();
		await settle();
		const zapier = hooksAnswering(() => 503);
		const now = Date.now() + 1_000;

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(now));
		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(now + MINUTE));

		expect(zapier.posts).toHaveLength(2);
		expect(await failingSince(hook.id)).toBe(now);
	});

	it('counts a post that went unanswered toward the three days', async () => {
		const hook = await listen();
		await settle();
		const unreachable = hooksAnswering(() => new TypeError('Network connection lost.'));
		const now = Date.now() + 1_000;

		await sendDueZapierEvents({ db, fetch: unreachable.fetch }, new Date(now));

		expect(unreachable.posts).toHaveLength(1);
		expect(await failingSince(hook.id)).toBe(now);
	});

	it('ends a hook failing for three days, drops what it was owed and pauses its Zap, the other Zaps untouched', async () => {
		const failing = await listen();
		const live = await listen();
		await settle();
		await settle();
		const now = Date.now() + 1_000;
		await markFailingSince(failing.id, now - 72 * HOUR);
		await failedOnceAlready(failing.id);
		const zapier = hooksAnswering((url) => (url === failing.hookUrl ? 500 : 200));

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(now));
		const posted = zapier.posts.length;
		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(now + HOUR));

		expect(zapier.posts).toHaveLength(posted);
		// the pause is answered 500 like every post, and the end stands regardless.
		expect(zapier.pauses).toEqual([failing.hookUrl]);
		const { results: subscriptions } = await env.DB.prepare(
			'select id, ended_reason from zapier_subscription order by id'
		).all<{ id: string; ended_reason: string | null }>();
		expect(subscriptions).toEqual([
			{ id: failing.id, ended_reason: 'gone' },
			{ id: live.id, ended_reason: null }
		]);
		const rows = await deliveryRows();
		expect(rows.filter((r) => r.subscription_id === failing.id)).toEqual([
			expect.objectContaining({ status: 'dropped', last_error: HOOK_FAILED_FOR_THREE_DAYS }),
			expect.objectContaining({ status: 'dropped', last_error: HOOK_FAILED_FOR_THREE_DAYS })
		]);
		expect(rows.filter((r) => r.subscription_id === live.id).map((r) => r.status)).toEqual([
			'sent',
			'sent'
		]);
	});

	it('never ends a hook on a row failing its first post, however long the hook has been marked', async () => {
		const hook = await listen();
		await settle();
		const now = Date.now() + 1_000;
		await markFailingSince(hook.id, now - 30 * 24 * HOUR);

		await sendDueZapierEvents({ db, fetch: hooksAnswering(() => 503).fetch }, new Date(now));

		const ended = await env.DB.prepare('select ended_at from zapier_subscription where id = ?')
			.bind(hook.id)
			.first<{ ended_at: number | null }>();
		expect(ended?.ended_at).toBe(null);
		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'pending', attempts: 1 })
		]);
	});

	it('keeps a hook whose only row was given up on days ago through two quick failures of a new gift', async () => {
		const hook = await listen();
		await settle();
		const zapier = hooksAnswering(() => 503);
		const day0 = Date.now() + 1_000;
		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(day0));
		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(day0 + 72 * HOUR + MINUTE));
		expect(await failingSince(hook.id)).toBe(day0);

		const day10 = day0 + 10 * 24 * HOUR;
		const later = await settle();
		await env.DB.prepare(
			'update zapier_delivery set created_at = ?, next_attempt_at = ? where event_id = ?'
		)
			.bind(day10, day10, later.paymentId)
			.run();
		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(day10));
		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(day10 + MINUTE));

		expect(zapier.pauses).toEqual([]);
		const ended = await env.DB.prepare('select ended_at from zapier_subscription where id = ?')
			.bind(hook.id)
			.first<{ ended_at: number | null }>();
		expect(ended?.ended_at).toBe(null);
		expect(await failingSince(hook.id)).toBe(day10);
		expect((await deliveryRows()).map((r) => [r.status, r.attempts]).sort()).toEqual([
			['failed', 1],
			['pending', 2]
		]);
	});

	it("writes neither a failure's mark nor its row's outcome when their batch faults", async () => {
		const hook = await listen();
		await settle();
		const zapier = hooksAnswering(() => 500);
		// a stand-in fault: the row's outcome refused inside the batch that also marks the hook.
		await env.DB.prepare(
			`create trigger refuse_outcome before update on zapier_delivery
			 when new.last_error = '500 Internal Server Error — nope'
			 begin select raise(abort, 'outcome refused'); end`
		).run();
		try {
			await expect(
				sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(Date.now() + 1_000))
			).rejects.toThrow();
		} finally {
			await env.DB.prepare('drop trigger refuse_outcome').run();
		}

		expect(zapier.posts).toHaveLength(1);
		expect(await failingSince(hook.id)).toBe(null);
		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'pending', attempts: 0, last_error: null })
		]);
	});

	it('keeps a hook failing for a moment under three days', async () => {
		const hook = await listen();
		await settle();
		const now = Date.now() + 1_000;
		await markFailingSince(hook.id, now - 72 * HOUR + 1);

		await sendDueZapierEvents({ db, fetch: hooksAnswering(() => 500).fetch }, new Date(now));

		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'pending', attempts: 1 })
		]);
		expect(await failingSince(hook.id)).toBe(now - 72 * HOUR + 1);
	});

	it('starts the three days over when a failing hook takes a post', async () => {
		const hook = await listen();
		await settle();
		const now = Date.now() + 1_000;
		await markFailingSince(hook.id, now - 71 * HOUR);

		await sendDueZapierEvents({ db, fetch: hooksAnswering(() => 200).fetch }, new Date(now));
		expect(await failingSince(hook.id)).toBe(null);

		await settle();
		await sendDueZapierEvents(
			{ db, fetch: hooksAnswering(() => 500).fetch },
			new Date(now + 2 * HOUR)
		);
		expect(await failingSince(hook.id)).toBe(now + 2 * HOUR);
		expect((await deliveryRows()).map((r) => r.status).sort()).toEqual(['pending', 'sent']);
	});

	it('gives up without posting on an event still undelivered 72 hours after it was queued', async () => {
		await listen();
		const retried = await settle();
		const untried = await settle();
		const lasting = await settle();
		const zapier = hooksAnswering(() => 500);
		const now = Date.now() + 1_000;
		const queuedAt = (paymentId: string, at: number) =>
			env.DB.prepare('update zapier_delivery set created_at = ? where event_id = ?')
				.bind(at, paymentId)
				.run();
		await queuedAt(retried.paymentId, now - 72 * HOUR);
		await queuedAt(untried.paymentId, now - 80 * HOUR);
		await queuedAt(lasting.paymentId, now - 72 * HOUR + 1);
		await env.DB.prepare(
			`update zapier_delivery set attempts = 9, last_error = '503 Service Unavailable'
			 where event_id = ?`
		)
			.bind(retried.paymentId)
			.run();

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(now));

		expect(zapier.posts.map((p) => p.body.id)).toEqual([lasting.paymentId]);
		const rows = new Map((await deliveryRows()).map((r) => [r.event_id, r]));
		expect(rows.get(retried.paymentId)).toEqual(
			expect.objectContaining({
				status: 'failed',
				attempts: 9,
				leased_until: null,
				last_error: '503 Service Unavailable'
			})
		);
		expect(rows.get(untried.paymentId)).toEqual(
			expect.objectContaining({
				status: 'failed',
				attempts: 0,
				last_error: 'Not delivered within 72 hours of being queued.'
			})
		);
		expect(rows.get(lasting.paymentId)).toEqual(
			expect.objectContaining({ status: 'pending', attempts: 1 })
		);
	});

	it('sends once when a run starts while the last one is still posting', async () => {
		await listen();
		await settle();
		const posts: string[] = [];
		let answer!: () => void;
		const hookAnswered = new Promise<void>((resolve) => {
			answer = resolve;
		});
		const slowHook = (async (input: RequestInfo | URL) => {
			posts.push(String(input));
			await hookAnswered;
			return new Response('{}', { status: 200 });
		}) as typeof fetch;
		const now = Date.now() + 1_000;

		const first = sendDueZapierEvents({ db, fetch: slowHook }, new Date(now));
		await expect.poll(() => posts.length).toBe(1);
		await sendDueZapierEvents({ db, fetch: slowHook }, new Date(now + MINUTE));
		answer();
		await first;

		expect(posts).toHaveLength(1);
		expect(await deliveryRows()).toEqual([expect.objectContaining({ status: 'sent' })]);
	});

	/**
	 * runs one after another until one claims nothing, each posting no more than a claim's worth,
	 * as the cron's minutes would.
	 */
	async function drain(zapier: ReturnType<typeof hooksAnswering>): Promise<void> {
		for (;;) {
			const before = zapier.posts.length;
			await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(Date.now() + 1_000));
			const posted = zapier.posts.length - before;
			expect(posted).toBeLessThanOrEqual(PACE.free.zapier);
			if (posted === 0) return;
		}
	}

	it("drains a backlog of forty rows over the runs after it, a claim's worth each", async () => {
		await listen();
		await listen();
		for (let gift = 0; gift < 20; gift++) await settle();
		const zapier = hooksAnswering();

		await drain(zapier);

		expect(new Set(zapier.posts.map((p) => `${p.url} ${p.body.id}`)).size).toBe(40);
		expect((await deliveryRows()).filter((r) => r.status !== 'sent')).toEqual([]);
	});

	it("drains a backlog owed to twenty hooks over the runs after it, a claim's worth each", async () => {
		for (let zap = 0; zap < 20; zap++) await listen();
		await settle();
		const zapier = hooksAnswering();

		await drain(zapier);

		expect(new Set(zapier.posts.map((p) => p.url)).size).toBe(20);
	});

	// fair within the claim's window of due rows (`CANDIDATES_PER_CLAIMED_ROW` in ../outbox/lease.ts),
	// which twenty rows do not fill.
	it("posts a Zap's newest gift in the next run beside another Zap's backlog shorter than the claim's window", async () => {
		const backlogged = await listen();
		for (let gift = 0; gift < 20; gift++) await settle();
		const quiet = await listen();
		const newest = await settle();
		const zapier = hooksAnswering();

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(Date.now() + 1_000));

		expect(zapier.posts.filter((p) => p.url === quiet.hookUrl).map((p) => p.body.id)).toEqual([
			newest.paymentId
		]);
		expect(zapier.posts.filter((p) => p.url === backlogged.hookUrl)).toHaveLength(
			PACE.free.zapier - 1
		);
	});

	it('reads no more rows to claim beside a long history than beside a short one', async () => {
		/**
		 * the rows D1 read for a run's batches, beside `endedZaps` Zaps that have ended and `history`
		 * rows no run takes again: every fifth one owed to a Zap that has ended, the rest sent to
		 * the one still on.
		 */
		async function readToRun(endedZaps: number, history: number): Promise<number> {
			await env.DB.prepare('delete from zapier_delivery').run();
			await env.DB.prepare('delete from zapier_subscription').run();
			const gift = await settle();
			for (let zap = 0; zap < endedZaps; zap++) await listen();
			await env.DB.prepare(
				`update zapier_subscription set ended_at = 1, ended_reason = 'unsubscribed'`
			).run();
			const open = await listen();
			await env.DB.prepare(
				`with recursive n(i) as (select 0 union all select i + 1 from n where i < ? - 1),
				   ended(id, k) as (select id, row_number() over (order by id) - 1
				                    from zapier_subscription where ended_at is not null)
				 insert into zapier_delivery (subscription_id, event_id, payment_id, status, attempts,
				   next_attempt_at, created_at, updated_at)
				 select coalesce(ended.id, ?), 'past-' || i, ?,
				   case when ended.id is null then 'sent' when i % 2 = 0 then 'failed' else 'dropped' end,
				   1, i, i, i
				 from n left join ended on i % 5 = 0 and ended.k = (i / 5) % ?`
			)
				.bind(history, open.id, gift.paymentId, endedZaps)
				.run();
			await settle();
			// the statistics a long-lived database plans by, without which sqlite plans every read
			// the same way whatever the table holds.
			await env.DB.prepare('analyze').run();
			const read = batchRowsRead();
			await sendDueZapierEvents(
				{ db: read.db, fetch: hooksAnswering().fetch },
				new Date(Date.now() + 1_000)
			);
			return read.total();
		}

		const short = await readToRun(5, 100);
		const long = await readToRun(50, 5_000);

		expect(long).toBeLessThanOrEqual(short);
	});

	it("drains a backlog of twenty refunds over the runs after it, a claim's worth each", async () => {
		await listen('gift_refunded');
		for (let gift = 0; gift < 20; gift++) await refund(await settle());
		const zapier = hooksAnswering();

		await drain(zapier);

		expect(new Set(zapier.posts.map((p) => p.body.id)).size).toBe(20);
	});

	it('posts each row of a backlog once when two runs work it together', async () => {
		for (let zap = 0; zap < 3; zap++) await listen();
		for (let gift = 0; gift < 50; gift++) await settle();
		const posts: string[] = [];
		let open!: () => void;
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const heldHooks = (async (input: RequestInfo | URL, init?: RequestInit) => {
			posts.push(`${String(input)} ${JSON.parse(String(init?.body)).id}`);
			await gate;
			return new Response('{}', { status: 200 });
		}) as typeof fetch;
		const now = Date.now() + 1_000;

		const lanes = MINUTE_RUN.zapier.lanes;
		const first = sendDueZapierEvents({ db, fetch: heldHooks }, new Date(now));
		await expect.poll(() => posts.length).toBe(lanes);
		const second = sendDueZapierEvents({ db, fetch: heldHooks }, new Date(now + MINUTE));
		await expect.poll(() => posts.length).toBe(2 * lanes);
		open();
		await Promise.all([first, second]);

		expect(posts).toHaveLength(2 * PACE.free.zapier);
		expect(new Set(posts).size).toBe(2 * PACE.free.zapier);
		expect((await deliveryRows()).filter((r) => r.status === 'sent')).toHaveLength(
			2 * PACE.free.zapier
		);
	});

	it('claims nothing owed to a subscription that has ended', async () => {
		const hook = await listen();
		await settle();
		// ended without its rows dropped: the state `endSubscriptionStatements` never leaves, held
		// off by the claim regardless.
		await env.DB.prepare(
			`update zapier_subscription set ended_at = 1, ended_reason = 'unsubscribed' where id = ?`
		)
			.bind(hook.id)
			.run();
		const zapier = hooksAnswering();

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(Date.now() + 1_000));

		expect(zapier.posts).toEqual([]);
		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'pending', leased_until: null })
		]);
	});

	it("posts to at most the feed's lanes at once, and to every hook it claimed", async () => {
		for (let zap = 0; zap < PACE.free.zapier; zap++) await listen();
		await settle();
		let inFlight = 0;
		let most = 0;
		const posts: string[] = [];
		const busyHooks = (async (input: RequestInfo | URL) => {
			posts.push(String(input));
			inFlight += 1;
			most = Math.max(most, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
			return new Response('{}', { status: 200 });
		}) as typeof fetch;

		await sendDueZapierEvents({ db, fetch: busyHooks }, new Date(Date.now() + 1_000));

		expect(most).toBe(MINUTE_RUN.zapier.lanes);
		expect(new Set(posts).size).toBe(PACE.free.zapier);
	});

	it('leaves a row alone once a later run has taken it over, whatever its own post answers', async () => {
		await listen();
		await settle();
		const posts: string[] = [];
		const answers: Array<(status: number) => void> = [];
		const heldHook = (async (input: RequestInfo | URL) => {
			posts.push(String(input));
			const status = await new Promise<number>((resolve) => answers.push(resolve));
			return new Response('nope', { status });
		}) as typeof fetch;
		const now = Date.now() + 1_000;

		// the first run overruns its lease; the run two minutes on takes the row over.
		const overrun = sendDueZapierEvents({ db, fetch: heldHook }, new Date(now));
		await expect.poll(() => posts.length).toBe(1);
		const takeover = sendDueZapierEvents({ db, fetch: heldHook }, new Date(now + 2 * MINUTE));
		await expect.poll(() => posts.length).toBe(2);
		const [takenOver] = await deliveryRows();

		answers[0]?.(500);
		await overrun;
		expect(await deliveryRows()).toEqual([takenOver]);

		answers[1]?.(200);
		await takeover;
		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'sent', attempts: 1 })
		]);
	});

	it('claims nothing when it starts too late to finish a post inside its own lease', async () => {
		await listen();
		await settle();
		await env.DB.prepare('update zapier_delivery set next_attempt_at = 0').run();
		const zapier = hooksAnswering();
		// a run whose scheduled time is so far behind the clock that its lease is nearly spent.
		const late = Date.now() - 2 * MINUTE + 5_000;

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(late));

		expect(zapier.posts).toEqual([]);
		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'pending', attempts: 0, leased_until: null })
		]);
	});

	it("lets go of a hook's answer once it is taken, so its connection is not held", async () => {
		await listen();
		await settle();
		let released = false;
		const hook = (async () =>
			new Response(
				new ReadableStream({
					cancel() {
						released = true;
					}
				}),
				{ status: 200 }
			)) as typeof fetch;

		await sendDueZapierEvents({ db, fetch: hook }, new Date(Date.now() + 1_000));

		expect(released).toBe(true);
	});
});
