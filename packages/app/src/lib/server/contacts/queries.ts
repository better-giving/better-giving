import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	getTableColumns,
	inArray,
	isNull,
	sql
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../db/client';
import { overMonths, type MonthlyRun } from '../months';
import {
	contact,
	donation,
	payment,
	recurringPlan,
	type Contact,
	type NewContact
} from '../db/schema';
import type { ContactSort, ContactView, SortDir } from '../../contacts/sorts';
import type { ParsedContact } from './contact-input';

// every read and write of `contact`, so the two non-obvious query shapes below have one
// place to be stated rather than being re-derived at each call site.
//
// `donation` and `payment` are named here too, in `listContacts` and `readDonorSummary` and
// nowhere else — the two places either table is read outside ../donations/queries.ts, whose header
// claims otherwise for every other read and points here for these two. `recurring_plan` is the
// third such crossing, in `activeCommitment` below and the two reads that spend it, and
// ../recurring/queries.ts names it from the other end.
//
// the crossing is forced in both by the question being about donors rather than about gifts.
// `listContacts` orders the donor file by how much a donor has given, across the whole file rather
// than across a page, so the aggregate and the `order by` that reads it have to be one statement —
// and that statement's driving table is `contact`. splitting it is a read of every contact in the
// file followed by a read of every gift in the books, sorted in the Worker, which is the shape the
// `LIMIT` exists to prevent. `readDonorSummary` counts contacts by the month their money first
// moved, which is one grouping over the same three tables: `donation` is what joins a settlement
// to the person who made it, and whether that person is counted at all turns on
// `contact.archived_at`. the recurring one is forced the same way: which donors the file's second
// view holds is a fact about `recurring_plan`, and it has to be a predicate on the statement that
// pages `contact` — reading every commitment and intersecting in the Worker is the shape the
// `LIMIT` exists to prevent, and it would page a file whose size the read no longer knows.
//
// **both are under the rule `projectStatus` in ../donations/queries.ts states**, and that file's
// header pins the agreement from the other end: a succeeded inbound attempt is what collects and
// every other attempt counts for nothing. the summary spends only that half of it — a count of
// donors is not money, so a refund takes nothing off one.
// ---------------------------------------------------------------------------
// execute, or return statements — the rule for every write added below.
//
// a single-row write that must land on its own may execute itself, which is what
// `createContact` does and why it is correct for the /admin create form. a write that must
// land atomically with a row in another table may not: it calls `newContactRow` for the row
// and `contactInsertStatement` for the statement, and splices that statement into the one
// `batch()` that owns the whole write. the id is minted in the first half precisely so the
// second table can reference it.
//
// two functions and not one, and the split is the whole seam: `newContactRow` mints the id a
// caller has to read, `contactInsertStatement` turns that row into a statement without the
// caller ever naming the `contact` table. that second half is what makes "every read and
// write of `contact` lives here" true rather than aspirational — the alternative, a caller
// importing `contact` from ../db/schema and writing its own `db.insert(contact)`, puts a
// write of this table in a module that is not this one, which is exactly what a later reader
// looking for all of them will miss.
//
// `Db` has no `transaction` (D1 has none — see ../db/client.ts), so a single `batch()` is
// the only atomic unit there is. the predictable failure is the inline "new donor" path
// on a donation form: `await createContact(...)` and then `batch()` the donation, its
// line items, its payment and its ledger lines is two commits, so a contact can exist
// with no gift and nothing in the schema detects it. ../ledger/posting.ts is the
// precedent and this file matches it deliberately, function for function — `post()`
// resolves rows and hands them up, `postingStatements(db, posting)` turns them into
// `BatchItem<'sqlite'>[]`, and neither calls `batch()`. `entryGroup` and `ledgerEntry`
// therefore never leave that module, and `contact` does not leave this one.
//
// returning a statement costs the caller nothing it would otherwise have: `.returning()`
// works inside `batch()`, so a statement-returning insert still yields its stored row.
// ---------------------------------------------------------------------------

