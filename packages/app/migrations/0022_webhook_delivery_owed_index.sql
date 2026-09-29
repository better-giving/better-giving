-- adds `webhook_delivery_owed_idx`, one destination's rows in one status, for a pause, a resume,
-- a delete and a deleted destination's standing sweep; `src/lib/server/db/schema.ts` argues it.
--
-- the data step. a destination paused before this file holds its owed rows due when they were
-- queued, and a claim no longer passes over a paused destination's rows, so each would be posted to
-- it. every row still owed to a paused, un-archived destination is parked at `HELD_UNTIL`
-- (src/lib/server/webhooks/events.ts), as a pause parks them (`holdStatement` in
-- src/lib/server/webhooks/deliver.ts), rows a run holds included; a resume lets them out.
-- `updated_at` is untouched: nothing about the row moved.
CREATE INDEX `webhook_delivery_owed_idx` ON `webhook_delivery` (`destination_id`,`status`);--> statement-breakpoint
UPDATE `webhook_delivery` SET `next_attempt_at` = 8640000000000000 WHERE `status` = 'pending' AND `destination_id` IN (SELECT `id` FROM `webhook_destination` WHERE `paused_at` IS NOT NULL AND `archived_at` IS NULL);
