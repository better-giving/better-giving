import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/client';
import { program, type Program } from '../db/schema';
import { sqliteResultCode } from '../db/rejection';
import type { ParsedProgram } from './program-input';

// every write of `program` without exception, and every read that has a rule in it — the same
// boundary `../forms/queries.ts` and `../org/queries.ts` draw, and it is what makes "all the writes
// are here" true rather than aspirational.
//
// the table object leaves this module in five places, every one of them a single column read off a
// query that was already being issued, and worth naming rather than papering over: `offersProgram`
// in ../forms/queries.ts, and a left join for the cause's name in `listDonations`
// (../donations/queries.ts), `findTarget` (../donations/settle.ts), and `openingGift` and
// `findAuthorizedGift` (../donations/collect.ts). what routing them through here would cost is a
// round trip apiece — three of them on the money path — to preserve a name. anything with a rule to
// keep may not do that: the archived-row filter the two readers below disagree about on purpose is
// that rule, and a write is never one of these.
//
// there is no delete, and there never is one. `form.program_id` and `donation.program_id` both
// point at this table, and a cause a gift already names has to keep resolving — a report that
// stopped being able to say where last quarter's money went is the loss, and it is silent.
// retirement is `archiveProgram` below; `../db/schema.ts` argues the same rule from the table's
// side, which is why nothing referencing it carries an `ON DELETE` action.
//
// no decode step, unlike `../forms/queries.ts`. that folder owns `form`'s three JSON columns and
// a `toRecord` that decodes two of them; this table has no JSON column, so the projections below
// are the whole of the boundary. the omission is worth naming rather than noticing later: a JSON
// column added here needs the decode added with it, or a raw JSON string reaches a route.
//
// ---------------------------------------------------------------------------
// execute, or return statements.
//
// every write below is one row of `program` from a staff screen and executes itself, which is
// what `../forms/queries.ts` does and for the same reason: `Db` has no `transaction` (D1 has
// none — see ../db/client.ts), so a write that had to land atomically with a row in another table
// would have to split into a row-building half and a statement-building half and splice the
// statement into the one `batch()` that owns the whole write. nothing here does, and there is no
// statement half. add the split the day something needs one.
// ---------------------------------------------------------------------------

/**
 * a cause as everything outside this module sees it — the whole row.
 *
 * derived from `Program` rather than written out, so a column renamed or retyped is a compile
 * error here rather than a key that silently stops arriving.
 */
export type ProgramRecord = Program;

/**
 * the columns above, as drizzle needs them named.
 *
 * spelled out beside the type they must agree with, and `satisfies` is what ties them together: a
 * column added to one and not the other stops compiling.
 */
const PROGRAM_COLUMNS = {
	id: program.id,
	name: program.name,
	description: program.description,
	status: program.status,
	createdAt: program.createdAt,
	updatedAt: program.updatedAt,
	archivedAt: program.archivedAt
} satisfies Record<keyof ProgramRecord, SQLiteColumn>;

/** one active cause, as a donation form offers it. */
export type ProgramOption = Pick<Program, 'id' | 'name'>;

/**
 * the two columns a donor's picker renders, and deliberately not the row.
 *
 * `description` is staff wording until a screen decides otherwise, and `status` says nothing to a
 * donor who is only ever shown the active list — a projection that returned the row would put
 * both in front of a browser to save naming two columns here.
 */
const PROGRAM_OPTION_COLUMNS = {
	id: program.id,
	name: program.name
} satisfies Record<keyof ProgramOption, SQLiteColumn>;

/**
 * what a name another cause already carries is answered with, by both writes below.
 *
 * the index is the only thing that can answer it, and it answers as a rejected statement rather
 * than as a row count: D1 has no transaction, so a read in front of the insert would be two
 * commits with a race between them, and the read would also have to except the row being written
 * from itself.
 *
 * the code is read off the rejection with `sqliteResultCode` (../db/rejection.ts), which is the
 * one place a driver's sentence is turned into a result code — and the constraint is the only
 * UNIQUE this table carries, so the code names it without naming the index.
 */
const NAME_TAKEN = 'SQLITE_CONSTRAINT_UNIQUE';

/**
 * every cause, active ones first and each set ordered by name.
 *
 * a list and never a lookup, from both ends: a fresh deployment has none — `migrations/` seeds
 * the chart of accounts and nothing else — so an id in app code would be a guess.
 *
 * archived rows are included, unlike `readActivePrograms`, because this is the screen an operator
 * retires a cause from and a retired one has to still be visible to have been retired. they sort
 * after rather than into the list: an operator reading the causes they can still pin should not
 * have to skip past the ones they cannot.
 *
 * `name` alone is the tiebreak-free ordering the table's unique index makes possible — no two
 * rows share one, so there is no pair for an unstable sort to reshuffle between loads.
 */
export async function readPrograms(db: Db): Promise<ProgramRecord[]> {
	// the first order term is 0 for an active cause and 1 for a retired one, ascending. spelled as
	// the comparison rather than left to `status` sorting alphabetically, which happens to give the
	// same answer today and would stop the moment a third status is added.
	return db
		.select(PROGRAM_COLUMNS)
		.from(program)
		.orderBy(sql`${program.status} = 'archived'`, asc(program.name));
}

