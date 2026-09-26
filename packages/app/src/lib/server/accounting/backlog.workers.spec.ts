import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import {
	contact,
	donation,
	entryGroup,
	payment,
	quickbooksSync,
	type QuickbooksSyncStatus
} from '../db/schema';
import { post, postingStatements } from '../ledger/posting';
import { readQuickbooksBacklog, retryFailedEntries } from './backlog';

// what the console says about the queue, and the one press that acts on it — against a real D1,
// because both are `quickbooks_sync` and standing in for it would prove the stand-in (CLAUDE.md).
//
// nothing here sends anything: ./deliver.workers.spec.ts is the run. what is asserted is the
// reading an operator is shown and the rows a retry leaves behind.

const MINUTE = 60_000;
const NOW = new Date('2026-03-01T10:00:00.000Z');

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	// the lines before the group they hang off, and the queue before both: both are foreign keys,
	// so any other order is a constraint violation rather than an empty table.
	for (const table of [
		'quickbooks_sync',
		'ledger_entry',
		'entry_group',
		'payment',
		'donation',
		'contact'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
});

/** one queued entry group, in the state and at the age a case is about. */
async function queued(input: {
	status: QuickbooksSyncStatus;
	minutesAgo: number;
	notified?: boolean;
}): Promise<string> {
	const queuedAt = new Date(NOW.getTime() - input.minutesAgo * MINUTE);
	// through `post()` rather than around it: a group written straight in is a group with no lines,
	// which is the unbalanced write ../ledger/sole-writer.spec.ts exists to refuse.
	const entry = post({
		sourceType: 'donation',
		sourceId: uuidv7(),
		currency: 'USD',
		occurredAt: queuedAt,
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
			status: input.status,
			attempts: input.status === 'pending' ? 0 : 3,
			lastError: input.status === 'failed' ? 'Intuit refused the payload.' : null,
			notifiedAt: input.notified === true ? queuedAt : null,
			createdAt: queuedAt,
			updatedAt: queuedAt
		})
	]);
	return id;
}

/**
 * a gift whose queue row is `giftStatus`, refunded in full, the refund queued and waiting: every
 * row written the way the settlement and the refund write them, down to the payment rows the
 * refund is keyed on.
 */
async function refundedGift(
	giftStatus: 'failed' | 'sent'
): Promise<{ gift: string; refund: string }> {
	const contactId = uuidv7();
	const donationId = uuidv7();
	const giftId = uuidv7();
	const refundId = uuidv7();
	const at = new Date(NOW.getTime() - 60 * MINUTE);
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
	if (giftGroup === undefined || refundGroup === undefined) {
		throw new Error('post() minted no entry group id');
	}
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
		db.insert(donation).values({
			id: donationId,
			contactId,
			totalMinor: 10_000,
			currency: 'USD',
			receivedAt: at
		}),
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
			status: giftStatus,
			attempts: 1,
			remoteId: giftStatus === 'sent' ? '42' : null,
			createdAt: at,
			updatedAt: at
		}),
		db.insert(quickbooksSync).values({ entryGroupId: refundGroup, createdAt: at, updatedAt: at })
	]);
	return { gift: giftGroup, refund: refundGroup };
}

/**
 * the settle-up of a dispute won whose opening was never recorded, on the gift in `giftGroup`:
 * the fee the processor kept, keyed on the gift's own payment row, queued and waiting.
 */
async function settledUpOnGift(giftGroup: string): Promise<string> {
	const [giftRow] = await db
		.select({ sourceId: entryGroup.sourceId })
		.from(entryGroup)
		.where(eq(entryGroup.id, giftGroup));
	if (giftRow === undefined) throw new Error(`no entry group ${giftGroup}`);
	const settleUp = post({
		sourceType: 'adjustment',
		sourceId: giftRow.sourceId,
		currency: 'USD',
		occurredAt: NOW,
		memo: null,
		lines: [
			{ accountId: postableId('processorFees'), amountMinor: 1_500 },
			{ accountId: postableId('undepositedFunds'), amountMinor: -1_500 }
		]
	});
	const id = settleUp.group.id;
	if (id === undefined) throw new Error('post() minted no entry group id');
	await db.batch([
		...postingStatements(db, settleUp),
		db.insert(quickbooksSync).values({ entryGroupId: id, createdAt: NOW, updatedAt: NOW })
	]);
	return id;
}

describe('the backlog the console reads', () => {
	it('counts what was given up on and dates the oldest gift still owed', async () => {
		await queued({ status: 'failed', minutesAgo: 90 });
		await queued({ status: 'pending', minutesAgo: 200 });
		await queued({ status: 'sent', minutesAgo: 500 });

		expect(await readQuickbooksBacklog(db)).toEqual({
			failed: 1,
			oldestWaitingAt: new Date(NOW.getTime() - 200 * MINUTE),
			heldBehindFailed: []
		});
	});

	it('reads a queue with nothing owed as nothing owed', async () => {
		await queued({ status: 'sent', minutesAgo: 500 });

		expect(await readQuickbooksBacklog(db)).toEqual({
			failed: 0,
			oldestWaitingAt: null,
			heldBehindFailed: []
		});
	});

	it('names each refund waiting on a gift that was given up on, and the gift it waits on', async () => {
		const failedGift = await refundedGift('failed');
		// a refund behind a gift that went over is sent by the next run, and waits on nobody.
		await refundedGift('sent');

		const backlog = await readQuickbooksBacklog(db);

		expect(backlog.heldBehindFailed).toEqual([
			{ entryGroupId: failedGift.refund, waitsOn: failedGift.gift }
		]);
	});

	it('names a won dispute’s settle-up keyed on the gift itself as waiting on a gift given up on', async () => {
		const failedGift = await refundedGift('failed');
		const settleUp = await settledUpOnGift(failedGift.gift);

		const backlog = await readQuickbooksBacklog(db);

		expect(backlog.heldBehindFailed).toEqual([
			{ entryGroupId: failedGift.refund, waitsOn: failedGift.gift },
			{ entryGroupId: settleUp, waitsOn: failedGift.gift }
		]);
	});
});

describe('the retry press', () => {
	it('queues every given-up row again and takes the notice stamp off it', async () => {
		const given = await queued({ status: 'failed', minutesAgo: 90, notified: true });

		expect(await retryFailedEntries(db)).toBe(1);

		const [row] = await db
			.select({
				status: quickbooksSync.status,
				notifiedAt: quickbooksSync.notifiedAt,
				attempts: quickbooksSync.attempts
			})
			.from(quickbooksSync)
			.where(eq(quickbooksSync.entryGroupId, given));
		// the count stays: it is what makes the next send look before it posts, and what keeps a
		// start-date move from dropping a gift that may already be in the books.
		expect(row).toEqual({ status: 'pending', notifiedAt: null, attempts: 3 });
	});

	it('leaves a gift that was already sent alone', async () => {
		const sent = await queued({ status: 'sent', minutesAgo: 500 });

		expect(await retryFailedEntries(db)).toBe(0);

		const [row] = await db
			.select({ status: quickbooksSync.status })
			.from(quickbooksSync)
			.where(eq(quickbooksSync.entryGroupId, sent));
		expect(row?.status).toBe('sent');
	});
});
