-- a `zapier_key` row minted before 0007 has no stored key, so the console has nothing to show for
-- it. the row goes, and the operator makes a new key from the console. `src/lib/server/db/schema.ts`
-- argues the column.
--
-- every Zap subscribed under that key ends the way `replaceZapierKey` in
-- `src/lib/server/zapier/key.ts` ends them: pending deliveries dropped, then each open subscription
-- ended as `key_replaced`. both are gated on the keyless row existing, so a deployment whose key is
-- already stored loses nothing, and they run ahead of the delete that the gate reads.
--
-- data only: no table is rebuilt, and `zapier_key.key` stays nullable in sql.
UPDATE `zapier_delivery`
SET `status` = 'dropped', `leased_until` = NULL, `updated_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE `status` = 'pending'
	AND `subscription_id` IN (SELECT `id` FROM `zapier_subscription` WHERE `ended_at` IS NULL)
	AND EXISTS (SELECT 1 FROM `zapier_key` WHERE `key` IS NULL);
--> statement-breakpoint
UPDATE `zapier_subscription`
SET `ended_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER),
	`ended_reason` = 'key_replaced',
	`updated_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE `ended_at` IS NULL
	AND EXISTS (SELECT 1 FROM `zapier_key` WHERE `key` IS NULL);
--> statement-breakpoint
DELETE FROM `zapier_key` WHERE `key` IS NULL;
