import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { ROLLUPS } from '../db/accounts';
import type { Db } from '../db/client';
import {
	account,
	entryGroup,
	ledgerEntry,
	type EntryGroup,
	type EntrySourceType,
	type LedgerEntry
} from '../db/schema';

// every read of `entry_group` and `ledger_entry`, so the table objects never leave this
// directory — the same boundary ../donations/queries.ts draws around `donation`.
//
// no writes, and that is a rule rather than a description. ./posting.ts is the only module that
// may INSERT into either table, and ./sole-writer.spec.ts enforces it by exempting this whole
// directory rather than by keeping a list of blessed callers — so a scan that would catch the
// same insert anywhere else in the app sees nothing here. this file is inside the exemption and
// contains no insert; the next reader adding one gets no warning from anything.
//
// no balance is stored and none may be, and that is a rule about the write rather than about what
// crosses this boundary. an account's balance, a fund's total, what a donor has given — each is a
// `SUM` over `ledger_entry` taken on the request that asks for it, which `readRaisedByMonth` below
// is one of. what is banned is a figure that outlives the read: a column, a cache, a row somewhere
// holding a total. that is a second answer to a question the entries already answer, and the first
// write that misses it makes the two disagree with no row looking wrong.

/**
 * how many entry groups a list page returns.
 *
 * bounded from two ends, the same two `DONATION_LIST_LIMIT` states in ../donations/queries.ts.
 * it is a `LIMIT` because the list is every posting a deployment has ever made and the newest
 * are the ones worth keeping. and the page's ids are bound into the follow-up read, one
 * parameter per id, against D1's cap of 100 bound parameters per query — so this stays well
 * under 100 whatever anyone later decides about page size, because a limit raised past it does
 * not read slowly, it fails the query. the probe row never reaches that read, so the count bound
 * is this number exactly.
 */
export const ENTRY_GROUP_LIST_LIMIT = 50;

/**
 * one line as a reader sees it.
 *
 * derived from `LedgerEntry` rather than written out, for the reason `DonationRow` is in
 * ../donations/queries.ts: a column renamed or retyped is a compile error here rather than a
 * field that silently stops arriving. `entry_group_id` stays out — the line is already handed
 * over inside its group, so the id would be a column reaching a browser that nothing renders —
 * and so does `account_is_postable`, which is the constant `1` the composite foreign key matches
 * on rather than a fact about a line.
 */
export type EntryLine = Pick<LedgerEntry, 'id' | 'accountId' | 'amountMinor'>;

/** one journal entry: the header, and every line under it. */
export type EntryGroupListRow = Pick<
	EntryGroup,
	'id' | 'sourceType' | 'sourceId' | 'currency' | 'occurredAt' | 'createdAt' | 'memo'
> & {
	/**
	 * in the order they were posted, and always at least two — `post()` refuses fewer, and the
	 * group and its lines land in one `batch()`, so a header with no lines is unwritable.
	 */
	lines: EntryLine[];
};

const GROUP_COLUMNS = {
	id: entryGroup.id,
	sourceType: entryGroup.sourceType,
	sourceId: entryGroup.sourceId,
	currency: entryGroup.currency,
	// the bitemporal pair, both of them: business time is what the list is ordered and read by,
	// and system time is what answers "what did the books say on March 31?" beside it. dropping
	// either one makes a backdated posting indistinguishable from a late-entered one.
	occurredAt: entryGroup.occurredAt,
	createdAt: entryGroup.createdAt,
	memo: entryGroup.memo
} satisfies Record<keyof Omit<EntryGroupListRow, 'lines'>, SQLiteColumn>;

/** a line with the group it belongs to, which is the only extra column the grouping needs. */
type LineRow = EntryLine & Pick<LedgerEntry, 'entryGroupId'>;

const LINE_COLUMNS = {
	id: ledgerEntry.id,
	entryGroupId: ledgerEntry.entryGroupId,
	accountId: ledgerEntry.accountId,
	amountMinor: ledgerEntry.amountMinor
} satisfies Record<keyof LineRow, SQLiteColumn>;

