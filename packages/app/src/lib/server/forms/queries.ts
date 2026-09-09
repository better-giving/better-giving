import { and, asc, eq, isNull } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { FORM_CURRENCY } from '../../forms/amounts';
import { postableId } from '../db/accounts';
import type { Db } from '../db/client';
import { form, type Form, program } from '../db/schema';
import type {
	FormRecord,
	ParsedForm,
	ParsedFormGiving,
	ParsedFormName,
	ParsedFormOrigins,
	ParsedFormProgram
} from './form-input';
import {
	decodeAllowedOrigins,
	decodeSuggestedAmounts,
	encodeAllowedOrigins,
	encodeSuggestedAmounts
} from './form-json';

// every read and write of `form`, and every write without exception — the same boundary
// `../org/queries.ts` and `../ledger/posting.ts` draw, and it is what makes "all the writes are
// here" true rather than aspirational.
//
// the table object itself leaves this module in exactly one place, and it is worth naming rather
// than papering over: `findTarget` in `../donations/settle.ts` joins `form` for the form's name in
// the same query that already joins `contact` the same way. what it buys is a name for a message
// the settlement path sends; what routing it through here would cost is a second round trip on the
// money path, per settled gift, to preserve a sentence. a read of a column that has no decoding and
// no archived-row rule to keep is the shape that may do that. anything needing this table's JSON
// columns, its `status` filter, or a write may not — `readForm` and `readForms` below are where the
// decisions about those live, and a caller that reimplements one has reimplemented the rules with
// it.
//
// ---------------------------------------------------------------------------
// execute, or return statements — the rule for every write added below.
//
// a single-row write that must land on its own may execute itself, which is what `createForm`,
// the four group writes and `archiveForm` below do. a write that must land atomically with a row in
// another table may not: it would split into a row-building half and a statement-building half
// and splice the statement into the one `batch()` that owns the whole write, as
// `../contacts/queries.ts` does. `Db` has no `transaction` (D1 has none — see ../db/client.ts),
// so a single `batch()` is the only atomic unit there is.
//
// there is no statement half here and that is a statement about the table, not an omission:
// every write below is one row of `form` from a staff screen, and there is nothing any of
// them could need to be atomic with. add the split the day something does.
// ---------------------------------------------------------------------------

/**
 * a form as everything outside this module sees it.
 *
 * one of the three JSON columns is decoded and the other two are not selected, and the list is
 * narrow because a list page is: `suggested_amounts` and the bounds are read on the screen that
 * edits one form, which is what `FormRecord` (./form-input.ts) is for. how often a gift may repeat
 * is not here and is not a fact about a form — `offeredCadences` in ./offered-cadences.ts is what
 * decides it for every form at once. selecting the whole row instead would hand `copy` out as a raw
 * JSON `string` — this folder owns no decode for it — and make "a raw JSON string never reaches a
 * route or a component" (./form-json.ts) false at this boundary, with only the route's projection
 * between it and a browser.
 *
 * derived from `Form` rather than written out, so a column that is renamed or retyped is a
 * compile error here rather than a key that silently stops arriving.
 */
export type FormListRow = Pick<Form, 'id' | 'name' | 'status'> & {
	allowedOrigins: string[];
};

/**
 * the columns above, as drizzle needs them named.
 *
 * spelled out beside the type it must agree with, and `satisfies` is what ties them together:
 * a column added to one and not the other stops compiling.
 */
const FORM_COLUMNS = {
	id: form.id,
	name: form.name,
	status: form.status,
	allowedOrigins: form.allowedOrigins
} satisfies Record<keyof FormListRow, SQLiteColumn>;

/**
 * every form, oldest first.
 *
 * a list and never a lookup, and that holds from both ends: a fresh deployment has no forms at
 * all — `migrations/` seeds the chart of accounts and nothing else — while a deployment that
 * has been used has as many as staff have made. either way an id in app code would be a
 * guess, so this returns every row and the page renders what it gets.
 *
 * `created_at` then `id`, and the tiebreak is not decoration: the column is Unix ms, so two
 * forms minted in one request tie on it, and an unordered list is one that reshuffles between
 * loads. no index backs either — the table holds forms in the low tens by design (see the
 * note at the end of `form` in ../db/schema.ts).
 *
 * archived forms are excluded, the same way `../contacts/queries.ts` excludes archived
 * contacts and for a stronger reason: forms archive rather than delete (see FORM_STATUSES in
 * ../../forms/statuses.ts), so an archived row still has an id and a snippet — and listing it would
 * hand an operator something to paste into a site plus a live box that writes an allowlist for
 * a form staff have already retired.
 */
