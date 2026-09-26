import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { contact, dispute, donation, payment, type ZapierTrigger } from '../db/schema';
import { sendDueZapierEvents } from './deliver';
import { giftRefundedStatements, zapierStatements } from './events';
import { subscribe, type SubscribeRequest, type Subscribed } from './subscriptions';

// the delivery run against a real D1, with the hooks answered by a `fetch` written here.
//
// every gift is settled through `zapierStatements`, the statement the money path splices in, so
// the rows a run reads are the rows production writes. the clock is the run's `now` and nothing
// else: each run is handed a time, the way the cron hands it `scheduledTime`.

/** the hash of the key every subscribe here is verified under, standing in the `zapier_key` row. */
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
	await env.DB.prepare('delete from zapier_key').run();
	await env.DB.prepare(
		`insert into zapier_key (id, key_hash, created_at, updated_at) values ('zapier', ?, 0, 0)`
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
 * (200 by default) and every post is recorded.
 */
function hooksAnswering(answer: (url: string) => number | Error = () => 200) {
	const posts: Post[] = [];
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		posts.push({ url, body: JSON.parse(String(init?.body)) });
		const status = answer(url);
		if (status instanceof Error) throw status;
		return new Response(status === 200 ? '{"status":"success"}' : 'nope', { status });
	}) as typeof globalThis.fetch;
	return { fetch, posts };
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
	});

	it('posts to at most six hooks at once, and to every one of them', async () => {
		for (let zap = 0; zap < 8; zap++) await listen();
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

		expect(most).toBe(6);
		expect(new Set(posts).size).toBe(8);
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

	it('posts nothing it could not finish inside its own lease', async () => {
		await listen();
		await settle();
		await env.DB.prepare('update zapier_delivery set next_attempt_at = 0').run();
		const zapier = hooksAnswering();
		// a run whose scheduled time is so far behind the clock that its lease is nearly spent.
		const late = Date.now() - 2 * MINUTE + 5_000;

		await sendDueZapierEvents({ db, fetch: zapier.fetch }, new Date(late));

		expect(zapier.posts).toEqual([]);
		expect(await deliveryRows()).toEqual([
			expect.objectContaining({ status: 'pending', attempts: 0, leased_until: late + 2 * MINUTE })
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
