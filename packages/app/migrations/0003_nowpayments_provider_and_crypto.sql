-- NOWPayments becomes a processor this schema admits, and a coin sent to an address becomes a way
-- money arrives. on `payment`: `payment_provider_check` gains 'nowpayments', `payment_method_check`
-- gains 'crypto', and nullable columns arrive for the coin, its network, the amount of it received,
-- when the address stops being watched, and the first payment a repeat deposit follows, with the
-- checks that hold them and an index on the last. `src/lib/server/db/schema.ts` argues each beside
-- its column.
--
-- `recurring_plan` is not touched. its provider check reads its own frozen list, which renders the
-- same names it did, so drizzle diffed nothing on that table and `donation.recurring_id` points at
-- the table it always did.
--
-- a check is not one of sqlite's four native ALTERs, so `payment` is rebuilt, create-copy-drop-rename,
-- with the hand-edits the two migrations before this one applied to the same table:
--
-- the pragma. drizzle emitted `PRAGMA foreign_keys=OFF`/`=ON`, which is inert inside the
-- migration's one transaction. `defer_foreign_keys` is set once for the file in its place. it
-- defers a violation, never a cascade: no foreign key on or into `payment` carries
-- `ON DELETE CASCADE`, and `strict.workers.spec.ts` holds that allowlist at the two auth ones.
-- nothing references `payment` but its own new `parent_payment_id`, which every copied row
-- leaves null.
--
-- `STRICT` is hand-written onto `__new_payment`, since drizzle's snapshot cannot record it.
--
-- every CHECK is unqualified. drizzle qualified them with `__new_payment`, which
-- `ALTER TABLE ... RENAME TO` does not rewrite, and sqlite 3.43 refuses the rename over it.
--
-- the copy names only the columns the old table has. drizzle's `SELECT` also named the new ones,
-- which the old table lacks, and D1's double-quoted-string fallback reads each as the text of its
-- own name: on a `payment` holding rows that fails the apply (STRICT refuses the text in
-- `valid_until`, the coin check refuses it on a card row, the foreign key refuses it in
-- `parent_payment_id`), and on an empty one it copies clean — which is why a suite over an empty
-- schema never sees it.
--
-- `payment_parent_payment_id_idx` is created on `__new_payment` before the `DROP` rather than
-- after the rename where drizzle put it: `parent_payment_id` names `payment`, so the drop's
-- implicit delete searches `__new_payment` for every row it removes. schema.ts's rule 2 carries
-- the edit every later rebuild of this table owes. the old table has no index of that name yet,
-- so this file creates it under its own name.
--
-- no functional index is re-emitted, so the backtick strip has nothing to act on.
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
	FOREIGN KEY (`donation_id`) REFERENCES `donation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_payment_id`) REFERENCES `payment`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_direction_check" CHECK("direction" in ('inbound', 'refund')),
	CONSTRAINT "payment_method_check" CHECK("method" in ('cash', 'check', 'card', 'ach', 'paypal', 'venmo', 'daf', 'crypto')),
	CONSTRAINT "payment_status_check" CHECK("status" in ('pending', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "payment_provider_check" CHECK("provider" is null or "provider" in ('stripe', 'paypal', 'chariot', 'nowpayments', 'manual')),
	CONSTRAINT "payment_currency_check" CHECK(length("currency") = 3 and "currency" = upper("currency") and "currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "payment_provider_txn_id_not_blank_check" CHECK("provider_txn_id" is null or trim("provider_txn_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_processor_needs_txn_id_check" CHECK("provider" in ('manual') or "provider_txn_id" is not null),
	CONSTRAINT "payment_txn_id_needs_provider_check" CHECK("provider_txn_id" is null or "provider" is not null),
	CONSTRAINT "payment_amount_minor_positive_check" CHECK("amount_minor" > 0),
	CONSTRAINT "payment_coin_not_blank_check" CHECK("coin" is null or trim("coin", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_coin_lowercase_check" CHECK("coin" is null or "coin" = lower("coin")),
	CONSTRAINT "payment_coin_network_not_blank_check" CHECK("coin_network" is null or trim("coin_network", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "payment_coin_needs_crypto_check" CHECK("coin" is null or "method" = 'crypto'),
	CONSTRAINT "payment_coin_facts_need_coin_check" CHECK(("coin_amount" is null and "coin_network" is null) or "coin" is not null),
	CONSTRAINT "payment_coin_amount_canonical_check" CHECK("coin_amount" is null or ("coin_amount" <> '' and "coin_amount" <> '0' and "coin_amount" not glob '*[^0-9.]*' and length("coin_amount") - length(replace("coin_amount", '.', '')) <= 1 and "coin_amount" not glob '.*' and "coin_amount" not glob '*.' and "coin_amount" not glob '0[0-9]*' and "coin_amount" not glob '*.*0'))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_payment`("id", "donation_id", "amount_minor", "currency", "direction", "method", "status", "provider", "provider_txn_id", "occurred_at", "created_at") SELECT "id", "donation_id", "amount_minor", "currency", "direction", "method", "status", "provider", "provider_txn_id", "occurred_at", "created_at" FROM `payment`;--> statement-breakpoint
CREATE INDEX `payment_parent_payment_id_idx` ON `__new_payment` (`parent_payment_id`);--> statement-breakpoint
DROP TABLE `payment`;--> statement-breakpoint
ALTER TABLE `__new_payment` RENAME TO `payment`;--> statement-breakpoint
CREATE INDEX `payment_donation_id_idx` ON `payment` (`donation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_provider_txn_idx` ON `payment` (`provider`,`provider_txn_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys=false;--> statement-breakpoint
CREATE INDEX `payment_pending_crypto_provider_created_at_idx` ON `payment` (`provider`,`created_at`) WHERE "payment"."method" = 'crypto' and "payment"."status" = 'pending';