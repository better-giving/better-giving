import { and, eq, exists, isNull, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../db/client';
import {
	payment,
	webhookDelivery,
	webhookDestination,
	webhookDestinationEvent
} from '../db/schema';
import { hasSettledGift, isFirstSettledGift, refundStands } from '../donations/queries';
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

/** the gift a settlement just made `succeeded`, and the donor it is filed under. */
export type MadeGift = { readonly paymentId: string; readonly contactId: string };

/**
 * the `gift.made` rows for one settled payment, and the `donor.added` rows where it is its donor's
 * first settled gift, for splicing into a caller's single `batch()`. outside the specs its one
 * caller is `settledGiftWrites` in ../books/writes.ts, and a writer takes them from there.
 *
 * `donor.added` is keyed on the contact, so a destination hears of each donor once, and owed only
 * where {@link isFirstSettledGift} holds — the rule a `new_donor` Zap is owed by, so both feeds
 * agree on who is new. a donor whose checkout never settles, or one typed in on the dashboard with
 * no gift, is not heard of until a gift of theirs settles.
 *
 * pure apart from the clock. an INSERT…SELECT never runs a column's `$defaultFn`, so the
 * timestamps are bound here, from one `new Date()`.
 */
export function webhookStatements(
	db: Db,
	gift: MadeGift
): [BatchItem<'sqlite'>, BatchItem<'sqlite'>] {
	const now = new Date();
	return [
		fanOut(db, 'gift.made', gift.paymentId, now),
		fanOut(db, 'donor.added', gift.contactId, now, isFirstSettledGift(db, gift))
	];
}

/**
 * the `gift.refunded` rows for `refundPaymentId`, the refund-direction row whose money is now
 * final: each refund of a gift, and each dispute lost on one, is its own event. outside the specs
 * its one caller is `refundedWrites` in ../books/writes.ts, reached only through `reversalWrites`.
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

/**
 * the subject of an event about one change to a record: `<record id>:<epoch ms of the change>`, so
 * each change is its own event under `webhook_delivery_event_idx` where the record's id alone would
 * let a destination hear of its first change only. ./payload.ts renders the record as it stands at
 * send, from {@link changedRecordOf}.
 */
export function changeSubject(recordId: string, at: Date): string {
	return `${recordId}:${at.getTime()}`;
}

/** the record a {@link changeSubject} names, or null where `subject` is not one. */
export function changedRecordOf(subject: string): string | null {
	const colon = subject.indexOf(':');
	return colon <= 0 ? null : subject.slice(0, colon);
}

/**
 * the `donor.updated` rows for a write to the contact `contactId`, owed only where `changed` holds
 * and a gift of theirs has settled ({@link hasSettledGift}): queued only once a gift of theirs has
 * settled, so a change to a donor whose checkout never settled, or one typed in on the dashboard
 * with no gift yet, owes nothing. the write itself happens either way.
 *
 * the gate is the deployment's, not each destination's, so a destination can hear of a donor's
 * change with no `donor.added` before it:
 * - a destination subscribed after the donor's first gift hears of their next change, and was
 *   never owed their `donor.added`.
 * - a settlement that marks a payment `succeeded` but posts nothing (`recognition` failing in
 *   ../donations/settle.ts) settles a gift that queues no `donor.added`, and every later change is
 *   still owed.
 * - a `donor.added` waiting out a failed post's retry can be overtaken by a `donor.updated` queued
 *   after it.
 *
 * outside the specs its one caller is `consentWrites` in ../donations/donor.ts, which splices it
 * **in front of** the update it reports: `changed` compares the row as it stands with what the
 * update will write, so a write that changes nothing owes nothing.
 */
export function donorUpdatedWebhookStatements(
	db: Db,
	contactId: string,
	changed: SQL
): BatchItem<'sqlite'> {
	const now = new Date();
	return fanOut(
		db,
		'donor.updated',
		changeSubject(contactId, now),
		now,
		and(changed, hasSettledGift(db, contactId))
	);
}

/**
 * the `recurring_gift.started` rows for the commitment `planId`, keyed on it, so a destination
 * hears of each commitment starting once. its one caller is `openCommitment` in
 * ../donations/collect.ts, which splices it into the batch that inserts the `recurring_plan` row —
 * the first charge that settles — so a refused insert takes these rows with it.
 */
export function recurringGiftStartedWebhookStatements(db: Db, planId: string): BatchItem<'sqlite'> {
	return fanOut(db, 'recurring_gift.started', planId, new Date());
}

/** what a standing change to a commitment is announced as. */
export type RecurringGiftChange = 'recurring_gift.updated' | 'recurring_gift.ended';

/**
 * the `event` rows for one standing change to the commitment `planId`, owed only where `lands`
 * holds. keyed on {@link changeSubject}, so a commitment that revives and ends again is heard of
 * each time. its one caller is `planChangeStatements` in ../recurring/changes.ts, which splices it
 * **in front of** the update it reports, with `lands` the update's own `where`.
 */
export function recurringGiftChangeWebhookStatements(
	db: Db,
	event: RecurringGiftChange,
	planId: string,
	lands: SQL
): BatchItem<'sqlite'> {
	const now = new Date();
	return fanOut(db, event, changeSubject(planId, now), now, lands);
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
