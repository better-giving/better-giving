-- PayPal becomes a processor this schema admits, and its two rails become ways money arrives.
-- four constraints change, on two tables: `payment_provider_check` and
-- `recurring_plan_provider_check` gain 'paypal'; `payment_method_check` gains 'paypal' and
-- 'venmo'; and `payment_stripe_needs_txn_id_check` becomes
-- `payment_processor_needs_txn_id_check`, naming the one provider that mints no transaction id
-- instead of the one that does. `src/lib/server/db/schema.ts` argues all four beside the columns.
--
-- none of them is one of sqlite's four native ALTERs, so this is the create-copy-drop-rename
-- rebuild that file's rule 2 describes, on both tables. what that costs, and what was
-- hand-edited into the generated draft:
--
-- the pragma. drizzle emitted `PRAGMA foreign_keys=OFF`/`=ON` around the first rebuild only and
-- nothing around the second, and both are no-ops anyway — the whole file runs in one transaction
-- and sqlite documents that pragma as inert inside one. `DROP TABLE recurring_plan` would then
-- fail against `donation.recurring_id`, which points at it. `defer_foreign_keys` is what D1
-- honours, it is set once for the file because it covers exactly one transaction, and it holds
-- across both rebuilds rather than only the first.
--
-- deferral is not what makes this safe on its own: it defers a violation, never a cascade, and a
-- rebuild's `DROP TABLE <parent>` performs an implicit delete of every parent row. no foreign key
-- on either table carries `ON DELETE CASCADE` — `strict.workers.spec.ts` holds the allowlist at
-- the two auth ones — so `donation` keeps its rows and the deferred check finds the commitments
-- again under the renamed table at commit.
--
-- `STRICT` is hand-written onto both `__new_` tables. a rebuild recreates a table from drizzle's
-- snapshot, which cannot record the keyword, so it goes missing with nobody having typed
-- anything; `strict.workers.spec.ts` is what catches it.
--
-- every CHECK below is unqualified — `CHECK("direction" in (...))` where `0000_initial_schema.sql`
-- writes `CHECK("payment"."direction" in (...))`. drizzle qualified them with the `__new_` table,
-- and `ALTER TABLE ... RENAME TO` does not rewrite a qualifier inside a check, so the renamed table
-- was left carrying checks that named a table no longer there. sqlite 3.43 refuses the rename over
-- it and workerd's sqlite does not, so the generated form passes the suite and gambles at the
-- one-way door. unqualified resolves against the table whatever it is called.
--
-- the one hand-edit CONTRIBUTING.md -> Migrations names that was not needed here: stripping the
-- backticks off a re-emitted functional index. neither table has one — all four indexes below are
-- over plain columns.
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
	FOREIGN KEY (`donation_id`) REFERENCES `donation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_direction_check" CHECK("direction" in ('inbound', 'refund')),
	CONSTRAINT "payment_method_check" CHECK("method" in ('cash', 'check', 'card', 'ach', 'paypal', 'venmo')),
	CONSTRAINT "payment_status_check" CHECK("status" in ('pending', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "payment_provider_check" CHECK("provider" is null or "provider" in ('stripe', 'paypal', 'manual')),
	CONSTRAINT "payment_currency_check" CHECK(length("currency") = 3 and "currency" = upper("currency") and "currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "payment_provider_txn_id_not_blank_check" CHECK("provider_txn_id" is null or trim("provider_txn_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_processor_needs_txn_id_check" CHECK("provider" in ('manual') or "provider_txn_id" is not null),
	CONSTRAINT "payment_txn_id_needs_provider_check" CHECK("provider_txn_id" is null or "provider" is not null),
	CONSTRAINT "payment_amount_minor_positive_check" CHECK("amount_minor" > 0)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_payment`("id", "donation_id", "amount_minor", "currency", "direction", "method", "status", "provider", "provider_txn_id", "occurred_at", "created_at") SELECT "id", "donation_id", "amount_minor", "currency", "direction", "method", "status", "provider", "provider_txn_id", "occurred_at", "created_at" FROM `payment`;--> statement-breakpoint
DROP TABLE `payment`;--> statement-breakpoint
ALTER TABLE `__new_payment` RENAME TO `payment`;--> statement-breakpoint
CREATE INDEX `payment_donation_id_idx` ON `payment` (`donation_id`);--> statement-breakpoint
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
	CONSTRAINT "recurring_plan_interval_check" CHECK("interval" in ('monthly', 'yearly')),
	CONSTRAINT "recurring_plan_status_check" CHECK("status" in ('active', 'cancelled', 'lapsed')),
	CONSTRAINT "recurring_plan_provider_check" CHECK("provider" in ('stripe', 'paypal', 'manual')),
	CONSTRAINT "recurring_plan_currency_check" CHECK(length("currency") = 3 and "currency" = upper("currency") and "currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "recurring_plan_amount_minor_positive_check" CHECK("amount_minor" > 0),
	CONSTRAINT "recurring_plan_provider_subscription_id_not_blank_check" CHECK(trim("provider_subscription_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "recurring_plan_provider_customer_id_not_blank_check" CHECK(trim("provider_customer_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "recurring_plan_ended_at_check" CHECK(("status" = 'active' and "ended_at" is null) or ("status" <> 'active' and "ended_at" is not null))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_recurring_plan`("id", "contact_id", "form_id", "amount_minor", "currency", "interval", "status", "provider", "provider_subscription_id", "provider_customer_id", "started_at", "next_charge_at", "ended_at", "created_at", "updated_at") SELECT "id", "contact_id", "form_id", "amount_minor", "currency", "interval", "status", "provider", "provider_subscription_id", "provider_customer_id", "started_at", "next_charge_at", "ended_at", "created_at", "updated_at" FROM `recurring_plan`;--> statement-breakpoint
DROP TABLE `recurring_plan`;--> statement-breakpoint
ALTER TABLE `__new_recurring_plan` RENAME TO `recurring_plan`;--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_plan_provider_subscription_idx` ON `recurring_plan` (`provider`,`provider_subscription_id`);--> statement-breakpoint
CREATE INDEX `recurring_plan_contact_id_idx` ON `recurring_plan` (`contact_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys=false;