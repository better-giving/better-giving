import { sql } from 'drizzle-orm';
import {
	check,
	foreignKey,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { uuidv7 } from 'uuidv7';
import { ACCOUNT_TYPES, type AccountType } from '../../accounts/types';
import { CONTACT_KINDS, type ContactKind } from '../../contacts/kinds';
// type-only, so there is no runtime edge at all — and packages/form/src/v1.ts imports nothing, by
// its own permanent rule, so no back-edge into this file is possible either. see
// `RECURRING_INTERVALS`, which is the wire's frequency vocabulary minus `one_time`.
import type { Frequency } from '@better-giving/form/v1';
import { PROGRAM_MODES, type ProgramMode } from '../../forms/program-modes';
import { FORM_STATUSES, type FormStatus } from '../../forms/statuses';
import { PROGRAM_STATUSES, type ProgramStatus } from '../../programs/statuses';
import { RECURRING_PLAN_STATUSES, type RecurringPlanStatus } from '../../recurring/statuses';
import type { PostableAccountId } from './postable';

// one dialect (sqlite) and one driver behind it, and nothing here may reference D1 — see
// ./client.ts, the only module that names it, which is where the transaction ban and the
// `batch()` contract are stated once instead of at every call site. there is no second
// driver, no container path and no self-host target: the write path is D1's `batch()` and
// the absence of an interactive transaction is designed around rather than worked around,
// so adding another store is a second implementation of the ledger's write path rather than
// a driver swap.
//
// model the domain past what the UI renders. a table is shaped for what it holds, never cut
// down to the columns a first screen writes.
//
// encodings fixed project-wide:
//   money  -> integer minor units, unit in the column name (`total_minor`). never
//             numeric/real: NUMERIC affinity silently stores a non-integer as float64,
//             and a ledger whose entry groups must sum to exactly zero cannot survive
//             that.
//   ccy    -> every amount is reachable to exactly one currency — either a `currency`
//             text on its own row, or on the row that contains it. not "a currency on
//             every money-bearing row", which is a stricter claim than this schema makes:
//             `ledger_entry.amount_minor` reads its `entry_group`'s, because an
//             entry mixing currencies cannot sum to zero and so has nowhere to put a
//             second one; `line_item` reads its `donation`'s for the same reason (see
//             the carve-out on that table). where the column does exist it carries
//             `currencyCheck` below — sqlite has no CHAR(3), so unconstrained text
//             accepts anything, and 'usd' vs 'usd' is two currencies that sum apart
//             while every row reads clean.
//             `payment` is the deliberate exception to reading "one currency per amount"
//             as "one currency per gift": `payment.currency` is the settlement currency
//             and may legitimately differ from its `donation.currency`, because a rail can
//             settle in a currency other than the one pledged. that is modelling past the
//             UI on purpose — v0 assumes a single org currency and will write the same
//             three letters on both rows — and it is why there is no check, and could not
//             be one: "equals my donation's currency" is cross-row. `line_item` still gets
//             no currency column of its own; see the carve-out on that table, which is a
//             different claim.
//   time   -> integer unix milliseconds UTC on every `_at` column. `created_at` is
//             system time; ledger/settlement rows additionally carry `occurred_at`
//             (business time). never text ISO-8601.
//   ids    -> text uuidv7 generated app-side by the `id()` helper below, with one
//             exception: `form.id` is a prefixed random string, for the reasons on the
//             `formId` helper. sqlite has
//             no gen_random_uuid(), so generation is ours either way; v7 is
//             time-ordered, which keeps index locality on the append-only tables.
//             text(36), not blob(16) — legibility beats index size at nonprofit scale.
//   enums  -> check constraints derived from the TS const array (see `enumCheck`),
//             never option tables and never a hand-typed second copy of the list.
//             most of those arrays are declared inline below, which is correct and
//             stays. one moves out only under this test: this file imports only from
//             leaves, and nothing it imports may import it back — so a vocabulary moves
//             to a leaf the moment a module this file itself needs to import from needs
//             it. a consumer that only reads downstream from here is not a reason.
//             `ACCOUNT_TYPES` failed the test — ./accounts.ts, which mints the
//             `PostableAccountId` this file stamps, needed it — and lives in
//             ../../accounts/types.ts. `CONTACT_KINDS` moved for a different reason
//             (client reach; see ../../contacts/kinds.ts), and `FORM_STATUSES`,
//             `PROGRAM_STATUSES` and `PROGRAM_MODES` moved for that same reason (see
//             ../../forms/statuses.ts, ../../programs/statuses.ts and
//             ../../forms/program-modes.ts): a component renders the words and cannot
//             import from `$lib/server/**` at all. this list is every vocabulary that has
//             left, and a move not added to it makes it read as complete while
//             under-reporting.
//             one vocabulary is not derived into a check at all: `donation.tribute_kind`,
//             which arrived by `ADD COLUMN` on a table with children, where a check is
//             the rebuild rule 2 below describes. `TRIBUTE_KINDS` is the donation form's
//             own — `@better-giving/form/v1` — and is not imported here: the parse
//             boundaries are the whole of the constraint, and the column says so at its
//             own site.
//   rates  -> integer scaled by 1e8 (`_e8`), never float. rates are not money.
//   extend -> a JSON column plus a typed registry, never a new column. D1 caps a
//             table at 100 columns and no org action may consume one: no mechanism may
//             let an org add a column, so crossing that limit takes a migration under
//             review and can never be reached by anything an operator does on a screen.
// single-tenant: no org_id, no tenancy column, no row-level security and no tenancy seam,
// anywhere in this schema or in the query layer over it.
//
// ---------------------------------------------------------------------------
// four rules for anyone editing this file. all four are about `drizzle-kit
// generate`, whose output is a draft, not a reviewed migration. read every generated
// .sql before committing it.
//
// 1. append new columns after `archived_at`. never reorder.
//    a column added at the end becomes a plain `ALTER TABLE ... ADD COLUMN`. a
//    column inserted anywhere else — including the natural-looking spot just before
//    `created_at` — makes drizzle-kit emit the create-copy-drop-rename table
//    rebuild, and its copy step is
//        INSERT into __new_account(...,"sort_key") SELECT ...,"sort_key" from account
//    where `"sort_key"` does not exist on the old table. D1 has sqlite's
//    double-quoted-string-literal fallback enabled, so this does not error: every
//    row silently gets the text 'sort_key'.
//
// 2. if a generated migration rebuilds a table, hand-edit its pragmas.
//    drizzle-kit wraps a rebuild in `PRAGMA foreign_keys=OFF` / `=ON`. sqlite documents
//    that pragma as a no-op inside a transaction, and the whole migration runs in one —
//    which is the mechanism, not "D1 ignores it". (the no-op is itself the evidence a
//    migration file is wrapped in a transaction.) so the rebuild's
//    `DROP TABLE account` fails with FOREIGN KEY constraint failed. two ways in: a
//    separate child table holding rows that point at the dropped table, and — the one
//    live today — the self-reference, which fails specifically because drizzle renders
//    the new table's FK as `REFERENCES account(id)`, i.e. the table it is about to
//    drop, leaving the copied 4110/4120 rows pointing at it. (a rebuild whose FK
//    targeted `__new_account` instead would survive; drizzle does not emit that.)
//    so this is live today, not a future problem. it aborts
//    atomically, but it is the migration step of `deploy` that fails and `wrangler deploy`
//    runs behind it, so a fork that hits it cannot deploy at all. replace the emitted pair with
//        PRAGMA defer_foreign_keys=true;  ...rebuild...  PRAGMA defer_foreign_keys=false;
//    which D1 honours, and which defers enforcement to commit instead of disabling it.
//    two caveats on the replacement. it resets at every commit, so it covers one
//    transaction and must be re-set if a rebuild is ever split across files. and
//    `ON DELETE CASCADE` is never deferrable — a cascade is an action, not a violation,
//    so it fires during the rebuild's implicit delete, empties the child table, and then
//    passes the commit-time check because the orphans it would have caught are gone.
//    that is why exactly one FK in this schema carries a cascade —
//    `auth_session.user_id -> auth_user.id`, argued at its own declaration in
//    ./auth-schema.ts — and no other may: a session is worthless without its user and no
//    accounting record hangs off either table, so a silently fired cascade there costs a
//    logged-out admin rather than books nobody can reconcile. every domain FK is
//    `NO ACTION`, and `strict.workers.spec.ts` reads `pragma_foreign_key_list` over every
//    table and fails on a second.
//    this is why every constraint on `account` below landed in the first migration:
//    adding one afterwards is this path.
//
// 3. every table is `STRICT`, and the keyword is hand-patched into the SQL.
//    drizzle-kit has no `STRICT` concept — this file cannot ask for it, and the
//    snapshots in migrations/meta/ cannot record it — so the keyword lives only in the
//    generated `.sql`, appended by hand as `) STRICT;`. do that to every CREATE TABLE
//    that reaches migrations/, whatever wrote it — generated, hand-written, the
//    `IF NOT EXISTS` form, and the `CREATE TABLE __new_<table>` inside rule 2's rebuild,
//    which is the one that goes missing with nobody having typed anything. it is what
//    turns `integer` from an affinity into a constraint: without it a real that does not
//    round-trip stores as float64 in an `integer` column and every SELECT still reads
//    clean, which is exactly how an entry group sums to something other than zero with
//    no wrong-looking row in it.
//    the trap is that drizzle cannot see the keyword either, so it reports no drift
//    with or without it — and rule 2's rebuild recreates the table from the snapshot,
//    i.e. without `STRICT`, silently. `strict.workers.spec.ts` reads
//    `pragma_table_list` after
//    applying every migration and fails on any table that lost it; that spec is the
//    only thing standing between a generated rebuild and a schema that quietly stopped
//    enforcing its own encodings, and it gets its chance in lefthook.yml's pre-commit
//    hook — the rebuild is caught before it is even committed, let alone deployed, which
//    matters because putting the keyword back afterwards needs a rebuild of its own, on
//    a table D1 will not let you drop, so it is there at birth or never.
//    `STRICT` does not subsume a check (see `boolCheck` below — STRICT INTEGER takes
//    `2`, and takes numeric text), so never drop one for it.
//
// 4. a rebuild re-emits a functional index backticked, and it will not run.
//    rule 2's rebuild drops the table's indexes with it and recreates them at the end,
//    but it renders an expression index by quoting the whole expression as a name:
//        CREATE INDEX ... ON `contact` (`lower("primary_email")`)
//    backticks make that an identifier, so sqlite looks for a column called
//    `lower("primary_email")` and fails with `no such column`. the original migration
//    wrote the same index unquoted and worked; only the rebuild path re-renders it.
//    strip the outer backticks. this one is not silent — it errors — but it errors
//    inside `deploy`'s `wrangler d1 migrations apply DB --remote`, and nothing upstream
//    of that reads the emitted SQL: lint, check and the suite all ran at commit time and
//    `build` ran first without looking at migrations/ at all. so the deploy dies at the
//    one-way door with no gate having had a chance. `contact_primary_email_lower_idx`
//    is the only functional index today; every future one inherits this.
// ---------------------------------------------------------------------------

/** primary-key column shared by every table: text uuidv7, generated app-side. */
const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => uuidv7());

/**
 * crockford's base32 minus `i`/`l`/`o`/`u` — no glyph pair a human can confuse when a
 * form id is read off a screen or dictated, and no accidental words. 32 symbols divides
 * 256 exactly, so masking a random byte to 5 bits stays uniform.
 */
const FORM_ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/**
 * `form.id` — the one primary key in this schema that is not a uuidv7, because it is
 * the one that is public: it sits in the org's own HTML, inside the embed snippet, and
 * is quoted back by an unauthenticated `/api/v1` request.
 *
 * a uuidv7 would leak its creation time and, worse, place every form a deployment ever
 * made in one narrow, ordered keyspace — the property that makes v7 good for index
 * locality is exactly what makes it guessable here. 16 random bytes -> 16 symbols is 80
 * bits, unenumerable by construction.
 *
 * `crypto.getRandomValues` and not `Math.random`: both workerd and node 22 have it, and
 * this is the only id in the schema whose unguessability is a security property rather
 * than a convenience. the prefix is not constrained in the database — see
 * `form_id_length_check` below for why.
 */
const formId = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => {
			const bytes = crypto.getRandomValues(new Uint8Array(16));
			let out = 'frm_';
			for (const b of bytes) out += FORM_ID_ALPHABET[b & 31];
			return out;
		});

/** ms-precision unix timestamp; drizzle surfaces it to TS as a `Date`. */
const at = (name: string) => integer(name, { mode: 'timestamp_ms' });

/** system time of insert. defaulted here so it is not a rule with N call sites. */
const createdAt = () =>
	at('created_at')
		.notNull()
		.$defaultFn(() => new Date());