/**
 * how many donors a list page returns, and therefore how far apart the pages are.
 *
 * it is a `LIMIT` with an `OFFSET` under it: the list is the whole donor file, and a fork that
 * has taken three thousand gifts would otherwise serialize three thousand rows into the page.
 * every row past this one is reachable — which is what makes the number a page size rather than
 * a cap on what an operator may see.
 */
export const CONTACT_LIST_LIMIT = 100;

/**
 * which page of the donor file to read, and in what order.
 *
 * every field is required and none is defaulted here. what an absent or malformed `?sort=` means
 * is a question about an address, and the screen owns its address — see
 * `packages/app/src/routes/_app.admin.donors._index.tsx`, which reads all three and falls back
 * rather than refusing.
 */
export type ContactOrder = {
	sort: ContactSort;
	dir: SortDir;
	/** 1-based. a page past the end of the file reads the last page rather than an empty one. */
	page: number;
	/**
	 * which donors are in the file at all. every figure `ContactPage` carries is this view's —
	 * the count, the pages and the page — because a total taken over the whole file would page a
	 * view it is not the size of.
	 */
	view: ContactView;
};

/**
 * whether this contact holds a commitment that is still being collected — the whole of what puts a
 * donor in the recurring view.
 *
 * `status = 'active'` and nothing else. `cancelled` and `lapsed` are both commitments that are not
 * collecting now, and a view built to answer "who is giving on a schedule" that held either would
 * be answering "who ever set one up". the `ended_at` column is deliberately not tested beside it:
 * `recurring_plan_ended_at_check` in ../db/schema.ts makes the status and the end one fact, so a
 * second condition would be the same condition written twice and able to disagree with the
 * constraint that enforces it.
 *
 * an `EXISTS` rather than a join, and that is the correctness of the thing rather than a
 * preference: a donor holding three active commitments joins to three rows, which lists them three
 * times, counts them three times and puts the same name on two pages once an `OFFSET` is under it.
 * it correlates on `contact.id`, so every caller has to be a statement whose driving table is
 * `contact`.
 */
function activeCommitment(db: Db) {
	return exists(
		db
			.select({ one: sql`1` })
			.from(recurringPlan)
			.where(and(eq(recurringPlan.contactId, contact.id), eq(recurringPlan.status, 'active')))
	);
}

/**
 * how many donors each view of the file holds.
 *
 * both figures in one statement, over one `where`: the two views are two readings of the same
 * unarchived file, and two reads could answer from either side of a write that arrived between
 * them — a nav whose figures do not add up is one an operator counts against the rows in front of
 * them.
 *
 * `all` is every unarchived contact, which is exactly `ContactPage.total` in the all view;
 * `recurring` is exactly that total in the recurring one. that is the property the specs assert,
 * and it is what lets the nav state both counts on both views without a second read per view.
 *
 * archived contacts are counted in neither, on the same terms as the list: a figure over a file
 * that counted people staff have decided not to see is a figure that never matches the rows.
 */
export async function readDonorViewCounts(db: Db): Promise<{ all: number; recurring: number }> {
	// `sum` over no rows is null rather than zero, so a deployment with no donors would read
	// `recurring: null` and put that word in the nav.
	const [row] = await db
		.select({
			all: count(),
			recurring: sql<number>`coalesce(sum(case when ${activeCommitment(db)} then 1 else 0 end), 0)`
		})
		.from(contact)
		.where(isNull(contact.archivedAt));

	return { all: row?.all ?? 0, recurring: row?.recurring ?? 0 };
}

/**
 * a donor row with what they have actually given.
 *
 * both figures are computed on the request and neither is stored — no column on `contact` holds
 * them and none may, for the reason ../ledger/posting.ts states about every other total in this
 * app: a stored figure is one that can disagree with the rows it was taken from.
 */
export type ContactListRow = Contact & {
	/** gifts with at least one succeeded inbound attempt. a gift nothing settled counts zero. */
	gifts: number;
	/** minor units: what those gifts collected, less what succeeded refunds took back. */
	given: number;
};

