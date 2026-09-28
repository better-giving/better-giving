-- adds `payment_settled_gift_occurred_at_idx`, the settled gifts newest first for the read API;
-- `src/lib/server/db/schema.ts` argues it.
CREATE INDEX `payment_settled_gift_occurred_at_idx` ON `payment` (`occurred_at`,`id`) WHERE "payment"."status" = 'succeeded' and "payment"."direction" = 'inbound';
