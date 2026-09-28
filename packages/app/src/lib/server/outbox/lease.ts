import { and, asc, eq, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { SelectResultFields } from 'drizzle-orm/query-builders/select.types';
import type {
	SelectedFieldsFlat,
	SQLiteColumn,
	SQLiteTable,
	SQLiteUpdateSetSource
} from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client';
import { eachAtMost } from './each-at-most';

// the lease every outbox is delivered on: which rows a run takes, how long they are its alone, when
// it may start work on one, and how it lets each go. it knows nothing of what a row is owed, what
// an answer means, how long a failure waits or when a row is given up on — the feed decides all of
// that and hands this module the columns to write.
//
// **a run works only what it claimed.** the cron fires every minute and a run can outlast one, so
// two runs over one backlog is ordinary. the claim is a single UPDATE whose own `where` takes rows
// owed (`status = 'pending'`), due (`next_attempt_at` reached) and held by nobody, the
// longest-waiting first, at most `claimsPerRun` of them; only what it *returns* is the run's, and a
// second run's claim matches none of them. there is no read in front of that write
// (../ledger/posting.ts: no invariant is enforced by an atomic read-then-write). the rows are
// chosen by a row-value `in` over a limited select, because D1 has no `UPDATE … LIMIT`.
//
// **the lease runs from the run's scheduled time**, the `now` a claim is handed, to `leaseMs`
// after it. a lease that has run out is no lease: the run that wrote it is gone or overran, and the
// row is owed either way. every outcome is written by `land`, which gives the lease back in the
// same statement — and only while this run still holds that lease and the row is still owed, so a
// run that lost the row to a later one, or whose row was dropped under it, writes nothing.
//
// **due-ness is stored, one way**: `next_attempt_at`. a waiting row's outcome is the feed's next
// time for it; nothing here derives one.
//
// **a run's last start** is the earlier of `deadlineMs` after its scheduled time and `attemptMs`
// before its lease runs out. a claim made past it takes nothing, and `each` starts no row past it,
// so no attempt is begun that could still be in flight when the next run may take the row, and a
// run that started late leaves the backlog to the run on time. it is read off the wall clock: the
// run that takes the row over does so once its own scheduled time reaches the lease, and it starts
// no earlier than that.
//
// **delivery is at least once.** a run that died mid-attempt writes nothing, and its rows come
// back once the lease runs out, to be attempted again.
//
// an outbox table has a `status` whose `pending` means owed, and `next_attempt_at`, `leased_until`
// and `updated_at` under those names. its claim wants one index over `status`, `next_attempt_at`,
// the key and `leased_until`, in that order (`zapier_delivery_due_idx` in ../db/schema.ts).

/** an outbox table: a row per thing owed, and the four columns the lease reads and writes. */
export type OutboxTable = SQLiteTable & {
	readonly status: SQLiteColumn;
	readonly nextAttemptAt: SQLiteColumn;
	readonly leasedUntil: SQLiteColumn;
	readonly updatedAt: SQLiteColumn;
};

/** one feed's bounds on a run, every one measured from the run's scheduled time. */
export type LeaseTerms = {
	/** how long a claimed row is the claiming run's alone. */
	readonly leaseMs: number;
	/** no row is claimed or started later than this. */
	readonly deadlineMs: number;
	/** the longest one row's work can take; none is started closer than this to the lease's end. */
	readonly attemptMs: number;
	/**
	 * rows one claim takes. a feed reading its claimed rows back by `in` binds a parameter per row,
	 * and D1 refuses a statement binding more than 100.
	 */
	readonly claimsPerRun: number;
	/** rows worked at once. */
	readonly lanes: number;
};

type Key = Readonly<Record<string, SQLiteColumn>>;

export type OutboxSpec<T extends OutboxTable, K extends Key> = LeaseTerms & {
	readonly table: T;
	/** the primary key's columns, under the names a claimed row carries them. */
	readonly key: K;
};

/** what a row's outcome writes. the lease columns are the module's. */
export type Outcome<T extends OutboxTable> = Omit<
	SQLiteUpdateSetSource<T>,
	'leasedUntil' | 'updatedAt'
>;

/** the rows one run took, and the only way to write where each landed. */
export type Claim<T extends OutboxTable, Row> = {
	readonly rows: readonly Row[];
	/** when these rows stop being this run's. */
	readonly lease: Date;
	/** `outcome` written and the lease given back, only while this run holds it and the row is owed. */
	land(row: Row, outcome: Outcome<T>): Promise<void>;
	/**
	 * `work` over the rows, `lanes` at once, none started past the run's last start. a row not
	 * started stays leased and comes back when the lease does. a lane that throws stops that lane;
	 * the rest finish before the first fault is rethrown.
	 */
	each(work: (row: Row) => Promise<void>): Promise<void>;
};

export function defineOutbox<T extends OutboxTable, K extends Key>(spec: OutboxSpec<T, K>) {
	const { table } = spec;

	/** held by nobody at `now`: never leased, or leased by a run whose lease has run out. */
	function unleased(now: Date): SQL | undefined {
		return or(isNull(table.leasedUntil), lte(table.leasedUntil, now));
	}

	/**
	 * the due rows, leased to the run scheduled at `now`: the key and `returning` of each. `where`
	 * narrows what is taken, for a row the feed will not work whatever its time says.
	 */
	async function claim<R extends SelectedFieldsFlat>(
		db: Db,
		now: Date,
		options: { readonly returning: R; readonly where?: SQL }
	): Promise<Claim<T, SelectResultFields<K & R>>> {
		type Row = SelectResultFields<K & R>;
		const lease = new Date(now.getTime() + spec.leaseMs);
		const lastStart = Math.min(now.getTime() + spec.deadlineMs, lease.getTime() - spec.attemptMs);

		const heldBy = (row: Row) =>
			and(
				...Object.entries(spec.key).map(([name, column]) =>
					eq(column, (row as Readonly<Record<string, unknown>>)[name])
				),
				eq(table.status, 'pending'),
				eq(table.leasedUntil, lease)
			);
		const claimed = (rows: readonly Row[]): Claim<T, Row> => ({
			rows,
			lease,
			async land(row, outcome) {
				await db
					.update(table as SQLiteTable)
					.set({ ...outcome, leasedUntil: null, updatedAt: now })
					.where(heldBy(row));
			},
			async each(work) {
				await eachAtMost(spec.lanes, rows, async (row) => {
					if (Date.now() < lastStart) await work(row);
				});
			}
		});

		if (Date.now() >= lastStart) return claimed([]);
		const due = db
			.select(spec.key as Key)
			.from(table as SQLiteTable)
			.where(
				and(
					eq(table.status, 'pending'),
					lte(table.nextAttemptAt, now),
					unleased(now),
					options.where
				)
			)
			.orderBy(asc(table.nextAttemptAt))
			.limit(spec.claimsPerRun);
		const rows = await db
			.update(table as SQLiteTable)
			.set({ leasedUntil: lease, updatedAt: now })
			.where(sql`(${sql.join(Object.values(spec.key), sql`, `)}) in ${due}`)
			.returning({ ...spec.key, ...options.returning });
		return claimed(rows as Row[]);
	}

	return { claim, unleased };
}
