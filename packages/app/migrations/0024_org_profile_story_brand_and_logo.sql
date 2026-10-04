-- the organisation's mission, vision, brand colour, social links and logo, stated from the console
-- beside its legal identity. `org_profile` gains `mission` and `vision`, plain text, null for none
-- and never blank; `brand_colour`, a lowercase `#rrggbb` or null; `social_links`, a JSON array, `[]`
-- for none; and `logo_image_id`, an `image`, null for none. `src/lib/server/db/schema.ts` argues
-- each column beside it.
--
-- no table is rebuilt: five native `ADD COLUMN`s, each with its check on the column, which sqlite
-- tests against the row already there, and that row holds null or `[]`. the checks are
-- unqualified, so they survive a later rename of the table.
--
-- `social_links` is `NOT NULL` with a constant default, which `ADD COLUMN` takes. `logo_image_id`
-- carries `REFERENCES`, which `ADD COLUMN` takes while foreign keys are on only where the column
-- defaults to null, and it has no default. its key is `NO ACTION`, like every other domain key in
-- this schema; that the image is a `photo` is not enforced here, since a check reads only its own
-- row and the kind is on the image's.
--
-- no backfill: nothing held any of the five before.
ALTER TABLE `org_profile` ADD `mission` text CONSTRAINT "org_profile_mission_not_blank_check" CHECK("mission" is null or trim("mission", char(32, 9, 10, 11, 12, 13, 160)) <> '');--> statement-breakpoint
ALTER TABLE `org_profile` ADD `vision` text CONSTRAINT "org_profile_vision_not_blank_check" CHECK("vision" is null or trim("vision", char(32, 9, 10, 11, 12, 13, 160)) <> '');--> statement-breakpoint
ALTER TABLE `org_profile` ADD `brand_colour` text CONSTRAINT "org_profile_brand_colour_check" CHECK("brand_colour" is null or "brand_colour" glob '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');--> statement-breakpoint
ALTER TABLE `org_profile` ADD `social_links` text DEFAULT '[]' NOT NULL CONSTRAINT "org_profile_social_links_array_check" CHECK(json_valid("social_links") and json_type("social_links") = 'array');--> statement-breakpoint
ALTER TABLE `org_profile` ADD `logo_image_id` text REFERENCES image(id);