/**
 * system time of last write. `$onUpdateFn` is what keeps it honest — without it
 * `db.update(x).set({ ... })` compiles fine and leaves this at the insert value
 * forever.
 */
const updatedAt = () =>
	at('updated_at')
		.notNull()
		.$defaultFn(() => new Date())
		.$onUpdateFn(() => new Date());

/**
 * check body for a closed enum, derived from the TS const array so a new member
 * cannot update the union while leaving the constraint behind — which would compile
 * and then be rejected by the database at runtime.
 *
 * `sql.raw` is safe here and only here: every input is a literal from this module's
 * own `as const` arrays, never a value off a request.
 */
const enumCheck = (col: SQLiteColumn, values: readonly string[]) =>
	sql`${col} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;

/**
 * `integer({ mode: 'boolean' })` is an affinity, not a constraint: `2` and `'yes'`
 * both insert, and drizzle maps them back with `Number(value) === 1`, so both surface
 * in TS as `false`. a deductible account would silently become non-deductible and
 * receipts would understate. `STRICT` would not catch this either — STRICT INTEGER
 * accepts 2 happily — so the check is the only thing that does.
 */
const boolCheck = (col: SQLiteColumn) => sql`${col} in (0, 1)`;

/**
 * check body for a text column that must carry an actual value. `notNull` alone does
 * not say that — `''` satisfies it — and `STRICT` says nothing about content, only
 * type: a blank string is a well-typed text.
 *
 * `trim(x, char(...))` rather than the one-argument `trim(x)`, which strips only
 * U+0020: a lone tab or newline would clear the one-argument form and still render as
 * an empty cell. `char()` is deterministic, so sqlite permits it in a check.
 *
 * the set is the five ASCII whitespace codepoints plus NBSP, and every one of them was
 * verified to insert past the narrower `char(32, 9, 10, 13)`:
 *   32  space   9 tab   10 LF   13 CR   — the ASCII four
 *   11  VT      12 FF                   — a lone `char(11)` satisfies that narrower set
 *   160 NBSP                            — the one that matters
 * NBSP is what a paste out of Word or a `&nbsp;` in a copied cell produces, so a form
 * named a single U+00A0 renders blank on every screen with the constraint satisfied and
 * no row looking wrong. that is the same silent-divergence class `STRICT` and the
 * uppercase half of `currencyCheck` exist for, which is why it is worth six extra bytes.
 *
 * still not as wide as JS `.trim()`, which is fully unicode-aware — U+2028/U+2029, the
 * U+2000..U+200A quad block, U+3000. those are not reachable by a paste from a word
 * processor, the parser is the layer that gets the full set right, and widening this one
 * later costs a table rebuild (rule 2 above) — which is the same reason it is not left at
 * the narrower form either. add to the tail of the list if a real value ever gets past.
 */
const notBlank = (col: SQLiteColumn) => sql`trim(${col}, char(32, 9, 10, 11, 12, 13, 160)) <> ''`;

/**
 * `notBlank` for a nullable column, where null means "not stated" and `''` means
 * "stated as nothing" — only the second is the bug.
 *
 * the `is null` disjunct is documentation, not logic: a check is satisfied by anything
 * that is not false, `trim(null, ...) <> ''` evaluates to null, and a null therefore
 * already passes `notBlank` on its own. it is written out because the constraint is
 * read far from the column definition and "may this be absent?" is the first question
 * asked of it — the same reason `account_tax_rate_e8_check` spells its own out.
 */
const optionalNotBlank = (col: SQLiteColumn) => sql`${col} is null or ${notBlank(col)}`;

/**
 * check body for a currency column: three ASCII letters, uppercase.
 *
 * one helper rather than a literal per table, because the whole value of the constraint
 * is that every currency column agrees byte for byte. a form that accepts Stripe's
 * lowercase `usd` while `entry_group` rejects it does not fail loudly — it splits the
 * books into 'usd' and 'usd', which group and sum separately with every row reading
 * clean. the full rationale sits on `entry_group_currency_check` below, the first call
 * site; widening any of these later is the table rebuild that rule 2 describes, so they
 * are stricter than the documented `length = 3` on purpose.
 *
 * the `glob` term is what makes it a currency rather than three bytes. without it,
 * `length = 3 and x = upper(x)` admits `'123'` — verified: it inserts —
 * along with `'$$$'`, `'   '` and `'ÉUR'`, because sqlite's `upper()` is ASCII-only and
 * leaves every non-ASCII codepoint alone, so an accented or Cyrillic string equals its own
 * `upper()`. an ISO-4217 code is three letters and nothing else, and a `'123'` in a
 * currency column is a books-wide split exactly like `'usd'` is.
 *
 * `glob` and not `like`: `like` is case-insensitive for ASCII by default, so
 * `like '[A-Z][A-Z][A-Z]'` would both accept 'usd' and treat the brackets as literals.
 * glob ranges are over codepoints, which is what excludes 'ÉUR' (U+00C9 sorts above 'Z').
 *
 * the glob subsumes the other two terms — three bracket atoms is a length and `A-Z` is
 * uppercase-ASCII. they stay because each names one property the column has, this check is
 * read far from the column, and dropping a term from a check is the table rebuild rule 2
 * describes rather than an edit.
 */
const currencyCheck = (col: SQLiteColumn) =>
	sql`length(${col}) = 3 and ${col} = upper(${col}) and ${col} glob '[A-Z][A-Z][A-Z]'`;

/**
 * check body for a JSON column holding a top-level array. `json_valid` first: without
 * it 'not json at all' inserts fine and the failure surfaces as a parse throw at read
 * time, far from the writer. the `json_type` half is what excludes an object, a bare
 * number, and JSON `null` — all of which are valid JSON and none of which a caller
 * expecting a list can iterate.
 */
const jsonArray = (col: SQLiteColumn) => sql`json_valid(${col}) and json_type(${col}) = 'array'`;

/**
 * check body for a JSON column holding a top-level object. same reasoning as
 * `jsonArray`; `contact_attributes_object_check` is the precedent.
 */
const jsonObject = (col: SQLiteColumn) => sql`json_valid(${col}) and json_type(${col}) = 'object'`;

// the kind vocabulary is shared with the pages that render it — see the note in
// ../../contacts/kinds.ts. the check below is still derived from that same array, so a
// value the union admits is one the database accepts by construction.

/**
 * the hub every other record points at — donors, employers, funds' counterparties,
 * households. modelled past what v0 renders: `kind` already admits organizations
 * and households so a matching-gift employer or a joint household does not need a
 * migration later.
 */
export const contact = sqliteTable(
	'contact',
	{
		id: id(),
		kind: text('kind').$type<ContactKind>().notNull(),

		// denormalized and always populated, so a list view never has to branch on kind.
		displayName: text('display_name').notNull(),

		// individuals
		firstName: text('first_name'),
		lastName: text('last_name'),
		// organizations
		legalName: text('legal_name'),

		/**
		 * denormalized primary. multi-value child tables (contact_email, contact_phone,
		 * contact_address) are a later commit; this stays the primary once they exist.
		 *
		 * look it up as `where lower(primary_email) = lower(?)`, never
		 * `eq(contact.primaryEmail, x)`. only the functional index exists, so a plain
		 * equality predicate is a full table scan — and it is the wrong semantics for
		 * dedupe anyway, since donors retype their address in any case. there is
		 * deliberately no second plain index: at nonprofit scale the scan is
		 * irrelevant and a duplicate index only costs writes.
		 */
		primaryEmail: text('primary_email'),
		primaryPhone: text('primary_phone'),

		// replaces per-org custom fields. a typed registry layers over this later;
		// the column itself is what keeps orgs from ever adding a column. the TS type
		// stays `string` on purpose — parsing belongs to the registry, not the driver.
		attributes: text('attributes').notNull().default('{}'),

		createdAt: createdAt(),
		updatedAt: updatedAt(),
		// soft delete. a donor with financial history is never hard-deleted.
		archivedAt: at('archived_at'),
		// append new columns below this line — see rule 1 at the top of this file.

		/**
		 * the donor's own answer about being written to.
		 *
		 * nullable, and the null is the whole point: never asked has to stay distinguishable from
		 * said no, because that is the distinction a consent record exists to make. an org mailing
		 * everyone it holds needs to know which of the two a row is, and a column defaulting to `0`
		 * would answer "declined" for every contact staff typed in — /admin's create form asks
		 * nothing about consent, so it writes null here and means it.
		 *
		 * it holds the most recent explicit answer rather than the first. a returning donor's gift
		 * carries a fresh one — `QuoteRequest.consentedToContact` in packages/form/src/v1.ts is required —
		 * and true -> false is a withdrawal, so an answer written only on insert would discard it.
		 * ../contacts/queries.ts is where both writes live.
		 *
		 * nullable and checked, which is not a contradiction: a sqlite CHECK fails only on a false
		 * result, and `NULL in (0, 1)` is NULL. so `contact_consented_to_contact_bool_check` below
		 * refuses a `2` without making an answer required.
		 */
		consentedToContact: integer('consented_to_contact', { mode: 'boolean' })
	},
	(t) => [
		check('contact_kind_check', enumCheck(t.kind, CONTACT_KINDS)),
		/**
		 * `notNull` does not keep the "always populated" promise the column comment above
		 * makes: `''` satisfies NOT NULL, and `STRICT` does not help either — it
		 * constrains a value's type, and a blank string is a well-typed text. without
		 * this a list view renders a nameless row and the operator has no handle on the
		 * contact at all. `contacts/contact-input.ts` derives the value and refuses a
		 * blank today, but that is an application promise on a column the schema claims
		 * unconditionally.
		 */
		check('contact_display_name_not_blank_check', notBlank(t.displayName)),
		// without this, 'not json at all' inserts fine and the failure surfaces as a
		// parse throw at read time, far from the writer. the registry assumes an
		// object, so [] / 3 / null are excluded too.
		check('contact_attributes_object_check', jsonObject(t.attributes)),
		/**
		 * what a missing bool check costs is stated at `boolCheck` above, and it costs more here
		 * than anywhere: a `2` stores and reads back as `false`, i.e. as a refusal the donor never
		 * gave, on the one column in this schema that exists to record what they said.
		 * `./consent-check.workers.spec.ts` reads the constraint back off the migrated database
		 * rather than off this line.
		 *
		 * it permits NULL as well as 0 and 1, which is the column comment's third state and not
		 * an oversight — see there.
		 */
		check('contact_consented_to_contact_bool_check', boolCheck(t.consentedToContact)),
		// case-insensitive email lookup — the dedupe path. lower() is deterministic,
		// so sqlite permits it in an index.
		index('contact_primary_email_lower_idx').on(sql`lower(${t.primaryEmail})`),
		index('contact_last_name_idx').on(t.lastName)
	]
);

// the account `type` vocabulary lives in a leaf ../../accounts/types.ts, which imports
// nothing — see the note there for why. the check below is still derived from that same
// array, so a value the union admits is one the database accepts by construction.

/**
 * the chart of accounts — the substrate every ledger entry posts against.
 *
 * rows are seeded by `migrations/0000_initial_schema.sql` with fixed ids identical in every
 * deployment; `src/lib/server/db/accounts.ts` is the only place app code names one,
 * and `accounts.workers.spec.ts` is what stops the two from drifting. `code` is the stable
 * business key, `id` is the foreign-key target.
 */
export const account = sqliteTable(
	'account',
	{
		id: id(),
		code: text('code').notNull(),
		name: text('name').notNull(),
		type: text('type').$type<AccountType>().notNull(),

		// receipting: which side of a quid-pro-quo gift this account carries.
		isDeductible: integer('is_deductible', { mode: 'boolean' }).notNull().default(false),
		// sales/VAT accounts, so tax is reported separately from contributed revenue.
		isTax: integer('is_tax', { mode: 'boolean' }).notNull().default(false),
		/**
		 * false only on reporting rollups. one ledger entry naming a rollup makes every
		 * report over that subtree double-count, with no error anywhere — so the flag
		 * lives in the database, and `PostableAccountId` in ./postable.ts makes the
		 * rollup unrepresentable in the posting call rather than merely discouraged.
		 */
		isPostable: integer('is_postable', { mode: 'boolean' }).notNull().default(true),
		// rate x 1e8 — 8_250_000 is 8.25%. null on every non-tax account, and null on
		// tax accounts until the org sets its jurisdiction's rate.
		taxRateE8: integer('tax_rate_e8'),

		// self-referencing chart hierarchy. no cascade: an account with ledger entries
		// under it must never disappear because a parent was removed.
		parentId: text('parent_id').references((): AnySQLiteColumn => account.id),

		createdAt: createdAt(),
		updatedAt: updatedAt(),
		// an account that has ever been posted to is archived, never deleted.
		archivedAt: at('archived_at')
		// append new columns below this line — see rule 1 at the top of this file.
	},
	(t) => [
		check('account_type_check', enumCheck(t.type, ACCOUNT_TYPES)),
		check('account_is_deductible_bool_check', boolCheck(t.isDeductible)),
		check('account_is_tax_bool_check', boolCheck(t.isTax)),
		check('account_is_postable_bool_check', boolCheck(t.isPostable)),
		// rates are integers scaled by 1e8, bounded at both ends: without the upper
		// bound 825000000 (825%) passes as readily as 8250000 (8.25%).
		check(
			'account_tax_rate_e8_check',
			sql`${t.taxRateE8} is null or (${t.taxRateE8} >= 0 and ${t.taxRateE8} <= 100000000)`
		),
		// self-parenting is the accident that actually happens (an admin form defaulting
		// parent to the current row), and it makes a recursive-CTE rollup never
		// terminate. longer cycles are cheap to detect app-side and not worth a trigger.
		check('account_parent_not_self_check', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
		uniqueIndex('account_code_idx').on(t.code),
		index('account_parent_id_idx').on(t.parentId),
		/**
		 * not a uniqueness rule — `id` is already the primary key, so this index constrains
		 * nothing new. it exists to be a FOREIGN KEY target: sqlite resolves a composite FK
		 * only against a parent UNIQUE index over exactly those columns. three tables point
		 * here — `ledger_entry(account_id, account_is_postable)`,
		 * `form(revenue_account_id, revenue_account_is_postable)` and
		 * `line_item(revenue_account_id, revenue_account_is_postable)` — which is what makes
		 * a rollup account unnameable by a posting, a form or a line; see the FK comments on
		 * those tables.
		 *
		 * it is created ahead of `ledger_entry`, the first table to point at it.
		 * that ordering is not cosmetic: sqlite resolves a composite FK against this index at
		 * DML time, not at CREATE TABLE, so an index living in a later migration file is
		 * legal on the way in and a `foreign key mismatch` on the first insert — the same
		 * "legal at create, explodes later" trap that kept `recurring_id` off `donation` until
		 * `recurring_plan` existed to point at.
		 *
		 * it also depends on `is_postable` being NOT NULL, which it is above — a nullable
		 * parent column breaks composite FK resolution — and that is the second reason this
		 * index is cheap while the shape it enables is not: `CREATE UNIQUE INDEX` is a
		 * plain statement, but changing `is_postable` would be a rebuild of `account`, and
		 * `4110`/`4120 -> 4100` already make that drop fail on D1.
		 */
		uniqueIndex('account_id_postable_idx').on(t.id, t.isPostable)
	]
);

/**
 * what a journal entry was posted *because of*. paired with `source_id` it is a polymorphic link,
 * which is what lets the ledger exist before `payment`/`donation`/`refund` do — no FK forces those
 * tables to arrive early, and the pair is what the idempotency constraint is built on.
 *
 * `adjustment` is the one member that links to nothing: a correction is posted by a human rather
 * than caused by a record, so its `source_id` is minted for it. the grain of all five is on
 * `entry_group_source_idx` below, which is the constraint it is part of.
 *
 * declared here rather than in a leaf, which is the default this file's `enums` rule states: no
 * module this file imports needs it, and no component renders it — nothing in /admin lists a
 * journal entry.
 */
export const ENTRY_SOURCE_TYPES = ['payment', 'donation', 'refund', 'fee', 'adjustment'] as const;
export type EntrySourceType = (typeof ENTRY_SOURCE_TYPES)[number];

/**
 * one row per journal entry — the thing that must balance.
 *
 * the header exists because `source_type`, `source_id`, `occurred_at`, `currency` and
 * `memo` are facts about the *entry*, not about a line. copied onto every line, two things
 * break at once: `UNIQUE (source_type, source_id)` is unbuildable, because every line of one
 * balanced gift carries the same pair, so the constraint would reject the second line of the
 * *first* gift rather than a redelivered webhook; and nothing stops two lines of one entry
 * disagreeing about `occurred_at`, which silently corrupts the bitemporal audit query. stored
 * once, both go away.
 *
 * bitemporal: `occurred_at` is when the money moved, `created_at` is when we wrote the
 * row. both, so a backdated gift can be posted without lying about when it was recorded
 * — "what did the books say on March 31?" is then answerable and provable.
 *
 * append-only, so no `updated_at` and no `archived_at`: a mistake is a compensating
 * entry, never an overwrite.
 */
export const entryGroup = sqliteTable(
	'entry_group',
	{
		id: id(),
		sourceType: text('source_type').$type<EntrySourceType>().notNull(),
		sourceId: text('source_id').notNull(),

		/**
		 * on the entry, not on the line — an entry mixing currencies cannot meaningfully
		 * sum to zero, so there is nowhere for a second currency to go.
		 */
		currency: text('currency').notNull(),

		/** business time: the accounting date. */
		occurredAt: at('occurred_at').notNull(),
		/** system time: when the row was written. */
		createdAt: createdAt(),
		memo: text('memo')
		// append new columns below this line — see rule 1 at the top of this file.
	},
	(t) => [
		check('entry_group_source_type_check', enumCheck(t.sourceType, ENTRY_SOURCE_TYPES)),
		/**
		 * length 3 *and* uppercase. sqlite has no CHAR(3), so without the first half any
		 * string is a currency; without the second half 'usd' and 'usd' are two currencies
		 * that group and sum separately while every row reads clean — the same class of
		 * silent divergence `STRICT` exists to stop. it is stricter than the documented
		 * `length = 3` on purpose: Stripe reports currency lowercase, so the alternative is
		 * a books-wide mixed-case split, and adding the constraint later needs the table
		 * rebuild that rule 2 above describes. `posting.ts` rejects it first, with a message.
		 *
		 * the body lives in `currencyCheck` above rather than here: `form`, `donation` and
		 * `payment` carry three more currency columns that have to agree with this one byte for
		 * byte, and a second copy of the literal is how they would stop agreeing.
		 */
		check('entry_group_currency_check', currencyCheck(t.currency)),
		// a blank source_id would satisfy the unique index exactly once and then collide
		// with every other blank one, i.e. it fails as a mysterious duplicate later.
		check('entry_group_source_id_not_empty_check', sql`length(${t.sourceId}) > 0`),
		/**
		 * where webhook idempotency actually lives. a redelivered Stripe event posts the
		 * same (source_type, source_id) and is rejected by the database — not by a
		 * read-then-write check, which `batch()` cannot do atomically anyway.
		 *
		 * ---------------------------------------------------------------------------
		 * what `source_id` holds, per `source_type`. this index is what makes the pair an
		 * idempotency key, so the grain is part of the constraint and not a call-site detail
		 * — a writer that picks the wrong one gets a rejection that reads exactly like the
		 * redelivery this is here to refuse. decided here and now, before the webhook handler
		 * exists to settle it by accident, the same way `payment_provider_txn_idx` below pins
		 * which id a refund row stores:
		 *
		 *   'donation'   -> `donation.id`. gift recognition, and the only one keyed on the gift:
		 *                   revenue is recognised exactly once per donation, so "once per
		 *                   donation" is the rule this enforces.
		 *   'payment'    -> `payment.id`. one settlement event, one posting. a gift settling in
		 *                   instalments is several `payment` rows and therefore several entries.
		 *   'refund'     -> `payment.id` — the refund's own row, never the donation it reverses.
		 *   'fee'        -> `payment.id` of the settlement the fee was deducted from.
		 *   'adjustment' -> a uuidv7 minted for the correction, one per correction, borrowed
		 *                   from nothing — not the payment, donation or entry being corrected.
		 *                   a hand-posted correction answers to no external event, so it has no
		 *                   natural key to be idempotent against, and two identical corrections
		 *                   posted deliberately must both land. any borrowed id makes the
		 *                   second one collide with the first and be refused as a redelivery.
		 *
		 * refunds are why this is written down. keying a refund on `donation.id` looks
		 * natural — the refund is "about" that gift — and it makes the second refund on one
		 * gift collide with the first and be refused as a redelivery. a partial refund
		 * followed by the rest of the gift is an ordinary sequence, so that loses a
		 * correction: silently, on a fork we cannot reach, on precisely the path CLAUDE.md
		 * says must be settled by a compensating entry rather than a rollback. `payment.id`
		 * is unique per refund and keeps every correction postable.
		 * ---------------------------------------------------------------------------
		 */
		uniqueIndex('entry_group_source_idx').on(t.sourceType, t.sourceId),
		// the bitemporal audit query filters on business time.
		index('entry_group_occurred_at_idx').on(t.occurredAt)
	]
);

/**
 * the lines. every line of one `entry_group` sums to exactly zero.
 *
 * **signed amounts: `+` is a debit, `−` is a credit.** that convention is settled
 * project-wide; there is no `direction` column and no per-type sign flipping.
 *
 * five columns, and never more without a reason — this is the hot append table, and the
 * one whose row count drives D1's 100-bound-parameter cap on a `batch()`. the fifth is
 * not a fact about a line: it is the constant `1` the composite postable foreign key
 * below matches on, and it was worth the parameter because the alternative was leaving
 * `account_id` able to name a rollup.
 *
 * `src/lib/server/ledger/posting.ts` is the only module that may INSERT here, and
 * `sole-writer.spec.ts` is what enforces that rather than trusting this sentence.
 */
export const ledgerEntry = sqliteTable(
	'ledger_entry',
	{
		id: id(),
		entryGroupId: text('entry_group_id')
			.notNull()
			.references(() => entryGroup.id),
		/**
		 * no `.references()` here — this column is half of the composite foreign key declared
		 * in the constraint list below, and drizzle would otherwise emit a second,
		 * single-column FK to `account(id)` alongside it, which is the very constraint the
		 * composite replaces.
		 *
		 * no `ON DELETE` action anywhere on this table on purpose. an account that has been
		 * posted to is archived, never deleted, so a cascade would only ever fire on the
		 * accident it exists to survive.
		 *
		 * `$type<PostableAccountId>()` carries the brand through the row type, which is what
		 * makes `NewLedgerEntry` unbuildable from a plain `string` — see ./postable.ts. it is
		 * documentation to a `wrangler d1 execute` and a real constraint to every writer that
		 * goes through drizzle, and it is the same brand `posting.ts` already takes on
		 * `PostingLine.accountId`, so that value flows in here with no cast.
		 */
		accountId: text('account_id').$type<PostableAccountId>().notNull(),
		amountMinor: integer('amount_minor').notNull(),
		/**
		 * not a fact about this line — the same constant-`1` device `line_item` carries, for
		 * the same reason, and see that column for the drizzle caveat about the default.
		 * never set it at a call site, never read it.
		 */
		accountIsPostable: integer('account_is_postable').notNull().default(1)
		// append new columns below this line — see rule 1 at the top of this file.
	},
	(t) => [
		/**
		 * the postable FOREIGN KEY. identical in shape to `line_item`'s, and the one that
		 * matters most: `line_item` decides what a report says a gift was for, but a ledger
		 * entry naming a rollup makes every report over that subtree double-count, silently
		 * and permanently, because the ledger is append-only and the rollup already sums its
		 * children.
		 *
		 * `PostableAccountId` in ./postable.ts brands the argument `posting.ts` takes, so a
		 * rollup is a compile error at the call site — but that is a type-checker guard and
		 * nothing else, which is precisely the gap this closes: a hand-written
		 * `wrangler d1 execute`, a CSV import or a future writer that never sees the brand
		 * reaches the table directly. paired with `ledger_entry_account_postable_check`
		 * pinning this side to 1, the only `account` rows `account_id` can name are the ones
		 * with `is_postable = 1`, at no extra read — `account_id_postable_idx` does the work.
		 *
		 * the parent unique index is created ahead of this table rather than beside the
		 * table that first needed it: sqlite resolves a composite FK against the parent
		 * index at DML time, so an index arriving in a later file is legal at create and a
		 * `foreign key mismatch` on the first insert.
		 */
		foreignKey({
			columns: [t.accountId, t.accountIsPostable],
			foreignColumns: [account.id, account.isPostable]
		}),
		// a zero line carries no information and is the shape a mis-split produces, so it
		// is a bug signal rather than a harmless no-op. rejected in posting.ts too.
		check('ledger_entry_amount_minor_not_zero_check', sql`${t.amountMinor} <> 0`),
		// the other half of the composite FK: without it, matching `(4100, 0)` against the
		// parent index would satisfy the foreign key perfectly.
		check('ledger_entry_account_postable_check', sql`${t.accountIsPostable} = 1`),
		// group reads: every line of one journal entry.
		index('ledger_entry_entry_group_id_idx').on(t.entryGroupId),
		// balances: `SUM(amount_minor) WHERE account_id = ?`, which is how every total in
		// the app is derived. never a stored running balance.
		index('ledger_entry_account_id_idx').on(t.accountId)
	]
);

// ---------------------------------------------------------------------------
// the donation record: form -> donation -> line_item / payment.
//
// ON DELETE. every foreign key below ships `ON DELETE no action`, which is what drizzle
// emits by default and what must never be edited to `cascade` — not even on a child
// nobody would miss. a cascade is an action, not a violation, so
// `PRAGMA defer_foreign_keys=true` (rule 2 above, the pragma every future table rebuild
// depends on) does not defer it: the rebuild's `DROP TABLE <parent>` performs an
// implicit delete of every parent row, the cascade fires against a table nobody was
// touching, the child is silently emptied, and the deferred check at commit then passes
// because the orphans it was watching for were tidied away. that is the one hazard in
// this family of tables that is both silent and unrecoverable, so: no action, always.
// ---------------------------------------------------------------------------

/**
 * an organisation's named cause: what a fundraiser calls the thing a gift went to — a clean-water
 * programme, a scholarship, a gala appeal. a form pins one, offers the donor the active list, or
 * asks about none at all, and the gift records which one it went to.
 *
 * not the chart of accounts and never a stand-in for it. `form.revenue_account_id` decides which
 * fund a gift posts to and this decides what the organisation calls where it went; three causes
 * posting to `4110` is the ordinary case, and a cause needing its own revenue account is a change
 * to that column rather than to this table.
 *
 * a cause is archived and never deleted, which is what lets every reference into this table —
 * `form.program_id` and `donation.program_id` — carry no `ON DELETE` action of any kind and need
 * none. the row a recorded gift points at is still there, so the pointer always resolves. there is
 * no delete query in ../programs/queries.ts either, and a hard delete would be one of two losses:
 * a gift that can no longer say where it went, or a total an organisation already reported
 * silently rewritten.
 *
 * no row is seeded. a cause is one organisation's own wording, so there is nothing a fork could
 * inherit — the same reason `form` seeds none.
 */
export const program = sqliteTable(
	'program',
	{
		id: id(),
		/** what the organisation calls this cause, on a staff screen and on a donation form alike. */
		name: text('name').notNull(),
		/** a sentence for a donor, and null where the name says it on its own. */
		description: text('description'),
		status: text('status').$type<ProgramStatus>().notNull().default('active'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		// causes archive, they never delete. this is the timestamp of the `status = 'archived'`
		// transition, not a soft delete.
		archivedAt: at('archived_at')
		// append new columns below this line — see rule 1 at the top of this file.
	},
	(t) => [
		check('program_status_check', enumCheck(t.status, PROGRAM_STATUSES)),
		check('program_name_not_blank_check', notBlank(t.name)),
		// nullable, so "not stated" is the normal state and only `''` is the bug — the same
		// distinction `optionalNotBlank` draws for `donation.source`. it is here at birth because
		// adding it afterwards is the table rebuild rule 2 describes.
		check('program_description_not_blank_check', optionalNotBlank(t.description)),
		/**
		 * one cause per name, and it is what makes a list of them readable: two rows called
		 * "Clean Water" are two causes a donor's picker draws identically and no report can
		 * separate, told apart only by an id no screen renders.
		 *
		 * the comparison is `collate nocase`, so "Clean water" is a name "Clean Water" already
		 * carries. capitals are all a screen would have left to tell that pair apart, and a picker,
		 * the gifts table and a receipt each render the name and nothing else. sqlite's nocase
		 * folds ascii a-z alone, so two names differing only in the case of a letter outside that
		 * range are still two causes.
		 *
		 * the stored name keeps the capitals the operator typed: nothing lowercases on the way in,
		 * and ../programs/program-input.ts trims and does no more than that.
		 *
		 * archived rows are in the index too. a retired cause keeps its name because the gifts
		 * recorded against it still render it, so letting a new one take the name would make one
		 * word mean two causes inside one report.
		 */
		uniqueIndex('program_name_idx').on(sql`${t.name} collate nocase`)
	]
);

/**
 * a donation form: the only donor-facing artifact this deployment produces, served on the
 * org's own site or on the donation page this deployment serves on its own address. one
 * deployment serves many — a general fund, a gala, a memorial.
 *
 * this is where the chart of accounts gets hidden. `line_item` needs a
 * `revenue_account_id` and no fundraiser will ever pick one; they pick a form, and the
 * fund rides along. the "Fund" wording the UI shows is this table.
 *
 * modelled past what v0 renders: `/api/v1` and the embed are deferred, and the table is
 * shaped for the whole of what a form will hold rather than for the columns a first
 * screen writes.
 *
 * no row is seeded, so a deployment starts with no forms and the first one is made by a
 * human in /admin/forms. seeding one would mean committing a public id — every form id
 * that ever ships would be the same 80 bits in every fork — to save a step that a
 * fundraiser has to take anyway, since a form nobody named or pointed at a fund is not
 * one they can use. `donation.form_id` is nullable because staff-entered cash and cheques
 * have no form behind them.
 */
export const form = sqliteTable(
	'form',
	{
		id: formId(),
		/** staff-facing label. never shown to a donor. */
		name: text('name').notNull(),
		status: text('status').$type<FormStatus>().notNull().default('draft'),
		/**
		 * the fund this form's gifts post to.
		 *
		 * no `.references()` here — half of the composite foreign key in the constraint list
		 * below, and drizzle would otherwise emit a second single-column FK to `account(id)`
		 * alongside it. a single-column FK is exactly what would let a form name the `4100`
		 * rollup.
		 *
		 * `$type<PostableAccountId>()` is what makes this column the start of the posting path
		 * rather than a break in it. a gift through a form posts to the fund this column names,
		 * so `form.revenueAccountId` is read straight into `PostingLine.accountId`; as a plain
		 * `string` the only way across was a cast, and a cast is how a brand whose whole
		 * purpose is that nobody can mint one stops meaning anything. see ./postable.ts.
		 */
		revenueAccountId: text('revenue_account_id').$type<PostableAccountId>().notNull(),

		// JSON columns, both arrays.
		//
		// neither how a donor may pay nor how often a gift may repeat is one of them, and neither
		// may become one. how a donor may pay is a fact about this deployment
		// (`OFFERED_PAYMENT_METHODS` in ../../forms/offered-rails.ts) rather than about one form,
		// and how often a gift may repeat is what this deployment's processor account can collect
		// (`offeredCadences` in ../forms/offered-cadences.ts) — so a column for either is a stored
		// copy of a constant. withdrawing one costs a table rebuild: sqlite will not `DROP COLUMN`
		// a column named in a table CHECK, and every JSON column here is named in one.
		suggestedAmounts: text('suggested_amounts').notNull().default('[]'),
		minMinor: integer('min_minor'),
		maxMinor: integer('max_minor'),
		currency: text('currency').notNull(),
		/**
		 * the sites this form may be embedded on. `/api/v1`'s CORS allowlist is built from
		 * this column — `Origin` is an attribution signal there, never an authorization
		 * control, so this is the list and not the header.
		 */
		allowedOrigins: text('allowed_origins').notNull().default('[]'),
		/** headline, blurb, thank-you overrides. an object, unlike the two above. */
		copy: text('copy').notNull().default('{}'),

		createdAt: createdAt(),
		updatedAt: updatedAt(),
		// forms archive, they never delete — see FORM_STATUSES in ../../forms/statuses.ts.
		// this is the timestamp of
		// the `status = 'archived'` transition, not a soft delete.
		archivedAt: at('archived_at'),
		/**
		 * not a fact about this form. the constant `1` the composite postable foreign key
		 * below matches on — never set it at a call site, never read it; it defaults.
		 *
		 * it sits here, after `archived_at`, rather than beside `revenue_account_id` where it
		 * reads better, because rule 1 at the top of this file admits no exception: a column
		 * anywhere but last makes every future `drizzle-kit generate` emit a table rebuild
		 * whose copy step SELECTs a column the old table does not have. (`line_item` has this
		 * pair adjacent only because that table has no timestamps to append after.)
		 */
		revenueAccountIsPostable: integer('revenue_account_is_postable').notNull().default(1),

		/**
		 * what this form does about causes — `none`, `pinned`, or `choice`. `PROGRAM_MODES` in
		 * ../../forms/program-modes.ts says what each of the three means.
		 *
		 * a fact about the form rather than about the deployment, unlike the payment methods and the
		 * cadences the two JSON columns above were withdrawn for: two forms on one deployment
		 * legitimately differ here, because a gala page names its gala and a general page names
		 * nothing.
		 */
		programMode: text('program_mode').$type<ProgramMode>().notNull().default('none'),

		/**
		 * the cause a `pinned` form credits, and null in the other two modes.
		 *
		 * held to that by `form_program_pinned_check` below rather than by the screen that writes it,
		 * because the two columns are one decision and either half left behind is a row that reads
		 * clean: a `pinned` form naming nothing pins nothing, and an id stranded by a mode moved back
		 * to `none` credits every gift to a cause the form has stopped offering.
		 *
		 * no `ON DELETE` action, and none is needed — see `program` above.
		 */
		programId: text('program_id').references(() => program.id)
		// append new columns below this line — see rule 1 at the top of this file.
	},
	(t) => [
		/**
		 * the postable FOREIGN KEY, the same shape `line_item` carries — see that constraint
		 * for the mechanism.
		 *
		 * it is here rather than deferred for the reason stated there: retrofitting it is a
		 * table rebuild, and `donation.form_id` points at this table, so the rebuild's
		 * `DROP TABLE form` would fail on D1 the moment one gift exists. without it a form
		 * could name the `4100` rollup and the failure would land on the first gift — in
		 * `line_item`, on a fork we cannot reach, about a row a staff screen wrote weeks
		 * earlier.
		 */
		foreignKey({
			columns: [t.revenueAccountId, t.revenueAccountIsPostable],
			foreignColumns: [account.id, account.isPostable]
		}),
		check('form_revenue_account_postable_check', sql`${t.revenueAccountIsPostable} = 1`),
		check('form_status_check', enumCheck(t.status, FORM_STATUSES)),
		check('form_name_not_blank_check', notBlank(t.name)),
		check('form_currency_check', currencyCheck(t.currency)),
		/**
		 * `id` is generated, never typed, so these two are not input validation — they are
		 * the floor under a public identifier. a blank or 3-character id would still be a
		 * legal PRIMARY KEY, and it is the shape a hand-run `d1 execute` produces.
		 *
		 * deliberately no prefix check. `substr(id, 1, 4) = 'frm_'` would pin the public id
		 * format in the database, and the public id format is not on CLAUDE.md's
		 * permanent-contracts list — pinning it there makes changing it a table rebuild on
		 * a table `donation` references. (if a later reviewer does want one, it is
		 * `substr`, never `id like 'frm_%'`: `_` is a like wildcard, so the like form
		 * silently accepts `frmX…` and proves nothing.)
		 */
		check('form_id_not_blank_check', notBlank(t.id)),
		check('form_id_length_check', sql`length(${t.id}) >= 12`),
		// bounds are re-checked server-side on every /api/v1 request against this record;
		// these are the floor under that, for the staff screen that sets them.
		//
		// the `is null` disjuncts in all three are documentation, not logic — same as
		// `optionalNotBlank` and `payment_provider_check`: both columns are nullable, "no
		// bound set" is the normal state, and a comparison against null evaluates to null,
		// which a check already accepts. they are spelled out because these constraints are
		// read far from the column definitions and "may a bound be absent?" is the first
		// question asked of them.
		check('form_min_minor_check', sql`${t.minMinor} is null or ${t.minMinor} >= 0`),
		check('form_max_minor_check', sql`${t.maxMinor} is null or ${t.maxMinor} >= 0`),
		// an inverted pair silently rejects every amount, which reads to staff as "the
		// form is broken" with nothing naming the cause.
		check(
			'form_min_max_minor_check',
			sql`${t.minMinor} is null or ${t.maxMinor} is null or ${t.minMinor} <= ${t.maxMinor}`
		),
		check('form_suggested_amounts_array_check', jsonArray(t.suggestedAmounts)),
		check('form_allowed_origins_array_check', jsonArray(t.allowedOrigins)),
		check('form_copy_object_check', jsonObject(t.copy)),
		check('form_program_mode_check', enumCheck(t.programMode, PROGRAM_MODES)),
		/**
		 * the two program columns are one decision, and this is the whole of what keeps them from
		 * disagreeing.
		 *
		 * an equality between two truths rather than two `or`-ed cases, so neither direction can be
		 * loosened without the other: a `pinned` form always names a cause, and a form in any other
		 * mode never holds one. `program_mode` is NOT NULL, so neither side is ever null and the
		 * check cannot pass by evaluating to null the way a comparison against a nullable column
		 * would.
		 */
		check(
			'form_program_pinned_check',
			sql`(${t.programId} is not null) = (${t.programMode} = 'pinned')`
		)
		// no index. a deployment has forms in the low tens and every read of this table is
		// either by primary key or a full list — and unlike a check, an index is a free
		// `CREATE INDEX` the day a read proves slow.
	]
);

/**
 * the "order": one gift, as recorded. its lines are `line_item`, its settlement events
 * are `payment`, and its money movement is an `entry_group` in the ledger.
 *
 * there is no `status` column, and adding one is the mistake this table is shaped
 * against. status is a read-time projection over `payment` + the ledger, promoted to a SQL
 * view only if a read proves slow. a mutable status kept in sync with an append-only
 * ledger is a second source of truth for the one fact that must never disagree. the
 * asymmetry seals it: sqlite does `ADD COLUMN` natively, while dropping a column carrying
 * a check is the 12-step rebuild — so not having it is the cheap direction to reverse.
 *
 * the projection, and what produces each state. this list is a contract with `payment`,
 * not a wish: every member below is derivable from rows that exist. `failed` and `cancelled`
 * are the two that depend on `payment.status` and are why it exists — with `payment` holding
 * settlement facts only, a failed charge writes no row, so `failed` is indistinguishable from
 * `pending` and `cancelled` has no substrate at all.
 *
 *   pending            no `payment` row yet, or the latest inbound attempt is `pending`.
 *   completed          an inbound `succeeded` payment, and refunds do not reach the total.
 *   failed             the latest inbound attempt is `failed` and none has succeeded.
 *   cancelled          the latest inbound attempt is `cancelled` and none has succeeded.
 *   refunded           `succeeded` refunds sum to the inbound total.
 *   partially_refunded `succeeded` refunds sum to less than it, and more than zero.
 *
 * two rules govern that list, and they are what make it exhaustive rather than a set of
 * cases. a gift with any `succeeded` inbound attempt is collected, and no later attempt
 * takes that back — money that moved is undone by a refund, which is a row of its own, and
 * never by a retry the rail refused. a gift with none falls through to its latest inbound
 * attempt, whatever that attempt is: `failed` and `cancelled` are the latest one rather
 * than any one, because a retried card is two rows and the first failing does not make the
 * gift failed — and a card that failed and is being retried is `pending` again, on a row
 * that is past `pending` itself. that ordering is `occurred_at`, business time, for the
 * same reason every other read is, tie-broken by `id` so one request's two attempts do not
 * project differently between loads. `../donations/queries.ts` is where this is read.
 *
 * two columns the domain model carries are deliberately absent here:
 *
 *   `net_minor` (generated, `total_minor - fee_minor`). a VIRTUAL generated column is a
 *   free `ADD COLUMN` whenever a reader wants it, and shipping it now would put an
 *   unverified interaction into every future table rebuild's `INSERT ... SELECT` — a
 *   failure that lands at `deploy`'s remote migration, past every gate that runs at
 *   commit time, at the one-way door. the subtraction costs nothing at read time until
 *   then.
 *
 * no `archived_at` either: a donation with ledger entries behind it has no meaningful
 * soft delete. a mistake is a compensating entry.
 *
 * `recurring_id` and `program_id` are the two columns here pointing at a table younger than this
 * one, they arrived the same way, and it is the way the next such column has to arrive. a
 * `REFERENCES` to a table that does not exist yet is legal at CREATE TABLE — sqlite resolves a
 * foreign key when DML runs, not when the table is declared — so a column declared ahead of its
 * table ships green and explodes on the first non-null insert, months later. each arrives instead
 * as `ALTER TABLE donation ADD COLUMN <name> text REFERENCES <table>(id)` once that table exists,
 * legal precisely because an added column defaults null. both are at the bottom of this table.
 *
 * a charge collected under a commitment takes its cause from the gift that opened the series,
 * which is why `recurring_plan` carries no program column of its own.
 */
export const donation = sqliteTable(
	'donation',
	{
		id: id(),
		/** the payer. soft credits — crediting someone who is not the payer — are a later table. */
		contactId: text('contact_id')
			.notNull()
			.references(() => contact.id),
		totalMinor: integer('total_minor').notNull(),
		currency: text('currency').notNull(),
		/** processor fee, expensed gross so the gift is recorded at face value. */
		feeMinor: integer('fee_minor').notNull().default(0),
		// receipt compliance. the deductibility split is a form field when receipts land;
		// the columns and both revenue accounts already exist, so it is not a migration.
		taxMinor: integer('tax_minor').notNull().default(0),
		nonDeductibleMinor: integer('non_deductible_minor').notNull().default(0),
		/** business date of the gift. backdating is required — see the check note below. */
		receivedAt: at('received_at').notNull(),
		/** how it came in, staff-entered. free text on purpose; not a closed vocabulary. */
		source: text('source'),
		/** null for staff-entered cash and checks, which is every gift in v0. */
		formId: text('form_id').references(() => form.id),
		/**
		 * the validated `Origin` header, captured server-side. one form is embedded on
		 * several sites, so this — not `form_id` — is the attribution key.
		 */
		origin: text('origin'),
		receiptSentAt: at('receipt_sent_at'),
		thankyouSentAt: at('thankyou_sent_at'),
		createdAt: createdAt(),
		// append new columns below this line — see rule 1 at the top of this file. this table ends at
		// `created_at` rather than at `archived_at`, for the reason the header above gives.

		/**
		 * what the donor typed for the organisation — in memory of someone, for a particular
		 * appeal. free text, and never parsed for meaning.
		 *
		 * null where none was written. no `optionalNotBlank` next to `source` and `origin`, which is
		 * the one thing that would otherwise be here: a check is a table-level constraint drizzle
		 * can only express by rebuilding the table, and this column arrives on a table with children
		 * by plain `ADD COLUMN`. so the blank case is settled before the write instead —
		 * `parseQuoteRequest` in ../donations/quote-input.ts trims and drops an empty note, and
		 * bounds its length, which is the bound this column does not carry either.
		 */
		note: text('note'),

		/**
		 * the standing commitment this gift was charged under. null on a one-time gift, and null
		 * on a repeating one until its first charge settles: the gift is recorded when the donor
		 * authorizes the commitment and there is no plan row yet to point at, so the charge that
		 * opens the series is what writes this column — which is also what makes it the claim
		 * (`findAuthorizedGift` in ../donations/collect.ts reads it back as `is null`).
		 *
		 * every charge in a series is its own donation row pointing here — its own
		 * `line_item`s, its own `payment`, its own entry groups — so there is no sequence
		 * number and no first-charge flag on this table. both are read off this column
		 * (`order by received_at`), and neither could be kept honest against a redelivered
		 * webhook, which is the one thing the settlement path is guaranteed to see.
		 *
		 * this is the column the header above deferred, and it arrives by
		 * `ALTER TABLE donation ADD COLUMN recurring_id text REFERENCES recurring_plan(id)`
		 * for the reason stated there — legal only because the table it names now exists and
		 * because an added column defaults null. `donation_recurring_id_idx` below is the
		 * read: every screen that shows a commitment shows the charges it has made.
		 */
		recurringId: text('recurring_id').references(() => recurringPlan.id),

		/**
		 * a gift marked as given in honor of, or in memory of, a named person — `'honor'` or
		 * `'memory'`, and null on a gift carrying no tribute.
		 *
		 * this is not `note` said twice. a note is anything a donor wants to say and is never parsed;
		 * a tribute is a structured fact the organisation reports on and sends mail about, and the two
		 * coexist on one gift.
		 *
		 * no enum check, which is the one place this column departs from the `enums ->` rule at the
		 * top of this file. these five columns arrive on a table with children by plain `ADD COLUMN`,
		 * and a check is a table-level constraint drizzle can only express by rebuilding — the same
		 * argument `note` above makes, and the reason `TRIBUTE_KINDS` in `@better-giving/form/v1` is
		 * not imported here. two parse boundaries hold a stored value to the vocabulary and they are
		 * the whole of what does: `parseTribute` in ../donations/quote-input.ts for a gift a donor
		 * submitted, and `tributeOf` in ../donations/collect.ts for a collection under a commitment.
		 */
		tributeKind: text('tribute_kind'),

		/**
		 * the person the gift honors or remembers.
		 *
		 * travels with `tribute_kind` — a kind naming nobody, and a name with no kind, are both rows
		 * this table accepts and neither is a state the form can produce. the pair is held together in
		 * `Tribute` in ../donations/quote-input.ts, where the two columns become one value that cannot
		 * be half-filled; a check saying it here is the table rebuild above.
		 *
		 * no length bound and no not-blank check either, for that same reason. both are
		 * `parseTribute`'s, against `MAX_NAME` in ../../contacts/input-schema.ts — the limit every
		 * other stored name in this schema is under.
		 */
		tributeHonoree: text('tribute_honoree'),

		/**
		 * the person the donor asked us to tell, and the address to tell them at.
		 *
		 * both null where the donor asked for nobody to be told, which is every gift that carries a
		 * tribute at all and most that do. two columns rather than a JSON blob: one of them is an
		 * address mail is sent to.
		 *
		 * the pair is enforced in `Tribute` and by `parseTribute` (../donations/quote-input.ts) — an
		 * address with no name greets nobody, a name with no address reaches nobody, and the columns
		 * are independent and nullable. the address is checked against `EMAIL` in
		 * ../../contacts/input-schema.ts there and nowhere else.
		 */
		tributeNotifyName: text('tribute_notify_name'),
		tributeNotifyEmail: text('tribute_notify_email'),

		/**
		 * when the notification to `tribute_notify_email` went. null until it does.
		 *
		 * this column is what stops a family being told twice, and it works only if the send is
		 * claimed by a guarded update rather than decided in front of one. Stripe redelivers a webhook,
		 * and a redelivery that reads this column and then sends has already lost the race. the
		 * pattern to copy is `sendReceipt` in ../donations/receipt.ts: `.set({ … })` with
		 * `isNull(…)` in the `where` and `.returning()` read for whether a row was claimed — no row
		 * means somebody else claimed it, and a send that then fails releases the claim.
		 *
		 * a repeating gift names somebody to tell on exactly one row, and the guard for that is
		 * structural rather than this column. every charge in a series is its own `donation` row (see
		 * `recurring_id` above); the charge that opens the series is the gift the donor authorized,
		 * carrying all four columns as ../donations/record.ts wrote them, and ../donations/collect.ts
		 * writes both notify columns null on every later collection. so there is nobody on any other
		 * row of the series for a send to find, which is what stops a monthly gift given in someone's
		 * memory mailing the family every month for a year — the failure being designed against, and
		 * the one ../donations/settled-notice.ts already answers for the organisation's own notice.
		 *
		 * nothing about the dedication is exported to the processor to make that work. the kind and
		 * the honoree reach a later collection off the opening charge's own two columns
		 * (`openingGift` in ../donations/collect.ts), and a commitment carries pointers and
		 * figures only.
		 */
		tributeNotifiedAt: at('tribute_notified_at'),

		/**
		 * the cause this gift went to, and null where it went to none — every staff-entered gift, and
		 * every gift made on a form that asks about no cause.
		 *
		 * on the gift rather than read back through `form.program_id`, because the two columns answer
		 * different questions: a form's is what it offers now, and this is where a gift already
		 * recorded went. a form re-pinned next quarter would otherwise rewrite last quarter's report.
		 *
		 * `donation_program_id_idx` below is the read: every figure a cause reports is a `SUM` over
		 * the gifts naming it.
		 */
		programId: text('program_id').references(() => program.id)
	},
	(t) => [
		check('donation_currency_check', currencyCheck(t.currency)),
		/**
		 * `> 0`, not `>= 0`. a zero-total donation is the shape a half-parsed form submit
		 * produces, and it posts an `entry_group` of zero-amount lines that
		 * `ledger_entry_amount_minor_not_zero_check` then rejects mid-batch — a rollback of
		 * the whole gift, reported from the ledger, about a value the donation row let
		 * through. a refund is a separate `payment` row plus a compensating entry, never a
		 * negative donation.
		 */
		check('donation_total_minor_positive_check', sql`${t.totalMinor} > 0`),
		check('donation_fee_minor_check', sql`${t.feeMinor} >= 0`),
		check('donation_tax_minor_check', sql`${t.taxMinor} >= 0`),
		check('donation_non_deductible_minor_check', sql`${t.nonDeductibleMinor} >= 0`),
		/**
		 * deliberately no cross-column amount checks. `fee_minor <= total_minor` and
		 * `non_deductible_minor <= total_minor` both look obviously true and are not: they
		 * encode receipting policy that v0 defers, and tax-inclusive vs tax-on-top
		 * pricing alone flips the second one. worse, a check naming two columns blocks
		 * `DROP COLUMN` on both of them, so an assumption written down early costs a table
		 * rebuild to withdraw.
		 */
		check('donation_source_not_blank_check', optionalNotBlank(t.source)),
		/**
		 * not-blank and nothing more. no shape check on `origin`: a valid `Origin` may be
		 * the literal string `null` (a sandboxed iframe, a `file://` page, a redirected
		 * request), or scheme+host, or scheme+host+port — a regex that admits all three
		 * admits nearly anything, and one that does not silently drops real traffic.
		 */
		check('donation_origin_not_blank_check', optionalNotBlank(t.origin)),
		/**
		 * no check on `received_at`. backdating is a requirement, not an anomaly — staff
		 * enter last month's checks — so there is no lower bound; and "not in the future"
		 * is unexpressible, because a check may only call deterministic functions and
		 * `unixepoch()` is not one.
		 */
		index('donation_contact_id_idx').on(t.contactId),
		index('donation_form_id_idx').on(t.formId),
		index('donation_recurring_id_idx').on(t.recurringId),
		index('donation_program_id_idx').on(t.programId),
		// every gift list and every period report filters on business time, never on
		// `created_at`.
		index('donation_received_at_idx').on(t.receivedAt)
	]
);