/** one page of the donor file, and where in the file it sits. */
export type ContactPage = {
	contacts: ContactListRow[];
	/**
	 * every unarchived contact this view holds, not only the ones on this page — what the screen
	 * counts against. in the recurring view it is that view's own size and not the file's, which is
	 * what keeps the caption and the paging pair true of the rows underneath them.
	 */
	total: number;
	/** the page actually read, which is the one asked for held inside the file that exists. */
	page: number;
	/** how many pages the file has. never below one, so an empty file is page 1 of 1. */
	pages: number;
};

/**
 * the donor file, one page of it, ordered by name or by what each donor has given.
 *
 * **the aggregates follow `projectStatus` in ../donations/queries.ts exactly, and have to.** a
 * succeeded inbound attempt is what collects; a succeeded refund takes back; every other attempt
 * counts for nothing, because it is money the org either never received or still holds. so a gift
 * whose only attempt is `pending` is not a gift this donor has given, and a gift refunded in full
 * is still a gift they gave and adds nothing to the figure. two readings of the same rows that
 * disagreed would be one screen contradicting the next.
 *
 * the subtraction is against what the inbound attempts collected rather than `donation.total_minor`,
 * for the reason stated there: the collected figure is the one a refund can reach.
 *
 * one statement, and the grouping is two deep because the test is per gift and the figure is per
 * donor: the inner group asks each gift what it collected and what came back, and the outer one
 * counts the gifts that collected anything and adds what they kept. a `count(*)` over the same
 * `where` rides beside it, and it is a second read rather than a window function because it is
 * what decides which page exists at all — the page below is clamped to it, so a request for page
 * nine of a two-page file reads the last page rather than an empty one, and the caption a screen
 * writes from `page` and `total` is true whatever an operator typed into the address.
 *
 * `id` breaks every tie, on every sort, and it is not decoration. names collide, and so do
 * figures — a hundred donors who have given nothing all tie on `given` — so without it the rows
 * inside a tie come back in whatever order the sort emitted, which is a page whose contents change
 * between loads and, with `OFFSET` under it, a donor who appears on two pages or on neither. `id`
 * is a uuidv7 minted app-side, so it is unique and its order is creation order: the tiebreak is
 * total, and descending it puts the newer of two tied donors first.
 *
 * archived contacts are neither listed nor counted: the column is a soft delete precisely because
 * a donor with financial history is never removed, so a file that showed them would be a file of
 * people staff have already decided not to see.
 *
 * `order.view` narrows that same `where` and nothing else — the sort, the tiebreak, the figures on
 * each row and the paging all work exactly as they do over the whole file, because the view is
 * which donors are in it rather than a different question about them. `activeCommitment` above is
 * the whole of the narrowing and argues why it is an `EXISTS`.
 */
export async function listContacts(db: Db, order: ContactOrder): Promise<ContactPage> {
	// one `where` behind both statements, so the count and the page can never be answers about
	// different sets of donors — which is what a caption counting the file while the plane shows a
	// view of it would be.
	const inView =
		order.view === 'recurring'
			? and(isNull(contact.archivedAt), activeCommitment(db))
			: isNull(contact.archivedAt);

	const [counted] = await db.select({ total: count() }).from(contact).where(inView);
	const total = counted?.total ?? 0;
	const pages = Math.max(1, Math.ceil(total / CONTACT_LIST_LIMIT));
	const page = Math.min(Math.max(1, order.page), pages);

	// one row per gift that has been settled at all: what it collected, and what came back. the
	// join is inner, so a gift with no attempt on it never reaches the outer grouping — it has
	// collected nothing, which is the same answer the `> 0` test below gives it.
	const settled = db
		.select({
			contactId: donation.contactId,
			collected:
				sql<number>`sum(case when ${payment.direction} = 'inbound' and ${payment.status} = 'succeeded' then ${payment.amountMinor} else 0 end)`.as(
					'collected'
				),
			refunded:
				sql<number>`sum(case when ${payment.direction} = 'refund' and ${payment.status} = 'succeeded' then ${payment.amountMinor} else 0 end)`.as(
					'refunded'
				)
		})
		.from(donation)
		.innerJoin(payment, eq(payment.donationId, donation.id))
		.groupBy(donation.id, donation.contactId)
		.as('settled');

	// `coalesce` because the join is outer: a donor with no settled gift matches no row, and
	// `sum` over no rows is null rather than zero. the screen states exact figures, and a donor
	// whose gifts column read `—` would be one a reader cannot tell from a donor nobody counted.
	const gifts = sql<number>`coalesce(sum(case when ${settled.collected} > 0 then 1 else 0 end), 0)`;
	const given = sql<number>`coalesce(sum(case when ${settled.collected} > 0 then ${settled.collected} - ${settled.refunded} else 0 end), 0)`;

	// `collate nocase` so the file reads as a list of names rather than as two lists, capitals
	// then lowercase — sqlite's default `BINARY` sorts every uppercase letter before every
	// lowercase one, which puts `ashworth` under `Zamora`.
	const key =
		order.sort === 'name'
			? sql`${contact.displayName} collate nocase`
			: order.sort === 'gifts'
				? gifts
				: given;
	const direction = order.dir === 'asc' ? asc : desc;

	const contacts = await db
		.select({ ...getTableColumns(contact), gifts, given })
		.from(contact)
		.leftJoin(settled, eq(settled.contactId, contact.id))
		.where(inView)
		.groupBy(contact.id)
		.orderBy(direction(key), desc(contact.id))
		.limit(CONTACT_LIST_LIMIT)
		.offset((page - 1) * CONTACT_LIST_LIMIT);

	return { contacts, total, page, pages };
}

