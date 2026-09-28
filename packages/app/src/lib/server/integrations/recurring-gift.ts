import type { RecurringPlanStatus } from '../../recurring/statuses';
import { majorText } from '../../forms/amounts';
import type { Db } from '../db/client';
import { type RecurringInterval, recurringPlan } from '../db/schema';
import { type PageOf, type PageQuery, pageOf, storedTimesWalk } from './paging';

// one recurring gift as the read API's recurring-gifts list answers it
// (src/routes/integrations.v1.recurring-gifts.ts): a donor's standing commitment to give on a
// schedule, never one of its charges — each charge is a gift on the gifts list, like any other.
//
// **the recurring gifts are the ones /admin/recurring lists**: every commitment this deployment
// holds, live or ended. `listRecurringPlans` in ../recurring/queries.ts is the screen's read.
//
// **the keys are permanent.** each is a field some integrator's code reads, so a rename breaks it
// silently: add a key, never rename or drop one. every key is present on every recurring gift, null
// where it has nothing to say. the donor is `donor_id`, an id on the donors list, and not a copy of
// their name: a name changes on the donor, and the donors list is where that change is announced.
//
// **`status` is the dashboard's word, not the stored one** — `RECURRING_STATUS_LABELS` in
// ../../recurring/statuses.ts: `stopped` where the organisation ended it, `payment_failed` where
// the processor gave up after the donor's card kept failing. the second is not final: the
// processor can start collecting again if the card goes through (`revives` in
// ../donations/collect.ts), so a caller reads a `payment_failed` gift turning `active` as one more
// change, and `stopped` is the only end that never comes back.
//
// **when a recurring gift last changed is the row's own `updated_at`.** every write to a
// commitment after the one that opens it is a drizzle `.update(recurringPlan)` that leaves the
// column unnamed, so the column's `$onUpdateFn` in ../db/schema.ts stamps it in the same
// statement: the stop in ../recurring/queries.ts, and in ../donations/collect.ts the lapse, the
// revival and the next charge each collection refreshes. a writer naming `updated_at` itself, or
// writing the row past drizzle, would hide its change from `updated_since`. a refresh that finds
// the next charge where it was still moves the stamp, and serves the gift again unchanged.
//
// **two orders**, the gifts list's (./gift.ts's header): with no `updated_since`, newest first by
// when the commitment was recorded, then id; with it, every recurring gift whose `updated_at` is at
// or after it, oldest change first, then id — resumed as that header says, from a minute before
// the last `updated_at` served, since the stamp is taken as the write is built.

/**
 * where a recurring gift stands, in the dashboard's words. **the set may gain values**: a reader
 * lets one it does not know pass, and a value's meaning never narrows.
 */
export const RECURRING_GIFT_STATUSES = ['active', 'stopped', 'payment_failed'] as const;
export type RecurringGiftStatus = (typeof RECURRING_GIFT_STATUSES)[number];

const STATUS_WORDS: Record<RecurringPlanStatus, RecurringGiftStatus> = {
	active: 'active',
	cancelled: 'stopped',
	lapsed: 'payment_failed'
};

/** one recurring gift, as the read API's recurring-gifts list answers it. */
export type ApiRecurringGift = {
	readonly id: string;
	readonly donor_id: string;
	/** each charge, in major units as a decimal string in the currency's own digits: `25.00`. */
	readonly amount: string;
	readonly amount_minor: number;
	readonly currency: string;
	/** how often it charges: the gifts list's `frequency`, never `one_time` here. */
	readonly frequency: RecurringInterval;
	readonly status: RecurringGiftStatus;
	/**
	 * when the next charge is expected, ISO 8601 in UTC: an expectation, since the processor holds
	 * the schedule. null where none is — an ended gift, or one whose processor has not yet said.
	 */
	readonly next_charge_at: string | null;
	/** when its first charge settled, ISO 8601 in UTC. */
	readonly started_at: string;
	/** when this recurring gift last changed, ISO 8601 in UTC: what `updated_since` compares. */
	readonly updated_at: string;
};

/** the two orders recurring gifts are walked in, named as their cursors carry them (./paging.ts). */
export const RECURRING_GIFT_ORDERS = {
	newest: 'recurring_gifts.newest',
	changed: 'recurring_gifts.changed'
} as const;

/** one page of recurring gifts in the order `query` names. */
export async function readRecurringGiftPage(
	db: Db,
	query: PageQuery
): Promise<PageOf<ApiRecurringGift>> {
	const walk = storedTimesWalk(query, recurringPlan);
	const rows = await db
		.select({
			id: recurringPlan.id,
			contactId: recurringPlan.contactId,
			amountMinor: recurringPlan.amountMinor,
			currency: recurringPlan.currency,
			interval: recurringPlan.interval,
			status: recurringPlan.status,
			nextChargeAt: recurringPlan.nextChargeAt,
			startedAt: recurringPlan.startedAt,
			createdAt: recurringPlan.createdAt,
			updatedAt: recurringPlan.updatedAt
		})
		.from(recurringPlan)
		.where(walk.where)
		.orderBy(...walk.orderBy)
		.limit(query.limit + 1);
	const page = pageOf(rows, query.limit, walk.keyOf);
	return {
		rows: page.rows.map((row) => ({
			id: row.id,
			donor_id: row.contactId,
			amount: majorText(row.amountMinor, row.currency),
			amount_minor: row.amountMinor,
			currency: row.currency,
			frequency: row.interval,
			status: STATUS_WORDS[row.status],
			next_charge_at: row.nextChargeAt?.toISOString() ?? null,
			started_at: row.startedAt.toISOString(),
			updated_at: row.updatedAt.toISOString()
		})),
		next: page.next
	};
}
