-- Zapier's key becomes a row of `api_key`, kind `zapier`, admitted by the same hash, and the
-- plaintext `zapier_key` stored is dropped. `src/lib/server/db/schema.ts` argues the columns.
--
-- a `zapier` key keeps the shape Zapier's app presents, `bgz_` and base64url, so `prefix` and
-- `last_four` are checked per kind. changing a CHECK is not one of sqlite's native ALTERs, so
-- `api_key` is the create-copy-drop-rename rebuild `src/lib/server/db/schema.ts`'s rule 2
-- describes, with the hand-edits CONTRIBUTING.md -> Migrations lists: `defer_foreign_keys` in place
-- of drizzle's inert `foreign_keys` pair, `STRICT` on `__new_api_key`, and every `CHECK` unqualified.
-- no table references `api_key`, so the drop leaves no child row to resolve.
--
-- the copy runs after the rebuild, whose checks are the first to take a `bgz_` prefix. only a row
-- holding its key is copied, since a row without one has nothing to cut a prefix or tail from; the
-- hash is carried unchanged, so every Zap connected before this file still presents a key that
-- admits it. the row's id is a uuidv7 of when the key was made, as the app would have minted it.
-- then `zapier_key.key` is nulled, and no column holds the plaintext after this file.
PRAGMA defer_foreign_keys=true;--> statement-breakpoint
CREATE TABLE `__new_api_key` (
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
	CONSTRAINT "api_key_name_not_blank_check" CHECK(trim("name", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "api_key_kind_check" CHECK("kind" in ('api', 'zapier')),
	CONSTRAINT "api_key_key_hash_check" CHECK(length("key_hash") = 64 and "key_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "api_key_prefix_check" CHECK(length("prefix") = 8 and (
				("kind" = 'api' and "prefix" glob 'bgk_*' and substr("prefix", 5) not glob '*[^0-9A-Za-z]*')
				or ("kind" = 'zapier' and "prefix" glob 'bgz_*' and substr("prefix", 5) not glob '*[^A-Za-z0-9_-]*')
			)),
	CONSTRAINT "api_key_last_four_check" CHECK(length("last_four") = 4 and (
				("kind" = 'api' and "last_four" not glob '*[^0-9A-Za-z]*')
				or ("kind" = 'zapier' and "last_four" not glob '*[^A-Za-z0-9_-]*')
			)),
	CONSTRAINT "api_key_archived_revoked_check" CHECK("archived_at" is null or "revoked_at" is not null)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_api_key`("id", "name", "kind", "key_hash", "prefix", "last_four", "created_at", "last_used_at", "revoked_at", "archived_at") SELECT "id", "name", "kind", "key_hash", "prefix", "last_four", "created_at", "last_used_at", "revoked_at", "archived_at" FROM `api_key`;--> statement-breakpoint
DROP TABLE `api_key`;--> statement-breakpoint
ALTER TABLE `__new_api_key` RENAME TO `api_key`;--> statement-breakpoint
PRAGMA defer_foreign_keys=false;--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_key_hash_idx` ON `api_key` (`key_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_one_zapier_idx` ON `api_key` (`kind`) WHERE "api_key"."kind" = 'zapier' and "api_key"."revoked_at" is null;--> statement-breakpoint
INSERT INTO `api_key` (`id`, `name`, `kind`, `key_hash`, `prefix`, `last_four`, `created_at`)
SELECT
	substr(`t`, 1, 8) || '-' || substr(`t`, 9, 4) || '-7' || substr(`r`, 1, 3) || '-'
		|| substr('89ab', 1 + abs(random() % 4), 1) || substr(`r`, 4, 3) || '-' || substr(`r`, 7, 12),
	'Zapier', 'zapier', `key_hash`, substr(`key`, 1, 8), substr(`key`, -4), `created_at`
FROM (
	SELECT `key`, `key_hash`, `created_at`, printf('%012x', `created_at`) AS `t`,
		lower(hex(randomblob(9))) AS `r`
	FROM `zapier_key`
	WHERE `key` IS NOT NULL
);
--> statement-breakpoint
UPDATE `zapier_key`
SET `key` = NULL, `updated_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE `key` IS NOT NULL;
