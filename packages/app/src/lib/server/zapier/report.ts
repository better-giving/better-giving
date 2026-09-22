import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { zapierDelivery } from '../db/schema';

// what the console says about the delivery queue: a screen's read, beside ./deliver.ts's run.
//
// there is no press over it: ./deliver.ts's header says when a row is given up on, and nothing
// re-queues one — the count is the signal.

/** the queue as an operator is shown it. */
export interface ZapierDeliveries {
	/** events still owed to a Zap, due now or waiting on a backoff. */
	readonly waiting: number;
	/** events given up on. */
	readonly failed: number;
	/** when the oldest event still owed was queued, or null where none is. */
	readonly oldestWaitingAt: Date | null;
}

/** the queue, in one read. `sent` and `dropped` rows are finished and counted by nothing. */
export async function readZapierDeliveries(db: Db): Promise<ZapierDeliveries> {
	const pending = sql`${zapierDelivery.status} = 'pending'`;
	const [row] = await db
		.select({
			waiting: sql<number>`coalesce(sum(case when ${pending} then 1 else 0 end), 0)`,
			failed: sql<number>`coalesce(sum(case when ${zapierDelivery.status} = 'failed' then 1 else 0 end), 0)`,
			oldestWaitingAt: sql<
				number | null
			>`min(case when ${pending} then ${zapierDelivery.createdAt} end)`
		})
		.from(zapierDelivery);

	return {
		waiting: row?.waiting ?? 0,
		failed: row?.failed ?? 0,
		oldestWaitingAt: row?.oldestWaitingAt == null ? null : new Date(row.oldestWaitingAt)
	};
}
