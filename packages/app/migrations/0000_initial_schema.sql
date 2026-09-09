-- the schema, whole. eighteen tables: the chart of accounts and the append-only ledger that
-- posts against it, the donor file, the donation record, the causes a gift can name, the forms
-- it arrives on, the organization's own identity, the sites a form may be served from, and the
-- six tables auth needs. the two rows a deployment cannot boot without are seeded at the foot.
--
-- why the domain is shaped this way is not here — it is in `src/lib/server/db/schema.ts`,
-- beside the columns, where it can keep evolving. this file carries only what someone editing
-- migrations needs: the hazards that fire on this file's own path.
--
-- ---------------------------------------------------------------------------
-- this is the whole of `migrations/`, and the one file in it whose comments are not frozen with
-- its filename. CONTRIBUTING.md -> Migrations freezes every other one, because nothing
-- distinguishes a reworded sentence from a loosened constraint against a file already run on
-- somebody's database; this file is instead rewritten in place each time the chain is squashed
-- into it, so it states the schema as it stands rather than as it stood. every other rule there
-- applies to it unchanged.
--
-- the filename survives a squash and must. wrangler records applied migrations in
-- `d1_migrations` by filename, with no checksum: a deployment that already ran
-- `0000_initial_schema.sql` skips this file and keeps the schema it has, while a fresh
-- deployment runs it once and lands on the same schema. under any other name it re-runs against
-- a populated database and dies on `table … already exists` — so a squash renames nothing, and
-- no source comment anywhere may name a migration by filename except this one, which is the
-- only name that is stable (`src/lib/server/auth/signing-key.ts` argues that from the other
-- side).
-- ---------------------------------------------------------------------------
--
-- statement order is `drizzle-kit generate`'s own and is left as it emitted it. within one file
-- the order is free: sqlite resolves a foreign key at DML time rather than at CREATE TABLE, so
-- `donation` may name `form` above the line that creates it, and every table exists by the time
-- the seeds at the foot run. that same rule is what makes order load-bearing *across* files — a
-- `REFERENCES` naming a table a later migration creates applies green and fails on the first row
-- — so a migration landing beside this one orders its own statements by hand.
--
-- ---------------------------------------------------------------------------
-- every `CREATE TABLE` here ends `) STRICT;`, and the keyword is hand-written.
--
-- drizzle-kit has no `STRICT` concept: `schema.ts` cannot ask for it, the snapshots under
-- meta/ cannot record it, and `generate` reports no drift with or without it. so it exists
-- only in this file, put here by a person, and it must be put back by a person on every
-- generated `.sql` that ever reaches this directory.
--
-- what it buys: `integer` becomes a constraint rather than an affinity. without it a real
-- that does not round-trip is stored as float64 in a money column and every SELECT still
-- reads clean — which is exactly how an `entry_group` comes to sum to something other than
-- zero with no wrong-looking row in it.
--
-- it cannot be added afterwards. that needs a table rebuild, and D1 refuses to drop a table
-- a child references — so the keyword is there at birth or never.
-- `src/lib/server/db/strict.workers.spec.ts` reads `pragma_table_list` over these files and
-- fails on any table that lost it; the suite runs in `lefthook.yml`'s pre-commit hook, so it
-- gets the chance to before the migration is even committed.
--
-- no FOREIGN KEY here carries `ON DELETE CASCADE`, and none may — the exceptions are
-- `auth_session -> auth_user` and `auth_account -> auth_user`, where the row is worthless
-- without its user and no accounting record hangs off either. a cascade is an action rather
-- than a violation, so `PRAGMA defer_foreign_keys=true` — the pragma every future table
-- rebuild depends on — does not defer it: the rebuild's `DROP TABLE <parent>` performs an
-- implicit delete of every parent row, the cascade fires against a table nobody was touching,
-- the child is silently emptied, and the deferred check at commit then passes because the
-- orphans it was watching for have been tidied away. silent, and unrecoverable.
-- `src/lib/server/db/strict.workers.spec.ts` holds the allowlist at those two.
-- ---------------------------------------------------------------------------