/**
 * the figures the donor screen states over the list: how many donors there are, how many arrived
 * this month, and how many arrived in each of the last twelve.
 *
 * every figure counts donors with at least one settled gift, `total` over the whole history rather
 * than over the run — ../months.ts is the shape and the run it is cut into, shared with every other
 * monthly figure this app states.
 */
export type DonorSummary = MonthlyRun;

/**
 * the three figures over the donor list, in one statement.
 *
 * **who counts is not who the list shows, and the two disagreeing is the design.** a row in the
 * file is a contact; a donor here is a contact whose gifts have actually settled, which is the
 * same test `listContacts` applies to the `gifts` column beside each name — a succeeded inbound
 * attempt, the rule `projectStatus` in ../donations/queries.ts states for every other read of
 * these two tables. a contact somebody typed into the create form is on the list and is nobody's
 * donor until money moves.
 *
 * a refund takes nothing off these counts, and that is the same answer the row gives: the figures
 * beside a name subtract what came back because they are money, and a count of donors is not.
 * somebody who gave and was refunded in full still gave.
 *
 * **when a donor is new is the month their first settled gift's `occurred_at` falls in**, which is
 * business time — when the money moved (../db/schema.ts, on that column). never `contact.created_at`:
 * a row written by an import, or by the create form months before the gift, would put a donor in a
 * month they gave nothing in. never `donation.received_at` either, which is the gift's time rather
 * than the settlement's.
 *
 * the grouping is two deep for that reason: the inner select asks each contact when their money
 * first moved, and the outer one counts contacts by the month that instant falls in. `%Y-%m` over
 * `occurred_at / 1000` with `unixepoch` reads the column as the UTC ms it is stored as and buckets
 * it by UTC calendar month, which is the encoding every time column in this app carries.
 *
 * it comes back as one row per month there has ever been a first gift in, not twelve — the total
 * is every donor rather than the ones inside the run, and a screen that summed the twelve would
 * state a total that shrinks as the year turns. the Worker is what cuts the run out of it.
 *
 * `now` is a parameter rather than a `Date.now()` inside, so a caller states which month is the
 * current one and a spec can pin a boundary to the millisecond.
 *
 * archived contacts count nowhere, on the same terms as the list: a donor staff have decided not
 * to see is not one a figure above that list should still be counting.
 */
