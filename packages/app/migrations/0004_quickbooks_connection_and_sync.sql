-- QuickBooks Online becomes a place this deployment's books are sent to. two new tables and
-- nothing else: `quickbooks_connection` holds the one company a deployment is joined to, and
-- `quickbooks_sync` holds where each journal entry stands on its way there.
-- `src/lib/server/db/schema.ts` argues each column beside it.
--
-- no table is rebuilt. both are plain creates, so none of the rebuild hand-edits apply: no
-- deferral, no unqualified CHECK, no backtick strip, no index moved ahead of a drop. `STRICT` is
-- hand-written onto each `CREATE TABLE`, since drizzle's snapshot cannot record it.
--
-- `quickbooks_connection` is a singleton on the shape `org_profile` and `auth_signing_key` use:
-- the primary key bounds how many rows may carry an id and `quickbooks_connection_id_check`
-- bounds which id that is, so no second row is insertable under any id. no row is seeded — a
-- deployment that has not connected has none, and a blank one would read as connected.
--
-- `quickbooks_sync.entry_group_id` is both the whole primary key and a foreign key to
-- `entry_group`, `NO ACTION` like every other domain key in this schema. that is where the sync's
-- idempotency comes from: `entry_group_source_idx` already refuses a second entry for one
-- (source_type, source_id), so a redelivered webhook reaches the same entry group and therefore
-- the same delivery row.
--
-- nothing writes to either table yet.
CREATE TABLE `quickbooks_connection` (
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
	`deposit_account_id` text,
	`deposit_account_name` text,
	`start_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "quickbooks_connection_id_check" CHECK("quickbooks_connection"."id" = 'quickbooks'),
	CONSTRAINT "quickbooks_connection_realm_id_not_blank_check" CHECK(trim("quickbooks_connection"."realm_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_access_token_not_blank_check" CHECK(trim("quickbooks_connection"."access_token", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_refresh_token_not_blank_check" CHECK(trim("quickbooks_connection"."refresh_token", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_company_name_not_blank_check" CHECK("quickbooks_connection"."company_name" is null or trim("quickbooks_connection"."company_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_income_account_id_not_blank_check" CHECK("quickbooks_connection"."income_account_id" is null or trim("quickbooks_connection"."income_account_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_income_account_name_not_blank_check" CHECK("quickbooks_connection"."income_account_name" is null or trim("quickbooks_connection"."income_account_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_fee_account_id_not_blank_check" CHECK("quickbooks_connection"."fee_account_id" is null or trim("quickbooks_connection"."fee_account_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_fee_account_name_not_blank_check" CHECK("quickbooks_connection"."fee_account_name" is null or trim("quickbooks_connection"."fee_account_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_deposit_account_id_not_blank_check" CHECK("quickbooks_connection"."deposit_account_id" is null or trim("quickbooks_connection"."deposit_account_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_deposit_account_name_not_blank_check" CHECK("quickbooks_connection"."deposit_account_name" is null or trim("quickbooks_connection"."deposit_account_name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_connection_income_account_name_needs_id_check" CHECK("quickbooks_connection"."income_account_name" is null or "quickbooks_connection"."income_account_id" is not null),
	CONSTRAINT "quickbooks_connection_fee_account_name_needs_id_check" CHECK("quickbooks_connection"."fee_account_name" is null or "quickbooks_connection"."fee_account_id" is not null),
	CONSTRAINT "quickbooks_connection_deposit_account_name_needs_id_check" CHECK("quickbooks_connection"."deposit_account_name" is null or "quickbooks_connection"."deposit_account_id" is not null)
) STRICT;
--> statement-breakpoint
CREATE TABLE `quickbooks_sync` (
	`entry_group_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`remote_id` text,
	`last_error` text,
	`notified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`entry_group_id`) REFERENCES `entry_group`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quickbooks_sync_status_check" CHECK("quickbooks_sync"."status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "quickbooks_sync_attempts_check" CHECK("quickbooks_sync"."attempts" >= 0),
	CONSTRAINT "quickbooks_sync_remote_id_not_blank_check" CHECK("quickbooks_sync"."remote_id" is null or trim("quickbooks_sync"."remote_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "quickbooks_sync_last_error_not_blank_check" CHECK("quickbooks_sync"."last_error" is null or trim("quickbooks_sync"."last_error", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
CREATE INDEX `quickbooks_sync_status_idx` ON `quickbooks_sync` (`status`);