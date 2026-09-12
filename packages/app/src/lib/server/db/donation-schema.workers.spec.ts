import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS, ROLLUPS, postableId } from './accounts';
import { createDb, type Db } from './client';
import { lineItem } from './schema';

// the constraints on `form` / `donation` / `line_item` / `payment` that are one-way.
//
// why this file exists and what it covers. sqlite cannot ALTER a check or a foreign key
// in or out — either is the 12-step table rebuild, whose `DROP TABLE` D1 blocks the
// moment a child table holds rows (see the header of `migrations/0000_initial_schema.sql`
// and rule 2 in schema.ts). so every constraint asserted below had to be right at birth —
// all four tables are created in that one file — and the cost of one
// being wrong is not a follow-up migration: it is a table that cannot be changed. these
// probes run against the committed `migrations/` SQL applied to a real D1 — see
// ./d1.setup.ts — so they test what deploys, not a schema rebuilt from a snapshot.
//
// what is not here, stated honestly. what is left out is two dozen CHECKs every bit as
// one-way as the ones below. three groups of those are covered — the ordering check, the
// enum checks, and the pair on `form.id`, each argued at its own describe. what is
// uncovered is the four groups listed here, and every one is a redundancy call rather than
// a cost one. naming them is deliberate: an omission nobody can name is indistinguishable
// from one nobody noticed.
//
//   the sign/floor checks — `form_min_minor_check`, `form_max_minor_check`,
//   `donation_fee_minor_check`, `donation_tax_minor_check`,
//   `donation_non_deductible_minor_check`, `line_item_quantity_check`,
//   `line_item_unit_price_minor_check`, `line_item_line_total_minor_check`,
//   `line_item_tax_minor_check`. one shape (`> 0` or `>= 0` against a literal), asserted
//   twice already by the `> 0` pair below, and a third copy of `values (…, -1, …)` proves
//   nothing the second did not.
//
//   the JSON shape checks — `form_suggested_amounts_array_check`,
//   `form_allowed_origins_array_check`, `form_copy_object_check`. same body from one helper
//   across three columns, and `contact_attributes_object_check` is the precedent. they are also
//   the only group here that is exercised by the file's successes rather than skipped: every
//   form inserted below omits all three columns, so all three `DEFAULT '[]'` / `'{}'` literals
//   are written through the check on every passing test. `form` carries no `payment_methods` and
//   no `frequencies`, so `form_payment_methods_array_check` and `form_frequencies_array_check` are
//   absent with them — the describe at the end of this file is what holds that absence.
//
//   the remaining not-blank checks — `line_item_label_not_blank_check` and the nullable
//   pair `donation_source_not_blank_check` / `donation_origin_not_blank_check`. what is
//   worth pinning in this family is the codepoint set, not the column, and it is pinned
//   twice below: on `form.name` with the vertical tab and the NBSP spelled out, and on
//   `payment.provider_txn_id`, which is the same `is null or trim(…)` shape the donation
//   pair uses.
//
//   the four single-column FOREIGN KEYS — `donation.contact_id`, `donation.form_id`,
//   `line_item.donation_id`, `payment.donation_id`. these split into two claims and neither
//   is unguarded. that foreign keys are enforced at all on this connection is the part that
//   could plausibly be off — enforcement is a per-connection pragma — and it is what the two
//   composite-FK rejections below demonstrate. that each clause is present in the DDL is
//   read from sqlite's own catalogue, exhaustively, by the `pragma_foreign_key_list` join in
//   ./strict.workers.spec.ts, which enumerates every FK on every table rather than a list.
//
// that is a judgement about redundancy, not about cost. anything with its own body rather
// than its own column belongs below — which is the rule that pulled `form_id_length_check`
// out of this list: its `length(…) >= 12` is shared with nothing in the schema.
//
// why the extended result code's name and never the prose. D1 flattens an error to a
// message and appends two symbolic codes, the primary one and then the extended one; the
// sentence in front of them is upstream's to reword, and matching it would turn this suite
// red with no schema change. there is no numeric `errcode` on a D1 error. what is asserted
// below is the extended code, never the primary — `SQLITE_CONSTRAINT` is what every
// constraint in the schema raises, so it separates none of these probes from each other,
// and ./rejection.ts is where that pair is argued. where a check is what should have
// fired, the constraint name is asserted alongside the code — the code alone says only
// "some check failed", and which one fired is usually the whole claim.
//
// every query here is scoped to its own rows. `@cloudflare/vitest-pool-workers` gives
// per-file storage, not per-test: writes accumulate down the file, and a probe that
// succeeds leaves a row behind for every test after it. so no assertion counts or joins
// over a whole table — an unscoped `count(*)` here passed only because every other insert
// into that table happened to be a rejection probe, which is a property of the file's
// current contents rather than of the schema.
//
// nothing in this file inserts into `ledger_entry` or `entry_group`, and it is not for want
// of a probe: ../ledger/sole-writer.spec.ts scans the source tree and fails on either
// pattern outside `src/lib/server/ledger/`. the ledger's own postable-account probes
// therefore live in ../ledger/posting.workers.spec.ts, which is exempt.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';
const SQLITE_CONSTRAINT_UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';

/**
 * runs `fn`, requires D1 to have rejected it, and hands back the message. throws rather
 * than returning a sentinel when the statement succeeds, so a probe that stops being
 * rejected fails loudly instead of passing quietly. (same helper as
 * ./strict.workers.spec.ts — duplicated rather than shared, because a spec helper that
 * travels between files is one more thing to keep in agreement than either file needs.)
 */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

const CONTACT_ID = '019fb100-0000-7000-8000-000000000001';
const DONATION_ID = '019fb100-0000-7000-8000-000000000002';

/**
 * the drizzle handle, for the one probe that has to go through it.
 *
 * everything else here is raw `env.DB` on purpose — a check is a property of the SQL that
 * deploys, and binding values directly is the shortest way to state one. drizzle is
 * required exactly where the claim is about what drizzle emits; see
 * `insertLineItemThroughDrizzle`.
 */