export async function readDonorSummary(db: Db, now: Date): Promise<DonorSummary> {
	// when each donor's money first moved. the joins are inner and the `where` is the settled test,
	// so a contact whose gifts have all failed, or are all still pending, matches no row here and
	// is counted nowhere below.
	const arrived = db
		.select({
			contactId: donation.contactId,
			firstAt: sql<number>`min(${payment.occurredAt})`.as('first_at')
		})
		.from(payment)
		.innerJoin(donation, eq(donation.id, payment.donationId))
		.innerJoin(contact, eq(contact.id, donation.contactId))
		.where(
			and(
				eq(payment.direction, 'inbound'),
				eq(payment.status, 'succeeded'),
				isNull(contact.archivedAt)
			)
		)
		.groupBy(donation.contactId)
		.as('arrived');

	const month = sql<string>`strftime('%Y-%m', ${arrived.firstAt} / 1000, 'unixepoch')`;
	const rows = await db
		.select({ month: month.as('month'), donors: count() })
		.from(arrived)
		.groupBy(month);

	return overMonths(
		rows.map((row) => ({ month: row.month, total: row.donors })),
		now
	);
}

/**
 * a `contact` row with its `id` already minted — the shape `newContactRow` returns.
 *
 * `NewContact['id']` is optional, because the column carries a `$defaultFn`. that is
 * exactly what this type exists to remove: the whole point of minting the id up here is
 * that a caller can read it before the row is written, and an optional `id` puts a `!` or a
 * null check at every one of those call sites.
 */
export type NewContactRow = NewContact & { readonly id: string };

/**
 * a `contact` row, id and all, without writing it — the statement-shaped half of
 * `createContact`.
 *
 * it mints the UUIDv7 app-side, and that is the whole reason it is split out. `id` has a
 * `$defaultFn`, so drizzle would supply one at insert time — but a caller that needs to
 * write `donation.contact_id` in the same `batch()` needs the id while it is still building
 * statements, and `.returning()` cannot answer that: reading it back is a second round
 * trip, and a second round trip is a second commit. `Db` has no `transaction` (D1 has
 * none), so one `batch()` is the only atomic unit there is, and the inline "new donor" path
 * on a donation form — contact, donation, its line items, its payment and its ledger lines
 * — has to fit in it or a donor can exist with no gift and nothing detects it.
 *
 * ../ledger/posting.ts is the precedent and argues it at length: `post()` resolves rows and
 * hands them up, `postingStatements()` turns them into statements, and neither calls
 * `batch()`. this is the same split one table over — `contactInsertStatement` below is this
 * file's `postingStatements`, and `createContact` is the thin caller for the single-row
 * case, which is what the /admin create form is.
 *
 * takes a `ParsedContact` rather than raw form values so that the `display_name` promise —
 * always populated, so no list view branches on kind — cannot be bypassed by a caller that
 * skipped `parseContact`. that is a type-level fact rather than a review item: the type is
 * branded, so a hand-built object literal of the same shape is a compile error here and
 * `parseContact` is the only thing that mints one.
 *
 * `created_at` and `updated_at` are still left to the column defaults — they are system
 * time, so they belong to the write rather than to this function, the same line `post()`
 * draws on `entry_group.created_at`. only `id` is hoisted, and only because a caller needs
 * to name it.
 *
 * the mapping stays singular: one field per column, spelled out. a spread of `input` would
 * be shorter and would carry the brand's phantom property into the values object, and it is
 * what makes a later field on `ParsedContact` reach a column nobody decided to store.
 *
 * `consented` is a second argument rather than a field on `ParsedContact` because it is not one:
 * the parser answers for the values a person typed into a contact, and the consent answer belongs
 * to the moment the donor was asked. it is required, and `null` is the value for a caller that
 * never asked — the /admin create form, which has no such field on it. that null is the whole
 * reason the column is nullable (../db/schema.ts): never asked and declined are different facts,
 * and defaulting one to the other is what a consent record exists to prevent.
 */
export function newContactRow(input: ParsedContact, consented: boolean | null): NewContactRow {
	return {
		id: uuidv7(),
		kind: input.kind,
		displayName: input.displayName,
		firstName: input.firstName,
		lastName: input.lastName,
		legalName: input.legalName,
		primaryEmail: input.primaryEmail,
		primaryPhone: input.primaryPhone,
		consentedToContact: consented
	};
}