/**
 * itemization: a gift can bundle a donation + (later) an event ticket + a membership,
 * each posting to a different revenue account.
 *
 * a line names its `revenue_account_id` directly, and the UI wraps it as a "Fund".
 */
export const lineItem = sqliteTable(
	'line_item',
	{
		id: id(),
		donationId: text('donation_id')
			.notNull()
			.references(() => donation.id),
		label: text('label').notNull(),
		quantity: integer('quantity').notNull().default(1),
		unitPriceMinor: integer('unit_price_minor').notNull(),
		lineTotalMinor: integer('line_total_minor').notNull(),
		taxMinor: integer('tax_minor').notNull().default(0),

		/**
		 * no `.references()` here — this column is half of a composite foreign key declared
		 * in the constraint list below, and drizzle would otherwise emit a second,
		 * single-column FK alongside it.
		 *
		 * `$type<PostableAccountId>()` for the same reason `form` carries it: the id a gift
		 * posts to travels `form` -> `line_item` -> `PostingLine.accountId`, and a plain
		 * `string` anywhere along that path is a cast at the far end. see ./postable.ts.
		 */
		revenueAccountId: text('revenue_account_id').$type<PostableAccountId>().notNull(),
		/**
		 * not a fact about this line. it is a constant `1` that exists only so the
		 * composite foreign key below has a second column to match on — never set it at a
		 * call site, never read it. see that constraint for what it buys.
		 *
		 * `.default(1)` here is load-bearing, and not merely a mirror of the SQL default.
		 * drizzle names every column of the table in an `insert`, and for a key absent from
		 * the values object it substitutes this schema-level default as a bound parameter —
		 * it never emits the `DEFAULT` keyword, which sqlite would not accept in a `VALUES`
		 * list anyway. so a column with a SQL default and no drizzle default binds `null` and
		 * trips NOT NULL on every insert that omits it. the two defaults have to agree, and
		 * that is what makes "never set it at a call site" safe rather than aspirational.
		 */
		revenueAccountIsPostable: integer('revenue_account_is_postable').notNull().default(1)
		// append new columns below this line — see rule 1 at the top of this file.
	},
	(t) => [
		/**
		 * no `currency` column, and that is the same carve-out `entry_group.currency` carries
		 * from the other side: a line item has no meaning outside its donation, so the parent's
		 * currency governs it. a column here would be a second copy of that fact with nothing
		 * able to hold the two in agreement — "equals my donation's currency" is cross-row, so
		 * no check expresses it and an FK cannot carry it.
		 */
		/**
		 * the postable FOREIGN KEY, and the reason it had to be born with the table.
		 *
		 * `account(id, is_postable)` has a unique index (below, on `account` — free, since
		 * `CREATE UNIQUE INDEX` is not a rebuild), and sqlite resolves a composite FK only
		 * against a parent UNIQUE index, which is why the parent column being NOT NULL
		 * matters as much as the index does. paired with
		 * `line_item_revenue_account_postable_check` pinning this side to 1, the only
		 * `account` rows this column can name are the ones with `is_postable = 1`.
		 *
		 * that makes a rollup id — `4100 Donations`, `is_postable = 0` — unnameable by a
		 * line item at the database level, and it costs zero extra reads: no lookup, no
		 * round trip, the index does it. this is the runtime twin of `PostableAccountId` in
		 * ./postable.ts, and the two are not redundant — the brand stops a caller in the
		 * type checker, this stops a hand-written `wrangler d1 execute`, a CSV import and
		 * any future writer that never sees the brand.
		 *
		 * the double-counting hazard belongs to `ledger_entry`, which carries the same pair
		 * (see that table): one ledger entry against a rollup makes every report over that
		 * subtree double-count, silently and permanently. a `line_item` naming one is milder —
		 * it mis-attributes what a gift was for — and the two constraints are the same shape
		 * because the same id flows from `form` to `line_item` to the posting.
		 *
		 * retrofitting this shape is a rebuild of `line_item`, which is why it is here and
		 * not deferred.
		 */
		foreignKey({
			columns: [t.revenueAccountId, t.revenueAccountIsPostable],
			foreignColumns: [account.id, account.isPostable]
		}),
		check('line_item_revenue_account_postable_check', sql`${t.revenueAccountIsPostable} = 1`),
		// a zero or negative quantity is a parse bug, and it makes the line's contribution
		// to the gift meaningless rather than merely wrong.
		check('line_item_quantity_check', sql`${t.quantity} > 0`),
		check('line_item_unit_price_minor_check', sql`${t.unitPriceMinor} >= 0`),
		check('line_item_line_total_minor_check', sql`${t.lineTotalMinor} >= 0`),
		check('line_item_tax_minor_check', sql`${t.taxMinor} >= 0`),
		/**
		 * deliberately not `line_total_minor = quantity * unit_price_minor`. any discount,
		 * proration, or largest-remainder rounding residual invalidates it — and it names
		 * three columns, so it would block `DROP COLUMN` on all three. the arithmetic
		 * belongs where the discount rules are, not here.
		 */
		check('line_item_label_not_blank_check', notBlank(t.label)),
		index('line_item_donation_id_idx').on(t.donationId)
	]
);

