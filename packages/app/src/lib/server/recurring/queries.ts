import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { RECURRING_PLAN_STATUSES, type RecurringPlanStatus } from '$lib/recurring/statuses';
import { readContactSummaries } from '../contacts/queries';
import type { Db } from '../db/client';
import { recurringPlan, type RecurringPlan } from '../db/schema';

// what /admin/recurring reads, and the one write it performs.
//
// the same boundary ../donations/queries.ts and ../forms/queries.ts draw: the `recurringPlan` table
// object leaves this module in one named place, so a screen takes rows and never a query builder,
// and every place the table is touched is in a file a reader can open.
//
// that place is `activeCommitment` in ../contacts/queries.ts, which the donor file's recurring view
// and its two counts spend. it is the crossing that file's header names from the other end, and it
// is forced by the same thing every other crossing in this app is: the question is about donors
// rather than about commitments, so the test has to be a predicate on a statement paging `contact`.
// nothing about a commitment is read there — only whether one is active — and a read that wanted a
// row belongs here.
//
// the donor's name and email come from ../contacts/queries.ts rather than from a join here, for
// the reason `readContactNames` states one module over: a join written here would read `contact`
// out of a file nobody looking for every reader of that table would think to open.
//
// nothing here calls the payment provider. a list that asks Stripe anything fails or hangs whenever
// Stripe does, and nothing on these screens is a fact about the processor's account — what the
// commitment is, when it started and where it stands are all this deployment's own rows. the one
// call there is is the cancel in ./stop.ts, which is a write an operator pressed.

/**
 * how many commitments a list page returns.
 *
 * bounded from the same two ends `DONATION_LIST_LIMIT` is (../donations/queries.ts): it is a
 * `LIMIT` because the list is every commitment a deployment has ever taken, and the page's ids are
 * bound one parameter each into the follow-up read against D1's cap of 100 bound parameters — so a
 * limit raised past that does not read slowly, it fails the query. the probe row never reaches that
 * read (see `listRecurringPlans`), so the count bound is this number exactly.
 *
 * it is also the cap this screen is least comfortable with, and that is recorded rather than
 * hidden: /admin/recurring exists to find one named donor and has no search, so a commitment
 * outside the window is unreachable from here. the ordering below is what keeps the rows that
 * survive the cap the rows with a button on them.
 */
export const RECURRING_LIST_LIMIT = 50;

/**
 * where a status sits in the order this list is read in.
 *
 * a `Record` over the union rather than an array, so a fourth status is a compile error here
 * rather than a row silently sorted last by an `else` arm — which on this screen would be a
 * commitment an operator can act on, hidden behind fifty they cannot.
 *
 * the order is the job rather than the chronology: this screen exists to act on a gift and only
 * the first two can be acted on, so the fifty rows that survive the cap are the fifty with a
 * control on them.
 */
const STATUS_RANK: Record<RecurringPlanStatus, number> = {
	active: 0,
	lapsed: 1,
	cancelled: 2
};

/**
 * that order as SQLite has to be told it.
 *
 * built from the record above rather than written out, so the two cannot drift — and built once at
 * module load rather than per call, because it is the same expression every time.
 *
 * every rank and every status word is a bound parameter, which is six of D1's hundred and is why
 * the page limit above is stated the way it is.
 */
const STATUS_ORDER: SQL = sql`case ${recurringPlan.status} ${sql.join(
	RECURRING_PLAN_STATUSES.map((status) => sql`when ${status} then ${STATUS_RANK[status]}`),
	sql.raw(' ')
)} end`;

/**
 * the columns of `recurring_plan` a list page renders, and `contact_id`, which it does not — that
 * one is how the donor is looked up.
 *
 * derived from `RecurringPlan` rather than written out, for the reason `DonationRow` is in
 * ../donations/queries.ts: a column renamed or retyped is a compile error here rather than a field
 * that silently stops arriving. everything else stays out — the two processor ids, the form, the
 * timestamps — because a column reaches a browser by being selected, and a projection is the only
 * thing that stops the next one added from doing so by default.
 */
type RecurringPlanRow = Pick<
	RecurringPlan,
	'id' | 'contactId' | 'amountMinor' | 'currency' | 'interval' | 'status' | 'nextChargeAt'
>;

/**
 * the columns above, as drizzle needs them named.
 *
 * spelled out beside the type it must agree with, and `satisfies` is what ties them together: a
 * column added to one and not the other stops compiling.
 */
