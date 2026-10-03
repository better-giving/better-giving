-- adds the indexes the read API's lists walk each of their orders by: donors and recurring gifts by
-- their stored times, and gifts oldest change first by each kind of write that moves one;
-- `src/lib/server/db/schema.ts` argues each.
CREATE INDEX `contact_unarchived_created_at_idx` ON `contact` (`created_at`,`id`) WHERE "contact"."archived_at" is null;--> statement-breakpoint
CREATE INDEX `contact_unarchived_updated_at_idx` ON `contact` (`updated_at`,`id`) WHERE "contact"."archived_at" is null;--> statement-breakpoint
CREATE INDEX `dispute_updated_at_idx` ON `dispute` (`updated_at`,`payment_id`);--> statement-breakpoint
CREATE INDEX `entry_group_created_at_idx` ON `entry_group` (`created_at`,`source_id`);--> statement-breakpoint
CREATE INDEX `payment_settled_gift_created_at_idx` ON `payment` (`created_at`,`id`) WHERE "payment"."status" = 'succeeded' and "payment"."direction" = 'inbound';--> statement-breakpoint
CREATE INDEX `payment_refund_created_at_idx` ON `payment` (`created_at`,`parent_payment_id`) WHERE "payment"."direction" = 'refund';--> statement-breakpoint
CREATE INDEX `recurring_plan_created_at_idx` ON `recurring_plan` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `recurring_plan_updated_at_idx` ON `recurring_plan` (`updated_at`,`id`);