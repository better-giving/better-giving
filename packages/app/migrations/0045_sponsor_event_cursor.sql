-- the one cursor a hosted site's hourly pull keeps into its fiscal sponsor's event feed: the sequence
-- number it has applied through. `sponsor_event_cursor_id_check` keeps it to one row, and no row is
-- seeded: a reader takes an absent row as 0, where the feed starts. `src/lib/server/db/schema.ts`
-- states the rule beside `sponsorEventCursor`.
--
-- `STRICT` is hand-written onto the table.
CREATE TABLE `sponsor_event_cursor` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "sponsor_event_cursor_id_check" CHECK("sponsor_event_cursor"."id" = 'sponsor'),
	CONSTRAINT "sponsor_event_cursor_seq_check" CHECK("sponsor_event_cursor"."seq" >= 0)
) STRICT;