const LIST_COLUMNS = {
	id: recurringPlan.id,
	contactId: recurringPlan.contactId,
	amountMinor: recurringPlan.amountMinor,
	currency: recurringPlan.currency,
	interval: recurringPlan.interval,
	status: recurringPlan.status,
	nextChargeAt: recurringPlan.nextChargeAt
} satisfies Record<keyof RecurringPlanRow, SQLiteColumn>;

/** one commitment as the list shows it: the row, and the donor it belongs to. */
export type RecurringListRow = Omit<RecurringPlanRow, 'contactId'> & {
	/** always populated — `contact.display_name` is denormalized, so no list branches on kind. */
	donorName: string;
	/** `null` for a donor nobody holds an address for, which the screen draws as a state. */
	donorEmail: string | null;
};

/**
 * one page of commitments: at most `RECURRING_LIST_LIMIT` of them, and whether more exist.
 *
 * the probe row is sliced off inside `listRecurringPlans` rather than handed over with a warning,
 * so there is no shape in which a caller renders `RECURRING_LIST_LIMIT + 1` rows by forgetting to
 * slice. the cap belongs to this module; the page only reports it.
 */
export type RecurringPage = {
	/** still-collecting first, capped. never contains the probe row. */
	plans: RecurringListRow[];
	/** true when the probe came back — there are commitments this page is not showing. */
	hasMore: boolean;
};

/**
 * every standing commitment this deployment holds, the ones that can still be acted on first.
 *
 * two reads and no join, the shape `listDonations` uses and for the reasons stated there. the
 * second read is the donors, which is a read rather than a join for a reason about module
 * boundaries rather than cost.
 *
 * ordered by status, then `started_at` descending, then `id` descending. the tiebreak is not
 * decoration: `started_at` is Unix ms and two commitments opened in one `batch()` tie on it, so
 * without it the list reshuffles between loads. there is no index behind either key and none is
 * wanted — the schema states this read is a full list over "commitments in the low thousands at
 * most" ($lib/server/db/schema.ts, on `recurring_plan_contact_id_idx`).
 *
 * the probe is dropped before the donors are read, so the ids bound into that read number
 * `RECURRING_LIST_LIMIT` at most.
 */
export async function listRecurringPlans(db: Db): Promise<RecurringPage> {
	const rows = await db
		.select(LIST_COLUMNS)
		.from(recurringPlan)
		.orderBy(STATUS_ORDER, desc(recurringPlan.startedAt), desc(recurringPlan.id))
		.limit(RECURRING_LIST_LIMIT + 1);

	const page = rows.slice(0, RECURRING_LIST_LIMIT);
	const hasMore = rows.length > RECURRING_LIST_LIMIT;

	if (page.length === 0) return { plans: [], hasMore };

	const donors = await readContactSummaries(
		db,
		page.map((row) => row.contactId)
	);

	return {
		plans: page.map(({ contactId, ...row }) => {
			const donor = donors.get(contactId);
			return {
				...row,
				// a commitment whose donor row is missing is unreachable — `contact_id` is NOT NULL
				// and its foreign key is `NO ACTION`, so the parent cannot be deleted out from
				// under it. the fallback is here because the lookup is a `Map`, and a blank cell on
				// the screen whose whole job is finding a named person would be a worse answer to a
				// state that cannot happen than a word saying so.
				donorName: donor?.displayName ?? 'Unknown donor',
				donorEmail: donor?.primaryEmail ?? null
			};
		}),
		hasMore
	};
}

/**
 * one commitment as its own screen reads it, and as the stop names it.
 *
 * a projection again rather than the row, and it is wider than the list's by three columns, each
 * of which the detail screen genuinely uses: `form_id` because the screen links to the form,
 * `provider_subscription_id` because it is what `cancelRecurringGift` names and what an operator
 * looks the commitment up by in the Stripe dashboard when a stop half-lands, and `ended_at`
 * because a stopped commitment says when.
 *
 * `contact_id` is here for the same reason it is on the list row and leaves for the same one: it
 * is how the donor is looked up, and the screen is handed a name rather than an id.
 *
 * the two processor ids are not both here. `provider_customer_id` names the donor's record on the
 * account and nothing on this screen or in the stop reaches it, so it stays out — a column reaches
 * a browser by being selected.
 */
type RecurringPlanRecordRow = Pick<
	RecurringPlan,
	| 'id'
	| 'contactId'
	| 'formId'
	| 'amountMinor'
	| 'currency'
	| 'interval'
	| 'status'
	| 'providerSubscriptionId'
	| 'startedAt'
	| 'nextChargeAt'
	| 'endedAt'
>;

