import { and, between, desc, eq, inArray, type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { ROLLUPS } from '../db/accounts';
import type { Db } from '../db/client';
import {
	account,
	donation,
	entryGroup,
	form,
	ledgerEntry,
	type EntryGroup,
	type EntrySourceType,
	type LedgerEntry,
	payment,
	supporterPage
} from '../db/schema';

// every read of `entry_group` and `ledger_entry`, so the table objects never leave this
// directory — the same boundary ../donations/queries.ts draws around `donation`. four reads cross
// that boundary from this side to reach a gift's entries. three name `donation` and `payment` in
// one statement: `readRaisedThroughForm`, which names `form` too, `readRaisedByFormWithin`, and
// `readRaisedThroughFundraisers`, which names `supporter_page` too. `giftNetRaised` is a fragment
// naming `payment`, correlated to the `donation` row of the statement its caller embeds it in.
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
 * parameter per id, and SQLite refuses a statement past `SQLITE_MAX_VARIABLE_NUMBER` (32766,
 * https://www.sqlite.org/limits.html) — so this number is that read's parameter count too. the
 * probe row never reaches that read, so the count bound is this number exactly.
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

const ENTRY_LINE_COLUMNS = {
	id: ledgerEntry.id,
	accountId: ledgerEntry.accountId,
	amountMinor: ledgerEntry.amountMinor
} satisfies Record<keyof EntryLine, SQLiteColumn>;

/** a line with the group it belongs to, which is the only extra column the grouping needs. */
type LineRow = EntryLine & Pick<LedgerEntry, 'entryGroupId'>;

const LINE_COLUMNS = {
	...ENTRY_LINE_COLUMNS,
	entryGroupId: ledgerEntry.entryGroupId
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
 * what a range holds, as far as the bound it was read under.
 *
 * the pair travels together because neither half answers alone: entries that stop at a bound are
 * not the range, and a caller handed them without `overCap` would shape a file covering part of a
 * period and say nothing about the rest.
 */
export type EntryGroupRange = {
	/** the entries, oldest first, each whole — the one the bound landed inside is not here. */
	groups: EntryGroupListRow[];
	/** true where the range holds more lines than the bound allowed. */
	overCap: boolean;
};

/**
 * every journal entry whose business time falls inside a closed range, oldest first, each with its
 * lines — what an accountant's download is shaped from — up to `lineCap` lines.
 *
 * **one join and one read, which is the opposite of `listEntryGroups` above — deliberately.** that
 * function reads twice because its first read is a page, and the second binds one parameter per
 * entry id; this one binds three — the two ends and the bound — whatever the range holds, and one
 * round trip. so the next reader "fixing" this into the two-read shape would be paying a second
 * round trip for a problem this read does not have.
 *
 * **the bound is lines and not entries, because the file's cap is lines** — one row per ledger line
 * in both templates (./journal-file.ts). it reads one past it rather than counting first: a range
 * over the cap is refused whole, so what that extra row buys is the answer "more than the cap"
 * without the widest ranges — exactly the ones the refusal is for — being materialised in the
 * worker to reach it. the last entry read is the one the bound may have cut, and it is dropped
 * rather than shaped: a journal arriving in the target with half its lines does not balance.
 *
 * **closed on both ends.** a month is asked for as its first and last instant, and a range open at
 * either end drops the entries dated exactly on the boundary — which are the ones an export is
 * checked against.
 *
 * ordered by `occurred_at` then `id` then the line's own id: oldest first, so a file reads as a
 * ledger rather than as a feed, with the same uuidv7 tiebreak `listEntryGroups` argues and the
 * posting order `withLines` reads lines in. the grouping below folds consecutive rows, which is
 * what that order buys — and what makes the cut entry the last one.
 */
export async function readEntryGroupsInRange(
	db: Db,
	from: Date,
	to: Date,
	lineCap: number
): Promise<EntryGroupRange> {
	const rows = await db
		.select({ group: GROUP_COLUMNS, line: ENTRY_LINE_COLUMNS })
		.from(entryGroup)
		.innerJoin(ledgerEntry, eq(ledgerEntry.entryGroupId, entryGroup.id))
		.where(between(entryGroup.occurredAt, from, to))
		.orderBy(entryGroup.occurredAt, entryGroup.id, ledgerEntry.id)
		.limit(lineCap + 1);

	const groups: EntryGroupListRow[] = [];
	let open: EntryGroupListRow | undefined;
	for (const { group, line } of rows) {
		if (open?.id !== group.id) {
			open = { ...group, lines: [] };
			groups.push(open);
		}
		open.lines.push(line);
	}

	const overCap = rows.length > lineCap;
	if (overCap) groups.pop();
	return { groups, overCap };
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
 * one journal entry by its own id, with its lines — or `null` where no row carries it.
 *
 * the read the delivery to QuickBooks makes, and the only one keyed on the id rather than on the
 * pair: `quickbooks_sync.entry_group_id` is what a queued row holds (../db/schema.ts), and it holds
 * that because it is the foreign key to this table. no `limit`, because the id is the primary key.
 */
export async function findEntryGroupById(db: Db, id: string): Promise<EntryGroupListRow | null> {
	const rows = await db.select(GROUP_COLUMNS).from(entryGroup).where(eq(entryGroup.id, id));
	const [found] = await withLines(db, rows);
	return found ?? null;
}

/**
 * the headers handed back with each one's lines under it, in posting order.
 *
 * one read for however many headers it is given, which is what keeps the parameter count
 * countable: the ids are bound one per header, against SQLite's `SQLITE_MAX_VARIABLE_NUMBER`
 * (32766), and `ENTRY_GROUP_LIST_LIMIT` is what holds the list caller under it.
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

/**
 * `donations(id)`: every account under `ROLLUPS.donations`, the rollup included — the accounts whose
 * credit side is what raised means. the reads below argue why it is walked rather than listed.
 */
const DONATIONS_SUBTREE = sql`
	with recursive donations(id) as (
		select ${account.id} from ${account} where ${account.id} = ${ROLLUPS.donations.id}
		union all
		select ${account.id} from ${account} join donations on ${account.parentId} = donations.id
	)
`;

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
 * chart of accounts has two revenue children today, and a migration adding another anywhere under
 * `4100` is all a fork needs to change that — a program is its own `program` row and adds none. a
 * read naming `4110` and `4120` would stop counting the moment that account is posted to —
 * silently, because every row still reads clean. `account_parent_not_self_check` in
 * ../db/schema.ts is what makes the walk terminate; drizzle has no `with recursive` builder, so
 * the statement is written out and the table and column names come off the schema objects rather
 * than being spelled again.
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
		${DONATIONS_SUBTREE}
		select
			strftime('%Y-%m', ${entryGroup.occurredAt} / 1000, 'unixepoch') as "month",
			-sum(${ledgerEntry.amountMinor}) as "raisedMinor"
		from ${ledgerEntry}
		join ${entryGroup} on ${entryGroup.id} = ${ledgerEntry.entryGroupId}
		where ${ledgerEntry.accountId} in (select id from donations)
		group by "month"
	`);
}

/** what one form has raised, in the form's currency. */
export type RaisedThroughForm = {
	/** minor units, net of anything that has been given back. */
	raisedMinor: number;
};

/**
 * the entry groups whose `source_id` is a `payment.id` — every grain `entry_group_source_idx` in
 * ../db/schema.ts lists but `'donation'`, which no writer posts. a hand correction is
 * `'adjustment'` too, keyed on an id minted for it, so it matches no payment and names no form.
 */
const PAYMENT_KEYED: readonly EntrySourceType[] = ['payment', 'refund', 'fee', 'adjustment'];

/**
 * what has been raised through one form: `readRaisedByMonth`'s figure — the credit side of the
 * donations subtree, so a refund, a dispute's withdrawal and a settle-up take themselves back off it
 * — over the entries posted for that form's gifts alone. a repeating gift's every charge is a
 * `donation` row of its own on the commitment's form, so each counts here as it settles.
 *
 * a gift reaches the books when its money settles (../donations/record.ts), so a gift still pending
 * has no entry and adds nothing. only entries in the form's own currency are summed, since two
 * currencies do not add.
 *
 * one statement from `form` through `donation` and `payment` to the entries, which is why
 * `form`, `donation` and `payment` are named here: the gifts of a form are unbounded, and reading
 * their payment ids first would bind one parameter per payment, and SQLite refuses a statement past
 * `SQLITE_MAX_VARIABLE_NUMBER` (32766, https://www.sqlite.org/limits.html).
 * `donation_form_id_idx`, `payment_donation_id_idx`, `entry_group_source_idx` (probed once per
 * `PAYMENT_KEYED` type) and `ledger_entry_entry_group_id_idx` carry each join.
 *
 * null for a form no row carries.
 */
export async function readRaisedThroughForm(
	db: Db,
	formId: string
): Promise<RaisedThroughForm | null> {
	const [row] = await db.all<RaisedThroughForm>(sql`
		${DONATIONS_SUBTREE}
		select coalesce(-sum(${ledgerEntry.amountMinor}), 0) as "raisedMinor"
		from ${form}
		left join ${donation} on ${donation.formId} = ${form.id}
		left join ${payment} on ${payment.donationId} = ${donation.id}
		left join ${entryGroup}
			on ${entryGroup.sourceId} = ${payment.id}
			and ${inArray(entryGroup.sourceType, PAYMENT_KEYED)}
			and ${entryGroup.currency} = ${form.currency}
		left join ${ledgerEntry}
			on ${ledgerEntry.entryGroupId} = ${entryGroup.id}
			and ${ledgerEntry.accountId} in (select id from donations)
		where ${form.id} = ${formId}
		group by ${form.id}
	`);
	return row ?? null;
}

/** what one supporter fundraiser has raised, in its own currency, and from how many gifts. */
export type RaisedThroughFundraiser = { pageId: string; raisedMinor: number; gifts: number };

/**
 * the figure and the count of gifts per supporter fundraiser, over the gifts naming each in
 * `donation.supporter_page_id` and in the page's own currency: one row per page `where` admits that
 * holds a gift with an entry, and none for a page with none. a gift is a `donation` row, so each
 * charge of a repeating gift counts as one as it settles; a gift refunded in full nets to nothing
 * and drops out of the count. the gifts are found by that column alone, never through the page's
 * settings row.
 *
 * one statement, since the gifts are unbounded: reading their payment ids first would bind one
 * parameter per payment, and SQLite refuses a statement past `SQLITE_MAX_VARIABLE_NUMBER` (32766,
 * https://www.sqlite.org/limits.html). `donation_supporter_page_id_idx`
 * carries the join from the page. the joins are `cross join`, which sqlite reads as a fixed order
 * (https://www.sqlite.org/optoverview.html#crossjoin): planned freely, it starts from
 * `entry_group_source_idx` on the type alone and walks every payment the organisation has taken
 * (`raised-through-fundraisers.db.spec.ts`).
 */
export function readRaisedThroughFundraisers(
	db: Db,
	where: SQL
): Promise<RaisedThroughFundraiser[]> {
	return db.all<RaisedThroughFundraiser>(sql`
		${DONATIONS_SUBTREE},
		per_gift(page_id, net) as (
			select ${supporterPage.id}, -sum(${ledgerEntry.amountMinor})
			from ${supporterPage}
			cross join ${donation} on ${donation.supporterPageId} = ${supporterPage.id}
			cross join ${payment} on ${payment.donationId} = ${donation.id}
			cross join ${entryGroup}
				on ${entryGroup.sourceId} = ${payment.id}
				and ${inArray(entryGroup.sourceType, PAYMENT_KEYED)}
				and ${entryGroup.currency} = ${supporterPage.currency}
			cross join ${ledgerEntry}
				on ${ledgerEntry.entryGroupId} = ${entryGroup.id}
				and ${ledgerEntry.accountId} in (select id from donations)
			where ${where}
			group by ${donation.id}
		)
		select
			page_id as "pageId",
			coalesce(sum(net), 0) as "raisedMinor",
			count(*) filter (where net > 0) as "gifts"
		from per_gift
		group by page_id
	`);
}

/**
 * what one gift still stands at in the books, in its own currency: its payments' entries into the
 * donations subtree, net, as a scalar subquery on the outer row's `donation`. 0 for a gift still
 * pending, given back in full, or withdrawn by a dispute that has not been won; above 0 for one
 * partly given back.
 *
 * the caller's statement must name `donation` unaliased in its FROM, which the fragment's
 * `donation.id` and `donation.currency` bind to, and must qualify its own columns: unqualified,
 * `amount_minor` is ambiguous between `donation` and the `ledger_entry` read here
 * (`readOwnGifts` in ../supporters/pages.ts).
 */
export function giftNetRaised(): SQL<number> {
	return sql<number>`(
		${DONATIONS_SUBTREE}
		select coalesce(-sum(${ledgerEntry.amountMinor}), 0)
		from ${payment}
		join ${entryGroup}
			on ${entryGroup.sourceId} = ${payment.id}
			and ${inArray(entryGroup.sourceType, PAYMENT_KEYED)}
			and ${entryGroup.currency} = ${donation.currency}
		join ${ledgerEntry}
			on ${ledgerEntry.entryGroupId} = ${entryGroup.id}
			and ${ledgerEntry.accountId} in (select id from donations)
		where ${payment.donationId} = ${donation.id}
	)`;
}

/**
 * a span of business time: from `from` and up to, never including, `before`; either end open where
 * it is null.
 */
export type TimeWindow = { readonly from: Date | null; readonly before: Date | null };

/** `at`, an epoch-milliseconds expression, inside `window`; `undefined` where both ends are open. */
export function withinWindow(at: SQLWrapper, window: TimeWindow): SQL | undefined {
	return and(
		window.from === null ? undefined : sql`${at} >= ${window.from.getTime()}`,
		window.before === null ? undefined : sql`${at} < ${window.before.getTime()}`
	);
}

/** what was raised through one form inside a window; `formId` null for gifts made through none. */
export type RaisedByForm = { formId: string | null; raisedMinor: number };

/**
 * `readRaisedByMonth`'s figure over the entries whose business time falls inside `window`, split by
 * the form each entry's gift was made through — `readRaisedThroughForm`'s join, from the entries
 * out. the rows sum to the whole deployment's figure: a gift in hand names no form, and a hand
 * correction matches no payment, so both land on the `null` row. a refund counts in the window its
 * own entry is dated in, as it does in the dashboard's month.
 */
export async function readRaisedByFormWithin(db: Db, window: TimeWindow): Promise<RaisedByForm[]> {
	const inside = withinWindow(entryGroup.occurredAt, window);
	return db.all<RaisedByForm>(sql`
		${DONATIONS_SUBTREE}
		select
			${donation.formId} as "formId",
			-sum(${ledgerEntry.amountMinor}) as "raisedMinor"
		from ${ledgerEntry}
		join ${entryGroup} on ${entryGroup.id} = ${ledgerEntry.entryGroupId}
		left join ${payment}
			on ${payment.id} = ${entryGroup.sourceId}
			and ${inArray(entryGroup.sourceType, PAYMENT_KEYED)}
		left join ${donation} on ${donation.id} = ${payment.donationId}
		where ${ledgerEntry.accountId} in (select id from donations)
			${inside === undefined ? sql`` : sql`and ${inside}`}
		group by ${donation.formId}
	`);
}