export async function readForms(db: Db): Promise<FormListRow[]> {
	const rows = await db
		.select(FORM_COLUMNS)
		.from(form)
		.where(isNull(form.archivedAt))
		// `created_at` orders the list without being selected — it is a fact about the rows, not
		// one this page renders.
		.orderBy(asc(form.createdAt), asc(form.id));
	return rows.map((row) => ({
		...row,
		allowedOrigins: decodeAllowedOrigins(row.allowedOrigins)
	}));
}

// ---------------------------------------------------------------------------
// one form, whole: making it, reading it back to edit, editing it and retiring it.
//
// the writes below take a `ParsedForm` and nothing else. everything an operator configures is
// decidable from the submitted text and is decided by `parseFormInput` (./form-input.ts),
// carried by the brand on that value.
//
// `revenue_account_id` is not among those things and is not an input on any screen: every form
// records its gifts against `4110 Tax-Deductible Donations`, written by `createForm` below from
// `postableId` in ../db/accounts.ts. the column stays because the domain is modelled past what
// the UI renders (CLAUDE.md -> Bans -> Schema shape), and nothing an edit does moves it.
//
// `revenue_account_is_postable` is never named. it defaults to 1 and the check pins it there,
// which is the whole mechanism — see the constraint list on `form` in ../db/schema.ts.

/**
 * `FormRecord` (./form-input.ts), as drizzle needs its columns named — the same `satisfies`
 * discipline `FORM_COLUMNS` is under, and for the same reason: a column added to one and not
 * the other stops compiling.
 */
const FORM_DETAIL_COLUMNS = {
	id: form.id,
	name: form.name,
	status: form.status,
	revenueAccountId: form.revenueAccountId,
	suggestedAmounts: form.suggestedAmounts,
	minMinor: form.minMinor,
	maxMinor: form.maxMinor,
	currency: form.currency,
	allowedOrigins: form.allowedOrigins,
	programMode: form.programMode,
	programId: form.programId
} satisfies Record<keyof FormRecord, SQLiteColumn>;

/** the selected row with its two JSON columns decoded — the one place that mapping lives. */
function toRecord(
	row: {
		[K in keyof FormRecord]: K extends 'suggestedAmounts' | 'allowedOrigins'
			? string
			: FormRecord[K];
	}
): FormRecord {
	return {
		...row,
		suggestedAmounts: decodeSuggestedAmounts(row.suggestedAmounts),
		allowedOrigins: decodeAllowedOrigins(row.allowedOrigins)
	};
}

/** the columns every write sets, encoded — so create and edit cannot drift apart. */
function toColumns(input: ParsedForm) {
	return {
		name: input.name,
		status: input.status,
		suggestedAmounts: encodeSuggestedAmounts(input.suggestedAmounts),
		minMinor: input.minMinor,
		maxMinor: input.maxMinor,
		allowedOrigins: encodeAllowedOrigins(input.allowedOrigins),
		programMode: input.programMode,
		programId: input.programId
	};
}

/**
 * whether this deployment still offers the cause a form is about to be pinned to.
 *
 * a read rather than a constraint, because the constraint cannot answer it: the foreign key
 * catches an id no row carries and says nothing about a cause that has been retired — which is the
 * whole reason a cause is archived rather than deleted (`program` in ../db/schema.ts).
 *
 * `archived_at` rather than `status`, for the reason `readActivePrograms` in
 * ../programs/queries.ts gives: `archiveProgram` writes both in one statement and the timestamp is
 * the one no other write can reach.
 *
 * a read in front of a write, and D1 has no transaction to put the pair inside — so a cause
 * retired between the two lands a form pinned to it anyway. that is the state this deployment
 * already lives with and not a hole: a form pinned before its cause was retired keeps the pin, and
 * a cause retired one millisecond either side of the write is the same form either way. what the
 * read is for is the case the operator can act on — a stale tab offering a cause that was retired
 * yesterday.
 */
async function offersProgram(db: Db, id: string): Promise<boolean> {
	const [found] = await db
		.select({ id: program.id })
		.from(program)
		.where(and(eq(program.id, id), isNull(program.archivedAt)))
		.limit(1);
	return found !== undefined;
}

/**
 * makes a form and hands back the row that was stored.
 *
 * the id is not an argument and never will be: `form.id` is the one public primary key in
 * this schema, and its 80 random bits are minted by the column's own `$defaultFn` — see
 * `formId` in ../db/schema.ts. read off `returning()` rather than by a select afterwards,
 * which D1 could not make atomic with the insert anyway.
 *
 * `currency` is written here rather than parsed, because it is not an input: v0 is USD-only
 * by decision (see `FORM_CURRENCY` in `$lib/forms/amounts.ts`), so there is no field for an
 * operator to get wrong.
 *
 * `copy` is left to the column default. nothing in this repo reads or writes it, and its
 * shape belongs to whatever first renders a form's headline.
 *
 * `revenue_account_id` is written here rather than parsed, for the reason `currency` above it is:
 * it is not an input. every form records against `4110 Tax-Deductible Donations`, and the branded id
 * comes from `postableId` — door (1) of the two ../db/postable.ts enumerates, discharged by its
 * key type rather than by a read.
 */
