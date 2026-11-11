-- the messages index on `donation` covers every public note, hidden or not, so the admin screen's
-- reads take it as well as the donate page's. `donation_note_shown_received_at_idx` also required
-- `note_hidden_at is null`, which the admin reads do not say, so each of them scanned `donation`
-- and sorted it. the donate page keeps `note_hidden_at is null` as a filter on the rows the index
-- yields. `src/lib/server/db/schema.ts` argues the index beside it.
--
-- an index only: no table is rebuilt and no row changes. the new index is built from the public
-- notes already recorded.
DROP INDEX `donation_note_shown_received_at_idx`;--> statement-breakpoint
CREATE INDEX `donation_note_public_received_at_idx` ON `donation` (`received_at`,`id`) WHERE "donation"."note_public" = 1;
