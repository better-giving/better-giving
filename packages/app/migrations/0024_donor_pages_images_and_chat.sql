-- the pages this deployment serves on its own address, what they say about the organisation, the
-- chat each is made in, and the photos they show. five new tables and one added column:
-- `org_presentation`, the one row of the organisation's story, look, sharing and logo, each beside
-- the version it replaced; `page`, the donation page or a campaign, owning one `form` row as its
-- donation settings and holding its draft, published and last published documents, and a
-- campaign its kind; `chat_turn`, each page's chat in order, with a note on an assistant turn the
-- reply went wrong on or the fixed opening questions stood in for, the questions an assistant turn
-- asked and the answers an operator turn gave; `image`, what is known about one image; and
-- `image_bytes`, its bytes, in a table of their own so that no rebuild of another table copies
-- them. `program.image_id` is a cause's photo.
-- `src/lib/server/db/schema.ts` argues each column beside it, `src/lib/page/keys.ts` names the
-- document keys its checks read, and `src/lib/server/images/bytes.ts` is the one module that reads
-- or writes the bytes.
--
-- no table is rebuilt: the five are plain creates, and `program.image_id` is sqlite's native
-- `ADD COLUMN`, appended after the table's last column. an added column carrying `REFERENCES` must
-- default to null while foreign keys are on, and this one is nullable with no default. `STRICT` is
-- hand-written onto each `CREATE TABLE`, since drizzle's snapshot cannot record it.
--
-- every key here is `NO ACTION`, like every other domain key in this schema: `page.form_id`,
-- `chat_turn.page_id`, `image_bytes.image_id`, both logo columns and `program.image_id`.
-- `page.form_id` and `chat_turn.page_id` are each found by a unique index that leads with it.
-- `chat_turn` is created ahead of `page`, which sqlite allows: a foreign key's parent is resolved
-- when a row is written, not when the table is. that a logo or a cause's photo is a `photo` and
-- never an `illustration` is not enforced here: a check reads only its own row, and the kind is on
-- the image's.
--
-- one donation page is `page_one_donation_page_idx`, a unique index over `type` for that type
-- alone; a campaign's slug is unique among the slugs held, by `page_slug_idx`. a campaign's kind is
-- one of `src/lib/page/campaign-types.ts`'s, or null, and the donation page has none. `questions`
-- and `answers` are each a JSON array where set, `questions` only on an assistant turn and never
-- empty, `answers` only on an operator's; what a question and an answer hold is the app's parse.
-- `image_bytes_length_check` stops a blob at 1,900,000 bytes, under D1's 2,000,000-byte ceiling on
-- a row by enough for the id and the record header beside it.
--
-- nothing is seeded: the donation page is made by the app on first need, and an organisation that
-- has saved nothing reads as the defaults. nothing is backfilled: no page, turn or image existed
-- before this file, and every existing cause reads null, no photo.
CREATE TABLE `chat_turn` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`seq` integer NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`model` text,
	`image_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`note` text,
	`questions` text,
	`answers` text,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_turn_author_check" CHECK("chat_turn"."author" in ('operator', 'assistant')),
	CONSTRAINT "chat_turn_note_check" CHECK("chat_turn"."note" is null or ("chat_turn"."author" = 'assistant' and "chat_turn"."note" in ('refused', 'fell-back', 'unanswered', 'starter'))),
	CONSTRAINT "chat_turn_model_check" CHECK(("chat_turn"."model" is not null) = ("chat_turn"."author" = 'assistant') and ("chat_turn"."model" is null or trim("chat_turn"."model", char(32, 9, 10, 11, 12, 13, 160)) <> '')),
	CONSTRAINT "chat_turn_image_ids_array_check" CHECK(json_valid("chat_turn"."image_ids") and json_type("chat_turn"."image_ids") = 'array'),
	CONSTRAINT "chat_turn_text_check" CHECK(trim("chat_turn"."text", char(32, 9, 10, 11, 12, 13, 160)) <> '' or json_array_length("chat_turn"."image_ids") > 0),
	CONSTRAINT "chat_turn_questions_check" CHECK("chat_turn"."questions" is null or ("chat_turn"."author" = 'assistant' and json_valid("chat_turn"."questions") and json_type("chat_turn"."questions") = 'array' and json_array_length("chat_turn"."questions") > 0)),
	CONSTRAINT "chat_turn_answers_check" CHECK("chat_turn"."answers" is null or ("chat_turn"."author" = 'operator' and json_valid("chat_turn"."answers") and json_type("chat_turn"."answers") = 'array'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_turn_page_seq_idx` ON `chat_turn` (`page_id`,`seq`);--> statement-breakpoint
