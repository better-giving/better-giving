-- the pages this deployment serves on its own address, and what they say about the organisation.
-- three new tables and nothing else: `org_presentation`, the one row of the organisation's story,
-- look and sharing, each beside the version it replaced; `page`, the Donation page or a campaign,
-- owning one `form` row as its donation settings and holding its draft, published and last
-- published documents; and `chat_turn`, each page's chat in order. `src/lib/server/db/schema.ts`
-- argues each column beside it.
--
-- no table is rebuilt. all three are plain creates, so none of the rebuild hand-edits apply: no
-- deferral, no unqualified CHECK, no backtick strip, no index moved ahead of a drop. `STRICT` is
-- hand-written onto each `CREATE TABLE`, since drizzle's snapshot cannot record it.
--
-- `page.form_id` and `chat_turn.page_id` are `NO ACTION`, like every other domain key in this
-- schema; each is found by a unique index that leads with it. `chat_turn` is created ahead of
-- `page`, which sqlite allows: a foreign key's parent is resolved when a row is written, not when
-- the table is.
--
-- one Donation page is `page_one_donation_page_idx`, a unique index over `type` for that type
-- alone; a campaign's slug is unique among the slugs held, by `page_slug_idx`.
--
-- no row is seeded in any of the three: the Donation page is made by the app on first need, and an
-- organisation that has saved nothing reads as the defaults. no backfill: nothing existed to copy.
CREATE TABLE `chat_turn` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`seq` integer NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`model` text,
	`image_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_turn_author_check" CHECK("chat_turn"."author" in ('operator', 'assistant')),
	CONSTRAINT "chat_turn_model_check" CHECK(("chat_turn"."model" is not null) = ("chat_turn"."author" = 'assistant') and ("chat_turn"."model" is null or trim("chat_turn"."model", char(32, 9, 10, 11, 12, 13, 160)) <> '')),
	CONSTRAINT "chat_turn_image_ids_array_check" CHECK(json_valid("chat_turn"."image_ids") and json_type("chat_turn"."image_ids") = 'array'),
	CONSTRAINT "chat_turn_text_check" CHECK(trim("chat_turn"."text", char(32, 9, 10, 11, 12, 13, 160)) <> '' or json_array_length("chat_turn"."image_ids") > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_turn_page_seq_idx` ON `chat_turn` (`page_id`,`seq`);--> statement-breakpoint
CREATE TABLE `org_presentation` (
	`id` text PRIMARY KEY NOT NULL,
	`story` text DEFAULT '{}' NOT NULL,
	`look` text DEFAULT '{}' NOT NULL,
	`sharing` text DEFAULT '{}' NOT NULL,
	`story_previous` text,
	`look_previous` text,
	`sharing_previous` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "org_presentation_id_check" CHECK("org_presentation"."id" = 'default'),
	CONSTRAINT "org_presentation_story_object_check" CHECK(json_valid("org_presentation"."story") and json_type("org_presentation"."story") = 'object'),
	CONSTRAINT "org_presentation_look_check" CHECK(json_valid("org_presentation"."look") and json_type("org_presentation"."look") = 'object' and (json_extract("org_presentation"."look", '$.shade') is null or json_extract("org_presentation"."look", '$.shade') in ('light', 'warm', 'cool')) and (json_extract("org_presentation"."look", '$.corner') is null or json_extract("org_presentation"."look", '$.corner') in ('square', 'soft', 'round')) and (json_extract("org_presentation"."look", '$.brandColour') is null or json_extract("org_presentation"."look", '$.brandColour') glob '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')),
	CONSTRAINT "org_presentation_sharing_object_check" CHECK(json_valid("org_presentation"."sharing") and json_type("org_presentation"."sharing") = 'object'),
	CONSTRAINT "org_presentation_story_previous_object_check" CHECK("org_presentation"."story_previous" is null or (json_valid("org_presentation"."story_previous") and json_type("org_presentation"."story_previous") = 'object')),
	CONSTRAINT "org_presentation_look_previous_check" CHECK("org_presentation"."look_previous" is null or (json_valid("org_presentation"."look_previous") and json_type("org_presentation"."look_previous") = 'object' and (json_extract("org_presentation"."look_previous", '$.shade') is null or json_extract("org_presentation"."look_previous", '$.shade') in ('light', 'warm', 'cool')) and (json_extract("org_presentation"."look_previous", '$.corner') is null or json_extract("org_presentation"."look_previous", '$.corner') in ('square', 'soft', 'round')) and (json_extract("org_presentation"."look_previous", '$.brandColour') is null or json_extract("org_presentation"."look_previous", '$.brandColour') glob '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'))),
	CONSTRAINT "org_presentation_sharing_previous_object_check" CHECK("org_presentation"."sharing_previous" is null or (json_valid("org_presentation"."sharing_previous") and json_type("org_presentation"."sharing_previous") = 'object'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `page` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`slug` text,
	`state` text NOT NULL,
	`form_id` text NOT NULL,
	`draft` text NOT NULL,
	`published` text,
	`last_published` text,
	`editor_visited_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`form_id`) REFERENCES `form`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "page_type_check" CHECK("page"."type" in ('donation_page', 'campaign')),
	CONSTRAINT "page_state_check" CHECK("page"."state" in ('never_published', 'live', 'ended')),
	CONSTRAINT "page_donation_page_live_check" CHECK("page"."type" <> 'donation_page' or "page"."state" = 'live'),
	CONSTRAINT "page_name_check" CHECK(("page"."type" <> 'donation_page' or "page"."name" is null) and ("page"."type" <> 'campaign' or ("page"."name" is not null and trim("page"."name", char(32, 9, 10, 11, 12, 13, 160)) <> ''))),
	CONSTRAINT "page_slug_check" CHECK(("page"."type" <> 'donation_page' or "page"."slug" is null) and ("page"."type" <> 'campaign' or "page"."slug" is not null or "page"."state" = 'ended')),
	CONSTRAINT "page_published_check" CHECK(("page"."published" is null) = ("page"."state" = 'never_published')),
	CONSTRAINT "page_last_published_check" CHECK("page"."last_published" is null or "page"."published" is not null),
	CONSTRAINT "page_draft_object_check" CHECK(json_valid("page"."draft") and json_type("page"."draft") = 'object'),
	CONSTRAINT "page_published_object_check" CHECK("page"."published" is null or (json_valid("page"."published") and json_type("page"."published") = 'object')),
	CONSTRAINT "page_last_published_object_check" CHECK("page"."last_published" is null or (json_valid("page"."last_published") and json_type("page"."last_published") = 'object')),
	CONSTRAINT "page_campaign_only_settings_check" CHECK("page"."type" <> 'donation_page' or (json_extract("page"."draft", '$.goalMinor') is null and json_extract("page"."draft", '$.endsAt') is null and json_extract("page"."published", '$.goalMinor') is null and json_extract("page"."published", '$.endsAt') is null and json_extract("page"."last_published", '$.goalMinor') is null and json_extract("page"."last_published", '$.endsAt') is null)),
	CONSTRAINT "page_editor_visited_check" CHECK("page"."editor_visited_at" is null or "page"."type" = 'donation_page')
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `page_form_id_idx` ON `page` (`form_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_slug_idx` ON `page` (`slug`) WHERE "page"."slug" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `page_one_donation_page_idx` ON `page` (`type`) WHERE "page"."type" = 'donation_page';