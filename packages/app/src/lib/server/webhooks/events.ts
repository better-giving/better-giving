import { and, eq, exists, isNull, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../db/client';
import {
	payment,
	webhookDelivery,
	webhookDestination,
	webhookDestinationEvent
} from '../db/schema';
import { refundStands } from '../donations/queries';
import type { WebhookEvent } from '../../webhooks/catalog';

// the whole rule about which destinations an event is owed to, and the statements that say so.
//
// nothing here posts anything. what it produces is rows in `webhook_delivery` — the outbox
// ./deliver.ts reads — and the one property that matters is that they land in the same `batch()`
// as the change they report. a gift that committed without its rows is an event no destination
// ever hears of, and nothing sweeps for one: the delivery reads this table and nothing else.
//
// **there is no gate read.** each statement is an INSERT…SELECT over the destinations taking its
// event, evaluated inside the batch's own transaction, so no destination is zero rows. an archived
// destination is owed nothing; a paused one is owed its rows, which wait until it is resumed.
//
// **"once" is `webhook_delivery_event_idx`**, unique on destination, event and subject: a
// settlement delivered twice meets its own key, and `on conflict do nothing` answers that refusal
// and only that one — a NOT NULL, CHECK or foreign-key fault still refuses the whole batch.
//
// **every row's id is its `webhook-id`**, minted here in sql, one per destination, because the
// statement does not know how many destinations it will write for: `msg_` and a version 4 uuid
// from `randomblob`.

/** the gift a settlement just made `succeeded`. */
export type MadeGift = { readonly paymentId: string };

/**
 * the `gift.made` rows for one settled payment, for splicing into a caller's single `batch()`.
 * outside the specs its one caller is `settledGiftWrites` in ../books/writes.ts, and a writer
 * takes them from there.
 *
 * pure apart from the clock. an INSERT…SELECT never runs a column's `$defaultFn`, so the
 * timestamps are bound here, from one `new Date()`.
 */
export function webhookStatements(db: Db, gift: MadeGift): [BatchItem<'sqlite'>] {
	return [fanOut(db, 'gift.made', gift.paymentId, new Date())];
}

/**
 * the `gift.refunded` rows for `refundPaymentId`, the refund-direction row whose money is now
 * final: each refund of a gift, and each dispute lost on one, is its own event. outside the specs
 * its one caller is `reversalWrites` in ../books/writes.ts.
 *
 * gated on `refundStands` (../donations/queries.ts) as the batch left that row, the rule
 * `giftRefundedStatements` in ../zapier/events.ts holds for a Zap: a lost close racing a win that
 * committed first owes nothing. ./deliver.ts reads the same gate again at send.
 */
export function giftRefundedWebhookStatements(
	db: Db,
	refundPaymentId: string
): BatchItem<'sqlite'> {
	const stands = db
		.select({ one: sql`1` })
		.from(payment)
		.where(and(eq(payment.id, refundPaymentId), refundStands(db, payment)));
	return fanOut(db, 'gift.refunded', refundPaymentId, new Date(), exists(stands));
}

/**
 * the `gift.dispute_opened` rows for `withdrawalPaymentId`, the refund-direction row a dispute's
 * opening wrote when it withdrew the money. outside the specs its one caller is `reversalWrites` in
 * ../books/writes.ts.
 */
export function disputeOpenedWebhookStatements(
	db: Db,
	withdrawalPaymentId: string
): BatchItem<'sqlite'> {
	return fanOut(db, 'gift.dispute_opened', withdrawalPaymentId, new Date());
}

/** a version 4 uuid, lowercase, from sqlite's own random source. */
const UUID_V4 = sql`lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

/**
 * one pending row, due at once, per un-archived destination taking `event`, where `extra` holds.
 *
 * drizzle's `insert().select()` names every column of the table in declaration order and refuses a
 * select whose keys differ, so every column is selected here, the defaults included. the select
 * always carries a `where`, which sqlite needs to parse the `on conflict` after it
 * (https://sqlite.org/lang_upsert.html, "parsing ambiguity").
 */
function fanOut(
	db: Db,
	event: WebhookEvent,
	subjectId: string,
	now: Date,
	extra?: SQL
): BatchItem<'sqlite'> {
	const at = now.getTime();
	return db
		.insert(webhookDelivery)
		.select(
			db
				.select({
					id: sql`'msg_' || ${UUID_V4}`.as('id'),
					destinationId: webhookDestination.id,
					event: sql`${event}`.as('event'),
					subjectId: sql`${subjectId}`.as('subject_id'),
					status: sql`'pending'`.as('status'),
					attempts: sql`0`.as('attempts'),
					nextAttemptAt: sql`${at}`.as('next_attempt_at'),
					leasedUntil: sql`null`.as('leased_until'),
					lastStatus: sql`null`.as('last_status'),
					lastError: sql`null`.as('last_error'),
					deliveredAt: sql`null`.as('delivered_at'),
					createdAt: sql`${at}`.as('created_at'),
					updatedAt: sql`${at}`.as('updated_at')
				})
				.from(webhookDestination)
				.innerJoin(
					webhookDestinationEvent,
					and(
						eq(webhookDestinationEvent.destinationId, webhookDestination.id),
						eq(webhookDestinationEvent.event, event)
					)
				)
				.where(and(isNull(webhookDestination.archivedAt), extra))
		)
		.onConflictDoNothing();
}
