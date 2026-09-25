import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment, type ZapierTrigger } from '../db/schema';
import { post, type Posting } from '../ledger/posting';
import { correctionWrites, reversalWrites, settledGiftWrites } from './writes';

// what the composer hands a writer, spliced after that writer's own payment row and committed in
// one `batch()` against a real D1.
//
// a workers spec because what the composer promises is the database's to judge: the queue row and
// the Zap rows are INSERT…SELECTs whose gates are read inside the batch, and the order it returns
// is only right if every foreign key resolves in statement order (CONTRIBUTING.md -> Tests).

let db: Db;
beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	// children before parents: each table below points at one after it.
	for (const table of [
		'zapier_delivery',
		'zapier_subscription',
		'quickbooks_sync',
		'quickbooks_connection',
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
		'contact'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
});

const AT = new Date('2026-09-10T12:00:00.000Z');

/** the company connected, taking everything posted on or after the start of the year. */
async function connect(): Promise<void> {
	await env.DB.prepare(
		`insert into quickbooks_connection (id, realm_id, access_token, access_token_expires_at,
		                                    refresh_token, start_at, created_at, updated_at)
		 values ('quickbooks', '4620816365', 'access', 0, 'refresh', ?, 0, 0)`
	)
		.bind(Date.parse('2026-01-01T00:00:00.000Z'))
		.run();
}

async function subscribe(trigger: ZapierTrigger): Promise<void> {
	await env.DB.prepare(
		`insert into zapier_subscription (id, trigger, hook_url, created_at, updated_at)
		 values (?, ?, ?, 0, 0)`
	)
		.bind(uuidv7(), trigger, `https://hooks.zapier.com/hooks/standard/1/${trigger}/`)
		.run();
}

/** a donor, and the rows of one $50 gift of theirs as a writer would insert them: unwritten. */
async function giftFrom() {
	const contactId = uuidv7();
	await db.insert(contact).values({ id: contactId, kind: 'individual', displayName: 'Ada Okafor' });
	const donationId = uuidv7();
	const paymentId = uuidv7();
	return {
		contactId,
		donationId,
		paymentId,
		rows: [
			db
				.insert(donation)
				.values({ id: donationId, contactId, totalMinor: 5_000, currency: 'USD', receivedAt: AT }),
			db.insert(payment).values({
				id: paymentId,
				donationId,
				amountMinor: 5_000,
				currency: 'USD',
				direction: 'inbound',
				method: 'card',
				status: 'succeeded',
				provider: 'stripe',
				providerTxnId: `pi_${paymentId}`,
				occurredAt: AT
			})
		] as const
	};
}

function chargeOf(paymentId: string): Posting {
	return post({
		sourceType: 'payment',
		sourceId: paymentId,
		currency: 'USD',
		occurredAt: AT,
		lines: [
			{ accountId: postableId('undepositedFunds'), amountMinor: 5_000 },
			{ accountId: postableId('donationsDeductible'), amountMinor: -5_000 }
		]
	});
}

function feeOf(paymentId: string): Posting {
	return post({
		sourceType: 'fee',
		sourceId: paymentId,
		currency: 'USD',
		occurredAt: AT,
		lines: [
			{ accountId: postableId('processorFees'), amountMinor: 175 },
			{ accountId: postableId('undepositedFunds'), amountMinor: -175 }
		]
	});
}

/** every entry group, its source and the sum of each side of its lines. */
async function books() {
	const { results } = await env.DB.prepare(
		`select g.source_type, g.source_id, count(l.id) as lines,
		        sum(case when l.amount_minor > 0 then l.amount_minor else 0 end) as debits
		 from entry_group g join ledger_entry l on l.entry_group_id = g.id
		 group by g.id order by g.source_type`
	).all<{ source_type: string; source_id: string; lines: number; debits: number }>();
	return results;
}

/** the queue rows, by the source of the entry each is about. */
async function queued() {
	const { results } = await env.DB.prepare(
		`select g.source_type, g.source_id, q.status from quickbooks_sync q
		 join entry_group g on g.id = q.entry_group_id order by g.source_type`
	).all<{ source_type: string; source_id: string; status: string }>();
	return results;
}

/** the Zap rows, by trigger. */
async function owedToZaps() {
	const { results } = await env.DB.prepare(
		`select s.trigger, d.event_id, d.payment_id from zapier_delivery d
		 join zapier_subscription s on s.id = d.subscription_id order by s.trigger`
	).all<{ trigger: string; event_id: string; payment_id: string }>();
	return results;
}