/**
 * the insert for a row `newContactRow` built, unexecuted — for splicing into the caller's
 * single `batch()`:
 *
 *   const donor = newContactRow(parsed, consented);
 *   await db.batch([contactInsertStatement(db, donor), donationStmt, ...postingStatements(db, posting)]);
 *
 * it is the twin of `postingStatements(db, posting)` in ../ledger/posting.ts, and it exists
 * for the reason that one does: the table object stays inside the module that owns the table.
 * a caller that built `db.insert(contact)` itself would have to import `contact` from
 * ../db/schema, which is the import this file exists to make unnecessary.
 *
 * `.returning()` is left to the caller rather than baked in. inside a `batch()` it works and
 * costs nothing, but a caller splicing five statements together usually already holds the row
 * it passed in — `newContactRow` handed it over, id and all — so reading it back is a result
 * to destructure for no new information. `createContact` is the one caller that does want it.
 *
 * the `satisfies` is the return type, deliberately not the annotation. the contract is
 * `BatchItem<'sqlite'>` — that is what `db.batch()` accepts and what `postingStatements`
 * declares — but annotating it would erase `.returning()`, forcing the single-row path below
 * into a second round trip to read back a row it just wrote. `satisfies` compiles the
 * contract without narrowing what comes out.
 */
export function contactInsertStatement(db: Db, row: NewContactRow) {
	const statement = db.insert(contact).values(row);
	statement satisfies BatchItem<'sqlite'>;
	return statement;
}

/**
 * the consent answer a donor just gave, over the one they gave before — unexecuted, for the same
 * `batch()` that writes the gift it arrived with.
 *
 * a returning donor is matched to the contact row they already have, so an answer written only on
 * insert would be the first one they ever gave and every later one would be discarded. true -> false
 * is a withdrawal and false -> true is a grant; a consent record that holds neither is worse than
 * one that was never kept, because it reads as an answer.
 *
 * it names the row by id, so it is not the read-then-write CLAUDE.md bans: the caller has already
 * resolved which contact this is, and no value read inside the write decides what is written.
 *
 * `updated_at` moves with it, from the column's own `$onUpdateFn` rather than from anything here.
 * this is a write to the row and system time is what that column records; holding it still would
 * mean writing the old value back over drizzle's, which is a claim that nothing changed.
 *
 * it takes a boolean and never null: absent is the state of a contact nobody asked, and no path
 * that reaches this function is one — the gift carries a required answer. a caller that would pass
 * null wants no statement at all.
 */
export function contactConsentUpdateStatement(db: Db, id: string, consented: boolean) {
	const statement = db
		.update(contact)
		.set({ consentedToContact: consented })
		.where(eq(contact.id, id));
	statement satisfies BatchItem<'sqlite'>;
	return statement;
}

/**
 * writes one contact on its own and returns the stored row — the /admin create form's path,
 * where there is nothing to be atomic with.
 *
 * a write that must land atomically with a row in another table may not use this; it calls
 * `newContactRow` and splices `contactInsertStatement(db, row)` into the one `batch()` that
 * owns the whole write. see the header of this file, and `newContactRow` above.
 *
 * no duplicate-email check, and that is a decision rather than an omission: two people in
 * one household share an address, an organization's address is often a staff member's, and
 * there is no `UNIQUE` index on `primary_email` for exactly that reason.
 * `findContactByEmail` below exists to *offer* a match, never to enforce absence.
 */
export async function createContact(db: Db, input: ParsedContact): Promise<Contact> {
	// the pair, used as the header describes: build the row, then the statement. it executes
	// that statement directly rather than through `batch()` because there is nothing here to
	// be atomic with — one statement in a `batch()` is one commit either way.
	//
	// `null` for the consent answer, and it is stated rather than defaulted: this form does not ask
	// the question, so the row it writes must not answer it.
	const [row] = await contactInsertStatement(db, newContactRow(input, null)).returning();

	if (!row) {
		// unreachable: an insert that affected no rows would have thrown. it is here because
		// `noUncheckedIndexedAccess` makes the possibility explicit, and a thrown message
		// naming the table beats a `TypeError` on a destructured undefined.
		throw new Error('inserting into `contact` returned no row');
	}
	return row;
}

