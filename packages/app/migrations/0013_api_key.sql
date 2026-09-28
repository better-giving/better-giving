-- the keys a system outside this deployment presents to it: one new table, `api_key`, and nothing
-- else. `src/lib/server/db/schema.ts` argues each column beside it.
--
-- no table is rebuilt. a plain create and two indexes on the empty table it makes, so none of the
-- rebuild hand-edits apply: no deferral, no unqualified CHECK, no backtick strip, no index moved
-- ahead of a drop. `STRICT` is hand-written onto the `CREATE TABLE`, since drizzle's snapshot
-- cannot record it.
--
-- the key itself has no column: a row holds its SHA-256, its first 8 characters and its last 4.
-- `api_key_one_zapier_idx` is unique over un-revoked `zapier` rows only, so revoked ones are kept.
--
-- no backfill: `zapier_key` is left as it is, and no key exists until one is minted.
CREATE TABLE `api_key` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`last_four` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`archived_at` integer,
	CONSTRAINT "api_key_name_not_blank_check" CHECK(trim("api_key"."name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "api_key_kind_check" CHECK("api_key"."kind" in ('api', 'zapier')),
	CONSTRAINT "api_key_key_hash_check" CHECK(length("api_key"."key_hash") = 64 and "api_key"."key_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "api_key_prefix_check" CHECK(length("api_key"."prefix") = 8 and "api_key"."prefix" glob 'bgk_*' and substr("api_key"."prefix", 5) not glob '*[^0-9A-Za-z]*'),
	CONSTRAINT "api_key_last_four_check" CHECK(length("api_key"."last_four") = 4 and "api_key"."last_four" not glob '*[^0-9A-Za-z]*'),
	CONSTRAINT "api_key_archived_revoked_check" CHECK("api_key"."archived_at" is null or "api_key"."revoked_at" is not null)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_key_hash_idx` ON `api_key` (`key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_one_zapier_idx` ON `api_key` (`kind`) WHERE "api_key"."kind" = 'zapier' and "api_key"."revoked_at" is null;