-- supporter fundraisers: `supporter`, a member of the public raising money on a `supporter_page` of
-- their own that owns its `form` row as a campaign `page` does; `supporter_link`, the single-use
-- confirm and sign-in links mailed to them, and `supporter_session`, each stored as a hash;
-- `donation.supporter_page_id`, the fundraiser a gift was given through; and
-- `org_profile.supporter_fundraisers_enabled`. `src/lib/server/db/schema.ts` argues each.
--
-- four new tables, born `STRICT`. no table is rebuilt: `donation` and `org_profile` each take a
-- native `ADD COLUMN` appended after their last column. `donation.supporter_page_id` is nullable
-- with no default, so every gift already recorded reads as given through no fundraiser, and its
-- index is built over those nulls. `supporter_fundraisers_enabled` carries its check on the column
-- and defaults to 1, so a profile already saved reads the setting on.
CREATE TABLE `supporter` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_sign_in_at` integer,
	CONSTRAINT "supporter_email_lowercase_check" CHECK("supporter"."email" = lower("supporter"."email")),
	CONSTRAINT "supporter_email_not_blank_check" CHECK(trim("supporter"."email", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "supporter_name_not_blank_check" CHECK(trim("supporter"."name", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `supporter_email_idx` ON `supporter` (`email`);--> statement-breakpoint
CREATE TABLE `supporter_link` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`supporter_id` text NOT NULL,
	`purpose` text NOT NULL,
	`supporter_page_id` text,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`supporter_id`) REFERENCES `supporter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supporter_page_id`) REFERENCES `supporter_page`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supporter_link_token_hash_check" CHECK(length("supporter_link"."token_hash") = 64 and "supporter_link"."token_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "supporter_link_purpose_check" CHECK("supporter_link"."purpose" in ('confirm', 'sign_in')),
	CONSTRAINT "supporter_link_page_check" CHECK(("supporter_link"."purpose" = 'confirm') = ("supporter_link"."supporter_page_id" is not null))
) STRICT;
--> statement-breakpoint
CREATE TABLE `supporter_page` (
	`id` text PRIMARY KEY NOT NULL,
	`supporter_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`story` text NOT NULL,
	`goal_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`photo_id` text,
	`form_id` text NOT NULL,
	`status` text NOT NULL,
	`published_at` integer,
	`ended_at` integer,
	`hidden_at` integer,
	`hidden_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`supporter_id`) REFERENCES `supporter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`photo_id`) REFERENCES `image`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`form_id`) REFERENCES `form`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supporter_page_status_check" CHECK("supporter_page"."status" in ('pending', 'live', 'ended')),
	CONSTRAINT "supporter_page_title_not_blank_check" CHECK(trim("supporter_page"."title", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "supporter_page_story_not_blank_check" CHECK(trim("supporter_page"."story", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "supporter_page_goal_minor_positive_check" CHECK("supporter_page"."goal_minor" > 0),
	CONSTRAINT "supporter_page_currency_check" CHECK(length("supporter_page"."currency") = 3 and "supporter_page"."currency" = upper("supporter_page"."currency") and "supporter_page"."currency" glob '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "supporter_page_published_check" CHECK(("supporter_page"."status" <> 'pending' or "supporter_page"."published_at" is null) and ("supporter_page"."status" <> 'live' or "supporter_page"."published_at" is not null)),
	CONSTRAINT "supporter_page_ended_check" CHECK(("supporter_page"."status" = 'ended') = ("supporter_page"."ended_at" is not null)),
	CONSTRAINT "supporter_page_hidden_note_not_blank_check" CHECK("supporter_page"."hidden_note" is null or trim("supporter_page"."hidden_note", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "supporter_page_hidden_note_hidden_check" CHECK("supporter_page"."hidden_note" is null or "supporter_page"."hidden_at" is not null)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `supporter_page_slug_idx` ON `supporter_page` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `supporter_page_form_id_idx` ON `supporter_page` (`form_id`);--> statement-breakpoint
CREATE INDEX `supporter_page_supporter_created_idx` ON `supporter_page` (`supporter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `supporter_page_created_idx` ON `supporter_page` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `supporter_page_photo_id_idx` ON `supporter_page` (`photo_id`);--> statement-breakpoint
CREATE TABLE `supporter_session` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`supporter_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`supporter_id`) REFERENCES `supporter`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supporter_session_token_hash_check" CHECK(length("supporter_session"."token_hash") = 64 and "supporter_session"."token_hash" not glob '*[^0-9a-f]*')
) STRICT;
--> statement-breakpoint
ALTER TABLE `donation` ADD `supporter_page_id` text REFERENCES supporter_page(id);--> statement-breakpoint
CREATE INDEX `donation_supporter_page_id_idx` ON `donation` (`supporter_page_id`);--> statement-breakpoint
ALTER TABLE `org_profile` ADD `supporter_fundraisers_enabled` integer DEFAULT true NOT NULL CONSTRAINT "org_profile_supporter_fundraisers_enabled_bool_check" CHECK("supporter_fundraisers_enabled" in (0, 1));