let db: Db;

/** a payer and a gift for the child rows to hang off. the chart of accounts is seeded. */
beforeAll(async () => {
	db = createDb(env.DB);
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, created_at, updated_at)
		 values (?, 'individual', 'Probe Donor', 0, 0)`
	)
		.bind(CONTACT_ID)
		.run();
	await env.DB.prepare(
		`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
		 values (?, ?, 10000, 'USD', 0, 0)`
	)
		.bind(DONATION_ID, CONTACT_ID)
		.run();
});

/**
 * a line item with `revenue_account_is_postable` bound explicitly, which only a probe ever
 * does — the column is the constant half of a composite foreign key and every real writer
 * omits it (see `insertLineItemDefaulted` below). binding it is what lets the "pin lowered
 * to 0" test exist at all.
 */
const insertLineItem = (id: string, accountId: string, isPostable: number) =>
	env.DB.prepare(
		`insert into line_item
		   (id, donation_id, label, quantity, unit_price_minor, line_total_minor,
		    revenue_account_id, revenue_account_is_postable)
		 values (?, ?, 'probe', 1, 10000, 10000, ?, ?)`
	)
		.bind(id, DONATION_ID, accountId, isPostable)
		.run();

/**
 * the pin column left out of the column list, so sqlite supplies its `DEFAULT 1`.
 *
 * not the production path, which is what motivates the drizzle probe below: no writer in
 * this app builds SQL text, and drizzle never omits a column. what this probe covers is the
 * SQL-level default, which is a real and separate claim — a hand-run `wrangler d1 execute`
 * and an import script both take it.
 */
const insertLineItemDefaulted = (id: string, accountId: string) =>
	env.DB.prepare(
		`insert into line_item
		   (id, donation_id, label, quantity, unit_price_minor, line_total_minor,
		    revenue_account_id)
		 values (?, ?, 'probe', 1, 10000, 10000, ?)`
	)
		.bind(id, DONATION_ID, accountId)
		.run();

/**
 * the actual production path: the same insert through `createDb(env.DB)`, with the pin
 * column omitted from the values object.
 *
 * it is a different claim from either raw-SQL probe above, and the one no test made. the
 * two defaults on `revenue_account_is_postable` are a pair — the `DEFAULT 1` in the
 * migration and the `.default(1)` in schema.ts — because drizzle names every column of the
 * table in an insert and never emits the `DEFAULT` keyword, which sqlite would not accept
 * in a `VALUES` list anyway. what it emits for a key absent from the values object is
 * decided entirely by the schema, and the two cases were read off `.toSQL()` rather than
 * assumed:
 *
 *   with    `.default(1)`:  insert into "t" ("id", "pin") values (?, ?)   params ['x', 1]
 *   without `.default(1)`:  insert into "t" ("id", "pin") values (?, null)
 *
 * the second is not a fallback to the column's SQL default — it is a literal `null` written
 * into the values list, so the migration's `DEFAULT 1` never gets the chance to apply. a
 * column with a SQL default and no drizzle default therefore trips NOT NULL on every real
 * insert while both probes above stay green, which is exactly the shape of failure that
 * reaches production untested.
 */
const insertLineItemThroughDrizzle = (id: string) =>
	db.insert(lineItem).values({
		id,
		donationId: DONATION_ID,
		label: 'probe',
		unitPriceMinor: 10_000,
		lineTotalMinor: 10_000,
		revenueAccountId: postableId('donationsDeductible')
	});

describe("line_item cannot name a rollup account, and that is the database's doing", () => {
	// the runtime twin of `PostableAccountId` in ./postable.ts. the brand stops a caller
	// in the type checker; this stops a hand-written `wrangler d1 execute`, a CSV import,
	// and any future writer that never sees the brand.
	//
	// three tables carry this shape. the double-counting hazard — one entry against a rollup
	// makes every report over that subtree double-count, with no error anywhere — is
	// `ledger_entry`'s, and all three are guarded:
	//   `ledger_entry` — the double-counting one. probed in ../ledger/posting.workers.spec.ts,
	//                    because sole-writer.spec.ts forbids an insert into it from this file.
	//   `form`         — the id every gift through a form inherits. probed below.
	//   `line_item`    — mis-attributes what a gift was for. probed here.

	it('accepts a postable revenue account', async () => {
		// the positive control, and it is not optional: without it every assertion below
		// would still pass against a composite FK that rejects everything — a typo in the
		// parent index, say — and the constraint would look enforced while being useless.
		await insertLineItem('li-postable', POSTING_ACCOUNTS.donationsDeductible.id, 1);
		const row = await env.DB.prepare('select revenue_account_id as a from line_item where id = ?')
			.bind('li-postable')
			.first();
		expect(row).toEqual({ a: POSTING_ACCOUNTS.donationsDeductible.id });
	});

	it('resolves the foreign key with the pin column omitted, on its SQL DEFAULT 1', async () => {
		// the migration's default, which is what a hand-run `wrangler d1 execute` or an import
		// script takes. schema.ts says never to set `revenue_account_is_postable` at a call
		// site, so the composite FK has to resolve against a value nobody supplied — a
		// different claim from "it resolves when a probe binds 1 by hand". a schema that lost
		// the default (or gained a `NULL` one) would keep every other test in this describe
		// green and reject every insert that omits the column.
		await insertLineItemDefaulted('li-defaulted', POSTING_ACCOUNTS.donationsDeductible.id);
		const row = await env.DB.prepare(
			'select revenue_account_is_postable as pin from line_item where id = ?'
		)
			.bind('li-defaulted')
			.first();
		expect(row).toEqual({ pin: 1 });
	});

	it('resolves it through drizzle too, on the SCHEMA-level default', async () => {
		// the production path, and until this probe the untested one — see
		// `insertLineItemThroughDrizzle`. drizzle names every column and binds `.default(1)`
		// from schema.ts as a parameter, so this exercises the other half of the pair: the
		// probe above would stay green with the schema-level default deleted, and every real
		// line-item insert in the app would then bind `null` and trip NOT NULL.
		await insertLineItemThroughDrizzle('li-drizzle');
		const row = await env.DB.prepare(
			'select revenue_account_is_postable as pin, revenue_account_id as a from line_item where id = ?'
		)
			.bind('li-drizzle')
			.first();
		expect(row).toEqual({ pin: 1, a: POSTING_ACCOUNTS.donationsDeductible.id });
	});

	it('refuses the 4100 rollup, on the composite foreign key', async () => {
		// `4100 Donations` is a real, live row in `account` — a single-column FK to
		// `account(id)` would accept it happily. the pair `(id, is_postable)` is what does
		// not resolve, because the rollup's `is_postable` is 0 and this column is pinned
		// to 1. it costs no extra read: the unique index on the parent does the work.
		const message = await rejection(() =>
			insertLineItemDefaulted('li-rollup', ROLLUPS.donations.id)
		);
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});

	it('refuses to let the pin be lowered to 0 to reach a rollup anyway', async () => {
		// the loophole the check closes. matching `(4100, 0)` against the parent index
		// would satisfy the foreign key perfectly — so the FK alone is not the constraint;
		// the check holding this side at 1 is the other half of it.
		const message = await rejection(() => insertLineItem('li-pin', ROLLUPS.donations.id, 0));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('line_item_revenue_account_postable_check');
	});
});

describe('a form cannot name a rollup account either', () => {
	// `form.revenue_account_id` is where the chart of accounts gets hidden: a fundraiser
	// picks a form and the fund rides along, so this column is what every gift through that
	// form eventually posts to. a plain `REFERENCES account(id)` here accepts the `4100`
	// rollup — and the failure then lands on the first gift, in `line_item`, on a fork nobody
	// can reach, about a row a staff screen wrote weeks earlier. same composite FK as
	// `line_item`, so it fails on the form instead.

	/** the production shape: the pin column is not named, so it takes its `DEFAULT 1`. */
	const insertFormDefaulted = (id: string, accountId: string) =>
		env.DB.prepare(
			`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
			 values (?, 'probe', ?, 'USD', 0, 0)`
		)
			.bind(id, accountId)
			.run();

	it('accepts a postable revenue account with the pin column omitted', async () => {
		// positive control and the default-1 probe in one: no writer in the app names
		// `revenue_account_is_postable`, so if the default were lost every form insert would
		// fail while a probe that bound 1 by hand kept passing.
		await insertFormDefaulted('frm_probepostable1', POSTING_ACCOUNTS.donationsDeductible.id);
		const row = await env.DB.prepare(
			'select revenue_account_is_postable as pin from form where id = ?'
		)
			.bind('frm_probepostable1')
			.first();
		expect(row).toEqual({ pin: 1 });
	});

	it('refuses the 4100 rollup, on the composite foreign key', async () => {
		const message = await rejection(() =>
			insertFormDefaulted('frm_proberollup001', ROLLUPS.donations.id)
		);
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});

	it('refuses to let the pin be lowered to 0 to reach a rollup anyway', async () => {
		// `(4100, 0)` matches the parent index perfectly, so the FK alone is not the
		// constraint — the check pinning this side to 1 is the other half.
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into form
					   (id, name, revenue_account_id, revenue_account_is_postable,
					    currency, created_at, updated_at)
					 values ('frm_probepin000000', 'probe', ?, 0, 'USD', 0, 0)`
			)
				.bind(ROLLUPS.donations.id)
				.run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('form_revenue_account_postable_check');
	});
});

