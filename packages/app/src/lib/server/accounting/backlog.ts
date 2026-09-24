import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { quickbooksSync } from '../db/schema';

// what the console says about the queue, and the one press an operator has over it.
//
// it is separate from ./deliver.ts because the questions are different: that module is the run —
// what to send next, where a refusal lands, when a notice goes out — and this one is a screen's
// read and a person's press. what they share is the table, and the split between them is stated at
// ./deliver.ts's own header: every status a *run* writes is written there, and the one status a
// *person* writes is written here.
//
// **a retry is the only thing an operator may do to a row, and it is the only thing worth
// offering.** a row that was given up on is one no later run reads (`failed` in ./deliver.ts), so
// something has to put it back — and what is being repaired is never the row itself but the mapping
// or the connection behind it, which the operator has just fixed on the screen this press sits on.
// no press here deletes a row and none marks one sent: a gift owed to the books stays owed, and a
// row claiming a record that was never created is a gift nothing will ever find. the one thing that
// removes a row is moving the start date later (./outbox.ts), and only a row dated before the new
// date that no run has ever sent: one waiting for its first send. that is a gift the operator has
// just said the books do not take.

/** the queue as an operator is shown it. */
export interface QuickbooksBacklog {
	/** how many gifts were given up on. what a retry acts on, and nothing else. */
	readonly failed: number;
	/**
	 * when the oldest gift still owed to the books was queued, or null where none is.
	 *
	 * every unfinished row counts, `pending` as well as `failed`: what it answers is how far behind
	 * the books are, and a gift waiting on a backoff is as far behind as one given up on.
	 */
	readonly oldestWaitingAt: Date | null;
}

/** every status that is not finished. `sent` is the one terminal state and is never read back. */
const UNFINISHED = inArray(quickbooksSync.status, ['pending', 'failed']);

/** the queue, in one read: two aggregates over the index the sweep already has. */
export async function readQuickbooksBacklog(db: Db): Promise<QuickbooksBacklog> {
	const [row] = await db
		.select({
			failed: sql<number>`coalesce(sum(case when ${eq(quickbooksSync.status, 'failed')} then 1 else 0 end), 0)`,
			oldestWaitingAt: sql<
				number | null
			>`min(case when ${UNFINISHED} then ${quickbooksSync.createdAt} end)`
		})
		.from(quickbooksSync);

	return {
		failed: row?.failed ?? 0,
		oldestWaitingAt: row?.oldestWaitingAt == null ? null : new Date(row.oldestWaitingAt)
	};
}

/**
 * every row that was given up on, queued again, and how many there were.
 *
 * **the notice stamp goes with the status.** a row's stamp is what makes the failure notice once
 * per outage (../db/schema.ts), so a retry that left it standing would leave the outage marked as
 * already reported — and the next failure behind it, on rows an operator has just asked to be tried
 * again, would go out to nobody.
 *
 * `attempts` is left where it is. above zero it says a send may have reached QuickBooks, so the
 * next one looks before it posts and a start-date move never drops the row (./deliver.ts,
 * ./outbox.ts) — zeroing it here would post a gift already in the books a second time. the backoff
 * it feeds is measured from `updated_at`, which this write moves — so the first attempt after a
 * retry waits out one rung rather than going at once, a hundred rows released together do not all
 * call Intuit in the same second, and that send is posted under a fresh request id (./quickbooks.ts).
 */
export async function retryFailedEntries(db: Db): Promise<number> {
	const retried = await db
		.update(quickbooksSync)
		.set({ status: 'pending', notifiedAt: null })
		.where(eq(quickbooksSync.status, 'failed'))
		.returning({ entryGroupId: quickbooksSync.entryGroupId });
	return retried.length;
}