/** the sign lives on `direction`; `amount_minor` is always positive. */
export const PAYMENT_DIRECTIONS = ['inbound', 'refund'] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

export const PAYMENT_METHODS = ['cash', 'check', 'card', 'ach'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * which rail settled it. not the `PaymentProvider` port — that is the interface in
 * lib/server/payments, and this is the string stored on a row, so the type is
 * `PaymentProviderName` to keep the two importable into one module.
 */
export const PAYMENT_PROVIDERS = ['stripe', 'manual'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

/**
 * how a settlement attempt ended. four states, and the vocabulary is the rail's, not
 * ours — every one of them is a terminal or near-terminal PaymentIntent state Stripe
 * reports, so the webhook handler maps rather than interprets.
 *
 * `succeeded` and `failed` are the two outcomes; `pending` covers money that is on its way
 * and not yet ours (an ACH debit, a PaymentIntent awaiting `requires_action`, a cheque
 * staff have recorded but not banked); `cancelled` is an attempt abandoned before any
 * money moved, which is a different fact from one the rail refused.
 *
 * deliberately not `refunded`. a refund is a separate `payment` row with
 * `direction = 'refund'`, which is what keeps this table append-shaped and keeps a
 * reconciler reading one row per real event. a `refunded` member here would make the same
 * fact expressible twice — a status on the inbound row and a row of its own — with nothing
 * able to hold the two in agreement.
 *
 * `disputed`/`chargeback` are absent for the opposite reason: they are real and they are
 * not settlement outcomes, they are later events about a settled payment. they arrive as
 * their own rows or their own table when disputes land, and adding a member to this list
 * afterwards is a table rebuild — so the list is short on purpose rather than by omission.
 */
export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'cancelled'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * settlement attempts and their outcomes. a payment holds no balance, and nothing here is
 * ever summed to answer "how much has this donor given" — that is a `SUM` over
 * `ledger_entry`.
 *
 * a `succeeded` payment is what triggers a ledger posting, and only a `succeeded` one.
 * that qualifier is the whole of what `status` adds: without it a row here is a
 * settlement, so a failed charge could only be recorded by writing a row that lied or by
 * writing nothing at all — and `donation`'s documented `failed` state would have no
 * substrate (see that table). the pairing is not expressible as a check, because "has an
 * `entry_group`" is cross-row; `posting.ts`'s caller is where it is kept.
 *
 * the corollary, for anyone writing a read: `select ... from payment` does not mean
 * "money that moved". every aggregate over this table needs `where status = 'succeeded'`,
 * and the reason that is a tolerable cost here — where a running balance is banned
 * outright — is that no total in this app is derived from this table at all.
 */
export const payment = sqliteTable(
	'payment',
	{
		id: id(),
		donationId: text('donation_id')
			.notNull()
			.references(() => donation.id),
		amountMinor: integer('amount_minor').notNull(),
		currency: text('currency').notNull(),
		direction: text('direction').$type<PaymentDirection>().notNull(),
		/**
		 * which rail settled it — except on a `status = 'pending'` row, where nothing has
		 * settled and this is the rail the donor was quoted on.
		 *
		 * the column is NOT NULL, so a row opened before any money moved has to assert
		 * something, and the only fact available then is the donor's own choice.
		 * `lib/server/donations/record.ts` is what writes that, and the settlement half is
		 * what replaces it with the rail the charge actually reports. so a reader of a
		 * pending row is reading a claim, not an outcome — the vocabulary below is still
		 * the settled one, and a wallet quote arrives here as `card` because that is the
		 * rail it rides.
		 */
		method: text('method').$type<PaymentMethod>().notNull(),
		/**
		 * how the attempt ended — see `PAYMENT_STATUSES`.
		 *
		 * NOT NULL and deliberately without a default, which is the opposite call from every
		 * other column on this table and the only reason it is worth a note. a
		 * `.default('succeeded')` would be right for staff entry of cash and cheques — every
		 * gift in v0 — and silently wrong for the webhook path, where the row exists precisely
		 * because a rail reported an outcome that may not be that one. no default makes an
		 * omission a type error at every drizzle call site rather than a row that reads clean,
		 * and a NOT NULL rejection for the raw-SQL paths. it costs each writer six characters.
		 */
		status: text('status').$type<PaymentStatus>().notNull(),
		/** null on a payment recorded before the rail was known. */
		provider: text('provider').$type<PaymentProviderName>(),
		/**
		 * the rail's own id — a Stripe charge/PaymentIntent id. null for manual entry, and on
		 * a `direction = 'refund'` row it is the refund's id (`re_…`), never the charge's; see
		 * `payment_provider_txn_idx` below for why the index leaves no choice.
		 */
		providerTxnId: text('provider_txn_id'),
		/**
		 * business time: when the money actually moved — except on a `status = 'pending'`
		 * row, where it has not, and this is when the attempt was opened.
		 *
		 * the same shape `method` above carries and for the same reason: the column is NOT
		 * NULL and a row written at quote time has no better answer available.
		 * `lib/server/donations/record.ts` writes the quote instant; the settlement half
		 * replaces it with the moment the rail reports. a report over business time that
		 * included pending rows would therefore be reporting intentions — which is why no
		 * total in this app is derived from this table at all (see the note on the table).
		 */
		occurredAt: at('occurred_at').notNull(),
		/** system time: when the row was written. */
		createdAt: createdAt()
		// append new columns below this line — see rule 1 at the top of this file.
	},
	(t) => [
		check('payment_direction_check', enumCheck(t.direction, PAYMENT_DIRECTIONS)),
		check('payment_method_check', enumCheck(t.method, PAYMENT_METHODS)),
		check('payment_status_check', enumCheck(t.status, PAYMENT_STATUSES)),
		// the `is null` half is documentation — a check is satisfied by null, and
		// `null in ('stripe','manual')` evaluates to null, not false. see `optionalNotBlank`.
		check(
			'payment_provider_check',
			sql`${t.provider} is null or ${enumCheck(t.provider, PAYMENT_PROVIDERS)}`
		),
		check('payment_currency_check', currencyCheck(t.currency)),
		/**
		 * the three constraints that make `payment_provider_txn_idx` below mean anything.
		 *
		 * that unique index is the documented defence against a redelivered Stripe charge,
		 * and on its own it is bypassable three ways, because NULLs are DISTINCT in a sqlite
		 * unique index and `''` is not null:
		 *
		 *   ('stripe', null) twice   -> both insert. two settlement events for one charge.
		 *   (null, 'ch_x')  twice    -> both insert. same, from the other side.
		 *   ('stripe', '')  twice    -> collide. so a boundary that normalises a missing id
		 *                               to `''` instead of null refuses the second real
		 *                               payment as a redelivery, which is the failure that
		 *                               loses a gift rather than duplicating one.
		 *
		 * so: a txn id may be absent but never blank; a `stripe` row must carry one; and a
		 * txn id must name the rail that minted it. `('manual', NULL)` and `(NULL, NULL)`
		 * stay legal, and have to — staff entry of cash and checks is every gift in v0, and
		 * `(NULL, NULL)` is the payment recorded before the rail was known.
		 *
		 * the `is null` disjuncts on the first and third are documentation, same as
		 * `payment_provider_check` above. the second one's is not: `<>` against a null
		 * `provider` evaluates to null and the row passes, which is deliberate — that is the
		 * `(NULL, NULL)` case, and it is the third constraint that keeps a null provider from
		 * being a way to smuggle a txn id in unguarded.
		 */
		check('payment_provider_txn_id_not_blank_check', optionalNotBlank(t.providerTxnId)),
		check(
			'payment_stripe_needs_txn_id_check',
			sql`${t.provider} <> 'stripe' or ${t.providerTxnId} is not null`
		),
		check(
			'payment_txn_id_needs_provider_check',
			sql`${t.providerTxnId} is null or ${t.provider} is not null`
		),
		/**
		 * `> 0`, and `direction` carries the sign. this is the mirror of the ledger rule:
		 * signed amounts live on `ledger_entry` and nowhere else, so a business record
		 * never has to be read alongside a sign convention to be understood.
		 *
		 * deliberately no `direction = 'refund' -> amount_minor < 0`. that is a second sign
		 * convention, on the table most likely to be read by someone reconciling against a
		 * processor statement, where every figure is positive.
		 *
		 * and no refund-vs-received check of any kind: `sum(refunds) <= sum(inbound)` is
		 * cross-row, so no check expresses it, and D1 has no atomic read-then-write to
		 * enforce it with. two concurrent refunds can both post; the answer is a
		 * compensating entry a human writes, which is what double-entry books are for.
		 */
		check('payment_amount_minor_positive_check', sql`${t.amountMinor} > 0`),
		index('payment_donation_id_idx').on(t.donationId),
		/**
		 * payment-grain idempotency, sitting underneath `entry_group_source_idx`'s
		 * posting-grain idempotency. a redelivered Stripe charge carries the same
		 * `(provider, provider_txn_id)` and is refused by the database rather than by a
		 * read-then-write check that `batch()` cannot do atomically anyway.
		 *
		 * it does not get in the way of manual entry, and that is a property of sqlite
		 * rather than a coincidence: NULLs are DISTINCT in a unique index, so every
		 * staff-entered payment (both columns null) inserts happily while two rows naming
		 * the same real transaction collide. that NULLs-are-distinct property is also what
		 * makes the index bypassable on its own, which is what the three CHECKs above are
		 * for — read them as part of this constraint, not as separate hygiene.
		 *
		 * a refund stores the refund's own ID (`re_…`), never the charge's. decided here and
		 * now, because the shape of this index decides it and the webhook handler does not
		 * exist yet to be designed around an accident: `direction` is not in the index and
		 * `payment` has exactly one txn-id column, so a refund row carrying the charge id
		 * would collide with the inbound payment it reverses and be refused as a redelivery.
		 * the index stays two columns — adding `direction` is a plain `DROP INDEX` /
		 * `CREATE INDEX` if a rail ever forces it, not a table rebuild, so this is the cheap
		 * direction to be wrong in.
		 */
		uniqueIndex('payment_provider_txn_idx').on(t.provider, t.providerTxnId)
	]
);

/**
 * how often a commitment repeats.
 *
 * the wire's `FREQUENCIES` (packages/form/src/v1.ts) minus `one_time`: a gift that does not repeat
 * has no row in this table at all. `satisfies readonly Frequency[]` is what holds the two
 * lists to the same words — the wire vocabulary is add-never-rename (CLAUDE.md), so a member
 * added there is one this union may take, while a word spelled differently here is a type
 * error rather than a database happily storing a cadence nothing can charge.
 *
 * a third cadence does not arrive as a third member. widening this check is the table rebuild
 * rule 2 above describes, on a table `donation` points at — so from the first commitment
 * onward D1 will not let it be dropped. quarterly arrives instead as a nullable
 * `interval_count` column beside `interval` (a plain `ADD COLUMN`, rule 1), meaning three of
 * `monthly`, which is also the shape the rails express it in.
 */
export const RECURRING_INTERVALS = ['monthly', 'yearly'] as const satisfies readonly Frequency[];
export type RecurringInterval = (typeof RECURRING_INTERVALS)[number];

/**
 * a donor's standing commitment to give on a schedule. one row per commitment, never per
 * charge.
 *
 * every charge it makes is an ordinary `donation` pointing back at it through
 * `donation.recurring_id` — its own lines, its own `payment`, its own entry groups — so a
 * series is read from the donations rather than summarised here. nothing on this row is a
 * total, a count or a balance, and nothing ever should be: "how much has this commitment
 * given" is a `SUM` over `ledger_entry`, the same as every other number in this app.
 *
 * three things this table does not carry, each because something else already holds it:
 *
 *   the fund. `form_id` is NOT NULL here, unlike on `donation`, and that is what makes a
 *   revenue account reachable for charge two — `form.revenue_account_id` is the fund every
 *   charge in the series posts to. a commitment with no form would have nowhere to post
 *   anything after the browser that made it had gone.
 *
 *   the rail. a commitment is card-only — choosing monthly or yearly narrows the payment
 *   choice — so a `method` column would carry one value, and each charge's own `payment` row
 *   records the rail that settled it anyway.
 *
 *   an amendment history. an amount and an interval are fixed at creation and never change:
 *   to give a different amount the donor's commitment is cancelled and a new one made. so
 *   there is no per-change row, and `amount_minor` on this row is the amount of every charge
 *   under it for as long as it runs.
 *
 * when a row may be written is what the status vocabulary above decides. a commitment exists
 * here from its first successful charge, and the settlement that records that charge is what
 * writes it — in the same `batch()` as the charge's own donation. writing it when the
 * subscription is created instead would need a status meaning "no money has moved yet", there
 * is none, and a rail-side subscription that never charges would otherwise leave a row here
 * claiming a commitment the donor never completed.
 *
 * that makes the write idempotent by the same means every other write here is: the unique
 * index on the rail's subscription id below, never a read-then-write. a redelivered first
 * charge is a duplicate key rather than a second commitment, and the settlement that meets
 * one carries on to the donation it was really about.
 *
 * no `archived_at`, for the reason `donation` gives: a commitment with gifts behind it has no
 * meaningful soft delete. ending one is `status` plus `ended_at`, and both are permanent.
 */
export const recurringPlan = sqliteTable(
	'recurring_plan',
	{
		id: id(),
		/** the payer — the same fact `donation.contact_id` holds, about the whole series. */
		contactId: text('contact_id')
			.notNull()
			.references(() => contact.id),
		/** the form it was made on. NOT NULL — see the fund paragraph on the table above. */
		formId: text('form_id')
			.notNull()
			.references(() => form.id),
		/** what each charge is for. integer minor units, and fixed for the commitment's life. */
		amountMinor: integer('amount_minor').notNull(),
		currency: text('currency').notNull(),
		interval: text('interval').$type<RecurringInterval>().notNull(),
		status: text('status').$type<RecurringPlanStatus>().notNull(),

		/**
		 * which rail carries it, and its two ids there.
		 *
		 * the column names stay rail-neutral for the same reason `payment.provider_txn_id`'s
		 * does — payments go through the `PaymentProvider` port, never a vendor directly
		 * (CLAUDE.md) — and `provider` is what makes the unique index below a per-rail key
		 * rather than a global one, as well as the row's own answer to which port cancels it.
		 *
		 * both ids are stored, and that is not a copy of a third party's state: they identify
		 * objects this deployment created, exactly as `payment.provider_txn_id` does. what a
		 * copy would look like — a status, a period, a card brand read off the rail and
		 * believed afterwards — is the thing this row does not do.
		 *
		 * the subscription id is also the only handle a later charge arrives with: a rebill's
		 * PaymentIntent carries no metadata of ours, so the path from money that moved to the
		 * commitment it belongs to ends at the unique index below.
		 */
		provider: text('provider').$type<PaymentProviderName>().notNull(),
		providerSubscriptionId: text('provider_subscription_id').notNull(),
		providerCustomerId: text('provider_customer_id').notNull(),

		/** business time: when the commitment began, i.e. when its first charge settled. */
		startedAt: at('started_at').notNull(),
		/**
		 * when the next charge is expected.
		 *
		 * an expectation and never an authority: the rail holds the schedule and does the
		 * charging, nothing in this deployment sweeps this column, and no money moves because
		 * of what it says. it is refreshed as each charge settles and cleared when the
		 * commitment ends — null therefore means "none expected", which covers both an ended
		 * commitment and one whose rail has not yet said.
		 */
		nextChargeAt: at('next_charge_at'),
		/** business time: when it stopped. null while it is live — see the check below. */
		endedAt: at('ended_at'),

		createdAt: createdAt(),
		updatedAt: updatedAt()
		// append new columns below this line — see rule 1 at the top of this file. this table
		// ends at `updated_at` rather than at `archived_at`, for the reason the header gives.
	},
	(t) => [
		check('recurring_plan_interval_check', enumCheck(t.interval, RECURRING_INTERVALS)),
		check('recurring_plan_status_check', enumCheck(t.status, RECURRING_PLAN_STATUSES)),
		check('recurring_plan_provider_check', enumCheck(t.provider, PAYMENT_PROVIDERS)),
		check('recurring_plan_currency_check', currencyCheck(t.currency)),
		// `> 0` for the reason `donation_total_minor_positive_check` gives: a zero-amount
		// commitment is the shape a half-parsed submit produces, and every charge it made
		// would be a donation the ledger then refuses mid-batch.
		check('recurring_plan_amount_minor_positive_check', sql`${t.amountMinor} > 0`),
		// `notNull` does not say "carries an id" — `''` satisfies it, and a blank subscription
		// id would satisfy the unique index exactly once and then collide with the next blank
		// one, i.e. it fails as a mysterious duplicate on some later donor's commitment.
		check(
			'recurring_plan_provider_subscription_id_not_blank_check',
			notBlank(t.providerSubscriptionId)
		),
		check('recurring_plan_provider_customer_id_not_blank_check', notBlank(t.providerCustomerId)),
		/**
		 * `status` and `ended_at` are two halves of one fact and cannot disagree: a live
		 * commitment has not ended, and one that has ended says when.
		 *
		 * this is the one cross-column check on the table, and it is structural rather than
		 * policy — which is the line `donation`'s refused amount checks draw. what it stops is
		 * a cancel that writes the status and forgets the timestamp, leaving the dashboard able
		 * to say a commitment stopped and nothing about when.
		 *
		 * no ordering check against `started_at` alongside it: both are business times the
		 * rail reports, and a cancel arriving a millisecond behind a start is a clock rather
		 * than a corruption.
		 */
		check(
			'recurring_plan_ended_at_check',
			sql`(${t.status} = 'active' and ${t.endedAt} is null) or (${t.status} <> 'active' and ${t.endedAt} is not null)`
		),
		/**
		 * one rail-side subscription is one commitment.
		 *
		 * it is both defences at once. a redelivered or retried provisioning collides here
		 * rather than charging a donor under a second commitment — the same database-level
		 * idempotency `payment_provider_txn_idx` gives settlement, and for the same reason:
		 * `batch()` cannot do a read-then-write atomically. and it is the read every later
		 * charge performs, since the subscription id is all a rebill arrives with.
		 *
		 * `provider` leads it for the shape rather than for the selectivity — a unique index
		 * over both columns is what keeps two rails' id spaces from ever having to be assumed
		 * disjoint.
		 */
		uniqueIndex('recurring_plan_provider_subscription_idx').on(
			t.provider,
			t.providerSubscriptionId
		),
		// a donor's commitments, on their record. no index on `form_id` or `status`: a
		// deployment has commitments in the low thousands at most and both of those reads are
		// a full list, and unlike a check an index is a free `CREATE INDEX` the day one
		// proves slow.
		index('recurring_plan_contact_id_idx').on(t.contactId)
	]
);

/**
 * the organization's own identity — the fundraiser's side of a receipt.
 *
 * this is receipt content, never a credential and never something the app is constructed from:
 * nothing fails to boot because it is unset. the deploy-time secrets rule is untouched — no Stripe
 * key, no SMTP auth, no password lives here.
 *
 * exactly one row, ever, and the check below is what makes that true rather than a habit.
 * single-tenant is a schema-wide rule, so there is no `org_id` to key a second row by and
 * nothing that would ever want one.
 *
 * no seeded row, unlike `auth_signing_key` — the singleton this table copies its shape
 * from. that row is seeded by a migration because auth cannot mint a cookie without it; a
 * blank row here would be worse than no row, because the block that reports what a donation form
 * is still missing (../forms/readiness.ts) would read a row of empty strings as filled in. absent
 * means not set. ../org/queries.ts writes it with an upsert for that reason.
 *
 * no `archived_at`: you cannot archive the organization. there is one of it, it is the
 * deployment, and a soft delete would leave receipts with nowhere to read a legal name
 * from — the same reasoning `entry_group` states for its own omission, one table over.
 */
export const orgProfile = sqliteTable(
	'org_profile',
	{
		// not a uuidv7 and deliberately not `$defaultFn`: the row is a singleton, and the
		// check below is what keeps it one — a second row cannot be inserted under any other
		// id, so "which profile is live" is never a query with an ordering in it. copied from
		// `auth_signing_key` in ./auth-schema.ts.
		id: text('id').primaryKey(),

		/**
		 * the organization's legal name — the one field a receipt is legally required to
		 * carry, and the only `notNull` column here.
		 *
		 * the row does not exist until a human saves the form and the parser refuses a blank,
		 * so the row's existence means at minimum a legal name. `notNull` alone would not say
		 * that (`''` satisfies it), which is what the check is for.
		 */
		legalName: text('legal_name').notNull(),

		/**
		 * the organization's employer identification number — nine digits, stored and printed
		 * as `XX-XXXXXXX`.
		 *
		 * this product is for US 501(c)(3) organizations, so the column holds an EIN and
		 * nothing else: `@better-giving/operator/console/org-rules` refuses anything that is not
		 * nine digits
		 * and settles the one spelling of a number an operator may paste four ways, so no
		 * reader formats it again and two deployments cannot print the same number
		 * differently. a fork serving another jurisdiction changes that rule the way it
		 * changes everything else about the deployment (CLAUDE.md).
		 *
		 * `tax_id` and not `ein`, and the column name is the only place that survives: a
		 * rename buys nothing and costs a migration, and CLAUDE.md's "schema names never reach
		 * a screen" is what keeps the two apart — every screen and every receipt says EIN.
		 */
		taxId: text('tax_id'),

		// the org's address, structured rather than one text blob. modelling past what the UI
		// renders (CLAUDE.md): joining these into a receipt block is a template's concern and
		// costs a template edit, while splitting a blob later costs a migration and a data
		// migration over rows nobody can reliably parse.
		addressLine1: text('address_line1'),
		addressLine2: text('address_line2'),
		city: text('city'),
		/** state, province, county — whatever the jurisdiction calls the level under country. */
		region: text('region'),
		postalCode: text('postal_code'),
		/**
		 * deliberately free text, and not `currencyCheck`'s shape one letter shorter.
		 *
		 * ISO alpha-2 was the obvious mirror and it is the wrong trade here. what makes
		 * `currencyCheck` worth a rebuild-to-widen is that 'usd' and 'usd' split the books
		 * while every row reads clean — a silent divergence. a country on a receipt address
		 * sums nothing and groups nothing; a wrong one is visible on the receipt itself.
		 * against that, `glob '[A-Z][A-Z]'` would not prove membership either (it takes 'ZZ'),
		 * while it would commit every consumer to codes: a 250-entry country list this repo
		 * does not have, in a `<select>` on the console, and a code -> name map in the
		 * receipt template. and the asymmetry runs the other way from the usual one — dropping
		 * this check later is the table rebuild rule 2 describes, whereas a structured
		 * `country_code` column added beside it later is a plain `ADD COLUMN` (rule 1).
		 */
		country: text('country'),

		/**
		 * where operational mail goes — a failed webhook, a daily summary. not a donor-facing
		 * address and not a credential: SMTP auth is a deploy-time secret and stays one.
		 */
		notificationEmail: text('notification_email'),

		createdAt: createdAt(),
		updatedAt: updatedAt(),
		// append new columns below this line — see rule 1 at the top of this file.

		/**
		 * the sentence a donation form states about what the donor got back, where this
		 * organization words it differently from the standard one.
		 *
		 * **empty is the ordinary state and means the standard wording.** this product is for US
		 * 501(c)(3) organizations, whose sentence is the same one —
		 * `SUGGESTED_DEDUCTIBILITY_STATEMENT` in `packages/operator/src/deductibility.ts` — and
		 * `servedDeductibilityStatement` in `../org/deductibility.ts` is what puts it on every
		 * config served from a row that holds none. so nothing seeds this column, no default is
		 * declared, and nothing is refused while it is null.
		 *
		 * **no screen writes it.** `saveOrgProfile` in `../org/queries.ts` leaves it out of the
		 * columns it states, so a value survives every profile save an operator makes. an
		 * organization whose gifts carry a benefit is one fork of this repository with an engineer
		 * on it, and `DEPLOY.md` is where changing the wording is written down.
		 *
		 * an org-level fact and not a per-form one, which is why it is here and not on `form`:
		 * every form a deployment serves solicits under the same registration.
		 * `FormConfig.deductibilityStatement` in packages/form/src/v1.ts is the consumer, and that
		 * type requires the string rather than marking it optional — packages/form/src/config.ts
		 * hard-nulls a config that omits it, which is the embed refusing a config no deployment of
		 * this repository serves.
		 */
		deductibilityStatement: text('deductibility_statement')
	},
	(t) => [
		// the singleton constraint. `auth_signing_key_id_check` is the precedent.
		check('org_profile_id_check', sql`${t.id} = 'default'`),
		// `notNull` does not keep the promise the column comment makes — `''` satisfies it,
		// and `STRICT` constrains type rather than content, so a blank string is a well-typed
		// text. a receipt with a blank legal name is the one thing this row exists to prevent.
		check('org_profile_legal_name_not_blank_check', notBlank(t.legalName)),
		// null means "not stated", `''` means "stated as nothing" — only the second is a bug,
		// and it is the one an empty input submits. ../org/org-input.ts turns a blank into
		// null before it gets here; these are what hold when something else writes the row.
		check('org_profile_tax_id_not_blank_check', optionalNotBlank(t.taxId)),
		check('org_profile_address_line1_not_blank_check', optionalNotBlank(t.addressLine1)),
		check('org_profile_address_line2_not_blank_check', optionalNotBlank(t.addressLine2)),
		check('org_profile_city_not_blank_check', optionalNotBlank(t.city)),
		check('org_profile_region_not_blank_check', optionalNotBlank(t.region)),
		check('org_profile_postal_code_not_blank_check', optionalNotBlank(t.postalCode)),
		check('org_profile_country_not_blank_check', optionalNotBlank(t.country)),
		check('org_profile_notification_email_not_blank_check', optionalNotBlank(t.notificationEmail)),
		check(
			'org_profile_deductibility_statement_not_blank_check',
			optionalNotBlank(t.deductibilityStatement)
		)
	]
);

/**
 * the sites this deployment's donation forms may be loaded on — one row per site, typed once
 * for the whole deployment rather than per form.
 *
 * a site is a full origin with its scheme, `https://give.example.org`, because that is what a
 * browser puts in an `Origin` header and what `../api/cors.ts` compares against literally. a bare
 * host name would be a stored value that matches nothing and refuses every donation with no message
 * attached, which is the failure `@better-giving/operator/origins` exists to catch at the parse and
 * the scheme check below is the floor under.
 *
 * `form.allowed_origins` above holds the values a form was ticked on to, not references into
 * this table, and there is deliberately no foreign key between them. `readFormOrigins` in
 * ../forms/queries.ts answers a CORS preflight from that one column on a public,
 * unauthenticated, edge-cached path, and a foreign key would put a join there to answer a
 * question the row already answers. so this table is a source of options and a rule the two
 * write points keep, never a constraint the database enforces — a form left holding a site
 * this table no longer has is a stale row a screen clears, not a broken reference.
 *
 * rows rather than a JSON column on a singleton, unlike `form.allowed_origins` one table up.
 * the two are the same list read at different scales and the difference is what each has to
 * answer: a form's column is read whole, on every `/api/v1` request, by an id the request
 * carries, and never asked anything about an individual entry. this list is edited a row at a
 * time on a screen, has to refuse a duplicate rather than tidy one away at read time, and is
 * the one a check constraint can stand under — `site_origin_scheme_check` is a property of one
 * site, and a JSON array can only be asserted to be an array (see
 * `form_allowed_origins_array_check`, which says nothing about what is in it). modelling past
 * what the UI renders points the same way: a site is a thing this deployment holds, so it gets
 * a row with a `created_at` saying when it was first listed rather than a string in a blob.
 *
 * no `archived_at`. a site is removed rather than retired, and the removal is refused while any
 * form still lists it — nothing points at this row, so there is no history to keep and no
 * reference to leave dangling.
 */
export const site = sqliteTable(
	'site',
	{
		id: id(),
		/**
		 * the address, stored exactly as it was typed and trimmed — never lower-cased and never
		 * otherwise rewritten. `new URL(...).origin` has already lower-cased the host by the time
		 * `readOriginList` accepts the line, and rewriting it further here would move the stored
		 * value away from the one a browser sends.
		 */
		origin: text('origin').notNull(),
		/**
		 * where this site sits in the operator's own list, from 0.
		 *
		 * the list is re-rendered from this table on the screen that types it and as the tick
		 * boxes on every form screen, so an order derived from anything else — the address, the
		 * write time — is a list that comes back re-sorted, which reads as the form having eaten
		 * an edit. that is the same rule `@better-giving/operator/origins` keeps about first-seen order
		 * within one parse; this is where it survives the round trip.
		 *
		 * no unique index on it, deliberately. sqlite enforces a unique index per statement, so
		 * two sites swapping places inside one `batch()` would fail on the first of the two
		 * writes — and the property worth having is an order, not a bijection.
		 */
		position: integer('position').notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
		// append new columns below this line — see rule 1 at the top of this file.
	},
	(t) => [
		/**
		 * the scheme is the whole value of the column: `../api/cors.ts` compares a browser's
		 * `Origin` header to this list literally, so an entry without one is an entry that can
		 * never match. the parse refuses it in front of the operator who typed it; this is the
		 * floor under a hand-run `wrangler d1 execute`, which predates and outlives any parser.
		 *
		 * lower-case literals and not `lower(origin)`, because a stored value's scheme is already
		 * lower case by construction: `readOriginList` accepts a line only when
		 * `new URL(line).origin === line`, and `new URL` lower-cases the protocol — so
		 * `HTTPS://give.example.org` is refused at the parse rather than normalised, and a row
		 * carrying one is a row nothing in this app wrote.
		 *
		 * `substr` and never `origin like 'https://%'`: `_` is a like wildcard, so the like form
		 * accepts `httpsX//…` and proves nothing (the same trap `form_id_length_check` names).
		 */
		check(
			'site_origin_scheme_check',
			sql`substr(${t.origin}, 1, 8) = 'https://' or substr(${t.origin}, 1, 7) = 'http://'`
		),
		/**
		 * subsumed by the scheme check above — nothing blank starts with a scheme — and kept
		 * anyway, because each check here names one property the column has and this table is
		 * read far from the constraint. dropping either later is the table rebuild rule 2
		 * describes rather than an edit, so they are stricter than the minimum on purpose.
		 */
		check('site_origin_not_blank_check', notBlank(t.origin)),
		check('site_position_check', sql`${t.position} >= 0`),
		/**
		 * the list is a set. a site listed twice says nothing an allowlist can act on — the
		 * comparison is a membership test — and it renders as two identical boxes and two
		 * identical tick boxes with no way to tell which one a `Remove` was aimed at.
		 *
		 * it is also what the whole-list write conflicts on, so a save can re-position a site
		 * that was already listed instead of minting a second row for it.
		 */
		uniqueIndex('site_origin_idx').on(t.origin)
	]
);

export type Contact = typeof contact.$inferSelect;
export type NewContact = typeof contact.$inferInsert;
export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type EntryGroup = typeof entryGroup.$inferSelect;
export type NewEntryGroup = typeof entryGroup.$inferInsert;
export type LedgerEntry = typeof ledgerEntry.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntry.$inferInsert;
export type Program = typeof program.$inferSelect;
export type NewProgram = typeof program.$inferInsert;
export type Form = typeof form.$inferSelect;
export type NewForm = typeof form.$inferInsert;
export type Donation = typeof donation.$inferSelect;
export type NewDonation = typeof donation.$inferInsert;
export type LineItem = typeof lineItem.$inferSelect;
export type NewLineItem = typeof lineItem.$inferInsert;
export type Payment = typeof payment.$inferSelect;
export type NewPayment = typeof payment.$inferInsert;
export type RecurringPlan = typeof recurringPlan.$inferSelect;
export type NewRecurringPlan = typeof recurringPlan.$inferInsert;
export type OrgProfile = typeof orgProfile.$inferSelect;
export type NewOrgProfile = typeof orgProfile.$inferInsert;
export type Site = typeof site.$inferSelect;
export type NewSite = typeof site.$inferInsert;

// tables better-auth owns, kept in their own file because their columns are dictated
// by better-auth's core schema rather than by the domain. re-exported here — not
// added to drizzle.config.ts — so that this module stays the single entry point both
// `drizzle-kit generate` and `./client.ts` read, and `Db` keeps covering every table.
// ./auth-schema.ts imports nothing from this file, so the re-export is not a cycle.
export * from './auth-schema';
