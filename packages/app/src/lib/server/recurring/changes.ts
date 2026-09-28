import { and, eq, exists, inArray, ne, or, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { RecurringPlanStatus } from '../../recurring/statuses';
import type { Db } from '../db/client';
import { recurringPlan } from '../db/schema';
import { type RecurringGiftChange, recurringGiftChangeWebhookStatements } from '../webhooks/events';

// every write to a commitment after the insert that opens it (../donations/collect.ts), and the
// event each one owes a webhook destination: the stop in ./queries.ts, and in
// ../donations/collect.ts the lapse, the ending, the revival and the next charge each collection
// refreshes. ./sole-updater.spec.ts holds that no other module updates the table.
//
// **the event lands exactly when the change does, with no read in front.** each event's INSERT…
// SELECT goes first in the same `batch()` and selects only where the update's own `where` holds —
// the status the writer expects and a stored value that differs from the one being written — so it
// sees the row the update is about to change. a lost race, a redelivery or a second press matches
// nothing in either statement: no event, no write, no `updated_at` moved.
//
// **which event is the move the status makes.** a live commitment (`active`) moving to `lapsed`
// or `cancelled` has ended. every other change is an update — a revival, a next charge, and a
// lapsed commitment stopped, which the read API shows moving from `payment_failed` to `stopped`. a
// revived commitment that ends again is heard of ending again, and one opened already stopped is
// heard of ending in the batch that opens it (`recurringGiftStartedWebhookStatements` in
// ../webhooks/events.ts).

/**
 * what a standing change writes: a status, or a next charge, or both; absent keys are left as they
 * stand. `endedAt` is written only alongside a status, which is what lets the status alone say
 * whether the date moves. `SQL` is a `coalesce` where an existing date must survive, the stop's.
 */
export type PlanChange =
	| {
			readonly status: RecurringPlanStatus;
			readonly endedAt?: Date | null | SQL;
			readonly nextChargeAt?: Date | null;
	  }
	| {
			readonly status?: undefined;
			readonly endedAt?: undefined;
			readonly nextChargeAt: Date | null;
	  };

/**
 * the events `change` owes, then the update writing it over the commitment `planId` where it
 * stands in one of `from`, for splicing into a caller's `batch()`. where the change stops a
 * commitment, which event is owed is the stored status's, so a `from` holding both kinds gets one
 * statement for each, split on it. the update is last and returns the id it wrote.
 *
 * `ended_at` is not compared: {@link PlanChange} writes it only beside a status, and a change the
 * status makes is already a difference.
 */
export function planChangeStatements(
	db: Db,
	planId: string,
	from: readonly RecurringPlanStatus[],
	change: PlanChange
): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] {
	const differs = [
		change.status === undefined ? undefined : sql`${recurringPlan.status} is not ${change.status}`,
		change.nextChargeAt === undefined
			? undefined
			: sql`${recurringPlan.nextChargeAt} is not ${change.nextChargeAt?.getTime() ?? null}`
	];
	const lands = and(
		eq(recurringPlan.id, planId),
		inArray(recurringPlan.status, from),
		or(...differs)
	);
	const owed = (event: RecurringGiftChange, where?: SQL) =>
		recurringGiftChangeWebhookStatements(
			db,
			event,
			planId,
			exists(db.select({ one: sql`1` }).from(recurringPlan).where(and(lands, where)))
		);
	const update = db
		.update(recurringPlan)
		.set(change)
		.where(lands)
		.returning({ id: recurringPlan.id });

	return [...eventsOwed(), update];

	function eventsOwed(): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] {
		if (change.status === undefined || change.status === 'active') {
			return [owed('recurring_gift.updated')];
		}
		const updatedOverEnded = () =>
			owed('recurring_gift.updated', ne(recurringPlan.status, 'active'));
		if (!from.includes('active')) return [updatedOverEnded()];
		const ended = owed('recurring_gift.ended', eq(recurringPlan.status, 'active'));
		return from.every((status) => status === 'active') ? [ended] : [ended, updatedOverEnded()];
	}
}

/** {@link planChangeStatements} committed on its own: whether the change landed. */
export async function applyPlanChange(
	db: Db,
	planId: string,
	from: readonly RecurringPlanStatus[],
	change: PlanChange
): Promise<boolean> {
	const written: unknown = (await db.batch(planChangeStatements(db, planId, from, change))).at(-1);
	return Array.isArray(written) && written.length > 0;
}