CREATE TABLE `image` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`alt` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "image_kind_check" CHECK("image"."kind" in ('photo', 'illustration')),
	CONSTRAINT "image_content_type_check" CHECK("image"."content_type" in ('image/webp', 'image/jpeg', 'image/png')),
	CONSTRAINT "image_size_check" CHECK("image"."width" > 0 and "image"."height" > 0 and "image"."byte_size" > 0),
	CONSTRAINT "image_alt_check" CHECK("image"."alt" is null or trim("image"."alt", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
CREATE TABLE `image_bytes` (
	`image_id` text PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `image`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "image_bytes_length_check" CHECK(length("image_bytes"."bytes") between 1 and 1900000)
) STRICT;
--> statement-breakpoint
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
	`logo_image_id` text,
	`logo_image_id_previous` text,
	FOREIGN KEY (`logo_image_id`) REFERENCES `image`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`logo_image_id_previous`) REFERENCES `image`(`id`) ON UPDATE no action ON DELETE no action,
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`campaign_type` text,
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
	CONSTRAINT "page_draft_look_check" CHECK(json_extract("page"."draft", '$.look') is null or (json_type("page"."draft", '$.look') = 'object' and (json_extract("page"."draft", '$.look.shade') is null or json_extract("page"."draft", '$.look.shade') in ('light', 'warm', 'cool')) and (json_extract("page"."draft", '$.look.corner') is null or json_extract("page"."draft", '$.look.corner') in ('square', 'soft', 'round')) and (json_extract("page"."draft", '$.look.brandColour') is null or json_extract("page"."draft", '$.look.brandColour') glob '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'))),
	CONSTRAINT "page_published_look_check" CHECK(json_extract("page"."published", '$.look') is null or (json_type("page"."published", '$.look') = 'object' and (json_extract("page"."published", '$.look.shade') is null or json_extract("page"."published", '$.look.shade') in ('light', 'warm', 'cool')) and (json_extract("page"."published", '$.look.corner') is null or json_extract("page"."published", '$.look.corner') in ('square', 'soft', 'round')) and (json_extract("page"."published", '$.look.brandColour') is null or json_extract("page"."published", '$.look.brandColour') glob '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'))),
	CONSTRAINT "page_last_published_look_check" CHECK(json_extract("page"."last_published", '$.look') is null or (json_type("page"."last_published", '$.look') = 'object' and (json_extract("page"."last_published", '$.look.shade') is null or json_extract("page"."last_published", '$.look.shade') in ('light', 'warm', 'cool')) and (json_extract("page"."last_published", '$.look.corner') is null or json_extract("page"."last_published", '$.look.corner') in ('square', 'soft', 'round')) and (json_extract("page"."last_published", '$.look.brandColour') is null or json_extract("page"."last_published", '$.look.brandColour') glob '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'))),
	CONSTRAINT "page_campaign_only_settings_check" CHECK("page"."type" <> 'donation_page' or (json_extract("page"."draft", '$.goalMinor') is null and json_extract("page"."draft", '$.endsAt') is null and json_extract("page"."published", '$.goalMinor') is null and json_extract("page"."published", '$.endsAt') is null and json_extract("page"."last_published", '$.goalMinor') is null and json_extract("page"."last_published", '$.endsAt') is null)),
	CONSTRAINT "page_campaign_type_check" CHECK("page"."campaign_type" is null or ("page"."type" = 'campaign' and "page"."campaign_type" in ('year_end', 'emergency', 'building', 'event', 'tribute', 'monthly', 'program', 'other')))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `page_form_id_idx` ON `page` (`form_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_slug_idx` ON `page` (`slug`) WHERE "page"."slug" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `page_one_donation_page_idx` ON `page` (`type`) WHERE "page"."type" = 'donation_page';--> statement-breakpoint
ALTER TABLE `program` ADD `image_id` text REFERENCES image(id);