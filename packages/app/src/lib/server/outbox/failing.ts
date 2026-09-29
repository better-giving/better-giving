import { and, eq, isNotNull, lte, type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable, SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client';

// when a receiver an outbox posts to has been failing long enough to stop posting to it: one rule
// for every feed, handed back as statements for the feed's own `batch()`. what stopping means — a
// webhook destination paused, a Zap's subscription ended — is the feed's, and so is the write that
// does it; this module decides only when that write may take.
//
// **a receiver's run of failures starts at its `failing_since`**, set by the first failed post
// after the last one it took and cleared by the next one it takes. the mark and the failed row's
// outcome go in one batch, and so do the clear and a taken row's.
//
// **a mark counts only while it is no older than `stopAfterMs` before the failing row was
// queued.** a receiver's rows can all leave the outbox without a post being taken — given up on,
// dropped, out of retries — and nothing then clears the mark, so it can outlive a quiet spell with
// nothing posted. a row queued more than `stopAfterMs` after the mark cannot have been failing
// alongside it for the whole window, so its failure starts the run afresh at its own `now`, in the
// same statement that would have kept the mark.
//
// **a row's first failure never stops its receiver.** the stop is guarded on a failure of a row
// that had failed before, where the receiver's mark is `stopAfterMs` or more behind — every post to
// it for that long failed and none was taken.
//
// a receiver that is not `open` (paused, deleted, ended) is neither marked nor cleared: its mark is
// what a resume reads to find the window it held.

/** a receiver table: a row per receiver, keyed by `id`, carrying its `failing_since`. */
export type ReceiverTable = SQLiteTable & {
	readonly id: SQLiteColumn;
	readonly failingSince: SQLiteColumn;
};

export type FailingSpec<T extends ReceiverTable> = {
	readonly table: T;
	/** a receiver that can still be posted to, and so marked, cleared or stopped. */
	readonly open: SQL;
	/** how long every post to a receiver may fail before a retry's failure stops it. */
	readonly stopAfterMs: number;
};

export function defineFailing<T extends ReceiverTable>(spec: FailingSpec<T>) {
	const { table } = spec;
	const write = (db: Db, receiverId: string, failingSince: SQL | null, where?: SQL) =>
		db
			.update(table as SQLiteTable)
			.set({ failingSince } as SQLiteUpdateSetSource<T>)
			.where(and(eq(table.id, receiverId), spec.open, where));

	/**
	 * a failed post to `receiverId` at `now`, of a row queued at `row.createdAt`: the start of the
	 * receiver's run of failures, where none is on that the row could belong to.
	 */
	function failed(db: Db, receiverId: string, row: { readonly createdAt: Date }, now: Date) {
		const oldestStanding = row.createdAt.getTime() - spec.stopAfterMs;
		return write(
			db,
			receiverId,
			sql`case when ${table.failingSince} >= ${oldestStanding} then ${table.failingSince} else ${now.getTime()} end`
		);
	}

	/** a post `receiverId` took: its run of failures, if it was on one, is over. */
	function taken(db: Db, receiverId: string) {
		return write(db, receiverId, null, isNotNull(table.failingSince));
	}

	/**
	 * the condition a feed's stop write is guarded on, after a failed post of `row` at `now`: the
	 * receiver's mark {@link FailingSpec.stopAfterMs} or more behind. null where the row had never
	 * failed before, and the receiver is not stopped at all.
	 */
	function stopGuard(row: { readonly attempts: number }, now: Date): SQL | null {
		if (row.attempts === 0) return null;
		return lte(table.failingSince, new Date(now.getTime() - spec.stopAfterMs));
	}

	return { failed, taken, stopGuard };
}