/**
 * the one contact whose primary email matches, case-insensitively, or `null`.
 *
 * `lower(primary_email) = lower(?)` is the required shape, not a nicety — see the note on
 * the column in schema.ts. the only index on this column is the functional
 * `lower(primary_email)` one, so `eq(contact.primaryEmail, x)` cannot use it and is a full
 * scan; it is also the wrong semantics, because donors retype their address in whatever
 * case they please.
 *
 * `limit(1)` with no ordering because there is no uniqueness to rely on (see
 * `createContact`): this answers "is there a contact with this address", which is what a
 * donation-entry form asks before offering to reuse one. a caller that needs *all* matches
 * should add a function rather than widen this one.
 */
export async function findContactByEmail(db: Db, email: string): Promise<Contact | null> {
	const normalized = email.trim();
	if (normalized.length === 0) return null;

	const [row] = await db
		.select()
		.from(contact)
		.where(
			and(sql`lower(${contact.primaryEmail}) = lower(${normalized})`, isNull(contact.archivedAt))
		)
		.limit(1);

	return row ?? null;
}

/**
 * the display name of each of these contacts, keyed by id — for a list of rows that name a donor
 * without being about donors.
 *
 * it exists so that a gifts list can say who gave, without the `contact` table object leaving this
 * module. a join written in `../donations/queries.ts` would read the same rows and be the same
 * mistake `contactInsertStatement` exists to prevent one table over: the next reader looking for
 * every place `contact` is touched would have to already know to look there. the cost is one more
 * read, which is one more of the fifty a Worker invocation gets on the free tier.
 *
 * `ids` is bound one parameter per id and D1 caps a query at 100 of them, so a caller passes a page
 * of ids and never a table's worth. the page limits in this app are set well under that — see
 * `DONATION_LIST_LIMIT` in ../donations/queries.ts, which states the coupling from the other end.
 *
 * an empty list is answered without a query. `in ()` is not the neutral condition it looks like,
 * and a read of every contact in the file is the wrong way to find that out.
 *
 * archived contacts are included, unlike `listContacts`. a soft delete hides a donor from the donor
 * file; it does not unmake the gifts they gave, and a gift row whose donor column read `—` would be
 * one nobody can attribute.
 */
export async function readContactNames(
	db: Db,
	ids: readonly string[]
): Promise<Map<string, string>> {
	if (ids.length === 0) return new Map();

	const rows = await db
		.select({ id: contact.id, displayName: contact.displayName })
		.from(contact)
		.where(inArray(contact.id, [...ids]));

	return new Map(rows.map((row) => [row.id, row.displayName]));
}

/**
 * the two things another module's rows need about the donor they name: what to call them, and how
 * to reach them.
 *
 * beside `readContactNames` rather than replacing it, and the difference is a column reaching a
 * browser. the gifts list names a donor and nothing more, so widening the read above would put
 * `primary_email` into a page that renders no email — and a column reaches a browser by being
 * selected, which is the rule the projection in ../donations/queries.ts exists to keep. two reads
 * that each say what their caller needs is the shape that keeps that true as a third caller
 * arrives.
 *
 * every rule the names read is under holds here too, for the same reasons stated there: an empty
 * list is answered without a query, `ids` is one bound parameter each against D1's cap of 100, and
 * archived contacts are included — a soft delete hides a donor from the donor file and does not
 * unmake the commitment they made.
 *
 * `primaryEmail` is `null` for a donor nobody has an address for, and that is a state /admin draws
 * rather than one it filters: a recurring gift is reachable through the deployment's own records
 * whether or not anybody can email the person who made it.
 */
export type ContactSummary = Pick<Contact, 'displayName' | 'primaryEmail'>;

export async function readContactSummaries(
	db: Db,
	ids: readonly string[]
): Promise<Map<string, ContactSummary>> {
	if (ids.length === 0) return new Map();

	const rows = await db
		.select({
			id: contact.id,
			displayName: contact.displayName,
			primaryEmail: contact.primaryEmail
		})
		.from(contact)
		.where(inArray(contact.id, [...ids]));

	return new Map(rows.map(({ id, ...summary }) => [id, summary]));
}

/** one contact by id, or `null` — the donor-profile lookup. archived rows included. */
export async function findContactById(db: Db, id: string): Promise<Contact | null> {
	const [row] = await db.select().from(contact).where(eq(contact.id, id)).limit(1);
	return row ?? null;
}
