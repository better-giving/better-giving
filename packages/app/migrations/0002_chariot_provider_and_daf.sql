-- Chariot becomes a processor this schema admits, and a donor-advised fund becomes a way money
-- arrives. three constraints change, on two tables: `payment_provider_check` and
-- `recurring_plan_provider_check` gain 'chariot'; `payment_method_check` gains 'daf'.
-- `payment_processor_needs_txn_id_check` is re-emitted unchanged and now holds a chariot row to a
-- transaction id, which is the grant id. `src/lib/server/db/schema.ts` argues the lists beside
-- the columns.
--
-- none of them is one of sqlite's four native ALTERs, so this is the create-copy-drop-rename
-- rebuild that file's rule 2 describes, on both tables, and the hand-edits are the ones
-- `0001_paypal_provider_and_rails.sql` applied to the same two tables:
--
-- the pragma. drizzle emitted `PRAGMA foreign_keys=OFF`/`=ON` around the first rebuild only, and
-- inside the migration's one transaction that pragma is inert. `defer_foreign_keys` is set once
-- for the file in its place, so `DROP TABLE recurring_plan` does not fail against
-- `donation.recurring_id` and both rebuilds sit under the deferral. it defers a violation, never a
-- cascade: no foreign key on either table carries `ON DELETE CASCADE`, and
-- `strict.workers.spec.ts` holds that allowlist at the two auth ones.
--
-- `STRICT` is hand-written onto both `__new_` tables, since drizzle's snapshot cannot record it;
-- `strict.workers.spec.ts` catches its absence.
--
-- every CHECK is unqualified. drizzle qualified them with the `__new_` table, which
-- `ALTER TABLE ... RENAME TO` does not rewrite, and sqlite 3.43 refuses the rename over it.
--
-- the fourth rebuild hand-edit CONTRIBUTING.md -> Migrations names, stripping backticks off a
-- re-emitted functional index, has nothing to act on: all four indexes are over plain columns.
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
	CONSTRAINT "payment_method_check" CHECK("method" in ('cash', 'check', 'card', 'ach', 'paypal', 'venmo', 'daf')),
	CONSTRAINT "payment_status_check" CHECK("status" in ('pending', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "payment_provider_check" CHECK("provider" is null or "provider" in ('stripe', 'paypal', 'chariot', 'manual')),
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
	CONSTRAINT "recurring_plan_provider_check" CHECK("provider" in ('stripe', 'paypal', 'chariot', 'manual')),
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