-- the chart of accounts: the substrate every ledger entry posts against. `code` is the
-- stable business key, `id` is the foreign-key target. its rows are seeded at the foot of
-- this file, with ids identical in every deployment.
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`is_deductible` integer DEFAULT false NOT NULL,
	`is_tax` integer DEFAULT false NOT NULL,
	-- false only on reporting rollups, which already sum their children. NOT NULL is not
	-- cosmetic: a composite foreign key resolves only against a parent UNIQUE index over
	-- NOT NULL columns, and `account_id_postable_idx` below is that index.
	`is_postable` integer DEFAULT true NOT NULL,
	-- rate x 1e8 — 8250000 is 8.25%. rates are integers, never floats; they are not money.
	`tax_rate_e8` integer,
	`parent_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_type_check" CHECK("account"."type" in ('asset', 'liability', 'net_assets', 'revenue', 'cost_of_sales', 'expense')),
	-- `in (0, 1)` and not merely NOT NULL: sqlite's boolean is an integer affinity, so `2`
	-- inserts happily and drizzle maps it back with `Number(v) === 1`, i.e. to `false`. a
	-- deductible account would silently become non-deductible and receipts would understate.
	-- STRICT does not catch this either — STRICT INTEGER takes `2`.
	CONSTRAINT "account_is_deductible_bool_check" CHECK("account"."is_deductible" in (0, 1)),
	CONSTRAINT "account_is_tax_bool_check" CHECK("account"."is_tax" in (0, 1)),
	CONSTRAINT "account_is_postable_bool_check" CHECK("account"."is_postable" in (0, 1)),
	-- bounded at both ends: without the upper bound 825000000 (825%) passes as readily as
	-- 8250000 (8.25%).
	CONSTRAINT "account_tax_rate_e8_check" CHECK("account"."tax_rate_e8" is null or ("account"."tax_rate_e8" >= 0 and "account"."tax_rate_e8" <= 100000000)),
	-- self-parenting is the accident that actually happens (an admin form defaulting parent
	-- to the current row), and it makes a recursive-CTE rollup never terminate.
	CONSTRAINT "account_parent_not_self_check" CHECK("account"."parent_id" is null or "account"."parent_id" <> "account"."id")
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `account_code_idx` ON `account` (`code`);
--> statement-breakpoint
CREATE INDEX `account_parent_id_idx` ON `account` (`parent_id`);
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- not a uniqueness rule — `id` is already the primary key, so this index constrains nothing
-- new. it exists to be a foreign-key target: sqlite resolves a composite FK only against a
-- parent UNIQUE index over exactly those columns.
--
-- three tables point at it — `ledger_entry(account_id, account_is_postable)`,
-- `form(revenue_account_id, revenue_account_is_postable)` and the same pair on `line_item`.
-- each of those carries a companion check pinning its own side to 1, so the only `account`
-- rows any of them can name are the ones with `is_postable = 1`. a rollup account is
-- therefore unnameable by any writer — not by a posting, not by a form, not by a line — at
-- the database level and at no extra read, because this index does the work.
--
-- that matters most on `ledger_entry`: the ledger is append-only and a rollup already sums
-- its children, so one entry naming `4100 Donations` makes every report over that subtree
-- double-count, silently and permanently. `PostableAccountId` in
-- `src/lib/server/db/postable.ts` is the same guard in the type checker, and the two are
-- not redundant — the brand stops a caller, this stops a hand-run `wrangler d1 execute`, a
-- CSV import, and any future writer that never sees the brand.
--
-- it is created here, ahead of every table that points at it, because sqlite resolves a
-- composite FK at DML time: an index living in a later migration file is legal on the way
-- in and a `foreign key mismatch` on the first insert.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX `account_id_postable_idx` ON `account` (`id`,`is_postable`);
--> statement-breakpoint
-- the hub every other record points at: donors, employers, funds' counterparties,
-- households. `kind` already admits organizations and households, so a matching-gift
-- employer or a joint household needs no migration later.
CREATE TABLE `contact` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	-- denormalized and always populated, so a list view never branches on kind.
	`display_name` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`legal_name` text,
	`primary_email` text,
	`primary_phone` text,
	-- the extension column. a JSON object plus a typed registry is what keeps an org from
	-- ever adding a column of its own; D1 caps a table at 100.
	`attributes` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	-- soft delete. a donor with financial history is never hard-deleted.
	`archived_at` integer,
	-- the donor's answer to the contact question. nullable with no default: never asked
	-- has to stay distinguishable from said no, and every row a fork already holds is the
	-- first of those. every write of it goes through drizzle's boolean mode, in
	-- `src/lib/server/contacts/queries.ts`; its length bound and its blank handling are in
	-- `src/lib/contacts/input-schema.ts` rather than here.
	`consented_to_contact` integer,
	CONSTRAINT "contact_kind_check" CHECK("contact"."kind" in ('individual', 'organization', 'household')),
	-- the blank-name guard, and the shape every not-blank check in this file copies. NOT NULL
	-- does not say "has a value" — `''` satisfies it — and STRICT constrains type, not
	-- content. `trim(x, char(...))` and never the one-argument `trim(x)`, which strips U+0020
	-- alone: the set here adds NBSP (160), which is what a paste out of a word processor
	-- produces. widening it later costs a table rebuild, so it is not left at the one-argument
	-- form.
	CONSTRAINT "contact_display_name_not_blank_check" CHECK(trim("contact"."display_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	-- `json_valid` first, or 'not json at all' inserts and surfaces as a parse throw at read
	-- time, far from the writer. the `json_type` half excludes [] / 3 / null, which are valid
	-- JSON and none of which the registry can read.
	CONSTRAINT "contact_attributes_object_check" CHECK(json_valid("contact"."attributes") and json_type("contact"."attributes") = 'object'),
	-- `in (0, 1)` for `account.is_deductible`'s reason, and it matters most here: STRICT
	-- INTEGER takes `2`, and drizzle's boolean mode reads a stored `2` back as `false` —
	-- a refusal the donor never gave, on the one column in this schema that exists to
	-- record what they said. NULL passes and must: a sqlite CHECK fails only on a false
	-- result and `null in (0, 1)` is null, so never asked stays admissible.
	CONSTRAINT "contact_consented_to_contact_bool_check" CHECK("contact"."consented_to_contact" in (0, 1))
) STRICT;
--> statement-breakpoint
-- case-insensitive email lookup — the dedupe path, and the only index on this column, so
-- every lookup must be `where lower(primary_email) = lower(?)`. `lower()` is deterministic,
-- so sqlite permits it in an index. note for a future rebuild: drizzle re-renders an
-- expression index with the whole expression backticked, which makes it an identifier and
-- fails `no such column`. it is written unquoted here and must stay that way.
CREATE INDEX `contact_primary_email_lower_idx` ON `contact` (lower("primary_email"));
--> statement-breakpoint
CREATE INDEX `contact_last_name_idx` ON `contact` (`last_name`);
--> statement-breakpoint
-- the "order": one gift as recorded. its lines are `line_item`, its settlement attempts are
-- `payment`, and its money movement is an `entry_group` in the ledger.
--
-- there is no `status` column and adding one is the mistake this table is shaped against:
-- status is a read-time projection over `payment` + the ledger, and a mutable status kept in
-- sync with an append-only ledger is a second source of truth for the one fact that must
-- never disagree. the asymmetry seals it — sqlite does `ADD COLUMN` natively, while dropping
-- a column carrying a check is the 12-step rebuild.
CREATE TABLE `donation` (
	`id` text PRIMARY KEY NOT NULL,
	-- the payer. soft credits — crediting someone who is not the payer — are a later table.
	`contact_id` text NOT NULL,
	`total_minor` integer NOT NULL,
	`currency` text NOT NULL,
	-- processor fee, expensed gross so the gift is recorded at face value.
	`fee_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`non_deductible_minor` integer DEFAULT 0 NOT NULL,
	-- business date of the gift. backdating is a requirement, not an anomaly.
	`received_at` integer NOT NULL,
	`source` text,
	-- null for staff-entered cash and cheques, which is every gift in v0.
	`form_id` text,
	-- the validated `Origin` header, captured server-side. one form is embedded on several
	-- sites, so this — not `form_id` — is the attribution key.
	`origin` text,
	`receipt_sent_at` integer,
	`thankyou_sent_at` integer,
	`created_at` integer NOT NULL,
	-- ---------------------------------------------------------------------------
	-- the columns after `created_at`, and none of them carries a CHECK. none can be given one
	-- either: a CHECK is a table-level constraint, this table has children (`line_item`,
	-- `payment`), and adding one is the 12-step rebuild whose `DROP TABLE donation` D1 refuses.
	-- what each would have said is said at the parse boundary instead, and said nowhere else.
	--
	-- appended rather than placed where they read best, and that is the rule for the next one
	-- too: a column inserted mid-table makes a future `drizzle-kit generate` emit a rebuild
	-- whose copy step SELECTs a column the old table lacks, and D1's double-quoted-literal
	-- fallback then writes the text of the column name into every row.
	-- ---------------------------------------------------------------------------
	-- the donor's message. `parseQuoteRequest` (`src/lib/server/donations/quote-input.ts`)
	-- stores a blank one as null and bounds its length.
	`note` text,
	-- which standing commitment this gift was charged under, null for a one-off. every charge
	-- in a series is its own row here, so this is the only thing joining them.
	`recurring_id` text,
	-- a gift given in honor of, or in memory of, a named person — and the person the donor
	-- asked us to tell. `tribute_kind` holds `honor` or `memory`, whose vocabulary is
	-- `TRIBUTE_KINDS` in `src/lib/donations/tributes.ts`; `parseTribute` beside
	-- `parseQuoteRequest` is what pairs kind with honoree and notify-name with notify-email,
	-- bounds every string, and stores a blank one as null. this table accepts a kind naming
	-- nobody and an address with no name.
	`tribute_kind` text,
	`tribute_honoree` text,
	`tribute_notify_name` text,
	`tribute_notify_email` text,
	-- the guard against telling a family twice: the notification is claimed by an
	-- `UPDATE … SET tribute_notified_at = ? WHERE id = ? AND tribute_notified_at IS NULL`, the
	-- way `sendReceipt` in `src/lib/server/donations/receipt.ts` claims a receipt, because
	-- Stripe redelivers a webhook.
	`tribute_notified_at` integer,
	-- the cause this gift is recorded against, null when the form named none.
	`program_id` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`form_id`) REFERENCES `form`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring_plan`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "donation_currency_check" CHECK(length("donation"."currency") = 3 and "donation"."currency" = upper("donation"."currency") and "donation"."currency" glob '[A-Z][A-Z][A-Z]'),
	-- `> 0`, not `>= 0`. a zero-total donation is the shape a half-parsed form submit
	-- produces, and it posts an entry group of zero-amount lines that
	-- `ledger_entry_amount_minor_not_zero_check` then rejects mid-batch — the whole gift
	-- rolled back, reported from the ledger, about a value this row let through. a refund is
	-- a separate `payment` row plus a compensating entry, never a negative donation.
	CONSTRAINT "donation_total_minor_positive_check" CHECK("donation"."total_minor" > 0),
	-- the three `>= 0` floors below, and deliberately no cross-column amount checks above
	-- them. `fee_minor <= total_minor` and `non_deductible_minor <= total_minor` both look
	-- obviously true and are not — they encode receipting policy, and tax-inclusive vs
	-- tax-on-top pricing alone flips the second. a check naming two columns also blocks
	-- `DROP COLUMN` on both, so an assumption written down early costs a table rebuild to
	-- withdraw.
	CONSTRAINT "donation_fee_minor_check" CHECK("donation"."fee_minor" >= 0),
	CONSTRAINT "donation_tax_minor_check" CHECK("donation"."tax_minor" >= 0),
	CONSTRAINT "donation_non_deductible_minor_check" CHECK("donation"."non_deductible_minor" >= 0),
	CONSTRAINT "donation_source_not_blank_check" CHECK("donation"."source" is null or trim("donation"."source", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	-- not-blank and nothing more. no shape check on `origin`: a valid `Origin` may be the
	-- literal string `null` (a sandboxed iframe, a `file://` page), or scheme+host, or
	-- scheme+host+port — a regex admitting all three admits nearly anything, and one that
	-- does not silently drops real traffic.
	--
	-- and no check on `received_at`: staff enter last month's cheques, so there is no lower
	-- bound, and "not in the future" is unexpressible because a check may call only
	-- deterministic functions and `unixepoch()` is not one.
	CONSTRAINT "donation_origin_not_blank_check" CHECK("donation"."origin" is null or trim("donation"."origin", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
CREATE INDEX `donation_contact_id_idx` ON `donation` (`contact_id`);
--> statement-breakpoint
CREATE INDEX `donation_form_id_idx` ON `donation` (`form_id`);
--> statement-breakpoint
CREATE INDEX `donation_recurring_id_idx` ON `donation` (`recurring_id`);
--> statement-breakpoint
CREATE INDEX `donation_program_id_idx` ON `donation` (`program_id`);
--> statement-breakpoint
-- every gift list and every period report filters on business time, never on `created_at`.
CREATE INDEX `donation_received_at_idx` ON `donation` (`received_at`);
--> statement-breakpoint
-- one row per journal entry — the thing that must balance. bitemporal: `occurred_at` is
-- when the money moved, `created_at` is when the row was written, so a backdated gift can be
-- posted without lying about when it was recorded.
--
-- append-only, so no `updated_at` and no `archived_at`: a mistake is a compensating entry,
-- never an overwrite.
CREATE TABLE `entry_group` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	-- on the entry rather than on the line: an entry mixing currencies cannot meaningfully
	-- sum to zero, so there is nowhere for a second one to go.
	`currency` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`memo` text,
	CONSTRAINT "entry_group_source_type_check" CHECK("entry_group"."source_type" in ('payment', 'donation', 'refund', 'fee', 'adjustment')),
	-- what a currency column is, on this table and the three others that carry one — an
	-- ISO-4217 code is three uppercase ASCII letters and nothing else. `glob` and not `like`:
	-- `like` is case-insensitive for ASCII and would accept 'usd'. the glob subsumes the other
	-- two terms; they stay because dropping a term from a check is a table rebuild, not an
	-- edit. the body is one helper in schema.ts, so all four columns agree byte for byte.
	CONSTRAINT "entry_group_currency_check" CHECK(length("entry_group"."currency") = 3 and "entry_group"."currency" = upper("entry_group"."currency") and "entry_group"."currency" glob '[A-Z][A-Z][A-Z]'),
	-- a blank source_id would satisfy the unique index below exactly once and then collide
	-- with every other blank one — i.e. it fails as a mysterious duplicate, later.
	CONSTRAINT "entry_group_source_id_not_empty_check" CHECK(length("entry_group"."source_id") > 0)
) STRICT;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- where webhook idempotency lives. a redelivered Stripe event posts the same
-- (source_type, source_id) and is refused by the database — not by a read-then-write check,
-- which D1's `batch()` cannot perform atomically anyway.
--
-- what `source_id` holds, per `source_type`. the grain is part of the constraint, not a
-- call-site detail: a writer that picks the wrong one gets a rejection that reads exactly
-- like the redelivery this exists to refuse.
--
--   'donation' -> donation.id   gift recognition, the only one keyed on the gift. revenue is
--                               recognised exactly once per donation, which is this rule.
--   'payment'  -> payment.id    one settlement event, one posting. a gift settling in
--                               instalments is several payments and several entries.
--   'refund'   -> payment.id    the refund's own row, never the donation it reverses.
--   'fee'      -> payment.id    the settlement the fee was deducted from.
--   'adjustment' -> a uuidv7 minted for the correction and borrowed from nothing. a
--                  correction answers to no external event, so the pair is not an
--                  idempotency key for it and two identical corrections both land.
--
-- refunds are why the grain is written down: keying one on `donation.id` looks natural, and
-- it makes the second refund on a gift collide with the first and be refused as a redelivery.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX `entry_group_source_idx` ON `entry_group` (`source_type`,`source_id`);
--> statement-breakpoint
-- the bitemporal audit query filters on business time.
CREATE INDEX `entry_group_occurred_at_idx` ON `entry_group` (`occurred_at`);
--> statement-breakpoint
-- a donation form, embedded on the org's own site. one deployment serves many — a general
-- fund, a gala, a memorial.
--
-- this is where the chart of accounts gets hidden: a line item needs a `revenue_account_id`
-- and no fundraiser will ever pick one. they pick a form, and the fund rides along. the
-- "Fund" wording the UI shows is this table.
CREATE TABLE `form` (
	-- the one PRIMARY KEY in this schema that is not a UUIDv7 — `frm_` plus 80 random bits,
	-- because it is the one that is public. `formId()` in schema.ts argues that choice; what
	-- matters here is that the id is generated and never typed, so the two CHECKs below are
	-- not input validation. they are the floor under a public identifier, for the hand-run
	-- `d1 execute` that would otherwise leave a blank or 3-character value as a perfectly
	-- legal PRIMARY KEY.
	`id` text PRIMARY KEY NOT NULL,
	-- staff-facing label. never shown to a donor.
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	-- the fund this form's gifts post to — half of the composite postable FK below.
	`revenue_account_id` text NOT NULL,
	`suggested_amounts` text DEFAULT '[]' NOT NULL,
	`min_minor` integer,
	`max_minor` integer,
	`currency` text NOT NULL,
	-- `/api/v1`'s CORS allowlist is built from this column. `Origin` is an attribution signal
	-- there, never an authorization control, so this is the list and not the header.
	`allowed_origins` text DEFAULT '[]' NOT NULL,
	`copy` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	-- forms archive, they never delete: a pasted snippet outlives the form it points at, and
	-- `archived` renders a graceful message where a hard delete breaks a live page.
	`archived_at` integer,
	-- the constant-1 pin — see `ledger_entry.account_is_postable` for the mechanism and for
	-- why the two defaults are a pair. it sits after `archived_at`, where it reads worse than
	-- it would beside `revenue_account_id`, because a column anywhere but last makes a future
	-- `drizzle-kit generate` emit a table rebuild whose copy step SELECTs a column the old
	-- table lacks — and D1's double-quoted-string fallback stores the column name as its
	-- value in every row rather than erroring. append new columns, never reorder.
	`revenue_account_is_postable` integer DEFAULT 1 NOT NULL,
	-- which cause this form records a gift against, and whether the donor gets a say.
	-- `none` names no cause, `pinned` names exactly the one in `program_id`, and `choice`
	-- offers the live list and leaves `program_id` null. the pairing is a CHECK below
	-- rather than a rule in a screen, because a pinned form with no cause renders a
	-- chooser with nothing in it and a gift that names nothing.
	`program_mode` text DEFAULT 'none' NOT NULL,
	`program_id` text,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE no action,
	-- the postable FK. it is here rather than deferred because retrofitting it is a rebuild
	-- of `form`, and `donation.form_id` points here — so D1 would refuse the drop the moment
	-- one gift existed. without it a form could name the 4100 rollup and the failure would
	-- land on the first gift, in `line_item`, about a row a staff screen wrote weeks earlier.
	FOREIGN KEY (`revenue_account_id`,`revenue_account_is_postable`) REFERENCES `account`(`id`,`is_postable`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "form_revenue_account_postable_check" CHECK("form"."revenue_account_is_postable" = 1),
	CONSTRAINT "form_status_check" CHECK("form"."status" in ('draft', 'live', 'archived')),
	CONSTRAINT "form_name_not_blank_check" CHECK(trim("form"."name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "form_currency_check" CHECK(length("form"."currency") = 3 and "form"."currency" = upper("form"."currency") and "form"."currency" glob '[A-Z][A-Z][A-Z]'),
	-- no prefix check: pinning the public id format here would make changing it a rebuild of a
	-- table `donation` references. a later reviewer who wants one must use
	-- `substr(id, 1, 4) = 'frm_'`, never `id like 'frm_%'` — `_` is a like wildcard, so that
	-- form silently accepts `frmX…` and proves nothing.
	CONSTRAINT "form_id_not_blank_check" CHECK(trim("form"."id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "form_id_length_check" CHECK(length("form"."id") >= 12),
	-- the `is null` disjuncts in the next three are documentation, not logic: both bounds are
	-- nullable, "no bound set" is the normal state, and a comparison against null evaluates
	-- to null, which a check already accepts. spelled out because "may a bound be absent?" is
	-- the first question asked of a constraint read this far from its column.
	CONSTRAINT "form_min_minor_check" CHECK("form"."min_minor" is null or "form"."min_minor" >= 0),
	CONSTRAINT "form_max_minor_check" CHECK("form"."max_minor" is null or "form"."max_minor" >= 0),
	-- an inverted pair is satisfiable by NO amount, so `/api/v1` rejects every gift the form
	-- ever receives and the staff screen that wrote the pair reports nothing wrong. what a
	-- fundraiser sees is "the form is broken", with the cause two screens away.
	CONSTRAINT "form_min_max_minor_check" CHECK("form"."min_minor" is null or "form"."max_minor" is null or "form"."min_minor" <= "form"."max_minor"),
	CONSTRAINT "form_suggested_amounts_array_check" CHECK(json_valid("form"."suggested_amounts") and json_type("form"."suggested_amounts") = 'array'),
	CONSTRAINT "form_allowed_origins_array_check" CHECK(json_valid("form"."allowed_origins") and json_type("form"."allowed_origins") = 'array'),
	CONSTRAINT "form_copy_object_check" CHECK(json_valid("form"."copy") and json_type("form"."copy") = 'object'),
	CONSTRAINT "form_program_mode_check" CHECK("form"."program_mode" in ('none', 'pinned', 'choice')),
	-- an equality between two booleans, so it reads both ways at once: `pinned` requires a
	-- cause, and naming a cause requires `pinned`.
	CONSTRAINT "form_program_pinned_check" CHECK(("form"."program_id" is not null) = ("form"."program_mode" = 'pinned'))
) STRICT;
--> statement-breakpoint
-- the lines. every line of one `entry_group` sums to exactly zero, and `+` is a debit,
-- `-` is a credit — settled project-wide, so there is no `direction` column here and no
-- per-account-type sign flipping.
--
-- five columns and never more without a reason: this is the hot append table, and the one
-- whose row count drives D1's 100-bound-parameter cap on a `batch()`.
--
-- `src/lib/server/ledger/posting.ts` is the only module that may INSERT here; sums-to-zero
-- is cross-row, so no constraint in this file can express it and a second writer is a second
-- accounting system. `sole-writer.spec.ts` is what enforces that rather than trusting this
-- sentence.
CREATE TABLE `ledger_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_group_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	-- not a fact about this line. a constant 1, existing only so the composite foreign key
	-- below has a second column to match on — see `account_id_postable_idx`. never set it at
	-- a call site, never read it.
	--
	-- its two defaults are a pair: this `DEFAULT 1` and the `.default(1)` in schema.ts.
	-- drizzle names every column of the table in an insert and, for a key absent from the
	-- values object, binds the schema-level default as a parameter — it never emits the
	-- `DEFAULT` keyword, which sqlite would not accept in a `VALUES` list. so a column with a
	-- SQL default and no drizzle default binds `null` and trips NOT NULL on every insert.
	`account_is_postable` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`entry_group_id`) REFERENCES `entry_group`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`,`account_is_postable`) REFERENCES `account`(`id`,`is_postable`) ON UPDATE no action ON DELETE no action,
	-- a zero line carries no information and is the shape a mis-split produces, so it is a
	-- bug signal rather than a harmless no-op.
	CONSTRAINT "ledger_entry_amount_minor_not_zero_check" CHECK("ledger_entry"."amount_minor" <> 0),
	-- the other half of the composite FK: without it, matching `(4100, 0)` against the parent
	-- index would satisfy the foreign key perfectly.
	CONSTRAINT "ledger_entry_account_postable_check" CHECK("ledger_entry"."account_is_postable" = 1)
) STRICT;
--> statement-breakpoint
CREATE INDEX `ledger_entry_entry_group_id_idx` ON `ledger_entry` (`entry_group_id`);
--> statement-breakpoint
-- balances: `SUM(amount_minor) WHERE account_id = ?`, which is how every total in the app is
-- derived. never a stored running balance.
CREATE INDEX `ledger_entry_account_id_idx` ON `ledger_entry` (`account_id`);
--> statement-breakpoint
-- itemization: a gift can bundle a donation + an event ticket + a membership, each posting
-- to a different revenue account. a line names its `revenue_account_id` directly and the UI
-- wraps it as a "Fund".
--
-- no `currency` column, and that is the same carve-out `entry_group` carries from the other
-- side: a line has no meaning outside its donation, so the parent's currency governs it. a
-- column here would be a second copy of that fact with nothing able to hold the two in
-- agreement — "equals my donation's currency" is cross-row, so no check expresses it.
CREATE TABLE `line_item` (
	`id` text PRIMARY KEY NOT NULL,
	`donation_id` text NOT NULL,
	`label` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`line_total_minor` integer NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`revenue_account_id` text NOT NULL,
	-- the constant-1 pin again — see `ledger_entry.account_is_postable`. it is adjacent to
	-- its partner here only because this table has no timestamps to append after.
	`revenue_account_is_postable` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`donation_id`) REFERENCES `donation`(`id`) ON UPDATE no action ON DELETE no action,
	-- the postable FK, born with the table because retrofitting it is a rebuild. a
	-- `line_item` naming a rollup is milder than a ledger entry doing so — it mis-attributes
	-- what a gift was for rather than double-counting a subtree — but it is the same id
	-- flowing from `form` to here to the posting, so it is the same constraint.
	FOREIGN KEY (`revenue_account_id`,`revenue_account_is_postable`) REFERENCES `account`(`id`,`is_postable`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "line_item_revenue_account_postable_check" CHECK("line_item"."revenue_account_is_postable" = 1),
	-- a zero or negative quantity is a parse bug, and it makes the line's contribution to the
	-- gift meaningless rather than merely wrong.
	CONSTRAINT "line_item_quantity_check" CHECK("line_item"."quantity" > 0),
	CONSTRAINT "line_item_unit_price_minor_check" CHECK("line_item"."unit_price_minor" >= 0),
	CONSTRAINT "line_item_line_total_minor_check" CHECK("line_item"."line_total_minor" >= 0),
	CONSTRAINT "line_item_tax_minor_check" CHECK("line_item"."tax_minor" >= 0),
	-- deliberately not `line_total_minor = quantity * unit_price_minor`. any discount,
	-- proration or largest-remainder rounding residual invalidates it — and it names three
	-- columns, so it would block `DROP COLUMN` on all three.
	CONSTRAINT "line_item_label_not_blank_check" CHECK(trim("line_item"."label", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
CREATE INDEX `line_item_donation_id_idx` ON `line_item` (`donation_id`);
--> statement-breakpoint
-- the organization's own identity — the fundraiser's side of a receipt, and the source of the
-- legal fields the embedded form is not allowed to render without. exactly one row ever, and
-- `org_profile_id_check` is what makes that true rather than a habit; `auth_signing_key` at the
-- bottom of this file is the same singleton shape.
--
-- no row is seeded here, and that is the difference from `auth_signing_key`: auth cannot mint a
-- cookie without its row, whereas a blank row here would be worse than none — the setup
-- checklist at `/` reads absence as "not set up yet" and would read a row of empty strings as
-- configured. every column but `legal_name` is nullable for the same reason, including
-- `deductibility_statement`, whose words are a legal statement the organization makes and this
-- project does not write on its behalf.
CREATE TABLE `org_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`tax_id` text,
	`address_line1` text,
	`address_line2` text,
	`city` text,
	`region` text,
	`postal_code` text,
	`country` text,
	`notification_email` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deductibility_statement` text,
	CONSTRAINT "org_profile_id_check" CHECK("org_profile"."id" = 'default'),
	CONSTRAINT "org_profile_legal_name_not_blank_check" CHECK(trim("org_profile"."legal_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "org_profile_tax_id_not_blank_check" CHECK("org_profile"."tax_id" is null or trim("org_profile"."tax_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "org_profile_address_line1_not_blank_check" CHECK("org_profile"."address_line1" is null or trim("org_profile"."address_line1", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "org_profile_address_line2_not_blank_check" CHECK("org_profile"."address_line2" is null or trim("org_profile"."address_line2", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "org_profile_city_not_blank_check" CHECK("org_profile"."city" is null or trim("org_profile"."city", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "org_profile_region_not_blank_check" CHECK("org_profile"."region" is null or trim("org_profile"."region", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "org_profile_postal_code_not_blank_check" CHECK("org_profile"."postal_code" is null or trim("org_profile"."postal_code", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "org_profile_country_not_blank_check" CHECK("org_profile"."country" is null or trim("org_profile"."country", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "org_profile_notification_email_not_blank_check" CHECK("org_profile"."notification_email" is null or trim("org_profile"."notification_email", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "org_profile_deductibility_statement_not_blank_check" CHECK("org_profile"."deductibility_statement" is null or trim("org_profile"."deductibility_statement", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
-- settlement attempts and their outcomes. a payment holds no balance, and nothing here is
-- ever summed to answer "how much has this donor given" — that is a sum over `ledger_entry`.
--
-- a `succeeded` payment is what triggers a ledger posting, and only a `succeeded` one. that
-- pairing is not expressible as a check — "has an `entry_group`" is cross-row — so it lives
-- in `posting.ts`'s caller.
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`donation_id` text NOT NULL,
	-- `> 0`, with `direction` carrying the sign. signed amounts live on `ledger_entry` and
	-- nowhere else, so a business record is never read alongside a sign convention. this is
	-- also the table most likely to be read while reconciling against a processor statement,
	-- where every figure is positive.
	`amount_minor` integer NOT NULL,
	-- the settlement currency, and it may legitimately differ from its donation's: a rail can
	-- settle in a currency other than the one pledged. there is no check tying them and there
	-- could not be — "equals my donation's currency" is cross-row.
	`currency` text NOT NULL,
	`direction` text NOT NULL,
	`method` text NOT NULL,
	-- NOT NULL and deliberately without a default — the only column here that has none.
	-- `DEFAULT 'succeeded'` would be right for staff entry of cash and cheques and silently
	-- wrong for the webhook path, where the row exists precisely because a rail reported an
	-- outcome that may not be that one. no default makes an omission a type error at every
	-- drizzle call site and a NOT NULL rejection everywhere else.
	`status` text NOT NULL,
	-- null on a payment recorded before the rail was known.
	`provider` text,
	-- the rail's own id — a Stripe charge/PaymentIntent id. null for manual entry, and on a
	-- `direction = 'refund'` row it is the refund's id (`re_…`), never the charge's; see
	-- `payment_provider_txn_idx` below, whose shape leaves no choice.
	`provider_txn_id` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`donation_id`) REFERENCES `donation`(`id`) ON UPDATE no action ON DELETE no action,
	-- a refund is its own row, which is what makes the absence below deliberate: there is NO
	-- refund-vs-received check of any kind, because `sum(refunds) <= sum(inbound)` is
	-- cross-row — no check expresses it and D1 has no atomic read-then-write to enforce it
	-- with. two concurrent refunds can both post; the answer is a compensating entry a human
	-- writes, which is what double-entry books are for.
	CONSTRAINT "payment_direction_check" CHECK("payment"."direction" in ('inbound', 'refund')),
	CONSTRAINT "payment_method_check" CHECK("payment"."method" in ('cash', 'check', 'card', 'ach')),
	-- four states, and the vocabulary is the rail's so the webhook handler maps rather than
	-- interprets. not `refunded`: a refund is a separate row with `direction = 'refund'`, and
	-- a member here would make one fact expressible twice with nothing holding the two in
	-- agreement. `disputed` is absent for the opposite reason — it is a later event about a
	-- settled payment, not a settlement outcome.
	CONSTRAINT "payment_status_check" CHECK("payment"."status" in ('pending', 'succeeded', 'failed', 'cancelled')),
	-- the `is null` half is documentation: a check is satisfied by null, and
	-- `null in ('stripe','manual')` evaluates to null rather than false.
	CONSTRAINT "payment_provider_check" CHECK("payment"."provider" is null or "payment"."provider" in ('stripe', 'manual')),
	CONSTRAINT "payment_currency_check" CHECK(length("payment"."currency") = 3 and "payment"."currency" = upper("payment"."currency") and "payment"."currency" glob '[A-Z][A-Z][A-Z]'),
	-- ---------------------------------------------------------------------------
	-- the three constraints that make `payment_provider_txn_idx` mean anything. that unique
	-- index is the documented defence against a redelivered Stripe charge, and on its own it
	-- is bypassable three ways, because NULLs are DISTINCT in a sqlite unique index and `''`
	-- is not null:
	--   ('stripe', null) twice -> both insert. two settlement events for one charge.
	--   (null, 'ch_x')   twice -> both insert. the same hole from the other side.
	--   ('stripe', '')   twice -> collide. so a boundary normalising a missing id to `''`
	--                             instead of null refuses the second real payment as a
	--                             redelivery — which loses a gift rather than duplicating one.
	-- so: a txn id may be absent but never blank; a 'stripe' row must carry one; and a txn id
	-- must name the rail that minted it. `('manual', NULL)` and `(NULL, NULL)` stay legal and
	-- have to — staff entry is every gift in v0.
	-- ---------------------------------------------------------------------------
	CONSTRAINT "payment_provider_txn_id_not_blank_check" CHECK("payment"."provider_txn_id" is null or trim("payment"."provider_txn_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_stripe_needs_txn_id_check" CHECK("payment"."provider" <> 'stripe' or "payment"."provider_txn_id" is not null),
	CONSTRAINT "payment_txn_id_needs_provider_check" CHECK("payment"."provider_txn_id" is null or "payment"."provider" is not null),
	CONSTRAINT "payment_amount_minor_positive_check" CHECK("payment"."amount_minor" > 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `payment_donation_id_idx` ON `payment` (`donation_id`);
--> statement-breakpoint
-- payment-grain idempotency, sitting underneath `entry_group_source_idx`'s posting-grain
-- idempotency. it does not get in the way of manual entry, and that is sqlite's rule rather
-- than a coincidence: NULLs are DISTINCT in a unique index, so every staff-entered payment
-- (both columns null) inserts happily while two rows naming the same real transaction
-- collide. that same property is what makes this index bypassable on its own — read the
-- three CHECKs above as part of this constraint, not as separate hygiene.
--
-- a refund stores the refund's own ID (`re_…`), never the charge's, and the shape of this
-- index is what decides that: `direction` is not in the index and `payment` has exactly one
-- txn-id column, so a refund row carrying the charge id would collide with the inbound
-- payment it reverses and be refused as a redelivery. widening it to include `direction` is
-- a plain drop/CREATE INDEX if a rail ever forces it, never a table rebuild, so this is the
-- cheap direction to be wrong in.
CREATE UNIQUE INDEX `payment_provider_txn_idx` ON `payment` (`provider`,`provider_txn_id`);
--> statement-breakpoint
-- `program`: an organisation's named cause — what a form pins to or offers a donor, and what
-- a gift records itself against. `src/lib/server/db/schema.ts` argues the table and
-- `src/lib/server/programs/queries.ts` is every read and write of it.
--
-- no row is seeded, and none can be: a cause is one organisation's own wording, so a fork
-- has nothing to inherit — the same reason this file seeds no form.
--
-- it is created ahead of `form` and `donation`, both of which point at it.
CREATE TABLE `program` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "program_status_check" CHECK("program"."status" in ('active', 'archived')),
	CONSTRAINT "program_name_not_blank_check" CHECK(trim("program"."name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "program_description_not_blank_check" CHECK("program"."description" is null or trim("program"."description", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `program_name_idx` ON `program` ("name" collate nocase);
--> statement-breakpoint
-- a donor's standing commitment to give on a schedule. it points at the contact who gave it
-- and the form it was made on, so it is created after both; `donation.recurring_id` names it
-- from the other side, and every charge in a series is its own `donation` row.
--
-- the row is written by the first charge that settles, from what actually moved, and
-- `src/lib/server/recurring/collect.ts` is the only module that may INSERT it — an
-- authorization is not a collection. `sole-inserter.spec.ts` is what enforces that.
CREATE TABLE `recurring_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`form_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`interval` text NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subscription_id` text NOT NULL,
	`provider_customer_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`next_charge_at` integer,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`form_id`) REFERENCES `form`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurring_plan_interval_check" CHECK("recurring_plan"."interval" in ('monthly', 'yearly')),
	CONSTRAINT "recurring_plan_status_check" CHECK("recurring_plan"."status" in ('active', 'cancelled', 'lapsed')),
	CONSTRAINT "recurring_plan_provider_check" CHECK("recurring_plan"."provider" in ('stripe', 'manual')),
	CONSTRAINT "recurring_plan_currency_check" CHECK(length("recurring_plan"."currency") = 3 and "recurring_plan"."currency" = upper("recurring_plan"."currency") and "recurring_plan"."currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "recurring_plan_amount_minor_positive_check" CHECK("recurring_plan"."amount_minor" > 0),
	CONSTRAINT "recurring_plan_provider_subscription_id_not_blank_check" CHECK(trim("recurring_plan"."provider_subscription_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "recurring_plan_provider_customer_id_not_blank_check" CHECK(trim("recurring_plan"."provider_customer_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "recurring_plan_ended_at_check" CHECK(("recurring_plan"."status" = 'active' and "recurring_plan"."ended_at" is null) or ("recurring_plan"."status" <> 'active' and "recurring_plan"."ended_at" is not null))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_plan_provider_subscription_idx` ON `recurring_plan` (`provider`,`provider_subscription_id`);
--> statement-breakpoint
CREATE INDEX `recurring_plan_contact_id_idx` ON `recurring_plan` (`contact_id`);
--> statement-breakpoint
-- the deployment's own list of sites: one row per web address a donation form may be loaded
-- on, typed once for the whole deployment rather than per form. why it is rows rather than a
-- JSON column, and why there is no foreign key from `form.allowed_origins` into it, is argued
-- on the table in `src/lib/server/db/schema.ts`.
CREATE TABLE `site` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "site_origin_scheme_check" CHECK(substr("site"."origin", 1, 8) = 'https://' or substr("site"."origin", 1, 7) = 'http://'),
	CONSTRAINT "site_origin_not_blank_check" CHECK(trim("site"."origin", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "site_position_check" CHECK("site"."position" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `site_origin_idx` ON `site` (`origin`);
--> statement-breakpoint
-- the credential a colleague signs in with. `auth_account` is better-auth's `account` model,
-- and this deployment's whole use of it is one row per member: `provider_id = 'credential'`,
-- the member's own id in `account_id`, and better-auth's scrypt hash in `password`. that hash
-- is the only password hash in this schema — the deployer's `ADMIN_PASSWORD` is a deploy-time
-- secret compared in constant time and hashed nowhere, which
-- `src/lib/server/auth/credential.ts` argues. the nine OAuth columns are written by nothing
-- here and are declared anyway, because the table is better-auth's shape and not ours to
-- trim.
--
-- its `user_id` cascades, which is the second of the two cascades this schema allows — read
-- the allowlist in `src/lib/server/db/strict.workers.spec.ts` before adding a third.
-- `src/lib/server/auth/members.ts` removes a member by deleting the `auth_user` row and
-- depends on this cascade to take the credential and the sessions with it.
CREATE TABLE `auth_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `auth_account_user_id_idx` ON `auth_account` (`user_id`);
--> statement-breakpoint
-- the invitation that produced a member, and ours rather than better-auth's. the row is the
-- invitation and there is no state column: `accepted_at`, `revoked_at` and `expires_at`
-- between them say what became of it. `token_hash` is a SHA-256, so a stolen backup carries
-- no working link — the token itself is in the mail and the recipient's address bar and
-- nowhere else. `invited_by` carries no foreign key on purpose: a removed colleague must not
-- take the invitations they sent with them, so it is a pointer allowed to dangle.
CREATE TABLE `auth_member_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`invited_by` text,
	`accepted_at` integer,
	`revoked_at` integer,
	CONSTRAINT "auth_member_invitation_email_lower_check" CHECK("auth_member_invitation"."email" = lower("auth_member_invitation"."email")),
	CONSTRAINT "auth_member_invitation_token_hash_check" CHECK(length("auth_member_invitation"."token_hash") = 64)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_member_invitation_token_hash_idx` ON `auth_member_invitation` (`token_hash`);
--> statement-breakpoint
-- sessions are DB-backed rows that can be revoked, which is the whole reason better-auth is
-- here. `session.cookieCache` is left off in `createAuth`, so every request resolves against
-- this table and a delete takes effect on the next one.
CREATE TABLE `auth_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	-- the value inside the signed session cookie. every lookup is by this column.
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	-- the one CASCADE in this schema, and it is right here and wrong everywhere else: a
	-- session is worthless without its user, whereas an `account` with ledger entries under
	-- it must never disappear because a parent row went away. see the header on why a cascade
	-- and a table rebuild are a silent, unrecoverable pair — neither of these two tables is
	-- rebuildable without noticing, and no financial record hangs off either.
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_session_token_idx` ON `auth_session` (`token`);
--> statement-breakpoint
-- `list-sessions` and `revoke-sessions` filter by user. no index on `expires_at`:
-- better-auth filters by token and checks expiry in JS, so one would only cost writes.
CREATE INDEX `auth_session_user_id_idx` ON `auth_session` (`user_id`);
--> statement-breakpoint
-- the key that signs the session cookie, minted at the foot of this file. exactly one
-- row: the check is what keeps it a singleton, so "which key is live" is never a query with
-- an ordering in it.
--
-- it is a tamper check over a value whose authority lives in `auth_session`, so it guards
-- nothing that D1 access does not already grant — which is what makes a row the right home
-- for a value nobody types, is shown, or configures.
CREATE TABLE `auth_signing_key` (
	`id` text PRIMARY KEY NOT NULL,
	-- 64 lowercase hex characters — 32 bytes.
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "auth_signing_key_id_check" CHECK("auth_signing_key"."id" = 'default')
) STRICT;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- the tables better-auth owns. their columns are dictated by better-auth's core schema
-- rather than by the domain, and the `auth_` prefix is a namespace rather than a collision
-- fix: better-auth's own core schema contains a table called `account`, which this repo
-- already has as the chart of accounts. so the whole foreign namespace is prefixed once and
-- the rule is mechanical — anything better-auth owns starts with `auth_`, nothing the domain
-- owns does.
--
-- all four of better-auth's core tables are here: `auth_user`, `auth_session`,
-- `auth_account` and `auth_verification`. two more carry the prefix and are ours rather
-- than better-auth's, because the prefix marks the namespace and not what generated the
-- table — `auth_signing_key` and `auth_member_invitation`.
-- `src/lib/server/db/auth-schema.ts` argues every column of all six, and
-- `src/lib/server/auth/auth.spec.ts` compares the four against better-auth's own shape on
-- every run. none of them is reachable over HTTP: no route file answers `/api/auth/*`, so
-- better-auth's router is a 404 rather than a surface switched off, and
-- `src/lib/server/auth/unmounted-router.spec.ts` holds that absence.
-- ---------------------------------------------------------------------------
CREATE TABLE `auth_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "auth_user_email_verified_bool_check" CHECK("auth_user"."email_verified" in (0, 1))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_user_email_idx` ON `auth_user` (`email`);
--> statement-breakpoint
-- the table behind a member's mailed password reset: better-auth's `verification` model, one
-- row per outstanding reset link. `identifier` is `reset-password:<token>` carrying the token
-- exactly as it was mailed, `value` is the `auth_user.id` whose password the link resets, and
-- the row is deleted when the link is used. `value` holds a user id and carries no foreign
-- key, because better-auth's own schema declares none.
CREATE TABLE `auth_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_verification_identifier_idx` ON `auth_verification` (`identifier`);
--> statement-breakpoint
-- the chart of accounts: the reference data every ledger entry posts against.
--
-- a migration and not a seed script, because the remote migration runs inside `deploy` and is
-- therefore the only path that always reaches a fork. a seed step is one an operator can
-- skip, and this is not optional data: `ledger_entry.account_id` is a foreign key, so a
-- deployment without these rows cannot record a gift.
--
-- the ids below are deliberately identical in every deployment. they were generated once as
-- UUIDv7s and pasted in, so "every internal id is a UUIDv7" holds with no exception to
-- remember, while `code` stays the business key. do not regenerate them:
-- `src/lib/server/db/accounts.ts` mirrors them and `accounts.workers.spec.ts` asserts the
-- two sets are equal — which is the only thing standing between a forgotten migration and
-- an FK rejection on someone else's fork. once real gifts have posted against an id,
-- changing it is a data migration over an append-only ledger.
--
-- on idempotency: wrangler records applied files in a `d1_migrations` table, so this does
-- not re-run on a healthy database. the `ON CONFLICT` clauses are the belt for the ways it
-- can execute twice anyway — a re-created database, a restored backup, a hand-run
-- `d1 execute --file`. the target is left bare rather than `(code)`: a bare do nothing also
-- swallows a primary-key collision, so a re-run stays inert even after an operator has
-- renumbered a seeded `code`.
--
-- one statement per row. D1 caps a query at 100 bound parameters, so a multi-row INSERT is
-- never the shape here.
--
-- numbering follows the conventional four-digit ledger blocks: 1000s assets, 2000s
-- liabilities, 3000s net assets, 4000s revenue, 5000s expenses (6000s left free for
-- cost_of_sales when tickets and merch land). leaf codes are spaced so an org can interleave
-- its own accounts without renumbering.

-- 1000s -- assets
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('019fb0b4-ec6c-7fbb-aa36-4ff01f1781b9', '1010', 'Bank / Cash', 'asset', 0, 0, 1, NULL, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- the processor clearing account. a card charge is not cash: it is money the processor owes
-- us until it settles. a $100 gift with a $3.20 fee posts `Dr 1020 100 / Cr 4110 100` at
-- charge time, then `Dr 5200 3.20 / Cr 1020 3.20` on settlement, which leaves the 96.80 net
-- sitting in 1020. the transfer of that net into the bank is deliberately not modelled: the
-- app cannot observe money arriving in a bank account, so it does not claim to, and the net
-- stays here. debiting 1010 directly at charge time is what makes a cash account that never
-- ties to a bank statement, and makes the fee entry credit the bank for money that never
-- left it.
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('019fb0d2-7d57-7c5e-a7df-baed1f27b405', '1020', 'Undeposited Funds', 'asset', 0, 0, 1, NULL, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('019fb0b4-ec6e-7ff7-960c-a441e2c603d7', '1200', 'Accounts Receivable', 'asset', 0, 0, 1, NULL, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 2000s -- liabilities. `tax_rate_e8` stays null until the org sets its jurisdiction's rate;
-- the rate is x 1e8 (8250000 = 8.25%), never a float.
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('019fb0b4-ec6e-7ff7-960c-a442a54222ff', '2200', 'Sales Tax Payable', 'liability', 0, 1, 1, NULL, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 3000s -- net assets. the names are FASB ASU 2016-14's own wording, and the two-class split
-- is what that standard requires a US nonprofit to report. closing revenue has nowhere to go
-- without them.
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('019fb0d2-7d59-7612-9df3-962bd680f619', '3000', 'Net Assets Without Donor Restrictions', 'net_assets', 0, 0, 1, NULL, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('019fb0d2-7d59-7612-9df3-962cdf9fec08', '3100', 'Net Assets With Donor Restrictions', 'net_assets', 0, 0, 1, NULL, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 4000s -- revenue. the rollup goes in before its children: `parent_id` is a real foreign key
-- and D1 enforces foreign keys. it is the one row here with `is_postable = 0`, and the reason
-- `account_id_postable_idx` exists — a single ledger entry naming it would make every report
-- over this subtree double-count with no error anywhere.
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('019fb0b4-ec6e-7ff7-960c-a443c29210fa', '4100', 'Donations', 'revenue', 0, 0, 0, NULL, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('019fb0b4-ec6e-7ff7-960c-a4448295b77c', '4110', 'Tax-Deductible Donations', 'revenue', 1, 0, 1, NULL, '019fb0b4-ec6e-7ff7-960c-a443c29210fa', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- the non-deductible sibling carries the quid-pro-quo side of a gift: the fair market value
-- of goods or benefits the donor received.
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('019fb0b4-ec6e-7ff7-960c-a4452097e944', '4120', 'Non-Deductible Donations', 'revenue', 0, 0, 1, NULL, '019fb0b4-ec6e-7ff7-960c-a443c29210fa', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 5000s -- expenses. fees are expensed gross so the gift is recorded at face value.
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('019fb0b4-ec6e-7ff7-960c-a44693a8124e', '5200', 'Processor Fees', 'expense', 0, 0, 1, NULL, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- the session-cookie signing key, minted here so the only auth value an operator supplies is
-- ADMIN_PASSWORD, and nothing about auth has to be generated by hand before a deploy will boot.
-- the table itself is created above.
--
-- what it signs: the session cookie, and only that. it is a tamper check over a value whose
-- authority lives in `auth_session` — better-auth resolves every request against that table
-- (no cookie cache), so a forged or replayed cookie still has to name a session row that
-- exists and has not expired, and deleting the row ends the session on the next request. the
-- key is therefore not a bearer credential: it guards nothing that D1 access does not
-- already grant, which is what makes a row the right home for it and keeps the project's
-- "credentials are deploy-time secrets" rule intact — nobody types this value, nobody is
-- shown it, nobody configures it.
--
-- why a migration and not a seed or a first-request write:
--   - the remote migration is the only path that reaches every fork, always. it runs inside
--     `deploy` ahead of `wrangler deploy`, so a database a Worker can talk to has this row in
--     it before that Worker exists. a seed script is a step an operator can skip; a
--     settings-table default is not one.
--   - minting on first request instead would put a write on the hot path, race two
--     concurrent cold starts into two different keys, and make "is auth configured yet" a
--     runtime question. here it is answered before the Worker exists.
--   - BETTER_AUTH_SECRET still overrides this row when set. that is the emergency lever
--     (revoke every live session without a D1 write), not the normal configuration.
--
-- idempotent, because it must be inert on a re-run: wrangler records applied files in
-- `d1_migrations`, so this does not execute twice on a healthy database — but a re-created
-- database, a restored backup or a hand-run `d1 execute --file` are all ways it can. the bare
-- `ON CONFLICT DO NOTHING` (bare so it swallows the primary-key collision too) means a second
-- execution does not mint a second key and silently sign the admin out.
--
-- rotation logs the admin out and does nothing else — no ledger row, no donor record and no
-- `auth_user` row depends on this value. generate the replacement on your own machine rather
-- than in D1, so the entropy question below does not apply to it; the cost is that the value
-- passes through your shell history:
--
--   pnpm wrangler d1 execute better-giving --remote --command "UPDATE auth_signing_key set value = '$(openssl rand -hex 32)' where id = 'default'"
--
-- swap `--remote` for `--local` to rotate the local dev database.

-- 32 bytes, hex-encoded to 64 characters, lowercased so the stored shape is one thing.
-- `unixepoch('subsec') * 1000` is the project's encoding: integer unix ms UTC.
INSERT INTO `auth_signing_key` (`id`, `value`, `created_at`)
VALUES ('default', lower(hex(randomblob(32))), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- on `randomblob`'s entropy — medium confidence, and why that is accepted here.
--
-- traced through the open source, July 2026:
--   - SQLite 3.47 (the version workerd vendors, unpatched in random.c and os_unix.c)
--     stretches a 44-byte VFS seed with ChaCha20. good seed in, crypto-quality out.
--   - workerd's SQLite VFS does not implement xRandomness. both of its VFSes delegate to the
--     stock unix VFS (`.xRandomness = native.xRandomness`, src/workerd/util/sqlite.c++), and
--     `random`/`randomblob` are on its SQL function allowlist — the same array D1's own docs
--     cite as the list of functions D1 supports.
--   - the stock unix VFS reads /dev/urandom, and when it cannot open it, silently seeds
--     ChaCha20 with time(2) + pid + zero padding instead of failing.
--   - Cloudflare's production Workers sandbox is documented as an empty filesystem with
--     filesystem syscalls blocked by seccomp, and D1 is SQLite-in-Durable-Objects, in the
--     DO's own thread. whether that process can open /dev/urandom is not answerable from
--     outside: the sandbox policy is not in open-source workerd, and the storage layer that
--     could register its own VFS or pre-seed the PRNG is not open source either.
--   - measured: three samples from a remote database and two from separate fresh local
--     instances all differed, which rules out a fixed or zeroed seed. it cannot distinguish
--     /dev/urandom from the time+pid fallback — both produce non-repeating output. that is
--     exactly what makes the weak case silent.
--   - no Cloudflare doc, blog, changelog or engineer statement addresses randomblob's
--     entropy. their docs point at crypto.getRandomValues() for tokens, which is a different
--     code path (BoringSSL RAND_bytes) and says nothing about this one.
--
-- why it is still fine here, and the two conditions that make it fine:
--   1. this value is a tamper check, not a bearer credential. the worst case — a
--      brute-forceable seed — costs an attacker a forged cookie signature, and a forged
--      signature still has to name a live `auth_session` row. it does not mint one.
--   2. there is no better option at mint time. the alternative is not "use getRandomValues
--      here", it is "mint at first request instead", which trades a quantified, bounded risk
--      for a hot-path write and a cold-start race.
-- if either stops being true — if this key ever becomes sufficient on its own for anything —
-- do not reach for a bigger randomblob. move minting to the Worker, or make
-- BETTER_AUTH_SECRET required again.
-- ---------------------------------------------------------------------------
