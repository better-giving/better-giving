-- a gift is sent to QuickBooks against the account the money is held in until it is paid out,
-- one per processor and one for a gift received in hand, and never against the bank: this app hears
-- no payout, so the bank account `deposit_account_id` named was posted a deposit the bank feed never
-- shows for every gift. `quickbooks_connection` loses `deposit_account_id` and
-- `deposit_account_name` and gains a pair per holding — `stripe_balance_`, `paypal_balance_`,
-- `chariot_balance_`, `nowpayments_balance_` and `undeposited_funds_account_id`/`_name` — each with
-- the not-blank and name-needs-id checks the income and fee pairs carry, and `moved_at`, which keeps
-- the connect-time account fill off a connection moved to another company until an operator saves
-- its accounts. `src/lib/server/db/schema.ts` argues each column beside it.
--
-- no bank pick is carried into a holding: a holding is an Other Current Asset and the deposit
-- account was a Bank account, so every holding starts null and a connected deployment holds its
-- gifts until an operator picks. income, fee, the tokens and the start date are copied as they
-- stand.
--
-- dropping a column a CHECK names is not one of sqlite's native ALTERs, so this is the
-- create-copy-drop-rename rebuild `src/lib/server/db/schema.ts`'s rule 2 describes, with the
-- hand-edits CONTRIBUTING.md -> Migrations lists:
--
-- the pragma. drizzle emitted `PRAGMA foreign_keys=OFF`/`=ON`, which is inert inside the
-- migration's one transaction; `defer_foreign_keys` stands in its place. nothing references
-- `quickbooks_connection` and it references nothing, so there is no violation for it to defer.
--
-- `STRICT` is hand-written onto the `__new_` table, since drizzle's snapshot cannot record it;
-- `strict.workers.spec.ts` catches its absence.
--
-- every CHECK is unqualified. drizzle qualified them with the `__new_` table, which
-- `ALTER TABLE ... RENAME TO` does not rewrite, and sqlite 3.43 refuses the rename over it.
--
-- the copy names only the fourteen columns the old table holds. drizzle's draft selected the new
-- columns from it too, which D1's double-quoted-literal fallback reads as their own names as text.
--
-- no index is re-emitted, so there is no backtick to strip and none to move ahead of the drop.
PRAGMA defer_foreign_keys=true;--> statement-breakpoint
CREATE TABLE `__new_quickbooks_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`realm_id` text NOT NULL,
	`company_name` text,
	`access_token` text NOT NULL,
	`access_token_expires_at` integer NOT NULL,
	`refresh_token` text NOT NULL,
	`refresh_token_expires_at` integer,
	`income_account_id` text,
	`income_account_name` text,
	`fee_account_id` text,
	`fee_account_name` text,
	`start_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`stripe_balance_account_id` text,
	`stripe_balance_account_name` text,
	`paypal_balance_account_id` text,
	`paypal_balance_account_name` text,
	`chariot_balance_account_id` text,
	`chariot_balance_account_name` text,
	`nowpayments_balance_account_id` text,
	`nowpayments_balance_account_name` text,
	`undeposited_funds_account_id` text,
	`undeposited_funds_account_name` text,
	`moved_at` integer,
	CONSTRAINT "quickbooks_connection_id_check" CHECK("id" = 'quickbooks'),
	CONSTRAINT "quickbooks_connection_realm_id_not_blank_check" CHECK(trim("realm_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_access_token_not_blank_check" CHECK(trim("access_token", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_refresh_token_not_blank_check" CHECK(trim("refresh_token", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_company_name_not_blank_check" CHECK("company_name" is null or trim("company_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_income_account_id_not_blank_check" CHECK("income_account_id" is null or trim("income_account_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_income_account_name_not_blank_check" CHECK("income_account_name" is null or trim("income_account_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_fee_account_id_not_blank_check" CHECK("fee_account_id" is null or trim("fee_account_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_fee_account_name_not_blank_check" CHECK("fee_account_name" is null or trim("fee_account_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_income_account_name_needs_id_check" CHECK("income_account_name" is null or "income_account_id" is not null),
	CONSTRAINT "quickbooks_connection_fee_account_name_needs_id_check" CHECK("fee_account_name" is null or "fee_account_id" is not null),
	CONSTRAINT "quickbooks_connection_stripe_balance_account_id_not_blank_check" CHECK("stripe_balance_account_id" is null or trim("stripe_balance_account_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_stripe_balance_account_name_not_blank_check" CHECK("stripe_balance_account_name" is null or trim("stripe_balance_account_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_stripe_balance_account_name_needs_id_check" CHECK("stripe_balance_account_name" is null or "stripe_balance_account_id" is not null),
	CONSTRAINT "quickbooks_connection_paypal_balance_account_id_not_blank_check" CHECK("paypal_balance_account_id" is null or trim("paypal_balance_account_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_paypal_balance_account_name_not_blank_check" CHECK("paypal_balance_account_name" is null or trim("paypal_balance_account_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_paypal_balance_account_name_needs_id_check" CHECK("paypal_balance_account_name" is null or "paypal_balance_account_id" is not null),
	CONSTRAINT "quickbooks_connection_chariot_balance_account_id_not_blank_check" CHECK("chariot_balance_account_id" is null or trim("chariot_balance_account_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_chariot_balance_account_name_not_blank_check" CHECK("chariot_balance_account_name" is null or trim("chariot_balance_account_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_chariot_balance_account_name_needs_id_check" CHECK("chariot_balance_account_name" is null or "chariot_balance_account_id" is not null),
	CONSTRAINT "quickbooks_connection_nowpayments_balance_account_id_not_blank_check" CHECK("nowpayments_balance_account_id" is null or trim("nowpayments_balance_account_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_nowpayments_balance_account_name_not_blank_check" CHECK("nowpayments_balance_account_name" is null or trim("nowpayments_balance_account_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_nowpayments_balance_account_name_needs_id_check" CHECK("nowpayments_balance_account_name" is null or "nowpayments_balance_account_id" is not null),
	CONSTRAINT "quickbooks_connection_undeposited_funds_account_id_not_blank_check" CHECK("undeposited_funds_account_id" is null or trim("undeposited_funds_account_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_undeposited_funds_account_name_not_blank_check" CHECK("undeposited_funds_account_name" is null or trim("undeposited_funds_account_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_undeposited_funds_account_name_needs_id_check" CHECK("undeposited_funds_account_name" is null or "undeposited_funds_account_id" is not null)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_quickbooks_connection`("id", "realm_id", "company_name", "access_token", "access_token_expires_at", "refresh_token", "refresh_token_expires_at", "income_account_id", "income_account_name", "fee_account_id", "fee_account_name", "start_at", "created_at", "updated_at") SELECT "id", "realm_id", "company_name", "access_token", "access_token_expires_at", "refresh_token", "refresh_token_expires_at", "income_account_id", "income_account_name", "fee_account_id", "fee_account_name", "start_at", "created_at", "updated_at" FROM `quickbooks_connection`;--> statement-breakpoint
DROP TABLE `quickbooks_connection`;--> statement-breakpoint
ALTER TABLE `__new_quickbooks_connection` RENAME TO `quickbooks_connection`;--> statement-breakpoint
PRAGMA defer_foreign_keys=false;
