-- stock and IRA (QCD) gifts. `pledge_rail` holds the organisation's transfer details for each rail,
-- one row per rail, and `pledge` holds a gift a donor has pledged on one until staff mark it
-- received. `payment_method_check` gains 'stock' and 'ira_qcd', the method the payment written at
-- Mark received carries. `src/lib/server/db/schema.ts` argues each table and check beside it.
--
-- a pledge writes no `donation`, `payment` or entry: a stock pledge has no dollar value, and
-- `donation_total_minor_positive_check` stands. so `donation` is not touched.
--
-- a check is not one of sqlite's native ALTERs, so `payment` is rebuilt, create-copy-drop-rename,
-- with the hand-edits migrations/0003 applied to the same table:
--
-- the pragma. drizzle emitted `PRAGMA foreign_keys=OFF`/`=ON`, inert inside the migration's one
-- transaction; `defer_foreign_keys` is set in its place and cleared at the end of the file. no
-- foreign key on or into `payment` carries `ON DELETE CASCADE`.
--
-- `STRICT` is hand-written onto all three tables, `__new_payment` included.
--
-- every CHECK on `__new_payment` is unqualified, the spelling migrations/0003 left on `payment`. the
-- rebuild needs neither spelling: on this client (sqlite 3.45.1) `ALTER TABLE ... RENAME TO` also
-- rewrites a CHECK that still says `"__new_payment".` (CONTRIBUTING.md -> Migrations).
--
-- the copy names only columns the old table has: every column on it, and no new one.
--
-- `parent_payment_id` names `payment`, so the drop's implicit delete searches `__new_payment` for
-- every row it removes. its index is created on `__new_payment` before the `DROP`, under a `__new_`
-- name because the old table still holds the real one, and dropped after the rename, where
-- drizzle's own `CREATE INDEX` makes the real one.
--
-- no functional index is re-emitted, so the backtick strip has nothing to act on.
CREATE TABLE `pledge` (
	`id` text PRIMARY KEY NOT NULL,
	`method` text NOT NULL,
	`contact_id` text NOT NULL,
	`currency` text NOT NULL,
	`reference` text NOT NULL,
	`ticker` text,
	`shares_millionths` integer,
	`custodian` text,
	`amount_minor` integer,
	`told_at` integer,
	`donation_id` text,
	`form_id` text NOT NULL,
	`origin` text,
	`program_id` text,
	`supporter_page_id` text,
	`note` text,
	`note_public` integer DEFAULT false NOT NULL,
	`note_anonymous` integer DEFAULT false NOT NULL,
	`note_shown_name` text,
	`tribute_kind` text,
	`tribute_honoree` text,
	`tribute_notify_name` text,
	`tribute_notify_email` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`donation_id`) REFERENCES `donation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`form_id`) REFERENCES `form`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`program_id`) REFERENCES `program`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supporter_page_id`) REFERENCES `supporter_page`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pledge_method_check" CHECK("pledge"."method" in ('stock', 'ira_qcd')),
	CONSTRAINT "pledge_currency_check" CHECK(length("pledge"."currency") = 3 and "pledge"."currency" = upper("pledge"."currency") and "pledge"."currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "pledge_reference_not_blank_check" CHECK(trim("pledge"."reference", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_reference_uppercase_check" CHECK("pledge"."reference" = upper("pledge"."reference")),
	CONSTRAINT "pledge_ticker_not_blank_check" CHECK("pledge"."ticker" is null or trim("pledge"."ticker", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_ticker_uppercase_check" CHECK("pledge"."ticker" = upper("pledge"."ticker")),
	CONSTRAINT "pledge_custodian_not_blank_check" CHECK("pledge"."custodian" is null or trim("pledge"."custodian", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_shares_millionths_positive_check" CHECK("pledge"."shares_millionths" > 0),
	CONSTRAINT "pledge_amount_minor_positive_check" CHECK("pledge"."amount_minor" > 0),
	CONSTRAINT "pledge_stock_check" CHECK(("pledge"."method" = 'stock') = ("pledge"."ticker" is not null and "pledge"."shares_millionths" is not null)),
	CONSTRAINT "pledge_stock_has_no_amount_check" CHECK("pledge"."method" <> 'stock' or ("pledge"."amount_minor" is null and "pledge"."custodian" is null)),
	CONSTRAINT "pledge_ira_qcd_check" CHECK(("pledge"."method" = 'ira_qcd') = ("pledge"."custodian" is not null and "pledge"."amount_minor" is not null)),
	CONSTRAINT "pledge_ira_qcd_has_no_shares_check" CHECK("pledge"."method" <> 'ira_qcd' or ("pledge"."ticker" is null and "pledge"."shares_millionths" is null)),
	CONSTRAINT "pledge_origin_not_blank_check" CHECK("pledge"."origin" is null or trim("pledge"."origin", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_note_not_blank_check" CHECK("pledge"."note" is null or trim("pledge"."note", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_note_public_bool_check" CHECK("pledge"."note_public" in (0, 1)),
	CONSTRAINT "pledge_note_anonymous_bool_check" CHECK("pledge"."note_anonymous" in (0, 1)),
	CONSTRAINT "pledge_note_anonymous_public_check" CHECK("pledge"."note_anonymous" = 0 or "pledge"."note_public" = 1),
	CONSTRAINT "pledge_note_shown_name_not_blank_check" CHECK("pledge"."note_shown_name" is null or trim("pledge"."note_shown_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_note_shown_name_public_check" CHECK(("pledge"."note_public" = 1) = ("pledge"."note_shown_name" is not null)),
	CONSTRAINT "pledge_note_shown_name_anonymous_check" CHECK("pledge"."note_anonymous" = 0 or "pledge"."note_shown_name" = 'Anonymous'),
	CONSTRAINT "pledge_tribute_check" CHECK(("pledge"."tribute_kind" is null) = ("pledge"."tribute_honoree" is null)),
	CONSTRAINT "pledge_tribute_notify_check" CHECK(("pledge"."tribute_notify_name" is null) = ("pledge"."tribute_notify_email" is null) and ("pledge"."tribute_notify_name" is null or "pledge"."tribute_kind" is not null))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `pledge_reference_idx` ON `pledge` (`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `pledge_donation_id_idx` ON `pledge` (`donation_id`);--> statement-breakpoint
CREATE TABLE `pledge_rail` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`brokerage_name` text,
	`dtc_number` text,
	`account_number` text,
	`account_name` text,
	`payee_name` text,
	`mailing_address` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "pledge_rail_id_check" CHECK("pledge_rail"."id" in ('stock', 'ira_qcd')),
	CONSTRAINT "pledge_rail_enabled_bool_check" CHECK("pledge_rail"."enabled" in (0, 1)),
	CONSTRAINT "pledge_rail_brokerage_name_not_blank_check" CHECK("pledge_rail"."brokerage_name" is null or trim("pledge_rail"."brokerage_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_rail_dtc_number_not_blank_check" CHECK("pledge_rail"."dtc_number" is null or trim("pledge_rail"."dtc_number", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_rail_account_number_not_blank_check" CHECK("pledge_rail"."account_number" is null or trim("pledge_rail"."account_number", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_rail_account_name_not_blank_check" CHECK("pledge_rail"."account_name" is null or trim("pledge_rail"."account_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_rail_payee_name_not_blank_check" CHECK("pledge_rail"."payee_name" is null or trim("pledge_rail"."payee_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_rail_mailing_address_not_blank_check" CHECK("pledge_rail"."mailing_address" is null or trim("pledge_rail"."mailing_address", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "pledge_rail_stock_details_check" CHECK("pledge_rail"."id" = 'stock' or ("pledge_rail"."brokerage_name" is null and "pledge_rail"."dtc_number" is null and "pledge_rail"."account_number" is null and "pledge_rail"."account_name" is null)),
	CONSTRAINT "pledge_rail_ira_qcd_details_check" CHECK("pledge_rail"."id" = 'ira_qcd' or ("pledge_rail"."payee_name" is null and "pledge_rail"."mailing_address" is null)),
	CONSTRAINT "pledge_rail_enabled_complete_check" CHECK("pledge_rail"."enabled" = 0 or ("pledge_rail"."id" = 'stock' and "pledge_rail"."brokerage_name" is not null and "pledge_rail"."dtc_number" is not null and "pledge_rail"."account_number" is not null and "pledge_rail"."account_name" is not null) or ("pledge_rail"."id" = 'ira_qcd' and "pledge_rail"."payee_name" is not null and "pledge_rail"."mailing_address" is not null))
) STRICT;
--> statement-breakpoint
PRAGMA defer_foreign_keys=true;--> statement-breakpoint
CREATE TABLE `__new_payment` (
	`id` text PRIMARY KEY NOT NULL,
	`donation_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`direction` text NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`provider` text,
	`provider_txn_id` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`coin` text,
	`coin_network` text,
	`coin_amount` text,
	`valid_until` integer,
	`parent_payment_id` text,
	`provider_reference` text,
	`notice_owed_since` integer,
	`notice_maybe_sent_at` integer,
	FOREIGN KEY (`donation_id`) REFERENCES `donation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_payment_id`) REFERENCES `payment`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_direction_check" CHECK("direction" in ('inbound', 'refund')),
	CONSTRAINT "payment_method_check" CHECK("method" in ('cash', 'check', 'card', 'ach', 'paypal', 'venmo', 'daf', 'crypto', 'stock', 'ira_qcd')),
	CONSTRAINT "payment_status_check" CHECK("status" in ('pending', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "payment_provider_check" CHECK("provider" is null or "provider" in ('stripe', 'paypal', 'chariot', 'nowpayments', 'manual')),
	CONSTRAINT "payment_currency_check" CHECK(length("currency") = 3 and "currency" = upper("currency") and "currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "payment_provider_txn_id_not_blank_check" CHECK("provider_txn_id" is null or trim("provider_txn_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_processor_needs_txn_id_check" CHECK("provider" in ('manual') or "provider_txn_id" is not null),
	CONSTRAINT "payment_txn_id_needs_provider_check" CHECK("provider_txn_id" is null or "provider" is not null),
	CONSTRAINT "payment_amount_minor_positive_check" CHECK("amount_minor" > 0),
	CONSTRAINT "payment_provider_reference_not_blank_check" CHECK("provider_reference" is null or trim("provider_reference", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_provider_reference_needs_provider_check" CHECK("provider_reference" is null or "provider" is not null),
	CONSTRAINT "payment_coin_not_blank_check" CHECK("coin" is null or trim("coin", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_coin_lowercase_check" CHECK("coin" is null or "coin" = lower("coin")),
	CONSTRAINT "payment_coin_network_not_blank_check" CHECK("coin_network" is null or trim("coin_network", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_coin_needs_crypto_check" CHECK("coin" is null or "method" = 'crypto'),
	CONSTRAINT "payment_coin_facts_need_coin_check" CHECK(("coin_amount" is null and "coin_network" is null) or "coin" is not null),
	CONSTRAINT "payment_coin_amount_canonical_check" CHECK("coin_amount" is null or ("coin_amount" <> '' and "coin_amount" <> '0' and "coin_amount" not glob '*[^0-9.]*' and length("coin_amount") - length(replace("coin_amount", '.', '')) <= 1 and "coin_amount" not glob '.*' and "coin_amount" not glob '*.' and "coin_amount" not glob '0[0-9]*' and "coin_amount" not glob '*.*0'))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_payment`("id", "donation_id", "amount_minor", "currency", "direction", "method", "status", "provider", "provider_txn_id", "occurred_at", "created_at", "coin", "coin_network", "coin_amount", "valid_until", "parent_payment_id", "provider_reference", "notice_owed_since", "notice_maybe_sent_at") SELECT "id", "donation_id", "amount_minor", "currency", "direction", "method", "status", "provider", "provider_txn_id", "occurred_at", "created_at", "coin", "coin_network", "coin_amount", "valid_until", "parent_payment_id", "provider_reference", "notice_owed_since", "notice_maybe_sent_at" FROM `payment`;--> statement-breakpoint
CREATE INDEX `__new_payment_parent_payment_id_idx` ON `__new_payment` (`parent_payment_id`);--> statement-breakpoint
DROP TABLE `payment`;--> statement-breakpoint
ALTER TABLE `__new_payment` RENAME TO `payment`;--> statement-breakpoint
DROP INDEX `__new_payment_parent_payment_id_idx`;--> statement-breakpoint
CREATE INDEX `payment_donation_id_idx` ON `payment` (`donation_id`);--> statement-breakpoint
CREATE INDEX `payment_parent_payment_id_idx` ON `payment` (`parent_payment_id`);--> statement-breakpoint
CREATE INDEX `payment_pending_crypto_provider_created_at_idx` ON `payment` (`provider`,`created_at`) WHERE "payment"."method" = 'crypto' and "payment"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `payment_settled_gift_occurred_at_idx` ON `payment` (`occurred_at`,`id`) WHERE "payment"."status" = 'succeeded' and "payment"."direction" = 'inbound';--> statement-breakpoint
CREATE INDEX `payment_settled_gift_created_at_idx` ON `payment` (`created_at`,`id`) WHERE "payment"."status" = 'succeeded' and "payment"."direction" = 'inbound';--> statement-breakpoint
CREATE INDEX `payment_refund_created_at_idx` ON `payment` (`created_at`,`parent_payment_id`) WHERE "payment"."direction" = 'refund';--> statement-breakpoint
CREATE UNIQUE INDEX `payment_provider_txn_idx` ON `payment` (`provider`,`provider_txn_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys=false;