describe('a form pins a program or it does not, and the two columns cannot disagree', () => {
	// `program_mode` and `program_id` are one decision written in two columns, and each pairing the
	// check refuses is one a staff screen can produce. a `pinned` form naming no cause serves a
	// donor a picker-less form that credits nothing; a cause left behind by a mode moved back to
	// `none` records every gift against a programme the form has stopped offering, and neither row
	// looks wrong in a list.
	//
	// a table-level check, and sqlite can ALTER one neither in nor out: `donation.form_id` and
	// `recurring_plan.form_id` both point at `form`, which is what makes changing this pair a
	// hand-edited table rebuild rather than an `ALTER TABLE`.

	/** the cause a pinned form may name. arbitrary and local to this file, like every id here. */
	const PROGRAM_ID = '019fb100-0000-7000-8000-000000000101';

	const insertForm = (id: string, mode: string, programId: string | null) =>
		env.DB.prepare(
			`insert into form (id, name, revenue_account_id, currency, program_mode, program_id,
			                   created_at, updated_at)
			 values (?, 'probe', ?, 'USD', ?, ?, 0, 0)`
		)
			.bind(id, POSTING_ACCOUNTS.donationsDeductible.id, mode, programId)
			.run();

	beforeAll(async () => {
		await env.DB.prepare(
			`insert into program (id, name, status, created_at, updated_at)
			 values (?, 'Probe Programme', 'active', 0, 0)`
		)
			.bind(PROGRAM_ID)
			.run();
	});

	it('defaults to naming no programme at all, which is what an existing form is', async () => {
		// the rebuild carried every form across without either column, so the SQL default is the
		// value every form written before this migration holds. a default of anything else would
		// have failed the copy at the one-way door.
		await env.DB.prepare(
			`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
			 values ('frm_probemodedflt', 'probe', ?, 'USD', 0, 0)`
		)
			.bind(POSTING_ACCOUNTS.donationsDeductible.id)
			.run();
		const row = await env.DB.prepare(
			'select program_mode as mode, program_id as program from form where id = ?'
		)
			.bind('frm_probemodedflt')
			.first();
		expect(row).toEqual({ mode: 'none', program: null });
	});

	it('accepts `pinned` with the cause it pins', async () => {
		await insertForm('frm_probepinned001', 'pinned', PROGRAM_ID);
		const row = await env.DB.prepare('select program_id as program from form where id = ?')
			.bind('frm_probepinned001')
			.first();
		expect(row).toEqual({ program: PROGRAM_ID });
	});

	it('accepts `choice` with none, which is the donor picking', async () => {
		await insertForm('frm_probechoice001', 'choice', null);
		const row = await env.DB.prepare('select program_mode as mode from form where id = ?')
			.bind('frm_probechoice001')
			.first();
		expect(row).toEqual({ mode: 'choice' });
	});

	it('refuses `pinned` naming nothing', async () => {
		const message = await rejection(() => insertForm('frm_probepinbare01', 'pinned', null));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('form_program_pinned_check');
	});

	it('refuses `none` still holding a cause', async () => {
		const message = await rejection(() => insertForm('frm_probenoneheld1', 'none', PROGRAM_ID));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('form_program_pinned_check');
	});

	it('refuses `choice` still holding a cause, so the pairing is not just about `none`', async () => {
		const message = await rejection(() => insertForm('frm_probechoiceheld', 'choice', PROGRAM_ID));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('form_program_pinned_check');
	});

	it('refuses a mode outside none/pinned/choice', async () => {
		const message = await rejection(() => insertForm('frm_probemodebogus', 'every', null));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('form_program_mode_check');
	});

	it('refuses a cause no programme carries', async () => {
		// the pairing check passes here — `pinned` with a non-null id — so what rejects the row is
		// the foreign key, which is the half that makes the column a pointer rather than a string.
		const message = await rejection(() =>
			insertForm('frm_probeghostprg1', 'pinned', '019fb100-0000-7000-8000-0000000000ff')
		);
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});

	it('records a gift against a cause, and against none at all', async () => {
		// `donation.program_id` arrived by `ALTER TABLE ... ADD COLUMN`, so it carries a foreign key
		// and no check: null is every gift entered by staff and every gift on a form pinning nothing.
		await env.DB.prepare(
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at,
			                       program_id)
			 values (?, ?, 5000, 'USD', 0, 0, ?)`
		)
			.bind('019fb100-0000-7000-8000-000000000102', CONTACT_ID, PROGRAM_ID)
			.run();
		const row = await env.DB.prepare('select program_id as program from donation where id = ?')
			.bind('019fb100-0000-7000-8000-000000000102')
			.first();
		expect(row).toEqual({ program: PROGRAM_ID });
		// the gift the file-level `beforeAll` wrote names no column of ours at all.
		const bare = await env.DB.prepare('select program_id as program from donation where id = ?')
			.bind(DONATION_ID)
			.first();
		expect(bare).toEqual({ program: null });
	});

	it('refuses a gift against a cause no programme carries', async () => {
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into donation (id, contact_id, total_minor, currency, received_at, created_at,
				                       program_id)
				 values (?, ?, 5000, 'USD', 0, 0, '019fb100-0000-7000-8000-0000000000ff')`
			)
				.bind('019fb100-0000-7000-8000-000000000103', CONTACT_ID)
				.run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});
});

