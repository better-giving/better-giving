import { and, asc, eq, isNull, notExists } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { FORM_CURRENCY } from '../../forms/amounts';
import { postableId } from '../db/accounts';
import type { Db } from '../db/client';
import { form, type Form, mintFormId, page, type PageState, program } from '../db/schema';
import type { PageType } from '../../page/keys';
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
// the one statement half is `ownedFormInsert`: a page's settings row, which lands in the same
// `batch()` as the page naming it. every other write below is one row of `form` from a staff
// screen, with nothing it could need to be atomic with.
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
 * a `form` row no page names, which is what makes it one of the Forms screens'. a page's own row is
 * its donation settings and is edited in the page's editor (`page` in ../db/schema.ts), so the list
 * leaves it out and every write below refuses it at its `where`. the readers of one row by id —
 * the served config, the charge, a gift's own form — still read it.
 */
function ownedByNoPage(db: Db) {
	return notExists(db.select({ id: page.id }).from(page).where(eq(page.formId, form.id)));
}

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
 * a form staff have already retired. a page's own row is left out too (`ownedByNoPage` above).
 */
export async function readForms(db: Db): Promise<FormListRow[]> {
	const rows = await db
		.select(FORM_COLUMNS)
		.from(form)
		.where(and(isNull(form.archivedAt), ownedByNoPage(db)))
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
 * a form as it is stored: the record, and the version a group write is compared against — which
 * is no column an operator configures, so it is not on `FormRecord`.
 */
export type StoredForm = FormRecord & Pick<Form, 'updatedAt'>;

/**
 * `StoredForm`, as drizzle needs its columns named — the same `satisfies` discipline
 * `FORM_COLUMNS` is under, and for the same reason: a column added to one and not the other
 * stops compiling.
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
	programId: form.programId,
	updatedAt: form.updatedAt
} satisfies Record<keyof StoredForm, SQLiteColumn>;

/** the selected row with its two JSON columns decoded — the one place that mapping lives. */
function toRecord(
	row: {
		[K in keyof StoredForm]: K extends 'suggestedAmounts' | 'allowedOrigins'
			? string
			: StoredForm[K];
	}
): StoredForm {
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
export async function createForm(db: Db, input: ParsedForm): Promise<StoredForm | null> {
	// `null` and no row, for a pin no active cause answers to. the parse cannot decide it — what
	// this deployment still offers is a table — and the foreign key answers only half of it, as a
	// constraint error and a 500.
	if (input.programId !== null && !(await offersProgram(db, input.programId))) return null;

	const [row] = await db.insert(form).values(newRow(input)).returning(FORM_DETAIL_COLUMNS);

	if (!row) {
		// unreachable: an insert that stored no row would have thrown. it is here because the
		// alternative is a non-null assertion, which would be a claim about drizzle rather than
		// about this code.
		throw new Error('inserting into `form` returned no row');
	}
	return toRecord(row);
}

/** a new row's columns: the parsed values, and the two `createForm` above writes rather than parses. */
function newRow(input: ParsedForm) {
	return {
		...toColumns(input),
		currency: FORM_CURRENCY,
		revenueAccountId: postableId('donationsDeductible')
	};
}

/**
 * the insert for a settings row a page owns, and the id it will have, for the caller's `batch()`.
 *
 * the id is minted here rather than by the column's default because the page's own insert in the
 * same batch names it, and nothing inside a batch can read one statement's `returning()` into the
 * next. no pinned-cause read, unlike `createForm`: the caller states the mode, and a page's row is
 * never made pinned.
 */
export function ownedFormInsert(db: Db, input: ParsedForm) {
	const id = mintFormId();
	return { id, statement: db.insert(form).values({ id, ...newRow(input) }) };
}

/**
 * one form by id, or `null` when there is none.
 *
 * unlike `readForms` this does not filter archived rows, and the difference is the question
 * each answers. the list is what an operator may act on; this is a lookup of a specific id,
 * where "that form was retired" and "there is no such form" are different sentences on a
 * screen and hiding the first would collapse them into a 404.
 */
export async function readForm(db: Db, id: string): Promise<StoredForm | null> {
	const [row] = await db.select(FORM_DETAIL_COLUMNS).from(form).where(eq(form.id, id)).limit(1);
	return row ? toRecord(row) : null;
}

/**
 * the page whose donation settings a `form` row is, as a refusal names it: the Donation page has no
 * name (`page_name_check` in ../db/schema.ts), a campaign always has one. a campaign's `state` is
 * what says why its row may not be live — never published, or ended.
 */
export type OwningPage =
	| { readonly type: 'donation_page' }
	| { readonly type: 'campaign'; readonly name: string; readonly state: PageState };

/** the owning page off a row joined to `page`, or `null` for a row no page names. */
function owningPage(row: {
	pageType: PageType | null;
	pageName: string | null;
	pageState: PageState | null;
}): OwningPage | null {
	if (row.pageType === null) return null;
	if (row.pageType === 'donation_page') return { type: 'donation_page' };
	if (row.pageName === null || row.pageState === null) {
		// unreachable: `page_name_check` refuses a campaign without a name, and `state` is not null.
		throw new Error('a campaign page has no name or no state');
	}
	return { type: 'campaign', name: row.pageName, state: row.pageState };
}

/** the page that owns the `form` row `id`, or `null` when no page names it or no row has that id. */
export async function readOwningPage(db: Db, id: string): Promise<OwningPage | null> {
	const [row] = await db
		.select({ pageType: page.type, pageName: page.name, pageState: page.state })
		.from(page)
		.where(eq(page.formId, id))
		.limit(1);
	return row ? owningPage(row) : null;
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
// each is also a compare-and-set on `updated_at`: a save lands only on the version the caller's
// page was drawn from, so a tab drawn before a colleague's save is answered `stale` rather than
// putting back whatever that save moved — the draft status over a publish is the sharp one. the
// version is the row's, not the group's, so a save in one group refuses a stale tab's save in any
// other; a revalidation after a save hands the saving screen the new one.
//
// the id is a separate argument rather than a field on the parsed value, so it comes from the
// route that loaded the form rather than from a body the browser posted back.
//
// `updated_at` is named in no `set` — it carries `$onUpdateFn`, so drizzle adds it to every one,
// and that is what moves the version every write here is compared against.
// ---------------------------------------------------------------------------

/** a write refused because the row is a page's donation settings, naming that page. */
export type PageOwned = { readonly ownedBy: OwningPage };

/**
 * what a group write did.
 *
 * `gone` is a row that is missing or archived. `stale` is a row that has been written since the
 * version the caller was drawn from, and is refused rather than overwritten: a save replaces every
 * column its group owns, so a tab drawn before a publish would put the draft status back and take
 * the form off every donor page with nobody told. `PageOwned` is a row a page owns, whose settings
 * are edited in that page's editor.
 */
export type FormSave = 'saved' | 'gone' | 'stale' | PageOwned;

/** the one row a group write may land on: this id, not archived, no page's, and still at `version`. */
function writable(db: Db, id: string, version: Date) {
	return and(
		eq(form.id, id),
		isNull(form.archivedAt),
		ownedByNoPage(db),
		eq(form.updatedAt, version)
	);
}

/**
 * which refusal a write that matched no row met, read after the write rather than in front of it.
 * it picks the sentence and guards nothing: the refusal already happened at the `where`. a page's
 * row is named whether or not it is archived: the page's editor is the one place it can be changed.
 */
async function missed(db: Db, id: string): Promise<'gone' | 'stale' | PageOwned> {
	const [row] = await db
		.select({
			archivedAt: form.archivedAt,
			pageType: page.type,
			pageName: page.name,
			pageState: page.state
		})
		.from(form)
		.leftJoin(page, eq(page.formId, form.id))
		.where(eq(form.id, id))
		.limit(1);
	if (row === undefined) return 'gone';
	const ownedBy = owningPage(row);
	if (ownedBy !== null) return { ownedBy };
	return row.archivedAt !== null ? 'gone' : 'stale';
}

/**
 * the name and the status.
 *
 * `revenue_account_id` is in no `set` here and in none of the three group writes: the account a
 * form records against is `createForm`'s decision and is not an input, so an edit has nothing to
 * move it with.
 */
export async function updateFormName(
	db: Db,
	id: string,
	version: Date,
	input: ParsedFormName
): Promise<FormSave> {
	const updated = await db
		.update(form)
		.set({ name: input.name, status: input.status })
		.where(writable(db, id, version))
		.returning({ id: form.id });

	return updated.length > 0 ? 'saved' : await missed(db, id);
}

/** the two bounds and the suggested tiles, which are one decision and so one write. */
export async function updateFormGiving(
	db: Db,
	id: string,
	version: Date,
	input: ParsedFormGiving
): Promise<FormSave> {
	const updated = await db
		.update(form)
		.set({
			minMinor: input.minMinor,
			maxMinor: input.maxMinor,
			suggestedAmounts: encodeSuggestedAmounts(input.suggestedAmounts)
		})
		.where(writable(db, id, version))
		.returning({ id: form.id });

	return updated.length > 0 ? 'saved' : await missed(db, id);
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
	version: Date,
	input: ParsedFormOrigins
): Promise<FormSave> {
	const updated = await db
		.update(form)
		.set({ allowedOrigins: encodeAllowedOrigins(input.allowedOrigins) })
		.where(writable(db, id, version))
		.returning({ id: form.id });

	return updated.length > 0 ? 'saved' : await missed(db, id);
}

/**
 * what a save of the program group did, which is five answers: the four every group write has
 * (`FormSave`), and one of its own.
 *
 * `unknown_program` is its own word because it is its own sentence on the screen, and it is the
 * one of the five an operator can fix without leaving the page: `gone` says this form is not there
 * to write to and `stale` that the page is behind it, where this says the cause it was pointed at
 * is not one this deployment still offers. it is decided before the write, so a stale tab pinning
 * a retired cause hears about the cause first.
 */
export type ProgramSave = FormSave | 'unknown_program';

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
	version: Date,
	input: ParsedFormProgram
): Promise<ProgramSave> {
	if (input.programId !== null && !(await offersProgram(db, input.programId))) {
		return 'unknown_program';
	}

	const updated = await db
		.update(form)
		.set({ programMode: input.programMode, programId: input.programId })
		.where(writable(db, id, version))
		.returning({ id: form.id });

	return updated.length > 0 ? 'saved' : await missed(db, id);
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
 * double-click from overwriting the timestamp that records when it happened. a page's row is
 * refused as `PageOwned`, as every group write refuses it.
 */
export async function archiveForm(db: Db, id: string): Promise<boolean | PageOwned> {
	const archived = await db
		.update(form)
		.set({ status: 'archived', archivedAt: new Date() })
		.where(and(eq(form.id, id), isNull(form.archivedAt), ownedByNoPage(db)))
		.returning({ id: form.id });

	if (archived.length > 0) return true;
	const miss = await missed(db, id);
	return typeof miss === 'object' ? miss : false;
}