export async function createForm(db: Db, input: ParsedForm): Promise<FormRecord | null> {
	// `null` and no row, for a pin no active cause answers to. the parse cannot decide it — what
	// this deployment still offers is a table — and the foreign key answers only half of it, as a
	// constraint error and a 500.
	if (input.programId !== null && !(await offersProgram(db, input.programId))) return null;

	const [row] = await db
		.insert(form)
		.values({
			...toColumns(input),
			currency: FORM_CURRENCY,
			revenueAccountId: postableId('donationsDeductible')
		})
		.returning(FORM_DETAIL_COLUMNS);

	if (!row) {
		// unreachable: an insert that stored no row would have thrown. it is here because the
		// alternative is a non-null assertion, which would be a claim about drizzle rather than
		// about this code.
		throw new Error('inserting into `form` returned no row');
	}
	return toRecord(row);
}

/**
 * one form by id, or `null` when there is none.
 *
 * unlike `readForms` this does not filter archived rows, and the difference is the question
 * each answers. the list is what an operator may act on; this is a lookup of a specific id,
 * where "that form was retired" and "there is no such form" are different sentences on a
 * screen and hiding the first would collapse them into a 404.
 */
export async function readForm(db: Db, id: string): Promise<FormRecord | null> {
	const [row] = await db.select(FORM_DETAIL_COLUMNS).from(form).where(eq(form.id, id)).limit(1);
	return row ? toRecord(row) : null;
}

/**
 * one form's `allowed_origins`, and the whole of what the public api may know about a form
 * before a browser has been allowed to ask it anything.
 *
 * a query of its own rather than a `readForm` at the call site, and the narrowness is the point:
 * a CORS preflight is answered from this column alone, so reading nine columns and decoding two
 * JSON ones to reach it would hand an unauthenticated path a whole form record — the amounts, the
 * revenue account — that it has nothing to do with. `/api/v1` gets one door here, not two.
 *
 * an empty list for an id no form carries, which is the same answer a form naming no site gets.
 * they are one answer on purpose: the preflight grants nothing either way, and a caller able to
 * tell them apart would have a form-id oracle it could read from any page on the internet.
 *
 * an archived row is read, like `readForm` and unlike `readForms`. what tells an integrator a
 * form was retired is the 410 on the request itself; the preflight in front of it is not the
 * place to say so, because it carries no status a page can read.
 */
export async function readFormOrigins(db: Db, id: string): Promise<readonly string[]> {
	const [row] = await db
		.select({ allowedOrigins: form.allowedOrigins })
		.from(form)
		.where(eq(form.id, id))
		.limit(1);
	return row ? decodeAllowedOrigins(row.allowedOrigins) : [];
}

// ---------------------------------------------------------------------------
// the four group writes, which is how the screen that edits a form saves.
//
// there is no whole-row update, because the editor saves a group at a time. four functions rather
// than one taking a partial, and the difference is what a caller can get wrong: a `Partial<>`
// argument makes "this group must not write a column it does not own" a rule every action has to
// keep on its own, and one spread of the wrong object turns a save of the name into a save that
// clears the amount bounds — which is exactly the failure splitting the screen into three forms
// answers. four `set` clauses spelled out make it unrepresentable instead: there is no argument
// to any of these that could reach a column outside its own group.
//
// each one answers rather than throwing for a row that is missing or archived: both are a
// tab that was open when somebody else changed the form, which is an ordinary thing for a staff
// screen to meet and a sentence an operator can act on, where a 500 would be this module claiming
// the deployment is broken because two people had the same page open. `readForm` returns an
// archived row, so the screen that asked can tell the two apart and say which happened.
//
// retirement is out of reach from all four, and the `where` is what puts it there. `status` is the
// only retirement signal `FormRecord` carries and none of these clears `archived_at`, so an update
// that landed on an archived row would leave a form `readForms` hides forever, `archiveForm`
// answers `false` about, and no screen can retire again. restoring one is a write this module does
// not have.
//
// the answer comes off the update's own `returning()` rather than a select in front of it, because
// D1 has no transaction and a check-then-write would be two commits with a race between them.
//
// all four race the same way and none of them refuses a save on that account: two staff with one
// screen open each submit their own group whole, so the later press replaces the earlier one and
// nobody is told. it is last-write-wins by decision — on a deployment whose staff are a handful,
// the collision costs one press to redo.
//
// the id is a separate argument rather than a field on the parsed value, so it comes from the
// route that loaded the form rather than from a body the browser posted back.
//
// `updated_at` is named in no `set` — it carries `$onUpdateFn`, so drizzle adds it to every one.
// ---------------------------------------------------------------------------

