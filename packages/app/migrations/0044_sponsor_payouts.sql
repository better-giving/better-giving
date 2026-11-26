-- a hosted site's fiscal sponsor, and the income its payouts book. `entry_group_source_type_check`
-- gains 'payout', and `payment_provider_check` and `recurring_plan_provider_check` gain 'sponsor'.
-- the 4130 Grant income account is seeded under the 4100 Donations rollup. `src/lib/server/db/schema.ts`
-- states the rule for each check beside it, and `POSTING_ACCOUNTS.grantIncome` in
-- `src/lib/server/db/accounts.ts` names the account's id.
--
-- a check is not one of sqlite's native ALTERs, so `entry_group`, `payment` and `recurring_plan` are
-- each rebuilt, create-copy-drop-rename, with the hand-edits CONTRIBUTING.md -> Migrations lists:
--
-- the pragma. drizzle emitted `PRAGMA foreign_keys=OFF`/`=ON` around the first rebuild only, inert
-- inside the migration's one transaction; `defer_foreign_keys` is set once for the file in its place
-- and cleared at the end. no foreign key on or into the three tables carries `ON DELETE CASCADE`.
--
-- `STRICT` is hand-written onto every `__new_` table.
--
-- `parent_payment_id` names `payment`, so the drop's implicit delete searches `__new_payment` for
-- every row it removes. its index is created on `__new_payment` before the `DROP`, under a `__new_`
-- name because the old table still holds the real one, and dropped after the rename, where
-- drizzle's own `CREATE INDEX` makes the real one.
--
-- no functional index is re-emitted, and none of the three tables carries a trigger.
--
-- the account row's shape is 4120's in `0000_initial_schema.sql`: postable, not deductible, not a
-- tax, parent 4100. the bare `ON CONFLICT DO NOTHING` leaves a row already there as it stands.
PRAGMA defer_foreign_keys=true;--> statement-breakpoint
CREATE TABLE `__new_entry_group` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`currency` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`memo` text,
	CONSTRAINT "entry_group_source_type_check" CHECK("__new_entry_group"."source_type" in ('payment', 'donation', 'refund', 'fee', 'adjustment', 'payout')),
	CONSTRAINT "entry_group_currency_check" CHECK(length("__new_entry_group"."currency") = 3 and "__new_entry_group"."currency" = upper("__new_entry_group"."currency") and "__new_entry_group"."currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "entry_group_source_id_not_empty_check" CHECK(length("__new_entry_group"."source_id") > 0)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_entry_group`("id", "source_type", "source_id", "currency", "occurred_at", "created_at", "memo") SELECT "id", "source_type", "source_id", "currency", "occurred_at", "created_at", "memo" FROM `entry_group`;--> statement-breakpoint
DROP TABLE `entry_group`;--> statement-breakpoint
ALTER TABLE `__new_entry_group` RENAME TO `entry_group`;--> statement-breakpoint
CREATE UNIQUE INDEX `entry_group_source_idx` ON `entry_group` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `entry_group_occurred_at_idx` ON `entry_group` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `entry_group_created_at_idx` ON `entry_group` (`created_at`,`source_id`);--> statement-breakpoint
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
	CONSTRAINT "payment_direction_check" CHECK("__new_payment"."direction" in ('inbound', 'refund')),
	CONSTRAINT "payment_method_check" CHECK("__new_payment"."method" in ('cash', 'check', 'card', 'ach', 'paypal', 'venmo', 'daf', 'crypto', 'stock', 'ira_qcd')),
	CONSTRAINT "payment_status_check" CHECK("__new_payment"."status" in ('pending', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "payment_provider_check" CHECK("__new_payment"."provider" is null or "__new_payment"."provider" in ('stripe', 'paypal', 'chariot', 'nowpayments', 'sponsor', 'manual')),
	CONSTRAINT "payment_currency_check" CHECK(length("__new_payment"."currency") = 3 and "__new_payment"."currency" = upper("__new_payment"."currency") and "__new_payment"."currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "payment_provider_txn_id_not_blank_check" CHECK("__new_payment"."provider_txn_id" is null or trim("__new_payment"."provider_txn_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_processor_needs_txn_id_check" CHECK("__new_payment"."provider" in ('manual') or "__new_payment"."provider_txn_id" is not null),
	CONSTRAINT "payment_txn_id_needs_provider_check" CHECK("__new_payment"."provider_txn_id" is null or "__new_payment"."provider" is not null),
	CONSTRAINT "payment_amount_minor_positive_check" CHECK("__new_payment"."amount_minor" > 0),
	CONSTRAINT "payment_provider_reference_not_blank_check" CHECK("__new_payment"."provider_reference" is null or trim("__new_payment"."provider_reference", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_provider_reference_needs_provider_check" CHECK("__new_payment"."provider_reference" is null or "__new_payment"."provider" is not null),
	CONSTRAINT "payment_coin_not_blank_check" CHECK("__new_payment"."coin" is null or trim("__new_payment"."coin", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_coin_lowercase_check" CHECK("__new_payment"."coin" is null or "__new_payment"."coin" = lower("__new_payment"."coin")),
	CONSTRAINT "payment_coin_network_not_blank_check" CHECK("__new_payment"."coin_network" is null or trim("__new_payment"."coin_network", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_coin_needs_crypto_check" CHECK("__new_payment"."coin" is null or "__new_payment"."method" = 'crypto'),
	CONSTRAINT "payment_coin_facts_need_coin_check" CHECK(("__new_payment"."coin_amount" is null and "__new_payment"."coin_network" is null) or "__new_payment"."coin" is not null),
	CONSTRAINT "payment_coin_amount_canonical_check" CHECK("__new_payment"."coin_amount" is null or ("__new_payment"."coin_amount" <> '' and "__new_payment"."coin_amount" <> '0' and "__new_payment"."coin_amount" not glob '*[^0-9.]*' and length("__new_payment"."coin_amount") - length(replace("__new_payment"."coin_amount", '.', '')) <= 1 and "__new_payment"."coin_amount" not glob '.*' and "__new_payment"."coin_amount" not glob '*.' and "__new_payment"."coin_amount" not glob '0[0-9]*' and "__new_payment"."coin_amount" not glob '*.*0'))
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
CREATE TABLE `__new_recurring_plan` (
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
	CONSTRAINT "recurring_plan_interval_check" CHECK("__new_recurring_plan"."interval" in ('monthly', 'yearly')),
	CONSTRAINT "recurring_plan_status_check" CHECK("__new_recurring_plan"."status" in ('active', 'cancelled', 'lapsed')),
	CONSTRAINT "recurring_plan_provider_check" CHECK("__new_recurring_plan"."provider" in ('stripe', 'paypal', 'chariot', 'sponsor', 'manual')),
	CONSTRAINT "recurring_plan_currency_check" CHECK(length("__new_recurring_plan"."currency") = 3 and "__new_recurring_plan"."currency" = upper("__new_recurring_plan"."currency") and "__new_recurring_plan"."currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "recurring_plan_amount_minor_positive_check" CHECK("__new_recurring_plan"."amount_minor" > 0),
	CONSTRAINT "recurring_plan_provider_subscription_id_not_blank_check" CHECK(trim("__new_recurring_plan"."provider_subscription_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "recurring_plan_provider_customer_id_not_blank_check" CHECK(trim("__new_recurring_plan"."provider_customer_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "recurring_plan_ended_at_check" CHECK(("__new_recurring_plan"."status" = 'active' and "__new_recurring_plan"."ended_at" is null) or ("__new_recurring_plan"."status" <> 'active' and "__new_recurring_plan"."ended_at" is not null))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_recurring_plan`("id", "contact_id", "form_id", "amount_minor", "currency", "interval", "status", "provider", "provider_subscription_id", "provider_customer_id", "started_at", "next_charge_at", "ended_at", "created_at", "updated_at") SELECT "id", "contact_id", "form_id", "amount_minor", "currency", "interval", "status", "provider", "provider_subscription_id", "provider_customer_id", "started_at", "next_charge_at", "ended_at", "created_at", "updated_at" FROM `recurring_plan`;--> statement-breakpoint
DROP TABLE `recurring_plan`;--> statement-breakpoint
ALTER TABLE `__new_recurring_plan` RENAME TO `recurring_plan`;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_plan_provider_subscription_idx` ON `recurring_plan` (`provider`,`provider_subscription_id`);--> statement-breakpoint
CREATE INDEX `recurring_plan_contact_id_idx` ON `recurring_plan` (`contact_id`);--> statement-breakpoint
CREATE INDEX `recurring_plan_created_at_idx` ON `recurring_plan` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `recurring_plan_updated_at_idx` ON `recurring_plan` (`updated_at`,`id`);--> statement-breakpoint
PRAGMA defer_foreign_keys=false;--> statement-breakpoint
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('01a216b0-2321-771d-b8f6-924ee2497128', '4130', 'Grant income', 'revenue', 0, 0, 1, NULL, '019fb0b4-ec6e-7ff7-960c-a443c29210fa', CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;