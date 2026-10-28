-- a campaign can be unpublished: `page_state_check` admits `unpublished` beside `never_published`,
-- `live` and `ended` (`PAGE_STATES` in `src/lib/page/keys.ts`). an unpublished campaign keeps its
-- published page, which `page_published_check` already requires of every state but
-- `never_published`, and its slug, which `page_slug_check` already requires of every campaign
-- state but `ended`; `page_donation_page_live_check` already refuses it on the Donation page. no
-- row changes state here.
--
-- widening a table's CHECK is not one of sqlite's native ALTERs, so `page` is the
-- create-copy-drop-rename rebuild `src/lib/server/db/schema.ts`'s rule 2 describes, with the
-- hand-edits CONTRIBUTING.md -> Migrations lists: `defer_foreign_keys` in place of drizzle's inert
-- `foreign_keys` pair, since a table further down references `page`; `STRICT` on `__new_page`;
-- every CHECK unqualified. the copy names the twelve columns the table holds, unchanged, and the
-- three indexes are made again on the renamed table.
PRAGMA defer_foreign_keys=true;--> statement-breakpoint
CREATE TABLE `__new_page` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`slug` text,
	`state` text NOT NULL,
	`form_id` text NOT NULL,
	`draft` text NOT NULL,
	`published` text,
	`last_published` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`campaign_type` text,
	FOREIGN KEY (`form_id`) REFERENCES `form`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "page_type_check" CHECK("type" in ('donation_page', 'campaign')),
	CONSTRAINT "page_state_check" CHECK("state" in ('never_published', 'live', 'unpublished', 'ended')),
	CONSTRAINT "page_donation_page_live_check" CHECK("type" <> 'donation_page' or "state" = 'live'),
	CONSTRAINT "page_name_check" CHECK(("type" <> 'donation_page' or "name" is null) and ("type" <> 'campaign' or ("name" is not null and trim("name", char(32, 9, 10, 11, 12, 13, 160)) <> ''))),
	CONSTRAINT "page_slug_check" CHECK(("type" <> 'donation_page' or "slug" is null) and ("type" <> 'campaign' or "slug" is not null or "state" = 'ended')),
	CONSTRAINT "page_published_check" CHECK(("published" is null) = ("state" = 'never_published')),
	CONSTRAINT "page_last_published_check" CHECK("last_published" is null or "published" is not null),
	CONSTRAINT "page_draft_object_check" CHECK(json_valid("draft") and json_type("draft") = 'object'),
	CONSTRAINT "page_published_object_check" CHECK("published" is null or (json_valid("published") and json_type("published") = 'object')),
	CONSTRAINT "page_last_published_object_check" CHECK("last_published" is null or (json_valid("last_published") and json_type("last_published") = 'object')),
	CONSTRAINT "page_campaign_only_settings_check" CHECK("type" <> 'donation_page' or (json_extract("draft", '$.goalMinor') is null and json_extract("draft", '$.endsAt') is null and json_extract("published", '$.goalMinor') is null and json_extract("published", '$.endsAt') is null and json_extract("last_published", '$.goalMinor') is null and json_extract("last_published", '$.endsAt') is null)),
	CONSTRAINT "page_campaign_type_check" CHECK("campaign_type" is null or ("type" = 'campaign' and "campaign_type" in ('year_end', 'emergency', 'building', 'event', 'tribute', 'monthly', 'program', 'other')))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_page`("id", "type", "name", "slug", "state", "form_id", "draft", "published", "last_published", "created_at", "updated_at", "campaign_type") SELECT "id", "type", "name", "slug", "state", "form_id", "draft", "published", "last_published", "created_at", "updated_at", "campaign_type" FROM `page`;--> statement-breakpoint
DROP TABLE `page`;--> statement-breakpoint
ALTER TABLE `__new_page` RENAME TO `page`;--> statement-breakpoint
PRAGMA defer_foreign_keys=false;--> statement-breakpoint
CREATE UNIQUE INDEX `page_form_id_idx` ON `page` (`form_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_slug_idx` ON `page` (`slug`) WHERE "page"."slug" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `page_one_donation_page_idx` ON `page` (`type`) WHERE "page"."type" = 'donation_page';