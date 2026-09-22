import { env } from 'cloudflare:test';
import type { BatchItem } from 'drizzle-orm/batch';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import { contact, donation, payment, type ZapierTrigger } from '../db/schema';
import { post, postingStatements } from '../ledger/posting';
import { zapierStatements } from './events';

// the delivery rows a settled gift owes the Zaps listening, against a real D1.
//
// a workers spec because every claim is the database's: the fan-out is one INSERT…SELECT over the
// open subscriptions, "first gift" is a predicate inside that statement, and "once" is the
// primary key refusing a second row. none of it is a read in application code a stand-in could
// imitate (CONTRIBUTING.md -> Tests).

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from zapier_delivery').run();
	await env.DB.prepare('delete from zapier_subscription').run();
});

let hooks = 0;

/** an open subscription to `trigger`, on a hook of its own. */
async function subscribe(trigger: ZapierTrigger): Promise<string> {
	hooks += 1;
	const id = uuidv7();
	await env.DB.prepare(
		`insert into zapier_subscription (id, trigger, hook_url, created_at, updated_at)
		 values (?, ?, ?, 0, 0)`
	)
		.bind(id, trigger, `https://hooks.zapier.com/hooks/standard/1/${hooks}/`)
		.run();
	return id;
}

async function end(subscriptionId: string): Promise<void> {
	await env.DB.prepare(
		`update zapier_subscription set ended_at = 1, ended_reason = 'unsubscribed' where id = ?`
	)
		.bind(subscriptionId)
		.run();
}

/** a donor with no gift yet. */
async function donor(): Promise<string> {
	const id = uuidv7();
	await db.insert(contact).values({ id, kind: 'individual', displayName: 'Ada Okafor' });
	return id;
}

/**
 * one gift from `contactId`, committed with its fan-out in one batch — the payment first,
 * as every caller orders it, since the donor predicate reads it and the rows point at it.
 */
async function settle(
	contactId: string,
	status: 'succeeded' | 'failed' = 'succeeded'
): Promise<string> {
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const at = new Date('2026-09-10T12:00:00.000Z');
	await db.batch([
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
			status,
			provider: 'manual',
			occurredAt: at
		}),
		// only a settled payment is spliced in, as every caller splices it.
		...(status === 'succeeded' ? zapierStatements(db, { paymentId, contactId }) : [])
	]);
	return paymentId;
}

/** every delivery row, as the send reads them. */
async function deliveries() {
	const { results } = await env.DB.prepare(
		`select d.subscription_id, s.trigger, d.event_id, d.payment_id, d.status, d.attempts
		 from zapier_delivery d join zapier_subscription s on s.id = d.subscription_id
		 order by s.trigger, d.subscription_id, d.event_id`
	).all<{
		subscription_id: string;
		trigger: ZapierTrigger;
		event_id: string;
		payment_id: string;
		status: string;
		attempts: number;
	}>();
	return results;
}

describe('zapierStatements() — who is owed a row', () => {
	it('owes each open subscription one pending row, keyed by the gift or the donor', async () => {
		const gifts = [await subscribe('new_gift'), await subscribe('new_gift')].sort();
		const donors = await subscribe('new_donor');
		const contactId = await donor();

		const paymentId = await settle(contactId);

		expect(await deliveries()).toEqual([
			{
				subscription_id: donors,
				trigger: 'new_donor',
				event_id: contactId,
				payment_id: paymentId,
				status: 'pending',
				attempts: 0
			},
			...gifts.map((subscription_id) => ({
				subscription_id,
				trigger: 'new_gift',
				event_id: paymentId,
				payment_id: paymentId,
				status: 'pending',
				attempts: 0
			}))
		]);
	});

	it('owes nothing where no Zap is subscribed, and the gift still commits', async () => {
		const paymentId = await settle(await donor());

		expect(await deliveries()).toEqual([]);
		const stored = await env.DB.prepare('select status from payment where id = ?')
			.bind(paymentId)
			.first<{ status: string }>();
		expect(stored?.status).toBe('succeeded');
	});

	it('owes an ended subscription nothing', async () => {
		const open = await subscribe('new_gift');
		await end(await subscribe('new_gift'));
		await end(await subscribe('new_donor'));

		await settle(await donor());

		expect((await deliveries()).map((row) => row.subscription_id)).toEqual([open]);
	});
});

describe('zapierStatements() — a new donor is heard of once', () => {
	it('fires on a donor’s first gift and not on their second', async () => {
		const donors = await subscribe('new_donor');
		const contactId = await donor();

		const first = await settle(contactId);
		await settle(contactId);

		expect(await deliveries()).toEqual([
			expect.objectContaining({ subscription_id: donors, event_id: contactId, payment_id: first })
		]);
	});

	it('stays silent on a donor’s later gift to a Zap subscribed after their first', async () => {
		const contactId = await donor();
		await settle(contactId);
		await subscribe('new_donor');

		await settle(contactId);

		expect(await deliveries()).toEqual([]);
	});

	it('counts a gift that did not go through as no gift at all', async () => {
		const donors = await subscribe('new_donor');
		const contactId = await donor();
		await settle(contactId, 'failed');

		const first = await settle(contactId);

		expect(await deliveries()).toEqual([
			expect.objectContaining({ subscription_id: donors, event_id: contactId, payment_id: first })
		]);
	});
});

describe('zapierStatements() — a second commit for the same gift', () => {
	it('is absorbed by the key: the rows already owed stand, and the batch commits', async () => {
		const gifts = await subscribe('new_gift');
		const contactId = await donor();
		const paymentId = await settle(contactId);

		await db.batch(zapierStatements(db, { paymentId, contactId }));

		expect(await deliveries()).toEqual([
			expect.objectContaining({ subscription_id: gifts, event_id: paymentId })
		]);
	});

	it('leaves a redelivered posting refused as UNIQUE, which callers read as already posted', async () => {
		await subscribe('new_gift');
		await subscribe('new_donor');
		const contactId = await donor();
		const paymentId = await settle(contactId);
		const posting = () =>
			post({
				sourceType: 'payment',
				sourceId: paymentId,
				currency: 'USD',
				occurredAt: new Date('2026-09-10T12:00:00.000Z'),
				memo: null,
				lines: [
					{ accountId: postableId('bankCash'), amountMinor: 5_000 },
					{ accountId: postableId('donationsDeductible'), amountMinor: -5_000 }
				]
			});
		const commit = () =>
			db.batch([
				...postingStatements(db, posting()),
				...zapierStatements(db, { paymentId, contactId })
			] as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
		await commit();

		const refused = await commit().then(
			() => 'committed',
			(error: unknown) => sqliteResultCode(error)
		);
		expect(refused).toBe('SQLITE_CONSTRAINT_UNIQUE');
	});
});
