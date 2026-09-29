-- adds `webhook_delivery_owed_idx`, one destination's rows in one status, for a pause, a resume,
-- a delete and a deleted destination's standing sweep; `src/lib/server/db/schema.ts` argues it.
CREATE INDEX `webhook_delivery_owed_idx` ON `webhook_delivery` (`destination_id`,`status`);