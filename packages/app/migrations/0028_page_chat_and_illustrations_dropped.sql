-- the page chat and the illustration kind go: nothing in the app writes or reads a chat turn, and
-- nothing makes an illustration. `chat_turn` is dropped, every image only a chat turn named is
-- freed, and every image left is a `photo`, which `image_kind_check` now holds it to.
-- `src/lib/server/db/schema.ts` argues the table as it stands.
--
-- freeing is `src/lib/server/images/free.ts`'s rule, run once over every image a turn attached:
-- the bytes and then the metadata row of each one no cause's photo, no logo and no page document
-- names, a document matched on its text so an id anywhere in one keeps the image. an image a turn
-- attached and a page, a cause or the logo also draws stays, and an image no turn attached is not
-- this file's to free, named or not. both deletes read `chat_turn`, so they come before its drop;
-- the drop takes `chat_turn_page_seq_idx` with it, and `chat_turn` is a child only, so no row
-- points at what it drops.
--
-- every illustration becomes a photo in place, its `updated_at` kept: the kind is one nothing
-- reads. narrowing a CHECK is not one of sqlite's native ALTERs, so `image` is then the
-- create-copy-drop-rename rebuild `src/lib/server/db/schema.ts`'s rule 2 describes, of a table
-- `image_bytes.image_id`, `program.image_id` and `org_profile.logo_image_id` reference, with the
-- hand-edits CONTRIBUTING.md -> Migrations lists and migrations/0010 argues: `defer_foreign_keys`
-- in place of drizzle's inert `foreign_keys` pair, so each reference resolves to the name the
-- rename hands back; `STRICT` on `__new_image`; every CHECK unqualified. all three keys are
-- `NO ACTION`, so the drop fires no cascade and deletes no child row, and `image` holds metadata
-- only, so the copy moves no bytes. the copy names the nine columns the old table holds, all of
-- them unchanged, and `image` has no index of its own to re-emit.
DELETE FROM `image_bytes`
WHERE `image_id` IN (SELECT `value` FROM `chat_turn`, json_each(`chat_turn`.`image_ids`))
	AND NOT EXISTS (SELECT 1 FROM `program` WHERE `program`.`image_id` = `image_bytes`.`image_id`)
	AND NOT EXISTS (SELECT 1 FROM `org_profile` WHERE `org_profile`.`logo_image_id` = `image_bytes`.`image_id`)
	AND NOT EXISTS (SELECT 1 FROM `page` WHERE instr(`page`.`draft`, `image_bytes`.`image_id`) > 0 OR instr(`page`.`published`, `image_bytes`.`image_id`) > 0 OR instr(`page`.`last_published`, `image_bytes`.`image_id`) > 0);
--> statement-breakpoint
DELETE FROM `image`
WHERE `id` IN (SELECT `value` FROM `chat_turn`, json_each(`chat_turn`.`image_ids`))
	AND NOT EXISTS (SELECT 1 FROM `program` WHERE `program`.`image_id` = `image`.`id`)
	AND NOT EXISTS (SELECT 1 FROM `org_profile` WHERE `org_profile`.`logo_image_id` = `image`.`id`)
	AND NOT EXISTS (SELECT 1 FROM `page` WHERE instr(`page`.`draft`, `image`.`id`) > 0 OR instr(`page`.`published`, `image`.`id`) > 0 OR instr(`page`.`last_published`, `image`.`id`) > 0);
--> statement-breakpoint
DROP TABLE `chat_turn`;--> statement-breakpoint
UPDATE `image` SET `kind` = 'photo' WHERE `kind` = 'illustration';--> statement-breakpoint
PRAGMA defer_foreign_keys=true;--> statement-breakpoint
CREATE TABLE `__new_image` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`alt` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "image_kind_check" CHECK("kind" in ('photo')),
	CONSTRAINT "image_content_type_check" CHECK("content_type" in ('image/webp', 'image/jpeg', 'image/png')),
	CONSTRAINT "image_size_check" CHECK("width" > 0 and "height" > 0 and "byte_size" > 0),
	CONSTRAINT "image_alt_check" CHECK("alt" is null or trim("alt", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_image`("id", "kind", "content_type", "width", "height", "byte_size", "alt", "created_at", "updated_at") SELECT "id", "kind", "content_type", "width", "height", "byte_size", "alt", "created_at", "updated_at" FROM `image`;--> statement-breakpoint
DROP TABLE `image`;--> statement-breakpoint
ALTER TABLE `__new_image` RENAME TO `image`;--> statement-breakpoint
PRAGMA defer_foreign_keys=false;