/**
 * the name and the status.
 *
 * `revenue_account_id` is in no `set` here and in none of the three group writes: the account a
 * form records against is `createForm`'s decision and is not an input, so an edit has nothing to
 * move it with.
 */
export async function updateFormName(db: Db, id: string, input: ParsedFormName): Promise<boolean> {
	const updated = await db
		.update(form)
		.set({ name: input.name, status: input.status })
		.where(and(eq(form.id, id), isNull(form.archivedAt)))
		.returning({ id: form.id });

	return updated.length > 0;
}

/** the two bounds and the suggested tiles, which are one decision and so one write. */
export async function updateFormGiving(
	db: Db,
	id: string,
	input: ParsedFormGiving
): Promise<boolean> {
	const updated = await db
		.update(form)
		.set({
			minMinor: input.minMinor,
			maxMinor: input.maxMinor,
			suggestedAmounts: encodeSuggestedAmounts(input.suggestedAmounts)
		})
		.where(and(eq(form.id, id), isNull(form.archivedAt)))
		.returning({ id: form.id });

	return updated.length > 0;
}

/**
 * the sites this form may be loaded from, which is `/api/v1`'s CORS allowlist.
 *
 * the whole list every time, because the group is the whole list: a save replaces the column with
 * what the tick boxes held when the press was made.
 */
export async function updateFormOrigins(
	db: Db,
	id: string,
	input: ParsedFormOrigins
): Promise<boolean> {
	const updated = await db
		.update(form)
		.set({ allowedOrigins: encodeAllowedOrigins(input.allowedOrigins) })
		.where(and(eq(form.id, id), isNull(form.archivedAt)))
		.returning({ id: form.id });

	return updated.length > 0;
}

/**
 * what a save of the program group did, which is three answers rather than two.
 *
 * `unknown_program` is its own word because it is its own sentence on the screen, and it is the
 * one of the three an operator can fix without leaving the page: `gone` says this form is not
 * there to write to, where this says the cause it was pointed at is not one this deployment still
 * offers.
 */
export type ProgramSave = 'saved' | 'gone' | 'unknown_program';

/**
 * the cause this form's gifts are recorded against, which is the mode and the one id together.
 *
 * one write for two columns because they are one decision, and `form_program_pinned_check` in
 * ../db/schema.ts is what makes that structural: a `set` moving either half on its own would be
 * refused by the database rather than by this module. the pair arrives already agreed —
 * `parseFormProgram` in ./form-input.ts drops the id in every mode but `pinned` — so there is
 * nothing here to reconcile.
 */
export async function updateFormProgram(
	db: Db,
	id: string,
	input: ParsedFormProgram
): Promise<ProgramSave> {
	if (input.programId !== null && !(await offersProgram(db, input.programId))) {
		return 'unknown_program';
	}

	const updated = await db
		.update(form)
		.set({ programMode: input.programMode, programId: input.programId })
		.where(and(eq(form.id, id), isNull(form.archivedAt)))
		.returning({ id: form.id });

	return updated.length > 0 ? 'saved' : 'gone';
}

/**
 * retires a form: the status and the timestamp move together, in one statement.
 *
 * they have to. `FORM_STATUSES` and `archived_at` are two representations of one fact, D1 has
 * no interactive transaction to put two statements inside, and a form left holding one
 * without the other reads archived on a screen and live to `readForms`. one `set` is what
 * makes that unrepresentable rather than merely unlikely — no `batch()` is needed, because
 * this is one row.
 *
 * the form is not deleted and never is: a pasted snippet outlives it, sitting in someone
 * else's HTML on a site we cannot reach, so a hard delete breaks a live donation page with no
 * way to find out.
 *
 * `false` means there was nothing to archive — no such form, or one that already is. the two
 * are the same answer to the screen that asked, and refusing the second is what keeps a
 * double-click from overwriting the timestamp that records when it happened.
 */
export async function archiveForm(db: Db, id: string): Promise<boolean> {
	const archived = await db
		.update(form)
		.set({ status: 'archived', archivedAt: new Date() })
		.where(and(eq(form.id, id), isNull(form.archivedAt)))
		.returning({ id: form.id });

	return archived.length > 0;
}
