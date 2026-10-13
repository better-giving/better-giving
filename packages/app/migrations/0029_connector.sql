-- the connector's three tables: `connector_key`, each connection's key stored as its hash;
-- `connector_code`, the single-use code the Allow screen issues and `/connector/v1/exchange`
-- redeems; and `photo_link`, the single-use link a chat hands back to add one photo to one page.
-- `src/lib/server/db/schema.ts` argues each. new tables only, so no data step.
CREATE TABLE `connector_code` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`allowed_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	CONSTRAINT "connector_code_code_hash_check" CHECK(length("connector_code"."code_hash") = 64 and "connector_code"."code_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "connector_code_allowed_by_not_blank_check" CHECK(trim("connector_code"."allowed_by", char(32, 9, 10, 11, 12, 13, 160)) <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_code_code_hash_idx` ON `connector_code` (`code_hash`);--> statement-breakpoint
CREATE TABLE `connector_key` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`last_four` text NOT NULL,
	`allowed_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`revoked_by` text,
	CONSTRAINT "connector_key_key_hash_check" CHECK(length("connector_key"."key_hash") = 64 and "connector_key"."key_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "connector_key_prefix_check" CHECK("connector_key"."prefix" glob 'bgc_*' and length("connector_key"."prefix") = 8),
	CONSTRAINT "connector_key_last_four_check" CHECK(length("connector_key"."last_four") = 4),
	CONSTRAINT "connector_key_allowed_by_not_blank_check" CHECK(trim("connector_key"."allowed_by", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "connector_key_revoked_by_check" CHECK(("connector_key"."revoked_at" is null and "connector_key"."revoked_by" is null) or ("connector_key"."revoked_at" is not null and "connector_key"."revoked_by" in ('dashboard', 'connector')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_key_key_hash_idx` ON `connector_key` (`key_hash`);--> statement-breakpoint
CREATE TABLE `photo_link` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`page_id` text NOT NULL,
	`block_id` text,
	`connector_key_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_key_id`) REFERENCES `connector_key`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "photo_link_token_hash_check" CHECK(length("photo_link"."token_hash") = 64 and "photo_link"."token_hash" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_link_token_hash_idx` ON `photo_link` (`token_hash`);