describe('settledGiftWrites()', () => {
	it('writes the charge, the fee, the queue row the charge owes and each listening Zap’s row, after the payment', async () => {
		await connect();
		await subscribe('new_gift');
		await subscribe('new_donor');
		const gift = await giftFrom();
		const charge = chargeOf(gift.paymentId);

		await db.batch([
			...gift.rows,
			...settledGiftWrites(db, { charge, fee: feeOf(gift.paymentId), contactId: gift.contactId })
		]);

		expect(await books()).toEqual([
			{ source_type: 'fee', source_id: gift.paymentId, lines: 2, debits: 175 },
			{ source_type: 'payment', source_id: gift.paymentId, lines: 2, debits: 5_000 }
		]);
		expect(await queued()).toEqual([
			{ source_type: 'payment', source_id: gift.paymentId, status: 'pending' }
		]);
		expect(await owedToZaps()).toEqual([
			{ trigger: 'new_donor', event_id: gift.contactId, payment_id: gift.paymentId },
			{ trigger: 'new_gift', event_id: gift.paymentId, payment_id: gift.paymentId }
		]);
	});

	it('writes the charge alone where no fee was withheld', async () => {
		await connect();
		const gift = await giftFrom();

		await db.batch([
			...gift.rows,
			...settledGiftWrites(db, {
				charge: chargeOf(gift.paymentId),
				fee: null,
				contactId: gift.contactId
			})
		]);

		expect(await books()).toEqual([
			{ source_type: 'payment', source_id: gift.paymentId, lines: 2, debits: 5_000 }
		]);
		expect(await queued()).toEqual([
			{ source_type: 'payment', source_id: gift.paymentId, status: 'pending' }
		]);
	});

	it('hands back statements synchronously and writes nothing itself', async () => {
		await connect();
		await subscribe('new_gift');
		const gift = await giftFrom();
		await db.batch(gift.rows);

		const writes = settledGiftWrites(db, {
			charge: chargeOf(gift.paymentId),
			fee: feeOf(gift.paymentId),
			contactId: gift.contactId
		});

		expect(writes).toBeInstanceOf(Array);
		expect(await books()).toEqual([]);
		expect(await queued()).toEqual([]);
		expect(await owedToZaps()).toEqual([]);
	});

	it('refuses a fee handed over as the charge', () => {
		const paymentId = uuidv7();
		const fee = feeOf(paymentId);

		expect(() => settledGiftWrites(db, { charge: fee, fee: null, contactId: uuidv7() })).toThrow(
			/charge.*'fee'/
		);
	});

	it('refuses a fee taken from another payment than its charge', () => {
		const charge = chargeOf(uuidv7());
		const other = uuidv7();

		expect(() => settledGiftWrites(db, { charge, fee: feeOf(other), contactId: uuidv7() })).toThrow(
			new RegExp(other)
		);
	});
});

describe('correctionWrites()', () => {
	const correction = (sourceId = uuidv7()) =>
		post({
			sourceType: 'adjustment',
			sourceId,
			currency: 'USD',
			occurredAt: AT,
			memo: 'Stripe fee that never posted.',
			lines: [
				{ accountId: postableId('processorFees'), amountMinor: 475 },
				{ accountId: postableId('undepositedFunds'), amountMinor: -475 }
			]
		});

	it('writes the correction and the queue row it owes, and no Zap hears of it', async () => {
		await connect();
		await subscribe('new_gift');
		await subscribe('new_donor');
		const sourceId = uuidv7();

		await db.batch(correctionWrites(db, correction(sourceId)));

		expect(await books()).toEqual([
			{ source_type: 'adjustment', source_id: sourceId, lines: 2, debits: 475 }
		]);
		expect(await queued()).toEqual([
			{ source_type: 'adjustment', source_id: sourceId, status: 'pending' }
		]);
		expect(await owedToZaps()).toEqual([]);
	});

	it('refuses a gift’s charge handed over as a correction', () => {
		expect(() => correctionWrites(db, chargeOf(uuidv7()))).toThrow(/'adjustment'.*'payment'/);
	});
});

