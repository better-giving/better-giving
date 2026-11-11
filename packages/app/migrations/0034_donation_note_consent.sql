-- a gift's note on the donate page. `donation` gains `note_public` and `note_anonymous`, what the
-- donor asked for, both 0 unless they ticked the box; and `note_hidden_at`, unix milliseconds when
-- staff hid the note, null while it is shown. `src/lib/server/db/schema.ts` argues each column
-- beside it.
--
-- no table is rebuilt: three native `ADD COLUMN`s, each with its checks on the column, which sqlite
-- tests against every gift already there. `donation` has children (`line_item`, `payment`), so the
-- rebuild drizzle-kit drafts for a check would `DROP TABLE donation` under them. the checks are
-- unqualified, so they survive a later rename of the table, and `note_public` comes first because
-- the two after it read it.
--
-- no backfill: every gift recorded before the form asked reads `note_public` 0, so its note stays
-- private, with `note_anonymous` 0 and `note_hidden_at` null, which every check here admits. the
-- index is partial over shown notes, so it starts empty.
ALTER TABLE `donation` ADD `note_public` integer DEFAULT false NOT NULL CONSTRAINT "donation_note_public_bool_check" CHECK("note_public" in (0, 1));--> statement-breakpoint
ALTER TABLE `donation` ADD `note_anonymous` integer DEFAULT false NOT NULL CONSTRAINT "donation_note_anonymous_bool_check" CHECK("note_anonymous" in (0, 1)) CONSTRAINT "donation_note_anonymous_public_check" CHECK("note_anonymous" = 0 or "note_public" = 1);--> statement-breakpoint
ALTER TABLE `donation` ADD `note_hidden_at` integer CONSTRAINT "donation_note_hidden_public_check" CHECK("note_hidden_at" is null or "note_public" = 1);--> statement-breakpoint
CREATE INDEX `donation_note_shown_received_at_idx` ON `donation` (`received_at`,`id`) WHERE "donation"."note_public" = 1 and "donation"."note_hidden_at" is null;