const RECORD_COLUMNS = {
	id: recurringPlan.id,
	contactId: recurringPlan.contactId,
	formId: recurringPlan.formId,
	amountMinor: recurringPlan.amountMinor,
	currency: recurringPlan.currency,
	interval: recurringPlan.interval,
	status: recurringPlan.status,
	providerSubscriptionId: recurringPlan.providerSubscriptionId,
	startedAt: recurringPlan.startedAt,
	nextChargeAt: recurringPlan.nextChargeAt,
	endedAt: recurringPlan.endedAt
} satisfies Record<keyof RecurringPlanRecordRow, SQLiteColumn>;

export type RecurringPlanRecord = RecurringPlanRecordRow;

/**
 * one commitment by id, or `null` when there is none.
 *
 * a stopped commitment comes back, deliberately, the same way `readForm` returns an archived form:
 * "this gift was stopped" and "there is no such gift" are different sentences on a screen, and a
 * lookup that hid the first would collapse them into a 404 an operator cannot act on — on the one
 * screen a staff member opens to check that what they were asked to stop is stopped.
 */
export async function readRecurringPlan(db: Db, id: string): Promise<RecurringPlanRecord | null> {
	const [row] = await db
		.select(RECORD_COLUMNS)
		.from(recurringPlan)
		.where(eq(recurringPlan.id, id))
		.limit(1);
	return row ?? null;
}

/**
 * records that a commitment has stopped: the status, the date and the expectation, in one
 * statement.
 *
 * they have to be one. `recurring_plan_ended_at_check` refuses a row whose status and `ended_at`
 * disagree, D1 has no interactive transaction to put two statements inside, and a `next_charge_at`
 * left behind would be this deployment saying a stopped commitment is due to charge. one `set` is
 * what makes all three unrepresentable apart rather than merely unlikely — no `batch()` is needed,
 * because this is one row.
 *
 * `endedAt` is only written where there is none, which is what keeps a payment-failed commitment's
 * own date. that date means when collection really ended — the moment the rail gave up — and
 * overwriting it with the moment somebody pressed a button would lose the only record of it, which
 * is why the screen labels that row `Stopped collecting`. `coalesce` rather than a branch, because
 * a branch is a read-then-write and this is one statement by construction.
 *
 * the `where` is the whole idempotency of the act and it is not a convenience: `revives` in
 * ../donations/collect.ts requires `status = 'lapsed'`, so moving the row to `cancelled` is what
 * guarantees no delivery can bring it back — and refusing a row that is already `cancelled` is
 * what keeps a double press from overwriting the timestamp that records when it happened.
 *
 * `false` means nothing was written, and the caller decides what that is. it is **not** on its own
 * a failure: the inbound `customer.subscription.deleted` for a cancel this app just made can reach
 * the row first (`recordStanding`, same file), and a screen that reported a failure there would be
 * reporting one over a completed act. ./stop.ts is where that reading is made.
 *
 * the answer comes off the update's own `returning()` rather than a select in front of it, because
 * D1 has no transaction and a check-then-write would be two commits with a race between them.
 *
 * `updated_at` is not named — it carries `$onUpdateFn`, so drizzle adds it to every `set`.
 */
export async function stopRecurringPlan(db: Db, id: string, endedAt: Date): Promise<boolean> {
	const stopped = await db
		.update(recurringPlan)
		.set({
			status: 'cancelled',
			endedAt: sql`coalesce(${recurringPlan.endedAt}, ${endedAt.getTime()})`,
			nextChargeAt: null
		})
		.where(
			and(
				eq(recurringPlan.id, id),
				inArray(recurringPlan.status, ['active', 'lapsed'] satisfies RecurringPlanStatus[])
			)
		)
		.returning({ id: recurringPlan.id });

	return stopped.length > 0;
}

/**
 * how many commitments this deployment is still collecting on.
 *
 * `status = 'active'` and nothing else, which is the reading `activeCommitment` in
 * ../contacts/queries.ts takes and for the same reason: `cancelled` and `lapsed` are both
 * commitments that are not collecting now, so a figure holding either answers "who ever set one
 * up" rather than "what is coming". `ended_at` is deliberately not tested beside it —
 * `recurring_plan_ended_at_check` in ../db/schema.ts makes the status and the end one fact, so a
 * second condition would be the same condition written twice and able to disagree with the
 * constraint that enforces it.
 *
 * a `count()` over no rows is zero rather than null, so a deployment holding none reads as a
 * nought and a screen states one.
 */
export async function readActiveRecurringCount(db: Db): Promise<number> {
	const [row] = await db
		.select({ active: count() })
		.from(recurringPlan)
		.where(eq(recurringPlan.status, 'active'));

	return row?.active ?? 0;
}