describe('reversalWrites()', () => {
	/** a refund's own row id, which both of a refund's groups are keyed on. */
	const refundId = uuidv7();
	const withdrawal = post({
		sourceType: 'refund',
		sourceId: refundId,
		currency: 'USD',
		occurredAt: AT,
		lines: [
			{ accountId: postableId('undepositedFunds'), amountMinor: -2_000 },
			{ accountId: postableId('donationsDeductible'), amountMinor: 2_000 }
		]
	});
	const reinstatement = post({
		sourceType: 'payment',
		sourceId: refundId,
		currency: 'USD',
		occurredAt: AT,
		lines: [
			{ accountId: postableId('undepositedFunds'), amountMinor: 2_000 },
			{ accountId: postableId('donationsDeductible'), amountMinor: -2_000 }
		]
	});

	/**
	 * a $50 gift in the books and queued for QuickBooks, the refund row every group below is keyed on,
	 * and a Zap on every trigger, so an owed row would have somewhere to go.
	 */
	async function refundedGift(): Promise<string> {
		await connect();
		const gift = await giftFrom();
		await db.batch([
			...gift.rows,
			...settledGiftWrites(db, {
				charge: chargeOf(gift.paymentId),
				fee: null,
				contactId: gift.contactId
			})
		]);
		await db.insert(payment).values({
			id: refundId,
			donationId: gift.donationId,
			amountMinor: 2_000,
			currency: 'USD',
			direction: 'refund',
			method: 'card',
			status: 'succeeded',
			provider: 'stripe',
			providerTxnId: `re_${refundId}`,
			occurredAt: AT,
			parentPaymentId: gift.paymentId
		});
		await subscribe('new_gift');
		await subscribe('new_donor');
		await subscribe('gift_refunded');
		return gift.paymentId;
	}

	it('writes a refund’s group and the queue row it owes behind its gift, and owes every Zap nothing yet', async () => {
		const giftId = await refundedGift();

		await db.batch(reversalWrites(db, { kind: 'refund', entry: withdrawal }));

		expect(await books()).toEqual([
			{ source_type: 'payment', source_id: giftId, lines: 2, debits: 5_000 },
			{ source_type: 'refund', source_id: refundId, lines: 2, debits: 2_000 }
		]);
		expect(await queued()).toEqual([
			{ source_type: 'payment', source_id: giftId, status: 'pending' },
			{ source_type: 'refund', source_id: refundId, status: 'pending' }
		]);
		expect(await owedToZaps()).toEqual([]);
	});

	it('writes a failed refund’s reinstatement and the queue row it owes behind its refund, and owes every Zap nothing', async () => {
		const giftId = await refundedGift();
		await db.batch(reversalWrites(db, { kind: 'refund', entry: withdrawal }));

		await db.batch(reversalWrites(db, { kind: 'refund_failed', entry: reinstatement }));

		const rows = await queued();
		expect(rows).toHaveLength(3);
		expect(rows).toEqual(
			expect.arrayContaining([
				{ source_type: 'payment', source_id: giftId, status: 'pending' },
				{ source_type: 'payment', source_id: refundId, status: 'pending' },
				{ source_type: 'refund', source_id: refundId, status: 'pending' }
			])
		);
		expect(await owedToZaps()).toEqual([]);
	});

	it('writes a lost dispute’s settle-up and the queue row it owes behind its withdrawal, and owes every Zap nothing', async () => {
		const giftId = await refundedGift();
		await db.batch(reversalWrites(db, { kind: 'dispute_opened', entry: withdrawal }));
		const settleUp = post({
			sourceType: 'adjustment',
			sourceId: refundId,
			currency: 'USD',
			occurredAt: AT,
			lines: [
				{ accountId: postableId('processorFees'), amountMinor: 700 },
				{ accountId: postableId('undepositedFunds'), amountMinor: -700 }
			]
		});

		await db.batch(reversalWrites(db, { kind: 'settle_up', entry: settleUp }));

		expect(await queued()).toEqual([
			{ source_type: 'adjustment', source_id: refundId, status: 'pending' },
			{ source_type: 'payment', source_id: giftId, status: 'pending' },
			{ source_type: 'refund', source_id: refundId, status: 'pending' }
		]);
		expect(await owedToZaps()).toEqual([]);
	});

	it('refuses a withdrawal handed over as a settle-up', () => {
		expect(() => reversalWrites(db, { kind: 'settle_up', entry: withdrawal })).toThrow(
			/'adjustment'.*'refund'/
		);
	});

	it('refuses a gift’s charge handed over as a refund', () => {
		expect(() => reversalWrites(db, { kind: 'refund', entry: chargeOf(uuidv7()) })).toThrow(
			/'refund'.*'payment'/
		);
	});
});