/**
 * one page of journal entries: at most `ENTRY_GROUP_LIST_LIMIT` of them, and whether more exist.
 *
 * the probe row is sliced off inside `listEntryGroups` rather than handed over with a warning,
 * so there is no shape in which a caller renders `ENTRY_GROUP_LIST_LIMIT + 1` entries by
 * forgetting to slice. the cap belongs to this module; the page only reports it.
 */
export type EntryGroupPage = {
	/** newest first in business time, capped. never contains the probe row. */
	groups: EntryGroupListRow[];
	/** true when the probe came back — there are entries this page is not showing. */
	hasMore: boolean;
};

/**
 * the journal entries a deployment has posted, newest first, each with its lines.
 *
 * two reads and no join. a join would return one row per line and leave the caller to collapse
 * them, which puts the cap on the wrong grain — `LIMIT 50` over a join is fifty *lines*, i.e. a
 * page whose length depends on how many lines the entries happened to have. so the page of
 * headers is read first and the lines for exactly those ids second, which is also what keeps the
 * bound parameters countable.
 *
 * ordered by `occurred_at` then `id`, and the tiebreak is not decoration: the column is unix ms
 * and workerd freezes the clock between I/O, so two entries posted in one request tie on it, and
 * an unordered list is one that reshuffles between loads. `id` is a uuidv7 minted by `post()`, so
 * the greater id is the later posting. `entry_group_occurred_at_idx` backs the first key, so
 * sqlite walks that index in reverse and stops at the `LIMIT` rather than sorting the table; the
 * tiebreak is resolved within a run of equal timestamps and does not cost the plan.
 *
 * `hasMore` comes from a probe row rather than from the page's own length, the same shape
 * `listDonations` uses and for the same reason: `groups.length >= ENTRY_GROUP_LIST_LIMIT` is
 * wrong at exactly one number — the one a deployment sits on while being told there are entries
 * it is not being shown.
 */
export async function listEntryGroups(db: Db): Promise<EntryGroupPage> {
	const rows = await db
		.select(GROUP_COLUMNS)
		.from(entryGroup)
		.orderBy(desc(entryGroup.occurredAt), desc(entryGroup.id))
		.limit(ENTRY_GROUP_LIST_LIMIT + 1);

	// newest first, so the row the cap drops is the oldest of the ones fetched.
	const page = rows.slice(0, ENTRY_GROUP_LIST_LIMIT);
	const hasMore = rows.length > ENTRY_GROUP_LIST_LIMIT;

	return { groups: await withLines(db, page), hasMore };
}

/**
 * one journal entry by the pair that identifies it, with its lines — or `null` for a pair no row
 * carries.
 *
 * the pair and never `source_id` alone: `entry_group_source_idx` is unique over both columns, so an
 * id may legitimately be shared across two source types and a read on one half would hand back
 * whichever row sqlite reached first.
 *
 * it exists because `listEntryGroups` above cannot answer for a specific entry. that read is capped
 * and ordered by business time, and backdating is what `occurred_at` is for — so an entry dated
 * before the page's oldest row is absent from it, and a caller that confirmed a write by searching
 * the page would report nothing for exactly the writes the column exists to allow.
 */
export async function findEntryGroup(
	db: Db,
	sourceType: EntrySourceType,
	sourceId: string
): Promise<EntryGroupListRow | null> {
	const rows = await db
		.select(GROUP_COLUMNS)
		.from(entryGroup)
		.where(and(eq(entryGroup.sourceType, sourceType), eq(entryGroup.sourceId, sourceId)))
		// the pair is unique, so this bounds a read that cannot return two rows rather than picking
		// between them.
		.limit(1);

	const [found] = await withLines(db, rows);
	return found ?? null;
}

/**
 * the headers handed back with each one's lines under it, in posting order.
 *
 * one read for however many headers it is given, which is what keeps the parameter count
 * countable: the ids are bound one per header, against D1's cap of 100 bound parameters per query,
 * and `ENTRY_GROUP_LIST_LIMIT` is what holds the list caller under it.
 *
 * shared by both reads above rather than written twice. the grouping is the half that would drift:
 * a second copy is a second place the `Map` fallback and the line ordering have to agree.
 */
