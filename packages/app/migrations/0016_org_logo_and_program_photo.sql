-- the organisation's logo, with its undo, on `org_presentation`, and a cause's photo on `program`.
-- `src/lib/server/db/schema.ts` argues each column beside it.
--
-- no table is rebuilt: all three are sqlite's native `ADD COLUMN`, appended after each table's last
-- column. an added column carrying `REFERENCES` must default to null while foreign keys are on,
-- and each of these is nullable with no default. existing rows read null — no logo, no photo — and
-- nothing is backfilled.
--
-- each key is `NO ACTION`, like every other domain key in this schema. that the image is a `photo`
-- and never an `illustration` is not enforced here: a check reads only its own row, and the kind
-- is on the image's.
ALTER TABLE `org_presentation` ADD `logo_image_id` text REFERENCES image(id);--> statement-breakpoint
ALTER TABLE `org_presentation` ADD `logo_image_id_previous` text REFERENCES image(id);--> statement-breakpoint
ALTER TABLE `program` ADD `image_id` text REFERENCES image(id);