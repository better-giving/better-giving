-- a page document becomes content only: its words, its photos, its tiers and its questions, and
-- nothing that says how they are drawn. the layout, the palette, the look, the share buttons and the
-- block list go, and the page picks a whole layout from what its content holds
-- (`src/lib/page/shape.ts`). `src/lib/page/catalog.ts` is the rule the documents are moved to.
--
-- in `draft`, `published` and `last_published` alike, each document holding a block list is
-- rewritten from it. every page keeps `heading`, from the first title (empty where there is none). a
-- campaign also keeps `lede` from that title; `story` from the first story whose body holds text
-- that is not blank, and none where no story does; `hero` from the first hero holding a photo;
-- `photos` from the image blocks holding one (the first eight); `tiers` from every impact-tiers
-- block's tiers end to end in block order (the first six); and `faq` from every faq block's
-- questions the same way (the first ten). the Donation page keeps its heading, its share message,
-- its switches and its settings, and loses every other block — its lede, story, cover, photos,
-- tiers and questions — in the draft, the live copy and the copy Undo restores alike: the page rule
-- refuses them there, and the Donation page draws one fixed layout. a key with nothing to carry is
-- left out, which `json_patch` does with a null; each object or list is wrapped in `json()` so a
-- CASE around it hands it on as JSON and not as its text. every other key — the share message, the
-- switches, the name, the goal, the end date and the settings — stays as it is, and a null column
-- stays null. a photo no document places any more stays stored; nothing serves it.
--
-- the look checks go with the look: narrowing a table's CHECKs is not one of sqlite's native
-- ALTERs, so `page` is then the create-copy-drop-rename rebuild `src/lib/server/db/schema.ts`'s rule
-- 2 describes, with the hand-edits CONTRIBUTING.md -> Migrations lists: `defer_foreign_keys` in
-- place of drizzle's inert `foreign_keys` pair, since a table further down references `page`;
-- `STRICT` on `__new_page`; every CHECK unqualified. the copy names the twelve columns the old
-- table holds, unchanged, and the three indexes are made again on the renamed table.
-- `updated_at`, the editor's version, stays.
--
-- a connector photo link named the block its photo went into; it names a slot now — `cover`, or the
-- place of a photo beside it, or null for a new one (`parseSlot` in `src/lib/page/content-edit.ts`)
-- — and the column is renamed in place. a link still open from before names a block id, which reads
-- as no slot and adds its photo after the rest; a link lives minutes.
UPDATE `page` SET `draft` = json_patch(
	json_remove(`draft`, '$.layout', '$.palette', '$.look', '$.shareChannels', '$.blocks'),
	json_object(
		'heading', coalesce((SELECT json_extract(`b`.`value`, '$.heading') FROM json_each(`page`.`draft`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'title' ORDER BY `b`.`key` LIMIT 1), ''),
		'lede', CASE WHEN `page`.`type` = 'campaign' THEN (SELECT nullif(json_extract(`b`.`value`, '$.lede'), '') FROM json_each(`page`.`draft`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'title' ORDER BY `b`.`key` LIMIT 1) END,
		'story', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(json_extract(`b`.`value`, '$.body')) FROM json_each(`page`.`draft`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'story' AND EXISTS (SELECT 1 FROM json_tree(`b`.`value`, '$.body') AS `n` WHERE `n`.`key` = 'text' AND `n`.`type` = 'text' AND trim(`n`.`value`, char(32, 9, 10, 11, 12, 13, 160)) <> '') ORDER BY `b`.`key` LIMIT 1) END),
		'hero', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json_object('imageId', json_extract(`b`.`value`, '$.imageId'), 'alt', json_extract(`b`.`value`, '$.alt')) FROM json_each(`page`.`draft`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'hero' AND json_extract(`b`.`value`, '$.imageId') IS NOT NULL ORDER BY `b`.`key` LIMIT 1) END),
		'photos', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(nullif(json_group_array(json(`p`.`photo`)), '[]')) FROM (SELECT json_object('imageId', json_extract(`b`.`value`, '$.imageId'), 'alt', json_extract(`b`.`value`, '$.alt')) AS `photo` FROM json_each(`page`.`draft`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'image' AND json_extract(`b`.`value`, '$.imageId') IS NOT NULL ORDER BY `b`.`key` LIMIT 8) AS `p`) END),
		'tiers', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(nullif(json_group_array(json(`i`.`item`)), '[]')) FROM (SELECT `t`.`value` AS `item` FROM json_each(`page`.`draft`, '$.blocks') AS `b`, json_each(`b`.`value`, '$.tiers') AS `t` WHERE json_extract(`b`.`value`, '$.type') = 'impact-tiers' ORDER BY `b`.`key`, `t`.`key` LIMIT 6) AS `i`) END),
		'faq', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(nullif(json_group_array(json(`i`.`item`)), '[]')) FROM (SELECT `q`.`value` AS `item` FROM json_each(`page`.`draft`, '$.blocks') AS `b`, json_each(`b`.`value`, '$.items') AS `q` WHERE json_extract(`b`.`value`, '$.type') = 'faq' ORDER BY `b`.`key`, `q`.`key` LIMIT 10) AS `i`) END)
	)
)
WHERE `draft` IS NOT NULL AND json_type(`draft`, '$.blocks') = 'array';
--> statement-breakpoint
UPDATE `page` SET `published` = json_patch(
	json_remove(`published`, '$.layout', '$.palette', '$.look', '$.shareChannels', '$.blocks'),
	json_object(
		'heading', coalesce((SELECT json_extract(`b`.`value`, '$.heading') FROM json_each(`page`.`published`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'title' ORDER BY `b`.`key` LIMIT 1), ''),
		'lede', CASE WHEN `page`.`type` = 'campaign' THEN (SELECT nullif(json_extract(`b`.`value`, '$.lede'), '') FROM json_each(`page`.`published`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'title' ORDER BY `b`.`key` LIMIT 1) END,
		'story', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(json_extract(`b`.`value`, '$.body')) FROM json_each(`page`.`published`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'story' AND EXISTS (SELECT 1 FROM json_tree(`b`.`value`, '$.body') AS `n` WHERE `n`.`key` = 'text' AND `n`.`type` = 'text' AND trim(`n`.`value`, char(32, 9, 10, 11, 12, 13, 160)) <> '') ORDER BY `b`.`key` LIMIT 1) END),
		'hero', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json_object('imageId', json_extract(`b`.`value`, '$.imageId'), 'alt', json_extract(`b`.`value`, '$.alt')) FROM json_each(`page`.`published`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'hero' AND json_extract(`b`.`value`, '$.imageId') IS NOT NULL ORDER BY `b`.`key` LIMIT 1) END),
		'photos', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(nullif(json_group_array(json(`p`.`photo`)), '[]')) FROM (SELECT json_object('imageId', json_extract(`b`.`value`, '$.imageId'), 'alt', json_extract(`b`.`value`, '$.alt')) AS `photo` FROM json_each(`page`.`published`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'image' AND json_extract(`b`.`value`, '$.imageId') IS NOT NULL ORDER BY `b`.`key` LIMIT 8) AS `p`) END),
		'tiers', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(nullif(json_group_array(json(`i`.`item`)), '[]')) FROM (SELECT `t`.`value` AS `item` FROM json_each(`page`.`published`, '$.blocks') AS `b`, json_each(`b`.`value`, '$.tiers') AS `t` WHERE json_extract(`b`.`value`, '$.type') = 'impact-tiers' ORDER BY `b`.`key`, `t`.`key` LIMIT 6) AS `i`) END),
		'faq', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(nullif(json_group_array(json(`i`.`item`)), '[]')) FROM (SELECT `q`.`value` AS `item` FROM json_each(`page`.`published`, '$.blocks') AS `b`, json_each(`b`.`value`, '$.items') AS `q` WHERE json_extract(`b`.`value`, '$.type') = 'faq' ORDER BY `b`.`key`, `q`.`key` LIMIT 10) AS `i`) END)
	)
)
WHERE `published` IS NOT NULL AND json_type(`published`, '$.blocks') = 'array';
--> statement-breakpoint
UPDATE `page` SET `last_published` = json_patch(
	json_remove(`last_published`, '$.layout', '$.palette', '$.look', '$.shareChannels', '$.blocks'),
	json_object(
		'heading', coalesce((SELECT json_extract(`b`.`value`, '$.heading') FROM json_each(`page`.`last_published`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'title' ORDER BY `b`.`key` LIMIT 1), ''),
		'lede', CASE WHEN `page`.`type` = 'campaign' THEN (SELECT nullif(json_extract(`b`.`value`, '$.lede'), '') FROM json_each(`page`.`last_published`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'title' ORDER BY `b`.`key` LIMIT 1) END,
		'story', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(json_extract(`b`.`value`, '$.body')) FROM json_each(`page`.`last_published`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'story' AND EXISTS (SELECT 1 FROM json_tree(`b`.`value`, '$.body') AS `n` WHERE `n`.`key` = 'text' AND `n`.`type` = 'text' AND trim(`n`.`value`, char(32, 9, 10, 11, 12, 13, 160)) <> '') ORDER BY `b`.`key` LIMIT 1) END),
		'hero', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json_object('imageId', json_extract(`b`.`value`, '$.imageId'), 'alt', json_extract(`b`.`value`, '$.alt')) FROM json_each(`page`.`last_published`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'hero' AND json_extract(`b`.`value`, '$.imageId') IS NOT NULL ORDER BY `b`.`key` LIMIT 1) END),
		'photos', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(nullif(json_group_array(json(`p`.`photo`)), '[]')) FROM (SELECT json_object('imageId', json_extract(`b`.`value`, '$.imageId'), 'alt', json_extract(`b`.`value`, '$.alt')) AS `photo` FROM json_each(`page`.`last_published`, '$.blocks') AS `b` WHERE json_extract(`b`.`value`, '$.type') = 'image' AND json_extract(`b`.`value`, '$.imageId') IS NOT NULL ORDER BY `b`.`key` LIMIT 8) AS `p`) END),
		'tiers', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(nullif(json_group_array(json(`i`.`item`)), '[]')) FROM (SELECT `t`.`value` AS `item` FROM json_each(`page`.`last_published`, '$.blocks') AS `b`, json_each(`b`.`value`, '$.tiers') AS `t` WHERE json_extract(`b`.`value`, '$.type') = 'impact-tiers' ORDER BY `b`.`key`, `t`.`key` LIMIT 6) AS `i`) END),
		'faq', json(CASE WHEN `page`.`type` = 'campaign' THEN (SELECT json(nullif(json_group_array(json(`i`.`item`)), '[]')) FROM (SELECT `q`.`value` AS `item` FROM json_each(`page`.`last_published`, '$.blocks') AS `b`, json_each(`b`.`value`, '$.items') AS `q` WHERE json_extract(`b`.`value`, '$.type') = 'faq' ORDER BY `b`.`key`, `q`.`key` LIMIT 10) AS `i`) END)
	)
)
WHERE `last_published` IS NOT NULL AND json_type(`last_published`, '$.blocks') = 'array';
--> statement-breakpoint
ALTER TABLE `photo_link` RENAME COLUMN "block_id" TO "slot";--> statement-breakpoint
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
	CONSTRAINT "page_state_check" CHECK("state" in ('never_published', 'live', 'ended')),
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