/**
 * the causes a form may pin to or offer a donor, by name.
 *
 * archived rows are out, and that is the difference from `readPrograms`: what this answers is
 * what may be chosen now, and a retired cause is exactly what may not. the filter is
 * `archived_at` rather than `status` because `archiveProgram` writes both in one statement and
 * the timestamp is the one that cannot be reached by any other write.
 */
export async function readActivePrograms(db: Db): Promise<ProgramOption[]> {
	return db
		.select(PROGRAM_OPTION_COLUMNS)
		.from(program)
		.where(isNull(program.archivedAt))
		.orderBy(asc(program.name));
}

/**
 * one cause by id, or `null` when there is none.
 *
 * unlike `readActivePrograms` this does not filter archived rows, and the difference is the
 * question each answers. that list is what may be chosen; this is a lookup of a specific id,
 * where "that cause was retired" and "there is no such cause" are different sentences on a screen
 * and hiding the first would collapse them into a 404 — and a gift recorded against a retired
 * cause still has to render its name.
 */
export async function readProgram(db: Db, id: string): Promise<ProgramRecord | null> {
	const [row] = await db.select(PROGRAM_COLUMNS).from(program).where(eq(program.id, id)).limit(1);
	return row ?? null;
}

/**
 * makes a cause and hands back the row that was stored, or `null` for a name that is taken.
 *
 * `status` is left to the column default: a cause is made active, and the only way out of that is
 * `archiveProgram` below, which writes the timestamp with it. read off `returning()` rather than
 * by a select afterwards, which D1 could not make atomic with the insert anyway.
 *
 * a name another cause already carries is refused by `program_name_idx` rather than by a read in
 * front of the insert, and `null` is the answer. D1 has no transaction, so a check-then-write
 * would be two commits with a race between them, and the index is the only thing that can answer
 * this without one.
 */
export async function createProgram(db: Db, input: ParsedProgram): Promise<ProgramRecord | null> {
	let row: ProgramRecord | undefined;
	try {
		[row] = await db
			.insert(program)
			.values({ name: input.name, description: input.description })
			.returning(PROGRAM_COLUMNS);
	} catch (error) {
		// the one refusal this write has, and the only one it may swallow: anything else is the
		// write itself failing and belongs to the caller's log rather than to a box on a screen.
		if (sqliteResultCode(error) === NAME_TAKEN) return null;
		throw error;
	}

	if (!row) {
		// unreachable: an insert that stored no row would have thrown. it is here because the
		// alternative is a non-null assertion, which would be a claim about drizzle rather than
		// about this code.
		throw new Error('inserting into `program` returned no row');
	}
	return row;
}

/**
 * what a save of a cause did, which is three answers rather than two.
 *
 * `duplicate_name` is its own word because it is its own sentence, keyed to the box the operator
 * has to retype: `gone` says this cause is not there to write to, and saying that to somebody who
 * picked a name a colleague used yesterday would send them looking for a cause that is fine.
 */
export type ProgramSave = 'saved' | 'gone' | 'duplicate_name';

/**
 * renames a cause and rewrites its description, and answers whether there was one to write.
 *
 * `gone` rather than a throw for a row that is missing or archived: both are a tab that was open
 * when somebody else retired the cause, which is an ordinary thing for a staff screen to meet and
 * a sentence an operator can act on, where a 500 would be this module claiming the deployment is
 * broken because two people had the same page open.
 *
 * an archived row is out of reach, and the `where` is what puts it there. nothing in this module
 * clears `archived_at`, so an update that landed on a retired cause would leave one
 * `readActivePrograms` hides forever and `archiveProgram` answers `false` about — renamed by
 * somebody who believed they had brought it back.
 *
 * a name another cause already carries is refused by `program_name_idx` rather than by a read in
 * front of the update, for the reason `createProgram` above gives — and for one more: a read would
 * have to except this row from itself, so a cause rewriting its description without touching its
 * name would be refused as a repeat of itself.
 *
 * `updated_at` is in no `set`: the column carries `$onUpdateFn`, so drizzle adds it to every
 * update it emits.
 */
export async function updateProgram(
	db: Db,
	id: string,
	input: ParsedProgram
): Promise<ProgramSave> {
	let updated: { id: string }[];
	try {
		updated = await db
			.update(program)
			.set({ name: input.name, description: input.description })
			.where(and(eq(program.id, id), isNull(program.archivedAt)))
			.returning({ id: program.id });
	} catch (error) {
		if (sqliteResultCode(error) === NAME_TAKEN) return 'duplicate_name';
		throw error;
	}

	return updated.length > 0 ? 'saved' : 'gone';
}

/**
 * retires a cause: the status and the timestamp move together, in one statement.
 *
 * they have to. `PROGRAM_STATUSES` and `archived_at` are two representations of one fact, D1 has
 * no interactive transaction to put two statements inside, and a cause left holding one without
 * the other reads retired on a screen and active to `readActivePrograms`. one `set` makes that
 * unrepresentable rather than merely unlikely — no `batch()` is needed, because this is one row.
 *
 * `false` means there was nothing to retire — no such cause, or one that already is. the two are
 * the same answer to the screen that asked, and refusing the second is what keeps a double press
 * from overwriting the timestamp that records when it happened.
 */
export async function archiveProgram(db: Db, id: string): Promise<boolean> {
	const archived = await db
		.update(program)
		.set({ status: 'archived', archivedAt: new Date() })
		.where(and(eq(program.id, id), isNull(program.archivedAt)))
		.returning({ id: program.id });

	return archived.length > 0;
}
