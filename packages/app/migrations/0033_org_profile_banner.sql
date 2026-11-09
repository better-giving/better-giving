-- the donate page's banner: `org_profile.banner_image_id`, an `image` like `logo_image_id` beside it,
-- null for none. `src/lib/server/db/schema.ts` argues the column, and the banner writes in
-- `src/lib/server/org/queries.ts` free a banner they replace.
--
-- no table is rebuilt: this is sqlite's native `ADD COLUMN`, appended after the table's last
-- column. an added column carrying `REFERENCES` must default to null while foreign keys are on, and
-- this one is nullable with no default, so every profile already saved reads as having no banner.
ALTER TABLE `org_profile` ADD `banner_image_id` text REFERENCES image(id);