async function withLines(
	db: Db,
	headers: readonly Omit<EntryGroupListRow, 'lines'>[]
): Promise<EntryGroupListRow[]> {
	if (headers.length === 0) return [];

	const lines = await db
		.select(LINE_COLUMNS)
		.from(ledgerEntry)
		.where(
			inArray(
				ledgerEntry.entryGroupId,
				headers.map((row) => row.id)
			)
		)
		// posting order. `post()` mints a uuidv7 per line as it walks the caller's array, so the
		// ids are ascending in the order the entry was written — which is the order a debit and
		// the credit answering it were meant to be read in.
		.orderBy(ledgerEntry.id);

	const byGroup = new Map<string, EntryLine[]>();
	for (const { entryGroupId, ...line } of lines) {
		const held = byGroup.get(entryGroupId);
		if (held) held.push(line);
		else byGroup.set(entryGroupId, [line]);
	}

	// the fallback is unreachable — a group and its lines are written in one `batch()`, so a
	// header with no lines would mean a partial commit. it is here because the lookup is a
	// `Map` and the alternative is a non-null assertion over a state the schema cannot hold.
	return headers.map((row) => ({ ...row, lines: byGroup.get(row.id) ?? [] }));
}

/** one month's raised, as the grouped read hands it back. */
export type RaisedMonth = {
	/** the UTC calendar month, `2026-09` — `../months.ts` is the spelling on the other side. */
	month: string;
	/** minor units, net of anything that has been given back. */
	raisedMinor: number;
};

/**
 * what this deployment has raised, by the month the money moved in — one row per month there has
 * ever been a gift in, and no row for a month there has not.
 *
 * **raised is the credit side of the donations subtree and nothing else.** every gift credits a
 * revenue account under `ROLLUPS.donations` and the processor's cut debits an expense, so a figure
 * taken over anything wider would fall by whatever the rail kept — and the gift is recorded at face
 * value on purpose (../db/accounts.ts, at `processorFees`). the sign is the ledger's:
 * `+` is a debit and `−` a credit (./posting.ts), so raised is the negated sum and a refund — which
 * debits the same account — takes itself back off the month it was made in, with no second read and
 * no special case here.
 *
 * **the subtree is walked rather than listed**, and that is the whole reason this is raw SQL: the
 * chart of accounts has two revenue children today and gains one per program, so a read naming
 * `4110` and `4120` would stop counting the moment a program's own account is posted to — silently,
 * because every row still reads clean. `account_parent_not_self_check` in ../db/schema.ts is what
 * makes the walk terminate; drizzle has no `with recursive` builder, so the statement is
 * written out and the table and column names come off the schema objects rather than being spelled
 * again.
 *
 * the rollup itself is inside the walk and contributes nothing: `is_postable = 0` on it, and
 * `ledger_entry`'s composite foreign key is what makes a line naming it unwritable.
 *
 * **the month is business time.** `entry_group.occurred_at` is when the money moved, and
 * `created_at` is when the row was written — a settlement that lands in October against a gift made
 * in September belongs in September's figure, which is the whole reason the column exists.
 * `%Y-%m` over `occurred_at / 1000` with `unixepoch` reads it as the UTC ms it is stored as and
 * buckets it by UTC calendar month, which is the encoding every time column in this app carries.
 *
 * every month rather than twelve, for the reason `readDonorSummary` in ../contacts/queries.ts hands
 * back every month: the all-time figure is the sum of these, and a total taken over a run would
 * shrink as the year turned away from an older month. `overMonths` in ../months.ts is what cuts the
 * run out of it.
 */
export async function readRaisedByMonth(db: Db): Promise<RaisedMonth[]> {
	return db.all<RaisedMonth>(sql`
		with recursive donations(id) as (
			select ${account.id} from ${account} where ${account.id} = ${ROLLUPS.donations.id}
			union all
			select ${account.id} from ${account} join donations on ${account.parentId} = donations.id
		)
		select
			strftime('%Y-%m', ${entryGroup.occurredAt} / 1000, 'unixepoch') as "month",
			-sum(${ledgerEntry.amountMinor}) as "raisedMinor"
		from ${ledgerEntry}
		join ${entryGroup} on ${entryGroup.id} = ${ledgerEntry.entryGroupId}
		where ${ledgerEntry.accountId} in (select id from donations)
		group by "month"
	`);
}
