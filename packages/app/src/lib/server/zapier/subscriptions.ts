import { and, count, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { sqliteResultCode } from '../db/rejection';
import {
	zapierDelivery,
	zapierKey,
	zapierSubscription,
	type ZapierEndReason,
	type ZapierTrigger
} from '../db/schema';

// the Zaps listening: which hook is subscribed to which trigger, and every way one stops.
//
// a subscription is ended, never deleted (`zapier_subscription`'s header in ../db/schema.ts), and
// **ending one drops what it was still owed in the same batch**. a pending row behind an ended
// subscription is an event queued for nobody, and the delivery run would carry on posting it to a
// hook Zapier has let go of. `endSubscriptionStatements` is the one place that pairs the two, and
// every end — Zapier unsubscribing, a hook answering 410, the key being replaced, a hook moving
// trigger — goes through it.

/** a Zap asking for `trigger`'s events at `hookUrl`, already checked by the route. */
export type SubscribeRequest = { readonly trigger: ZapierTrigger; readonly hookUrl: string };

/** the subscription Zapier stores as `subscribeData.id`, and whether this call opened it. */
export type Subscribed = { readonly id: string; readonly created: boolean };

/** which open subscriptions an end reaches: one by id, or every one — a replaced key. */
export type SubscriptionScope = { readonly id: string } | 'every_open';

/**
 * the subscription for `hookUrl`, opened if it has none — or `null` when `keyHash`, the key the
 * request was verified under, is no longer this deployment's.
 *
 * a hook already open for the same trigger answers with the id it has: Zapier retries a subscribe
 * it never heard back from, and a second row would double every event to that Zap. a hook open
 * under the other trigger has that row ended, `unsubscribed`, and a fresh one opened — one hook
 * hears one trigger, which is what the open-hook index holds.
 *
 * **the insert checks the key in the same statement.** a replace landing between the request's
 * key check and this insert ends every open row, and a row opened after it would be a Zap on the
 * old key receiving gifts that nothing ever ends.
 */
export async function subscribe(
	db: Db,
	request: SubscribeRequest,
	keyHash: string
): Promise<Subscribed | null> {
	const open = await openFor(db, request.hookUrl);
	if (open !== undefined && open.trigger === request.trigger)
		return { id: open.id, created: false };

	const now = new Date();
	const insert = db
		.insert(zapierSubscription)
		.select(
			db
				.select({
					id: sql`${uuidv7()}`.as('id'),
					trigger: sql`${request.trigger}`.as('trigger'),
					hookUrl: sql`${request.hookUrl}`.as('hook_url'),
					endedAt: sql`null`.as('ended_at'),
					endedReason: sql`null`.as('ended_reason'),
					createdAt: sql`${now.getTime()}`.as('created_at'),
					updatedAt: sql`${now.getTime()}`.as('updated_at')
				})
				.from(zapierKey)
				.where(eq(zapierKey.keyHash, keyHash))
		)
		.returning({ id: zapierSubscription.id });
	try {
		const [row] =
			open === undefined
				? await insert
				: (
						await db.batch([...endSubscriptionStatements(db, open, 'unsubscribed', now), insert])
					)[2];
		return row === undefined ? null : { id: row.id, created: true };
	} catch (error) {
		// Zapier's retry of a subscribe it never heard back from can land beside the first: the
		// open-hook index refuses the second insert, and it answers with the row the first opened.
		if (sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
		const winner = await openFor(db, request.hookUrl);
		if (winner === undefined || winner.trigger !== request.trigger) throw error;
		return { id: winner.id, created: false };
	}
}

/** the open subscription for `hookUrl`, if there is one. */
async function openFor(db: Db, hookUrl: string) {
	const [open] = await db
		.select({ id: zapierSubscription.id, trigger: zapierSubscription.trigger })
		.from(zapierSubscription)
		.where(and(eq(zapierSubscription.hookUrl, hookUrl), isNull(zapierSubscription.endedAt)));
	return open;
}

/** how many Zaps are listening to each trigger — what replacing the key would disconnect. */
export async function countListening(
	db: Db
): Promise<{ readonly newGift: number; readonly newDonor: number }> {
	const rows = await db
		.select({ trigger: zapierSubscription.trigger, listening: count() })
		.from(zapierSubscription)
		.where(isNull(zapierSubscription.endedAt))
		.groupBy(zapierSubscription.trigger);
	const of = (trigger: ZapierTrigger) => rows.find((r) => r.trigger === trigger)?.listening ?? 0;
	return { newGift: of('new_gift'), newDonor: of('new_donor') };
}

/**
 * Zapier letting go of subscription `id`. an unknown or already-ended id changes nothing and is no
 * error: Zapier reads a refused unsubscribe as a failure, and there is nothing left to stop.
 */
export async function unsubscribe(db: Db, id: string): Promise<void> {
	await db.batch(endSubscriptionStatements(db, { id }, 'unsubscribed', new Date()));
}

/**
 * the statements that end the subscriptions in `scope` for `reason` at `now`, for one `batch()`.
 * `onlyIf` is a condition both statements also hold to: a replace ends nothing unless its own
 * key write landed.
 *
 * the pending rows are dropped first, while the subscriptions they belong to still read as open —
 * the other order would leave `every_open` naming nothing by the time the drop ran. a row already
 * sent or given up on keeps its status: it is history, not something owed. an already-ended
 * subscription keeps the reason it ended for.
 */
export function endSubscriptionStatements(
	db: Db,
	scope: SubscriptionScope,
	reason: ZapierEndReason,
	now: Date,
	onlyIf?: SQL
): [BatchItem<'sqlite'>, BatchItem<'sqlite'>] {
	const open = and(
		scope === 'every_open' ? undefined : eq(zapierSubscription.id, scope.id),
		isNull(zapierSubscription.endedAt),
		onlyIf
	);
	return [
		db
			.update(zapierDelivery)
			.set({ status: 'dropped', leasedUntil: null, updatedAt: now })
			.where(
				and(
					eq(zapierDelivery.status, 'pending'),
					inArray(
						zapierDelivery.subscriptionId,
						db.select({ id: zapierSubscription.id }).from(zapierSubscription).where(open)
					)
				)
			),
		db
			.update(zapierSubscription)
			.set({ endedAt: now, endedReason: reason, updatedAt: now })
			.where(open)
	];
}
