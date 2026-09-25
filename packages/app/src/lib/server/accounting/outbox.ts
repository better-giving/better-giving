import { and, eq, lte, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client';
import {
	payment,
	entryGroup,
	quickbooksConnection,
	quickbooksSync,
	type EntrySourceType
} from '../db/schema';
import type { Posting } from '../ledger/posting';

// the whole rule about when a journal entry is owed to QuickBooks, and the statements that say so.
//
// nothing here sends anything to Intuit. what it produces is a row in `quickbooks_sync` — the
// outbox a later delivery reads — and the one property that matters is that the row lands in the
// same `batch()` as the entry it is about. a posting that committed without its queue row is a
// gift in the books, owed to QuickBooks, with nothing anywhere recording that it is owed: the
// sweep that recovers lost work reads this table, so a missing row is never recovered. that table's
// header in ../db/schema.ts argues the idempotency this leans on, and states the same guarantee
// from the schema's side.
//
// ---------------------------------------------------------------------------
// why the gate is a clause and not a read.
//
// the statements are built before the batch runs — some call sites are synchronous builders
// (`chargeWrites` and `claimWrites` in ../donations/collect.ts) run later by that module's own
// `attempt` — and a start date read ahead of them is a window a date move can land in: a gift
// judged by the date that stood at the read, committed after the date moved, is queued or skipped
// by a rule that no longer holds and that the move never sees. so each queue insert selects from
// the connection row itself, and the gate is answered by the same statement that writes the row.
//
// `outboxStatements` therefore spends no database turn, which is what lets it be called from a
// builder that has none left to spend.
//
// ---------------------------------------------------------------------------
// the gate, and it is two questions.
//
// **connected.** `quickbooks_connection` is a singleton, so no row means no company to send to and
// nothing is queued at all. that is the ordinary state of a deployment nobody has connected, not a
// fault.
//
// **on or after the connection's own start date — or, for a reversal, behind a queued gift.**
// `start_at` is the earliest business date this deployment sends a gift or a correction from,
// compared against the entry group's `occurred_at` — business time on both sides, so a backdated
// gift is judged by when the money moved. inclusive at the start: an entry dated exactly at
// `start_at` is queued.
//
// a reversal is judged by the group it answers instead, and its own date decides nothing. every
// reversal's group is keyed on its refund-direction row (../donations/reverse.ts): the withdrawal
// `('refund', row)` answers the gift `('payment', parent)`, and what puts a withdrawal back
// `('payment', row)` or settles a lost dispute up `('adjustment', row)` answers the withdrawal. it
// is owed exactly where that group holds a queue row, in any status — so a refund of a gift
// QuickBooks was sent is sent after it whatever day it lands, and one of a gift QuickBooks never
// got is never sent. a hand correction names no gift, so its own date is the whole of its rule.
//
// **the date decides the queue whenever it moves, not only as a gift settles.** a gift is judged
// by the date as it stands when its batch commits, and moving the date judges every gift again by
// the same rule (`moveQuickbooksStartAt` below): earlier queues each owed group from the new date
// on that holds no row — gifts settled before the company was connected included — and later drops
// each row before it that no run has ever sent: `attempts = 0`, because a run counts the attempt as
// it claims the row, before anything leaves (./deliver.ts). a reversal moves with its gift: queued
// where the gift is queued, and dropped where the gift's row is. no lower bound on how far back:
// the queue is paced by the delivery's own cron and backoff (./deliver.ts), not by this.
//
// **what a move keeps is what a second send could duplicate.** a `sent` row is finished. a row
// with an attempt behind it — one a run holds now, or one whose run died after the post landed —
// may already be a record in the company's books, and only `attempts` tells the next send to look
// before it posts (./quickbooks.ts's `alreadyPosted`), so dropping it and re-queueing it at zero on
// a later move would post that gift twice.
//
// **a kept row is still sent.** delivery does not read `start_at` (./deliver.ts), so a tried or held
// row dated before the new date goes over like any other — the move only stops it being dropped.
//
// what is owed is read off the posting rather than off the call site, so a new poster gets the
// right answer without a line of its own. `payment` is a gift that reached the organisation,
// `adjustment` a correction a human posted, and `refund` money leaving a gift; `fee` is
// deliberately not one of them, because a processor's cut becomes a line on the record its sibling
// `payment` group is sent as (./record.ts assembles the pair), and a row for it would send the same
// money twice. `donation` is a source type nothing in this tree posts. whether a `payment` or an
// `adjustment` group is a reversal is read off the row it is keyed on, never off its type.

/** the source type each kind of record owed to QuickBooks is posted under. */
const OWED_KINDS = {
	gifts: 'payment',
	corrections: 'adjustment',
	reversals: 'refund'
} as const satisfies Record<string, EntrySourceType>;

/** the source types a posting has to carry to be owed to QuickBooks. */
const OWED_SOURCE_TYPES: readonly EntrySourceType[] = Object.values(OWED_KINDS);

/**
 * the only id `quickbooks_connection` will accept, enforced by `quickbooks_connection_id_check` in
 * ../db/schema.ts. the precedent is `ORG_PROFILE_ID` in ../org/queries.ts.
 */
const CONNECTION_ID = 'quickbooks';

/**
 * the queue rows `postings` owe, for splicing into a caller's single `batch()`. outside the specs
 * its one caller is ../books/writes.ts, and a writer takes them from there — `settledGiftWrites`,
 * `correctionWrites` or `reversalWrites`, which splice them after the entry groups they are about,
 * and after the caller's own payment row, which a reversal's gate reads.
 *
 * one statement per owed posting, each writing nothing where the gate says no — an unconnected
 * deployment, a gift dated before the start date as it stands when the batch runs, or a reversal
 * whose answered group holds no queue row as the batch runs. a fee entry
 * gets no statement at all. `null` is accepted in the list because `feeEntry` in
 * ../donations/entries.ts returns one, so both halves of a settled charge can be handed over
 * exactly as the caller holds them.
 *
 * **after the statements that write the entry groups, never before.** `quickbooks_sync
 * .entry_group_id` is a foreign key, so the other order is a batch D1 refuses outright.
 *
 * the entry group's id is the whole key — there is no second uniqueness rule here, and the index
 * that already refuses a duplicate posting refuses this row with it.
 */
export function outboxStatements(
	db: Db,
	postings: readonly (Posting | null)[]
): BatchItem<'sqlite'>[] {
	const now = new Date();
	const statements: BatchItem<'sqlite'>[] = [];
	for (const posting of postings) {
		if (posting === null) continue;
		const { id, sourceType, sourceId, occurredAt } = posting.group;
		if (!OWED_SOURCE_TYPES.includes(sourceType)) continue;
		if (id === undefined) {
			// `NewEntryGroup['id']` is optional because the column carries a `$defaultFn`, and `post()`
			// mints one on every path (../ledger/posting.ts) — so this is unreachable. it throws rather
			// than skipping: a posting silently left out of the queue is the exact loss this module
			// exists to prevent, and the poster's own failure handling is a better place for it than
			// nowhere.
			throw new Error(
				'a validated posting carries no entry group id, which post() in $lib/server/ledger/posting.ts always mints. nothing was queued for it.'
			);
		}
		statements.push(
			db.insert(quickbooksSync).select((qb) =>
				qb
					.select(
						pendingRow(
							sql`${id}`,
							sql`(select ${entryGroup.createdAt} from ${entryGroup} where ${entryGroup.id} = ${id})`,
							now
						)
					)
					.from(quickbooksConnection)
					.where(
						and(
							eq(quickbooksConnection.id, CONNECTION_ID),
							sql`case when ${keyedOnARefund(sql`${sourceId}`)}
								then ${answeredIsQueued(sql`${sourceType}`, sql`${sourceId}`)}
								else ${lte(quickbooksConnection.startAt, occurredAt)} end`
						)
					)
			)
		);
	}
	return statements;
}

/**
 * whether a group keyed on `sourceId` is a reversal's: each is keyed on its refund-direction row.
 * ./record.ts reads a queued group by this too, so the queue and the send cannot disagree on it.
 */
export function keyedOnARefund(sourceId: SQLWrapper): SQL {
	return sql`exists (select 1 from ${payment} where ${payment.id} = ${sourceId} and ${payment.direction} = 'refund')`;
}

// each group a fragment below reads beside another is aliased, and `from entry_group <alias>` is
// spelled out: drizzle renders an aliased table inside `sql` as its alias alone.
const gift = alias(entryGroup, 'gift');
const withdrawal = alias(entryGroup, 'withdrawal');
const answered = alias(entryGroup, 'answered');
const waiting = alias(entryGroup, 'waiting');

/** the id of the gift group behind refund row `sourceId`: `('payment', parent)`. */
function giftBehind(sourceId: SQLWrapper): SQL {
	return sql`(select ${gift.id} from ${entryGroup} ${gift}
		inner join ${payment} on ${payment.id} = ${sourceId} and ${payment.direction} = 'refund'
		where ${gift.sourceType} = ${OWED_KINDS.gifts} and ${gift.sourceId} = ${payment.parentPaymentId})`;
}

/**
 * the id of the group a reversal's group answers: the gift behind it for a withdrawal, and the
 * withdrawal `('refund', row)` for what puts it back or settles it up.
 */
function answeredGroupId(sourceType: SQLWrapper, sourceId: SQLWrapper): SQL {
	return sql`case when ${sourceType} = ${OWED_KINDS.reversals} then ${giftBehind(sourceId)}
		else (select ${withdrawal.id} from ${entryGroup} ${withdrawal}
			where ${withdrawal.sourceType} = ${OWED_KINDS.reversals} and ${withdrawal.sourceId} = ${sourceId}) end`;
}

/** whether the group a reversal's group answers holds a queue row, in any status. */
function answeredIsQueued(sourceType: SQLWrapper, sourceId: SQLWrapper): SQL {
	return sql`exists (select 1 from ${quickbooksSync} where ${quickbooksSync.entryGroupId} = ${answeredGroupId(sourceType, sourceId)})`;
}

/**
 * whether the queue row for `entryGroupId` is a reversal whose answered group's row is not yet
 * `sent`. a reversal that reached QuickBooks ahead of the gift it reverses takes money off a
 * customer the company's books have not credited yet.
 */
export function awaitingWhatItAnswers(entryGroupId: typeof quickbooksSync.entryGroupId): SQL {
	return sql`exists (select 1 from ${entryGroup} ${waiting}
		where ${waiting.id} = ${entryGroupId}
			and ${keyedOnARefund(waiting.sourceId)}
			and not exists (select 1 from ${quickbooksSync}
				where ${quickbooksSync.entryGroupId} = ${answeredGroupId(waiting.sourceType, waiting.sourceId)}
					and ${quickbooksSync.status} = 'sent'))`;
}

/**
 * a fresh `pending` row for `entryGroupId`, as the fields of an insert-select.
 *
 * every column in table order: an insert-select names them all, and drizzle refuses a select whose
 * keys differ. the timestamps are `$defaultFn`s, so nothing in sqlite fills them.
 *
 * `createdAt` is what tells the delivery a gift queued as it settled from history a move queued
 * (./deliver.ts's `dueRows`): a settlement's row copies its entry group's own `created_at`, written
 * earlier in the same batch, and a move's row is stamped with the move's time, which is after it.
 */
function pendingRow(entryGroupId: SQL | typeof entryGroup.id, createdAt: SQL | Date, now: Date) {
	return {
		entryGroupId: sql<string>`${entryGroupId}`.as('entry_group_id'),
		status: sql<string>`'pending'`.as('status'),
		attempts: sql<number>`0`.as('attempts'),
		remoteId: sql<null>`null`.as('remote_id'),
		lastError: sql<null>`null`.as('last_error'),
		notifiedAt: sql<null>`null`.as('notified_at'),
		createdAt: sql<number>`${createdAt instanceof Date ? createdAt.getTime() : createdAt}`.as(
			'created_at'
		),
		updatedAt: sql<number>`${now.getTime()}`.as('updated_at'),
		leasedUntil: sql<null>`null`.as('leased_until')
	};
}

/** the connection's start date as it stands inside the statement, or null where none is connected. */
const STORED_START_AT = sql`(select ${quickbooksConnection.startAt} from ${quickbooksConnection} where ${quickbooksConnection.id} = ${CONNECTION_ID})`;

const OWED_TYPES_SQL = sql.join(
	OWED_SOURCE_TYPES.map((type) => sql`${type}`),
	sql`, `
);

/** `startAt` where a company is connected, and null where none is — the stored date's shape. */
function proposedStartAt(startAt: Date): SQL {
	return sql`(select ${startAt.getTime()} from ${quickbooksConnection} where ${quickbooksConnection.id} = ${CONNECTION_ID})`;
}

/**
 * whether the queue row in scope is one a move may drop at `now`: never sent, never tried, and held
 * by nobody.
 */
function untouched(now: Date): SQL {
	return sql`${quickbooksSync.status} <> 'sent'
		and ${quickbooksSync.remoteId} is null
		and ${quickbooksSync.attempts} = 0
		and (${quickbooksSync.leasedUntil} is null or ${quickbooksSync.leasedUntil} <= ${now.getTime()})`;
}

/** whether `groupId` holds a queue row every move keeps: sent, tried, or held at `now`. */
function keptWhateverTheDate(groupId: SQLWrapper, now: Date): SQL {
	return sql`exists (select 1 from ${quickbooksSync}
		where ${quickbooksSync.entryGroupId} = ${groupId} and not (${untouched(now)}))`;
}

/**
 * whether the entry group in scope is owed a queue row once the start date is `boundary`: a gift or
 * a correction from the date on, and a reversal's group where the gift it reverses holds a row —
 * from the date on, or on a row every move keeps.
 *
 * judged through the gift rather than the group it answers, because a reversal is sent only once
 * that group's row is `sent` (./deliver.ts): a withdrawal that is tried, sent or held stands behind
 * a gift that was sent, which every move keeps.
 */
function owedFrom(boundary: SQL, now: Date): SQL {
	const giftHoldsOne = sql`exists (select 1 from ${entryGroup} ${answered}
		where ${answered.id} = ${giftBehind(entryGroup.sourceId)}
			and (${answered.occurredAt} >= ${boundary} or ${keptWhateverTheDate(answered.id, now)}))`;
	return sql`${boundary} is not null and case
		when ${keyedOnARefund(entryGroup.sourceId)} then ${giftHoldsOne}
		else ${entryGroup.occurredAt} >= ${boundary} end`;
}

/** entry groups owed once the start date is `boundary` that hold no queue row yet. */
function unqueuedFrom(boundary: SQL, now: Date): SQL {
	return sql`${entryGroup.sourceType} in (${OWED_TYPES_SQL})
		and not exists (select 1 from ${quickbooksSync} where ${quickbooksSync.entryGroupId} = ${entryGroup.id})
		and ${owedFrom(boundary, now)}`;
}

/** queue rows a move to `boundary` drops: untouched at `now`, and no longer owed. */
function droppedBy(boundary: SQL, now: Date): SQL {
	return sql`${untouched(now)}
		and ${quickbooksSync.entryGroupId} in (select ${entryGroup.id} from ${entryGroup}
			where ${boundary} is not null and not (${owedFrom(boundary, now)}))`;
}

/**
 * the connection's start date moved to `startAt`, and the queue made to agree with it, in one
 * `batch()`.
 *
 * set-based rather than read-then-write: both statements read the date the first one just wrote,
 * so a queue row and the date that decided it cannot land apart, and where no company is connected
 * that read is null and all three statements match nothing. `now` is what a lease is judged by and
 * what a queued row's timestamps are written as.
 */
export async function moveQuickbooksStartAt(db: Db, startAt: Date, now: Date): Promise<void> {
	await db.batch([
		db
			.update(quickbooksConnection)
			.set({ startAt })
			.where(eq(quickbooksConnection.id, CONNECTION_ID)),
		db.insert(quickbooksSync).select((qb) =>
			qb
				.select(pendingRow(entryGroup.id, now, now))
				.from(entryGroup)
				.where(unqueuedFrom(STORED_START_AT, now))
		),
		db.delete(quickbooksSync).where(droppedBy(STORED_START_AT, now))
	]);
}

/** the owed records one side of a move touches, by kind, and the business dates they span. */
export type StartAtMoveSide = {
	readonly gifts: number;
	readonly corrections: number;
	/** refunds and disputes, what put one back, and a lost dispute's settle-up. */
	readonly reversals: number;
	/** null where the side touches nothing. */
	readonly earliest: Date | null;
	readonly latest: Date | null;
};

export type StartAtMove = {
	/** entry groups the move would queue. */
	readonly queues: StartAtMoveSide;
	/** queue rows the move would drop. */
	readonly drops: StartAtMoveSide;
};

/**
 * the columns one side is counted in, over rows joined to their entry group.
 *
 * each aliased: a batch reads rows back keyed by column name, and the two counts differ only in a
 * bound parameter, so unaliased they collapse into one key and every value after it shifts.
 */
const SIDE_FIELDS = {
	gifts:
		sql<number>`count(case when ${entryGroup.sourceType} = ${OWED_KINDS.gifts} and not ${keyedOnARefund(entryGroup.sourceId)} then 1 end)`.as(
			'gifts'
		),
	corrections:
		sql<number>`count(case when ${entryGroup.sourceType} = ${OWED_KINDS.corrections} and not ${keyedOnARefund(entryGroup.sourceId)} then 1 end)`.as(
			'corrections'
		),
	reversals: sql<number>`count(case when ${keyedOnARefund(entryGroup.sourceId)} then 1 end)`.as(
		'reversals'
	),
	earliest: sql`min(${entryGroup.occurredAt})`.mapWith(entryGroup.occurredAt).as('earliest'),
	latest: sql`max(${entryGroup.occurredAt})`.mapWith(entryGroup.occurredAt).as('latest')
};

const TOUCHES_NOTHING: StartAtMoveSide = {
	gifts: 0,
	corrections: 0,
	reversals: 0,
	earliest: null,
	latest: null
};

/**
 * what {@link moveQuickbooksStartAt} would do with the same `startAt` and `now`, written nowhere.
 *
 * judged by the same predicates the move runs, so the answer is the move's until something settles
 * or is sent in between. where no company is connected, it touches nothing on both sides.
 */
export async function previewQuickbooksStartAt(
	db: Db,
	startAt: Date,
	now: Date
): Promise<StartAtMove> {
	const boundary = proposedStartAt(startAt);
	const [[queues], [drops]] = await db.batch([
		db.select(SIDE_FIELDS).from(entryGroup).where(unqueuedFrom(boundary, now)),
		db
			.select(SIDE_FIELDS)
			.from(quickbooksSync)
			.innerJoin(entryGroup, eq(entryGroup.id, quickbooksSync.entryGroupId))
			.where(droppedBy(boundary, now))
	]);
	return { queues: queues ?? TOUCHES_NOTHING, drops: drops ?? TOUCHES_NOTHING };
}
