import { and, eq, exists, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { RecurringPlanStatus } from '../../recurring/statuses';
import type { Db } from '../db/client';
import { recurringPlan } from '../db/schema';
import { recurringGiftChangeWebhookStatements } from '../webhooks/events';

// every write to a commitment after the insert that opens it (../donations/collect.ts), and the
// event each one owes a webhook destination: the stop in ./queries.ts, and in
// ../donations/collect.ts the lapse, the ending, the revival and the next charge each collection
// refreshes. ../donations/sole-inserter.spec.ts holds that no other module updates the table.
//
// **the event lands exactly when the change does, with no read in front.** the event's INSERT…
// SELECT goes first in the same `batch()` and selects only where the update's own `where` holds —
// the status the writer expects and a stored value that differs from the one being written — so it
// sees the row the update is about to change. a lost race, a redelivery or a second press matches
// nothing in either statement: no event, no write, no `updated_at` moved.
//
// **which event is the status the change writes.** a commitment moving to `lapsed` or `cancelled`
// has ended — for `lapsed` until it revives (`revives` in ../donations/collect.ts), so a
// commitment can end more than once. every other change is an update.

/** what a standing change writes. absent keys are left as they stand. */
export type PlanChange = {
	readonly status?: RecurringPlanStatus;
	/** a `coalesce` where an existing date must survive, which is the stop's. */
	readonly endedAt?: Date | null | SQL;
	readonly nextChargeAt?: Date | null;
};

/**
 * the event `change` owes, then the update writing it over the commitment `planId` where it stands
 * in one of `from`, for splicing into a caller's `batch()`. the update returns the id it wrote, so
 * a caller reads whether it landed off the batch's own answer.
 *
 * `ended_at` is not compared: `recurring_plan_ended_at_check` ties it to `status`, so it moves only
 * where the status does.
 */
export function planChangeStatements(
	db: Db,
	planId: string,
	from: readonly RecurringPlanStatus[],
	change: PlanChange
) {
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
	const event =
		change.status === undefined || change.status === 'active'
			? 'recurring_gift.updated'
			: 'recurring_gift.ended';
	return [
		recurringGiftChangeWebhookStatements(
			db,
			event,
			planId,
			exists(db.select({ one: sql`1` }).from(recurringPlan).where(lands))
		),
		db.update(recurringPlan).set(change).where(lands).returning({ id: recurringPlan.id })
	] as const;
}