describe('currency is uppercase on every table that stores one', () => {
	// Stripe reports currency lowercase, so this is the live path, not a hypothetical:
	// without the `upper()` half, 'usd' and 'usd' are two currencies that group and sum
	// separately while every row reads clean. the check body is one helper in schema.ts
	// so the four columns cannot drift apart; these are the proof that they have not.

	it('refuses a lowercase currency on form', async () => {
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
				 values ('frm_probelowercase', 'probe', ?, 'usd', 0, 0)`
			)
				.bind(POSTING_ACCOUNTS.donationsDeductible.id)
				.run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('form_currency_check');
	});

	it('refuses a lowercase currency on donation', async () => {
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
				 values ('d-lowercase', ?, 10000, 'usd', 0, 0)`
			)
				.bind(CONTACT_ID)
				.run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('donation_currency_check');
	});

	it('refuses a lowercase currency on payment', async () => {
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into payment
				   (id, donation_id, amount_minor, currency, direction, method, status,
				    occurred_at, created_at)
				 values ('p-lowercase', ?, 10000, 'usd', 'inbound', 'cash', 'succeeded', 0, 0)`
			)
				.bind(DONATION_ID)
				.run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_currency_check');
	});
});

describe('a gift has to be for some amount', () => {
	it('refuses total_minor = 0 on donation', async () => {
		// `> 0`, not `>= 0`. a zero-total donation is what a half-parsed form submit
		// produces, and left to stand it posts an entry group of zero-amount lines that
		// `ledger_entry_amount_minor_not_zero_check` rejects mid-batch — the whole gift
		// rolled back, reported from the ledger, about a value this row let through.
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
				 values ('d-zero', ?, 0, 'USD', 0, 0)`
			)
				.bind(CONTACT_ID)
				.run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('donation_total_minor_positive_check');
	});

	it('refuses amount_minor = 0 on payment', async () => {
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into payment
				   (id, donation_id, amount_minor, currency, direction, method, status,
				    occurred_at, created_at)
				 values ('p-zero', ?, 0, 'USD', 'inbound', 'cash', 'succeeded', 0, 0)`
			)
				.bind(DONATION_ID)
				.run()
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_amount_minor_positive_check');
	});
});

describe('the ordering CHECK on a form’s amount bounds', () => {
	// `form_min_max_minor_check` is the one constraint in this family whose absence is not
	// a wrong row but a dead form: `min_minor > max_minor` is satisfiable by no amount at
	// all, so `/api/v1` rejects every gift the form ever receives and the staff screen that
	// wrote the pair reports nothing wrong. what a fundraiser sees is "the form is broken",
	// with the cause two screens away — and the bounds are re-checked server-side against
	// this record on every request, so this check is the floor under that check rather than
	// a duplicate of it.
	//
	// each bound has its own `>= 0` check as well; those are the redundant-shape family the
	// header excludes. this one has its own body and names two columns, which also means
	// withdrawing it later would block `DROP COLUMN` on both.

	const insertForm = (id: string, min: number | null, max: number | null) =>
		env.DB.prepare(
			`insert into form (id, name, revenue_account_id, currency, min_minor, max_minor,
			                   created_at, updated_at)
			 values (?, 'probe', ?, 'USD', ?, ?, 0, 0)`
		)
			.bind(id, POSTING_ACCOUNTS.donationsDeductible.id, min, max)
			.run();

	it('refuses an inverted pair', async () => {
		const message = await rejection(() => insertForm('frm_probeinverted0', 5000, 1000));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('form_min_max_minor_check');
	});

	it('accepts an equal pair, so a fixed-amount form is expressible', async () => {
		// the boundary, pinned so nobody tightens `<=` into `<`. one appeal with a single
		// permitted gift size is a real form, and it is the shape that would break silently.
		await insertForm('frm_probeequalpair', 2500, 2500);
		const row = await env.DB.prepare(
			'select min_minor as lo, max_minor as hi from form where id = ?'
		)
			.bind('frm_probeequalpair')
			.first();
		expect(row).toEqual({ lo: 2500, hi: 2500 });
	});

	it('accepts either bound absent, which is the normal state', async () => {
		// the `is null` disjuncts are documentation in the migration (a check is satisfied by
		// null on its own), and this is what says they were not written as `>= 0` on a null by
		// mistake: an unbounded form is the default a fundraiser gets.
		await insertForm('frm_probenobounds0', null, null);
		await insertForm('frm_probeminonly00', 1000, null);
		await insertForm('frm_probemaxonly00', null, 1000);
		const { results } = await env.DB.prepare(
			`select id from form where id in
			   ('frm_probenobounds0', 'frm_probeminonly00', 'frm_probemaxonly00') order by id`
		).all<{ id: string }>();
		expect(results).toHaveLength(3);
	});
});

describe('the two CHECKs on a form’s public id', () => {
	// `form.id` is the one id in this schema that is not a UUIDv7, and the reason is that it
	// is public: it goes in the org's own HTML, it is what a fundraiser pastes into a page we
	// cannot reach, and it is the whole address of an unauthenticated, payment-initiating
	// `/api/v1`. the migration deliberately declines a prefix check on it — pinning the
	// format would make changing it a rebuild of a table `donation` references — so these two
	// CHECKs are the entire floor under whatever mints the id.
	//
	// they are complementary, not redundant, which is why the pair is probed rather than one
	// standing in for the other: twelve spaces satisfy `length >= 12` and are caught only by
	// the not-blank check, while a nine-character id is a perfectly non-blank string and is
	// caught only by the length check. each probe below violates exactly one of the two, so
	// no assertion here depends on which check sqlite evaluates first.
	//
	// this is also why `form_id_length_check` is probed while the other not-blank checks are
	// excluded in the header: `length(…) >= 12` is its own body, shared with nothing else in
	// the schema, so no other test in this file stands in for it.

	const insertFormId = (id: string) =>
		env.DB.prepare(
			`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
			 values (?, 'probe', ?, 'USD', 0, 0)`
		)
			.bind(id, POSTING_ACCOUNTS.donationsDeductible.id)
			.run();

	it('refuses an id shorter than twelve characters', async () => {
		// the entropy floor, and it is a security constraint rather than a formatting one:
		// with the four-character `frm_` prefix, `>= 12` is what keeps at least eight
		// characters of randomness in an id that addresses an endpoint with no auth in front
		// of it. a minter that got shortened is the way this erodes.
		const message = await rejection(() => insertFormId('frm_short'));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('form_id_length_check');
	});

	it('refuses an id that is twelve characters of whitespace', async () => {
		// the hole the length check alone leaves open, and the proof the not-blank check is
		// not a duplicate of it: this value is long enough to satisfy `length >= 12`, and a
		// form under a blank id is one no snippet can address and no screen can name.
		// written as `repeat` rather than as twelve literal spaces, for the same reason the
		// NBSP probes below are written as escapes — a run of spaces in a diff is a guess.
		const message = await rejection(() => insertFormId(' '.repeat(12)));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('form_id_not_blank_check');
	});

	it('accepts exactly twelve characters, so the bound is `>=` and not `>`', async () => {
		// the boundary, pinned in the direction that breaks silently. an id minter that
		// produces exactly the minimum length is legal today; a later `> 12` would reject
		// every id it makes, at form creation, long after the check stopped being read.
		await insertFormId('frm_12chars0');
		const row = await env.DB.prepare('select id from form where id = ?')
			.bind('frm_12chars0')
			.first();
		expect(row).toEqual({ id: 'frm_12chars0' });
	});
});

describe('the enum CHECKs', () => {
	// every enum in this schema is a check — there are no option tables — so each one is as
	// one-way as the rest of this file, and the value they add is not "a typo is caught":
	// it is that `text` accepts any string, so without them a `direction` of 'refnd' or a
	// `status` of 'complete' stores clean and every read that branches on it takes the
	// wrong arm forever. they are also the family most likely to be quietly dropped by a
	// rebuild, since drizzle derives them from a TS const array that a rebuild re-renders.
	//
	// one probe per column rather than per member: the body comes from `enumCheck` in
	// schema.ts, so what can go wrong is a whole constraint missing, not one member of it.

	const rejects = async (label: string, sql: string, constraint: string) => {
		const message = await rejection(() => env.DB.prepare(sql).run());
		expect(message, label).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message, label).toContain(constraint);
	};

	it('refuses a form status outside draft/live/archived', async () => {
		await rejects(
			'form.status',
			`insert into form (id, name, revenue_account_id, currency, status, created_at, updated_at)
			 values ('frm_probebadstatus', 'probe', '${POSTING_ACCOUNTS.donationsDeductible.id}',
			         'USD', 'published', 0, 0)`,
			'form_status_check'
		);
	});

	// the three on `payment`, which is where a rail's own vocabulary meets ours. Stripe says
	// `canceled`, `charge.refunded`, `card_present` — near-misses for every one of these.
	it('refuses a payment direction outside inbound/refund', async () => {
		await rejects(
			'payment.direction',
			`insert into payment (id, donation_id, amount_minor, currency, direction, method,
			                      status, occurred_at, created_at)
			 values ('p-baddirection', '${DONATION_ID}', 10000, 'USD', 'outbound', 'cash',
			         'succeeded', 0, 0)`,
			'payment_direction_check'
		);
	});

	it('refuses a payment method outside the six the schema models', async () => {
		await rejects(
			'payment.method',
			`insert into payment (id, donation_id, amount_minor, currency, direction, method,
			                      status, occurred_at, created_at)
			 values ('p-badmethod', '${DONATION_ID}', 10000, 'USD', 'inbound', 'wire',
			         'succeeded', 0, 0)`,
			'payment_method_check'
		);
	});

	it.each(['paypal', 'venmo'])(
		'admits %s, which is a rail of its own and not card',
		async (method) => {
			// the positive control on the widened list, and the claim `PAYMENT_METHODS` makes: a
			// gift through PayPal's window is not recorded as a card payment, and a Venmo one is
			// told apart from a PayPal one on the row rather than only in the processor's console.
			await env.DB.prepare(
				`insert into payment (id, donation_id, amount_minor, currency, direction, method,
				                      status, provider, provider_txn_id, occurred_at, created_at)
				 values (?, ?, 10000, 'USD', 'inbound', ?, 'succeeded', 'paypal', ?, 0, 0)`
			)
				.bind(`p-${method}`, DONATION_ID, method, `pp_${method}`)
				.run();
			const row = await env.DB.prepare(
				'select method as m, provider as p from payment where id = ?'
			)
				.bind(`p-${method}`)
				.first();
			expect(row).toEqual({ m: method, p: 'paypal' });
		}
	);

	it('refuses a payment status outside the four', async () => {
		// 'canceled' is Stripe's spelling of `cancelled`, so this is the near-miss that
		// actually arrives rather than a made-up one.
		await rejects(
			'payment.status',
			`insert into payment (id, donation_id, amount_minor, currency, direction, method,
			                      status, occurred_at, created_at)
			 values ('p-badstatus', '${DONATION_ID}', 10000, 'USD', 'inbound', 'card',
			         'canceled', 0, 0)`,
			'payment_status_check'
		);
	});

	it('refuses a payment provider outside stripe/paypal/manual, while still allowing none', async () => {
		await rejects(
			'payment.provider',
			`insert into payment (id, donation_id, amount_minor, currency, direction, method,
			                      status, provider, provider_txn_id, occurred_at, created_at)
			 values ('p-badprovider', '${DONATION_ID}', 10000, 'USD', 'inbound', 'card',
			         'succeeded', 'braintree', 'bt_1', 0, 0)`,
			'payment_provider_check'
		);
		// the half that must not be broken by it: `provider` is nullable and `null in (...)`
		// evaluates to null, which a check accepts. staff entry depends on that.
		await env.DB.prepare(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method,
			                      status, occurred_at, created_at)
			 values ('p-noprovider', ?, 10000, 'USD', 'inbound', 'cash', 'succeeded', 0, 0)`
		)
			.bind(DONATION_ID)
			.run();
		const row = await env.DB.prepare('select provider as p from payment where id = ?')
			.bind('p-noprovider')
			.first();
		expect(row).toEqual({ p: null });
	});

	it('refuses a payment with no status at all', async () => {
		// `status` is the one column on `payment` that is NOT NULL with no default — see the
		// note on it in schema.ts. that is deliberate, and it is only safe if it really is
		// enforced: a default silently added later would make every webhook that forgot to map
		// the rail's outcome record a settlement that may not have happened.
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into payment (id, donation_id, amount_minor, currency, direction, method,
				                      occurred_at, created_at)
				 values ('p-nostatus', ?, 10000, 'USD', 'inbound', 'cash', 0, 0)`
			)
				.bind(DONATION_ID)
				.run()
		);
		expect(message).toContain('SQLITE_CONSTRAINT_NOTNULL');
	});

	it('accepts every member of the status enum, so a failed attempt is recordable', async () => {
		// the positive control, and the reason the column exists: `donation`'s documented
		// projection lists `failed` and `cancelled`, and without this column neither has any
		// substrate — a failed charge writes no row and is indistinguishable from a gift
		// nobody has paid yet.
		for (const status of ['pending', 'succeeded', 'failed', 'cancelled']) {
			await env.DB.prepare(
				`insert into payment (id, donation_id, amount_minor, currency, direction, method,
				                      status, occurred_at, created_at)
				 values (?, ?, 10000, 'USD', 'inbound', 'card', ?, 0, 0)`
			)
				.bind(`p-status-${status}`, DONATION_ID, status)
				.run();
		}
		const { results } = await env.DB.prepare(
			`select status from payment where id like 'p-status-%' order by status`
		).all<{ status: string }>();
		expect(results.map((r) => r.status)).toEqual(['cancelled', 'failed', 'pending', 'succeeded']);
	});
});

describe('a currency column holds three letters, not three bytes', () => {
	// the `glob '[A-Z][A-Z][A-Z]'` term. without it, `length = 3 and x = upper(x)` admits
	// '123' — verified, it inserts. sqlite's `upper()` is ASCII-only, so it also admits 'ÉUR'
	// and every other non-ASCII triple, each of which splits the books exactly the way 'usd'
	// does while every row reads clean.

	const insertFormCurrency = (id: string, currency: string) =>
		env.DB.prepare(
			`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
			 values (?, 'probe', ?, ?, 0, 0)`
		)
			.bind(id, POSTING_ACCOUNTS.donationsDeductible.id, currency)
			.run();

	it.each([
		['digits', 'frm_ccydigits00000', '123'],
		['a digit in the tail', 'frm_ccytail0000000', 'US1'],
		['punctuation', 'frm_ccypunct000000', '$$$'],
		['spaces', 'frm_ccyspaces00000', '   '],
		['an accented letter, which equals its own upper()', 'frm_ccyaccent00000', 'ÉUR']
	])('refuses %s', async (label, id, currency) => {
		const message = await rejection(() => insertFormCurrency(id, currency));
		expect(message, label).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message, label).toContain('form_currency_check');
	});

	it('still accepts a real ISO-4217 code', async () => {
		// the positive control. a `glob` typo — a missing bracket, a lowercase range — would
		// reject everything, and every assertion above would still pass.
		await insertFormCurrency('frm_probecurrency1', 'RWF');
		const row = await env.DB.prepare('select currency as c from form where id = ?')
			.bind('frm_probecurrency1')
			.first();
		expect(row).toEqual({ c: 'RWF' });
	});
});

describe('a not-blank column rejects the whitespace a paste actually contains', () => {
	// `trim(x, char(32, 9, 10, 11, 12, 13, 160))`. under the narrower `char(32, 9, 10, 13)`,
	// `char(11)` — a vertical tab — inserts as a form name. NBSP (160) is the one that
	// matters: it is what a paste out of a word processor produces, so a form named a single
	// U+00A0 renders blank on every screen with the check satisfied.

	// written as escapes rather than as the characters themselves: a literal U+00A0 in this
	// file is invisible to whoever reads the diff, which is the same property that makes the
	// value worth constraining in the first place.
	it.each([
		['a vertical tab (U+000B)', 'frm_blankvtab00000', '\v'],
		['a form feed (U+000C)', 'frm_blankff0000000', '\f'],
		['a non-breaking space (U+00A0)', 'frm_blanknbsp00000', '\u00a0'],
		['NBSP mixed with ASCII whitespace', 'frm_blankmixed0000', ' \u00a0\t \n ']
	])('refuses a form name that is %s', async (label, id, name) => {
		const message = await rejection(() =>
			env.DB.prepare(
				`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
				 values (?, ?, ?, 'USD', 0, 0)`
			)
				.bind(id, name, POSTING_ACCOUNTS.donationsDeductible.id)
				.run()
		);
		expect(message, label).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message, label).toContain('form_name_not_blank_check');
	});

	it('still accepts a name that merely CONTAINS one', async () => {
		// the boundary: the check asserts a value is there, it does not canonicalize one, and
		// `trim` only ever strips the ends. a name with an NBSP inside it is a real name — it is
		// what a paste of 'General Fund' carries — so the codepoint set must not turn that into
		// a rejection. written as an escape, like the probes above.
		const name = 'General\u00a0Fund';
		await env.DB.prepare(
			`insert into form (id, name, revenue_account_id, currency, created_at, updated_at)
			 values ('frm_probenbspname', ?, ?, 'USD', 0, 0)`
		)
			.bind(name, POSTING_ACCOUNTS.donationsDeductible.id)
			.run();
		const row = await env.DB.prepare('select name as n from form where id = ?')
			.bind('frm_probenbspname')
			.first();
		expect(row).toEqual({ n: name });
	});
});

describe('payment-grain idempotency', () => {
	const insertPayment = (id: string, provider: string | null, txnId: string | null) =>
		env.DB.prepare(
			`insert into payment
			   (id, donation_id, amount_minor, currency, direction, method, status,
			    provider, provider_txn_id, occurred_at, created_at)
			 values (?, ?, 10000, 'USD', 'inbound', 'card', 'succeeded', ?, ?, 0, 0)`
		)
			.bind(id, DONATION_ID, provider, txnId)
			.run();

	it('refuses a redelivered (provider, provider_txn_id)', async () => {
		// this sits under `entry_group_source_idx`'s posting-grain idempotency, not beside
		// it: a redelivered Stripe webhook is stopped here before it can become a second
		// settlement event, by the database rather than by a read-then-write check that
		// `batch()` cannot perform atomically anyway.
		await insertPayment('p-stripe-1', 'stripe', 'ch_probe');
		const message = await rejection(() => insertPayment('p-stripe-2', 'stripe', 'ch_probe'));
		expect(message).toContain(SQLITE_CONSTRAINT_UNIQUE);
	});

	it('lets two manual payments with no provider both insert', async () => {
		// and this is why the unique index does not get in the way of staff entry: sqlite
		// treats NULLs as DISTINCT in a unique index, so every cash and check payment
		// (both columns null) collides with nothing. it is a property of the engine, so it
		// is asserted rather than assumed — a schema change that gave either column a
		// non-null default would turn the second manual gift of the day into a duplicate.
		await insertPayment('p-manual-1', null, null);
		await insertPayment('p-manual-2', null, null);
		// scoped to these two ids, not to `provider is null` over the whole table: writes
		// accumulate down this file (per-file storage), so the unscoped form was one
		// successful probe away from failing for a reason that is not the schema's.
		const { results } = await env.DB.prepare(
			`select id from payment
			 where provider is null and id in ('p-manual-1', 'p-manual-2') order by id`
		).all<{ id: string }>();
		expect(results.map((r) => r.id)).toEqual(['p-manual-1', 'p-manual-2']);
	});

	// the three ways that UNIQUE index is bypassable on its own, each closed by a check.
	// they are not hygiene: the index is the whole documented defence against a redelivered
	// Stripe charge becoming a second settlement event, and both of its columns are
	// nullable, with NULLs DISTINCT in a sqlite unique index.

	it.each(['stripe', 'paypal'])(
		'refuses a %s payment with no txn id — the pair would not collide',
		async (provider) => {
			// without this check (provider, null) inserts twice: two settlement events for one
			// charge, the exact outcome the index exists to prevent. it runs over every processor
			// rather than over Stripe alone, which is the whole of what the check's generalised
			// predicate claims.
			const message = await rejection(() => insertPayment(`p-${provider}-notxn`, provider, null));
			expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
			expect(message).toContain('payment_processor_needs_txn_id_check');
		}
	);

	it('refuses a txn id with no provider', async () => {
		// without this check (null, 'ch_x') inserts twice — the same hole from the other side,
		// and the shape a webhook handler produces when it reads the charge id but not the
		// rail that sent it.
		const message = await rejection(() => insertPayment('p-notprovider', null, 'ch_orphan'));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_txn_id_needs_provider_check');
	});

	it('refuses a blank txn id, which would COLLIDE rather than duplicate', async () => {
		// the inverse failure, and the worse one. ('stripe', '') twice does collide, because
		// `''` is not null — so a boundary that normalises a missing id to the empty string
		// refuses the second real payment as a redelivery. that loses a gift instead of
		// double-counting one, and it looks like idempotency working.
		const message = await rejection(() => insertPayment('p-blanktxn', 'stripe', ''));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_provider_txn_id_not_blank_check');
	});

	it('refuses a whitespace-only txn id, tab and newline included', async () => {
		// `trim(x, char(32, 9, 10, 13))`, not the one-argument `trim(x)` that strips only
		// U+0020 — a lone tab would otherwise satisfy the check and behave exactly like `''`.
		const message = await rejection(() => insertPayment('p-wstxn', 'stripe', ' \t\n\r '));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('payment_provider_txn_id_not_blank_check');
	});

	it('still admits a manual payment with no txn id', async () => {
		// the constraint the three CHECKs must not break, and the reason
		// `payment_processor_needs_txn_id_check` names its exception rather than saying "provider
		// is not null": staff entry of cash and checks is every gift in v0, and `('manual', NULL)`
		// has to insert.
		await insertPayment('p-manual-named', 'manual', null);
		const row = await env.DB.prepare(
			'select provider as p, provider_txn_id as t from payment where id = ?'
		)
			.bind('p-manual-named')
			.first();
		expect(row).toEqual({ p: 'manual', t: null });
	});
});

describe('the shape `form` is in, off the applied migrations', () => {
	// `form` carries neither `payment_methods` nor `frequencies`, and it carries the two program
	// columns and the check that pairs them. a rebuild of this table is where either fact is lost
	// silently — sqlite cannot ALTER a CHECK, so any change to one is the 12-step rebuild, and
	// drizzle re-emits every constraint from a snapshot on the way through.
	//
	// read against the migrated database rather than against `schema.ts`, which is the only
	// reading that can fail: a constraint lost on the way into the SQL is a constraint the
	// snapshot still agrees with and reports no drift over.
	//
	// `STRICT` and the `NO ACTION` on its foreign keys are not here: both are read exhaustively
	// out of sqlite's own catalogue by ./strict.workers.spec.ts, over every table rather than a
	// list, so `form` is covered there the moment it exists in any shape.

	/** the `CREATE TABLE` sqlite is holding, as the applied migrations left it. */
	async function formDdl(): Promise<string> {
		const row = await env.DB.prepare(
			"select sql as ddl from sqlite_master where type = 'table' and name = 'form'"
		).first<{ ddl: string }>();
		return row?.ddl ?? '';
	}

	it('leaves neither dropped column on the table', async () => {
		// past drizzle and past `schema.ts` both: a `DROP COLUMN` sqlite refuses is a migration
		// that fails loudly, but a rebuild that simply forgot to carry the drop through is one
		// where every read still passes and the column quietly survives on the deployed database.
		const columns = await env.DB.prepare("select name from pragma_table_info('form')").all<{
			name: string;
		}>();
		const names = columns.results.map((c) => c.name);
		expect(names).not.toContain('payment_methods');
		expect(names).not.toContain('frequencies');
	});

	it('leaves neither dropped CHECK behind either', async () => {
		const ddl = await formDdl();
		expect(ddl).not.toContain('form_payment_methods_array_check');
		expect(ddl).not.toContain('form_frequencies_array_check');
	});

	it('carries every other CHECK through the copy', async () => {
		// the whole list, stated rather than counted: a rebuild drops the table and writes a new
		// one, so every constraint on it is re-emitted from a snapshot and any single omission is
		// a silent loss of exactly the guarantee the constraint was added for.
		const ddl = await formDdl();
		for (const name of [
			'form_revenue_account_postable_check',
			'form_status_check',
			'form_name_not_blank_check',
			'form_currency_check',
			'form_id_not_blank_check',
			'form_id_length_check',
			'form_min_minor_check',
			'form_max_minor_check',
			'form_min_max_minor_check',
			'form_suggested_amounts_array_check',
			'form_allowed_origins_array_check',
			'form_copy_object_check',
			'form_program_mode_check',
			'form_program_pinned_check'
		]) {
			expect(ddl, name).toContain(name);
		}
	});

	it('still refuses a non-array in each of the two array columns left', async () => {
		// the group both dropped checks belonged to, and it is exercised only by this file's
		// successes otherwise — every form inserted above omits the JSON columns, so the passing
		// tests write the `DEFAULT` literals through the checks and never a value that should be
		// refused. one rejection each is what makes the survival of these two a claim.
		for (const column of ['suggested_amounts', 'allowed_origins']) {
			const message = await rejection(() =>
				env.DB.prepare(
					`insert into form (id, name, revenue_account_id, currency, ${column}, created_at, updated_at)
					 values (?, 'probe', ?, 'USD', '"not an array"', 0, 0)`
				)
					.bind(`frm_probearray${column.slice(0, 4)}`, POSTING_ACCOUNTS.donationsDeductible.id)
					.run()
			);
			expect(message, column).toContain(SQLITE_CONSTRAINT_CHECK);
			expect(message, column).toContain(`form_${column}_array_check`);
		}
	});

	it('keeps the primary key on `id`', async () => {
		// the copy step SELECTs into a new table, so a primary key stated wrong there is a table
		// that accepts two forms with one public id — which is two donation snippets pointing at
		// each other's fund.
		const columns = await env.DB.prepare("select name, pk from pragma_table_info('form')").all<{
			name: string;
			pk: number;
		}>();
		expect(columns.results.filter((c) => c.pk > 0).map((c) => c.name)).toEqual(['id']);
	});
});
