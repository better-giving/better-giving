import { and, asc, eq, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SelectResultFields } from 'drizzle-orm/query-builders/select.types';
import type { RunnableQuery } from 'drizzle-orm/runnable-query';
import type {
	SelectedFieldsFlat,
	SQLiteColumn,
	SQLiteTable,
	SQLiteUpdateSetSource
} from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client';
import { eachAtMost } from '../each-at-most';

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
// chosen by a row-value `in` over a limited select, because D1 has no `UPDATE … LIMIT`. where the
// feed names the column a row's receiver is in, the select takes every receiver's longest-waiting
// row before any receiver's next, so a receiver with a backlog shares a claim rather than filling
// it. how many rows a claim may take is what the feed's share of the invocation pays for
// (./budget.ts).
//
// **the lease runs from the run's scheduled time**, the `now` a claim is handed, to `leaseMs`
// after it. a lease that has run out is no lease: the run that wrote it is gone or overran, and the
// row is owed either way. every outcome is a `landing`, one statement that gives the lease back —
// and only while this run still holds that lease and the row is still owed, so a run that lost the
// row to a later one, or whose row was dropped under it, writes nothing. it answers with the row's
// key where it landed and with nothing where it did not, and the feed batches it with whatever
// else must commit beside it.
//
// **a sweep writes only rows no run holds**, and is a statement for the feed's batch as a landing
// is. a row under a live lease is left to the run holding it, whose landing then writes whatever
// answer its post got — and where that leaves the row owed, it is owed to whatever sweep it was
// spared by. so a feed's give-ups are standing sweeps, committed in each claim's own batch ahead of
// the claim (`before`): a row one of them covers is written off before any run can take it again,
// whether it was held when the sweep first ran, came back owed from a landing, or was left by a
// run that died.
//
// **`leased_until` is the only column this module owns.** every other column is the feed's, written
// through a claim's `set`, an outcome or a sweep's outcome. a column with an `$onUpdateFn` in
// ../db/schema.ts (`updated_at`) is stamped with the wall clock by drizzle on any of these
// statements that does not name it, so a feed that means to hold one names it as itself.
//
// **due-ness is stored, one way**: `next_attempt_at`. a waiting row's outcome is the feed's next
// time for it; nothing here derives one.
//
// **a run's last start** is the earlier of `deadlineMs` after its scheduled time and `attemptMs`
// plus the work after an answer (`AFTER_ANSWER_MS`) before its lease runs out. a claim made past it
// takes nothing, and `each` starts no row past it, so no attempt is begun that could still be in
// flight when the next run may take the row, and a run that started late leaves the backlog to the
// run on time. it is read off the wall clock: the
// run that takes the row over does so once its own scheduled time reaches the lease, and it starts
// no earlier than that.
//
// **delivery is at least once.** a run that died mid-attempt writes nothing, and its rows come
// back once the lease runs out, to be attempted again.
//
// an outbox table has a `status` whose `pending` means owed, and `next_attempt_at` and
// `leased_until` under those names. its claim wants one index over `status`, `next_attempt_at`, the
// key and `leased_until`, in that order (`zapier_delivery_due_idx` in ../db/schema.ts).
//
// ../accounting/deliver.ts is not delivered on this module. moving it would still take: a stored
// `next_attempt_at` on `quickbooks_sync`, whose due-ness is derived from `updated_at` and
// `attempts` today; an order the feed supplies, since it sends settled gifts ahead of moved history
// through a join; and a way for `each`'s work to stop the whole run, since a refusal the backlog is
// behind ends it there, where a throw here stops one lane.

/**
 * what one row's work may still take once its answer is in, or its time to answer is up: the
 * signing in front of the post, the refusal body read after it, and the landing write.
 */
const AFTER_ANSWER_MS = 10_000;

/** an outbox table: a row per thing owed, and the three columns the lease reads. */
export type OutboxTable = SQLiteTable & {
	readonly status: SQLiteColumn;
	readonly nextAttemptAt: SQLiteColumn;
	readonly leasedUntil: SQLiteColumn;
};

/** one feed's bounds on a run. */
export type LeaseTerms = {
	/** how long a claimed row is the claiming run's alone, from the run's scheduled time. */
	readonly leaseMs: number;
	/** no row is claimed or started later than this after the run's scheduled time. */
	readonly deadlineMs: number;
	/**
	 * the longest one row's post can wait on its answer. none is started closer than this, and the
	 * work after an answer, to the lease's end.
	 */
	readonly attemptMs: number;
	/** rows one claim takes: what the feed's share of the invocation pays for (./budget.ts). */
	readonly claimsPerRun: number;
	/** rows worked at once. */
	readonly lanes: number;
};

type Key = Readonly<Record<string, SQLiteColumn>>;

export type OutboxSpec<T extends OutboxTable, K extends Key> = LeaseTerms & {
	readonly table: T;
	/** the primary key's columns, under the names a claimed row carries them. */
	readonly key: K;
	/**
	 * the column naming who a row is posted to. where it is named, a claim takes every receiver's
	 * longest-waiting row before any receiver's next, so one receiver's backlog cannot fill a claim
	 * while another's rows wait.
	 */
	readonly receiver?: SQLiteColumn;
};

