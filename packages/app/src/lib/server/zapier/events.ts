import { and, eq, isNull, ne, notExists, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client';
import {
	donation,
	payment,
	zapierDelivery,
	zapierSubscription,
	type ZapierTrigger
} from '../db/schema';

// the whole rule about which Zaps a settled gift is owed to, and the statements that say so.
//
// nothing here posts anything to Zapier. what it produces is rows in `zapier_delivery` — the outbox
// the delivery run reads — and the one property that matters is that they land in the same
// `batch()` as the payment they are about. a gift that committed without its rows is an event no
// Zap ever hears of, and nothing sweeps for one: the delivery reads this table and nothing else.
// `zapier_delivery`'s header in ../db/schema.ts argues the key that makes each row happen once.
//
// **there is no gate read.** each statement is an INSERT…SELECT over the open subscriptions to its
// trigger, evaluated inside the batch's own transaction, so no subscription is zero rows and a
// replaced key — which ends every subscription made under it — is zero rows too. a read in front
// of it would be a second throwing read on the money path that decides nothing the statement does
// not already decide.
//
// **"new donor" is a predicate in the statement, never a read before it.** the donor's row is owed
// only where no other succeeded inbound payment of theirs exists, and D1 runs one batch at a time,
// so of two first gifts settling together the one that commits second sees the first and owes no
// donor row. the primary key `(subscription_id, event_id)`, with the contact id as the event, is
// what refuses a second one per Zap regardless — `on conflict do nothing` answers that refusal,
// and only that one: a NOT NULL, CHECK or foreign-key fault still refuses the whole batch.
//
// the predicate reads the ledger's own truth rather than a marker, so:
// - a Zap subscribed after a donor's first gift does not hear of them on their second.
// - a settlement that marks a payment `succeeded` but posts nothing (`recognition` failing in
//   ../donations/settle.ts) writes no row here, and that donor's next posted gift reads as not
//   their first, so "new donor" never fires for them.

/** the gift a settlement just made `succeeded`, and the donor it is filed under. */
export type SettledGift = { readonly paymentId: string; readonly contactId: string };

/**
 * the `new_gift` and `new_donor` rows for one settled payment, for splicing into the caller's
 * single `batch()`:
 *
 *   await db.batch([...writes, ...outboxStatements(db, gate, [charge, fee]), ...zapierStatements(db, gift)]);
 *
 * **after the statement that inserts the payment**, where the caller inserts one: every row points
 * at it through `zapier_delivery.payment_id`, a foreign key D1 checks per statement.
 *
 * pure apart from the clock. an INSERT…SELECT never runs a column's `$defaultFn`, so the three
 * timestamps are bound here, from the one `new Date()` `createdAt()` would have read.
 */
export function zapierStatements(
	db: Db,
	gift: SettledGift
): [BatchItem<'sqlite'>, BatchItem<'sqlite'>] {
	const now = new Date();
	const prior = alias(payment, 'prior');
	const priorDonation = alias(donation, 'prior_donation');
	const earlierGift = db
		.select({ one: sql`1` })
		.from(prior)
		.innerJoin(priorDonation, eq(priorDonation.id, prior.donationId))
		.where(
			and(
				eq(priorDonation.contactId, gift.contactId),
				eq(prior.status, 'succeeded'),
				eq(prior.direction, 'inbound'),
				ne(prior.id, gift.paymentId)
			)
		);

	return [
		fanOut(db, 'new_gift', gift.paymentId, gift.paymentId, now),
		fanOut(db, 'new_donor', gift.contactId, gift.paymentId, now, notExists(earlierGift))
	];
}

/**
 * one pending row per open subscription to `trigger`, where `extra` holds.
 *
 * drizzle's `insert().select()` names every column of the table in declaration order and refuses a
 * select whose keys differ, so every column is selected here, the defaults included. the select
 * always carries a `where`, which sqlite needs to parse the `on conflict` after it
 * (https://sqlite.org/lang_upsert.html, "parsing ambiguity").
 */
function fanOut(
	db: Db,
	trigger: ZapierTrigger,
	eventId: string,
	paymentId: string,
	now: Date,
	extra?: SQL
): BatchItem<'sqlite'> {
	const at = now.getTime();
	return db
		.insert(zapierDelivery)
		.select(
			db
				.select({
					subscriptionId: zapierSubscription.id,
					eventId: sql`${eventId}`.as('event_id'),
					paymentId: sql`${paymentId}`.as('payment_id'),
					status: sql`'pending'`.as('status'),
					attempts: sql`0`.as('attempts'),
					nextAttemptAt: sql`${at}`.as('next_attempt_at'),
					leasedUntil: sql`null`.as('leased_until'),
					lastError: sql`null`.as('last_error'),
					createdAt: sql`${at}`.as('created_at'),
					updatedAt: sql`${at}`.as('updated_at')
				})
				.from(zapierSubscription)
				.where(
					and(eq(zapierSubscription.trigger, trigger), isNull(zapierSubscription.endedAt), extra)
				)
		)
		.onConflictDoNothing();
}
