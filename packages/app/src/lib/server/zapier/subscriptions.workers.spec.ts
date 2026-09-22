import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment } from '../db/schema';
import {
	countListening,
	endSubscriptionStatements,
	subscribe,
	unsubscribe,
	type SubscribeRequest,
	type Subscribed
} from './subscriptions';

// the Zaps listening, against a real D1: the open-hook index and the ended pair are the
// database's, so the rules here are asserted where they are enforced (CONTRIBUTING.md -> Tests).

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

const HOOK = 'https://hooks.zapier.com/hooks/standard/1/2/3/';

async function subscriptionRows() {
	const { results } = await env.DB.prepare(
		`select id, trigger, hook_url, ended_reason from zapier_subscription order by created_at, id`
	).all<{ id: string; trigger: string; hook_url: string; ended_reason: string | null }>();
	return results;
}

/** a settled gift for a delivery row to point at. */
async function gift(): Promise<string> {
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
		})
	]);
	return paymentId;
}

/** a delivery owed to `subscriptionId`, in `status`. */
async function owe(subscriptionId: string, status: 'pending' | 'sent' = 'pending'): Promise<void> {
	const paymentId = await gift();
	await env.DB.prepare(
		`insert into zapier_delivery
		 (subscription_id, event_id, payment_id, status, attempts, next_attempt_at, created_at, updated_at)
		 values (?, ?, ?, ?, 0, 0, 0, 0)`
	)
		.bind(subscriptionId, paymentId, paymentId, status)
		.run();
}

async function deliveryStatuses(subscriptionId: string): Promise<string[]> {
	const { results } = await env.DB.prepare(
		'select status from zapier_delivery where subscription_id = ? order by status'
	)
		.bind(subscriptionId)
		.all<{ status: string }>();
	return results.map((r) => r.status);
}

describe('subscribe()', () => {
	it('opens a subscription for the hook and answers with its id', async () => {
		const opened = await subscribeUnderKey({ trigger: 'new_gift', hookUrl: HOOK });

		expect(opened.created).toBe(true);
		expect(await subscriptionRows()).toEqual([
			{ id: opened.id, trigger: 'new_gift', hook_url: HOOK, ended_reason: null }
		]);
	});

	it('answers a hook already open for the same trigger with the id it has', async () => {
		const first = await subscribeUnderKey({ trigger: 'new_donor', hookUrl: HOOK });
		const again = await subscribeUnderKey({ trigger: 'new_donor', hookUrl: HOOK });

		expect(again).toEqual({ id: first.id, created: false });
		expect(await subscriptionRows()).toHaveLength(1);
	});

	it('answers two subscribes of one hook arriving together with one subscription', async () => {
		const both = await Promise.all([
			subscribeUnderKey({ trigger: 'new_gift', hookUrl: HOOK }),
			subscribeUnderKey({ trigger: 'new_gift', hookUrl: HOOK })
		]);

		expect(both.map((b) => b.created).sort()).toEqual([false, true]);
		expect(both[0].id).toBe(both[1].id);
		expect(await subscriptionRows()).toHaveLength(1);
	});

	it('moves a hook open under the other trigger: ends that row, drops what it was owed, opens afresh', async () => {
		const before = await subscribeUnderKey({ trigger: 'new_gift', hookUrl: HOOK });
		await owe(before.id, 'pending');
		await owe(before.id, 'sent');

		const after = await subscribeUnderKey({ trigger: 'new_donor', hookUrl: HOOK });

		expect(after.created).toBe(true);
		expect(await subscriptionRows()).toEqual([
			{ id: before.id, trigger: 'new_gift', hook_url: HOOK, ended_reason: 'unsubscribed' },
			{ id: after.id, trigger: 'new_donor', hook_url: HOOK, ended_reason: null }
		]);
		expect(await deliveryStatuses(before.id)).toEqual(['dropped', 'sent']);
	});
});

describe('unsubscribe()', () => {
	it('ends that subscription and drops what it was owed, leaving every other Zap as it was', async () => {
		const leaving = await subscribeUnderKey({ trigger: 'new_gift', hookUrl: HOOK });
		const staying = await subscribeUnderKey({ trigger: 'new_gift', hookUrl: `${HOOK}other/` });
		await owe(leaving.id);
		await owe(staying.id);

		await unsubscribe(db, leaving.id);

		expect((await subscriptionRows()).map((r) => [r.id, r.ended_reason])).toEqual([
			[leaving.id, 'unsubscribed'],
			[staying.id, null]
		]);
		expect(await deliveryStatuses(leaving.id)).toEqual(['dropped']);
		expect(await deliveryStatuses(staying.id)).toEqual(['pending']);
	});

	it('leaves an ended subscription with the reason it ended for', async () => {
		const opened = await subscribeUnderKey({ trigger: 'new_gift', hookUrl: HOOK });
		await env.DB.prepare(
			`update zapier_subscription set ended_at = 1, ended_reason = 'gone' where id = ?`
		)
			.bind(opened.id)
			.run();

		await unsubscribe(db, opened.id);

		expect((await subscriptionRows())[0]?.ended_reason).toBe('gone');
	});
});

describe('countListening()', () => {
	it('counts the open subscriptions to each trigger, and none that ended', async () => {
		await subscribeUnderKey({ trigger: 'new_gift', hookUrl: `${HOOK}a/` });
		await subscribeUnderKey({ trigger: 'new_gift', hookUrl: `${HOOK}b/` });
		const ended = await subscribeUnderKey({ trigger: 'new_donor', hookUrl: `${HOOK}c/` });
		await unsubscribe(db, ended.id);

		expect(await countListening(db)).toEqual({ newGift: 2, newDonor: 0 });
	});
});

describe("endSubscriptionStatements(db, 'every_open', …)", () => {
	it('ends every open subscription and drops all they were owed, in one batch', async () => {
		const gifts = await subscribeUnderKey({ trigger: 'new_gift', hookUrl: `${HOOK}a/` });
		const donors = await subscribeUnderKey({ trigger: 'new_donor', hookUrl: `${HOOK}b/` });
		const gone = await subscribeUnderKey({ trigger: 'new_gift', hookUrl: `${HOOK}c/` });
		await unsubscribe(db, gone.id);
		await owe(gifts.id);
		await owe(donors.id);

		await db.batch(endSubscriptionStatements(db, 'every_open', 'key_replaced', new Date()));

		expect((await subscriptionRows()).map((r) => [r.id, r.ended_reason])).toEqual([
			[gifts.id, 'key_replaced'],
			[donors.id, 'key_replaced'],
			[gone.id, 'unsubscribed']
		]);
		expect(await deliveryStatuses(gifts.id)).toEqual(['dropped']);
		expect(await deliveryStatuses(donors.id)).toEqual(['dropped']);
	});
});