/** what the feed writes on a row: any column but the lease. */
export type Outcome<T extends OutboxTable> = Omit<SQLiteUpdateSetSource<T>, 'leasedUntil'>;

/** one write over outbox rows for the feed's `batch()`, answering with the key of each it wrote. */
export type KeyedWrite<K extends Key> = RunnableQuery<SelectResultFields<K>[], 'sqlite'>;

/** the rows one run took, and the only way to write where each landed. */
export type Claim<T extends OutboxTable, K extends Key, Row> = {
	readonly rows: readonly Row[];
	/** when these rows stop being this run's. */
	readonly lease: Date;
	/**
	 * `outcome` written and the lease given back, only while this run holds it and the row is owed.
	 * the statement is the feed's to batch with its own, and it answers with `row`'s key where it
	 * landed, with nothing where it did not.
	 */
	landing(row: Row, outcome: Outcome<T>): KeyedWrite<K>;
	/** {@link Claim.landing} on its own, and whether it landed. */
	land(row: Row, outcome: Outcome<T>): Promise<boolean>;
	/**
	 * `work` over the rows, `lanes` at once, none started past the run's last start. a row not
	 * started stays leased and comes back when the lease does. a lane that throws stops that lane;
	 * the rest finish before the first fault is rethrown.
	 */
	each(work: (row: Row) => Promise<void>): Promise<void>;
};

export function defineOutbox<T extends OutboxTable, K extends Key>(spec: OutboxSpec<T, K>) {
	const { table } = spec;

	/** a due row's place in its receiver's queue, first to last, where the spec names a receiver. */
	const turn =
		spec.receiver === undefined
			? []
			: [sql`row_number() over (partition by ${spec.receiver} order by ${table.nextAttemptAt})`];

	/** held by nobody at `now`: never leased, or leased by a run whose lease has run out. */
	const unleased = (now: Date) => or(isNull(table.leasedUntil), lte(table.leasedUntil, now));

	/**
	 * the due rows, leased to the run scheduled at `now`: the key and `returning` of each, read after
	 * `set` is written. `where` narrows what is taken, for a row the feed will not work whatever its
	 * time says. `before` is committed in the claim's own batch, ahead of it: a feed's standing
	 * sweeps go there, so a row one of them would give up on is never taken again.
	 */
	async function claim<R extends SelectedFieldsFlat>(
		db: Db,
		now: Date,
		options: {
			readonly returning: R;
			readonly where?: SQL;
			readonly set?: Outcome<T>;
			readonly before?: readonly BatchItem<'sqlite'>[];
		}
	): Promise<Claim<T, K, SelectResultFields<K & R>>> {
		type Row = SelectResultFields<K & R>;
		const lease = new Date(now.getTime() + spec.leaseMs);
		const lastStart = Math.min(
			now.getTime() + spec.deadlineMs,
			lease.getTime() - spec.attemptMs - AFTER_ANSWER_MS
		);

		const heldBy = (row: Row) =>
			and(
				...Object.entries(spec.key).map(([name, column]) =>
					eq(column, (row as Readonly<Record<string, unknown>>)[name])
				),
				eq(table.status, 'pending'),
				eq(table.leasedUntil, lease)
			);
		const landing = (row: Row, outcome: Outcome<T>) =>
			db
				.update(table as SQLiteTable)
				.set({ ...outcome, leasedUntil: null })
				.where(heldBy(row))
				.returning(spec.key as Key) as unknown as KeyedWrite<K>;
		const claimed = (rows: readonly Row[]): Claim<T, K, Row> => ({
			rows,
			lease,
			landing,
			async land(row, outcome) {
				const [landed] = await db.batch([landing(row, outcome)]);
				return landed.length > 0;
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
			.orderBy(...turn, asc(table.nextAttemptAt))
			.limit(spec.claimsPerRun);
		const taken = db
			.update(table as SQLiteTable)
			.set({ ...options.set, leasedUntil: lease })
			.where(sql`(${sql.join(Object.values(spec.key), sql`, `)}) in ${due}`)
			.returning({ ...spec.key, ...options.returning });
		const statements: BatchItem<'sqlite'>[] = [...(options.before ?? []), taken];
		const results = await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
		return claimed(results.at(-1) as Row[]);
	}

	/**
	 * `outcome` written on every row still owed that no run holds at `now` and `where` admits, due or
	 * not — a feed's give-up pass, as one statement for the feed's `batch()`, answering with the key
	 * of each row it wrote. a row under a live lease is left to the run holding it.
	 */
	function sweep(
		db: Db,
		now: Date,
		options: { readonly where: SQL; readonly outcome: Outcome<T> }
	): KeyedWrite<K> {
		return db
			.update(table as SQLiteTable)
			.set({ ...options.outcome, leasedUntil: null })
			.where(and(eq(table.status, 'pending'), unleased(now), options.where))
			.returning(spec.key as Key) as unknown as KeyedWrite<K>;
	}

	return { claim, sweep };
}
