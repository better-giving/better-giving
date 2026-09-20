import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../db/client';
import { quickbooksConnection, quickbooksSync, type EntrySourceType } from '../db/schema';
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
// why this is two functions.
//
// the same split ../ledger/posting.ts makes, for a related but distinct reason. `post()` /
// `postingStatements()` is split so that writing stays the caller's job and one `batch()` can hold
// the whole gift. this one is split because two of the four call sites cannot await at all:
// `chargeWrites` and `claimWrites` in ../donations/collect.ts are synchronous statement builders,
// run later by that module's own `attempt`. so the read is one function and the statements are
// another, and the caller reads once per settlement and hands the answer down.
//
// `outboxStatements` is therefore pure, which is what lets it be called from a builder that has no
// database turn left to spend — and it is read once per settlement rather than once per posting,
// because one settled charge makes two entry groups and only one of them is owed.
//
// ---------------------------------------------------------------------------
// the gate, and it is two questions.
//
// **connected.** `quickbooks_connection` is a singleton, so no row means no company to send to and
// nothing is queued at all. that is the ordinary state of a deployment nobody has connected, not a
// fault.
//
// **on or after the connection's own start date.** `start_at` is the earliest business date this
// deployment sends a gift from, compared against the entry group's `occurred_at` — business time on
// both sides, so a backdated gift is judged by when the money moved. inclusive at the start: an
// entry dated exactly at `start_at` is queued.
//
// **the date is read here and nowhere else, as a gift settles.** nothing in this tree queues a gift
// a second time, so a gift is judged once, by the date as it stood then: moving the date earlier
// queues nothing already settled, and moving it later takes nothing back. a gift that settled
// before a company was connected is never queued and nothing sends it afterwards.
//
// what is owed is read off the posting rather than off the call site, so a fifth poster gets the
// right answer without a line of its own. `payment` is a gift that reached the organisation and
// `adjustment` is a correction a human posted; `fee` is deliberately not one of them, because a
// processor's cut becomes a line on the record its sibling `payment` group is sent as (./record.ts
// assembles the pair), and a row for it would send the same money twice. `donation` and `refund` are source types nothing in
// this tree posts today.

/** the source types a posting has to carry to be owed to QuickBooks. */
const OWED_SOURCE_TYPES: readonly EntrySourceType[] = ['payment', 'adjustment'];

/**
 * the only id `quickbooks_connection` will accept, enforced by `quickbooks_connection_id_check` in
 * ../db/schema.ts. the precedent is `ORG_PROFILE_ID` in ../org/queries.ts.
 */
const CONNECTION_ID = 'quickbooks';

/**
 * what a connected company puts in front of a posting: the earliest business date it takes.
 *
 * a value rather than the row, because everything else on that row is the delivery's business —
 * the tokens it authenticates with, the accounts it maps to. what decides whether a row is written
 * at all is this one date, and a caller holding only it cannot accidentally send with it.
 */
export type OutboxGate = {
	readonly startAt: Date;
};

/**
 * the gate for this settlement, or `null` where no company is connected.
 *
 * **it throws where the read fails, and no caller may swallow it.** this is one read against the
 * same D1 handle the write needs, so a failure here means the write was not going to land either —
 * and every caller already has an answer for a write that did not land. answered as "not
 * connected" instead, the gift settles cleanly and is owed to QuickBooks with no row saying so,
 * which is the one outcome nothing downstream can repair.
 *
 * no ordering and no `limit`: `id` is the primary key and the check pins it to one literal, so this
 * is a point lookup and "which connection is live" is never a question with a sort in it.
 */
export async function outboxGate(db: Db): Promise<OutboxGate | null> {
	const [row] = await db
		.select({ startAt: quickbooksConnection.startAt })
		.from(quickbooksConnection)
		.where(eq(quickbooksConnection.id, CONNECTION_ID));
	return row === undefined ? null : { startAt: row.startAt };
}

/**
 * the queue rows `postings` owe, for splicing into the caller's single `batch()`:
 *
 *   await db.batch([...postingStatements(db, charge), ...outboxStatements(db, gate, [charge, fee])]);
 *
 * zero or more, and zero is the common answer — an unconnected deployment, a fee entry, a gift
 * dated before the connection began. `null` is accepted in the list because `feeEntry` in
 * ../donations/entries.ts returns one, so both halves of a settled charge can be handed over
 * exactly as the caller holds them.
 *
 * **after the statements that write the entry groups, never before.** `quickbooks_sync
 * .entry_group_id` is a foreign key, so the other order is a batch D1 refuses outright.
 *
 * pure: no database turn, no clock. `status`, `attempts` and both timestamps are column defaults,
 * so the entry group's id is the whole of what is written — there is no second uniqueness rule
 * here, and the index that already refuses a duplicate posting refuses this row with it.
 */
export function outboxStatements(
	db: Db,
	gate: OutboxGate | null,
	postings: readonly (Posting | null)[]
): BatchItem<'sqlite'>[] {
	if (gate === null) return [];

	const statements: BatchItem<'sqlite'>[] = [];
	for (const posting of postings) {
		if (posting === null) continue;
		const { id, sourceType, occurredAt } = posting.group;
		if (!OWED_SOURCE_TYPES.includes(sourceType)) continue;
		if (occurredAt.getTime() < gate.startAt.getTime()) continue;
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
		statements.push(db.insert(quickbooksSync).values({ entryGroupId: id }));
	}
	return statements;
}
