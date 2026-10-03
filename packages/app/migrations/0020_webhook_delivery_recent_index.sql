-- adds `webhook_delivery_recent_idx`, a destination's latest deliveries newest first for its page;
-- `src/lib/server/db/schema.ts` argues it.
CREATE INDEX `webhook_delivery_recent_idx` ON `webhook_delivery` (`destination_id`,`created_at`,`id`);
