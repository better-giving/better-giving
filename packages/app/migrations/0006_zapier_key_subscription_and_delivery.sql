-- gifts and new donors become events a Zap can subscribe to. three new tables and nothing else:
-- `zapier_key` holds the hash of the one key Zapier presents, `zapier_subscription` one row per
-- Zap listening for a trigger, and `zapier_delivery` where each event stands on its way to each
-- of them. `src/lib/server/db/schema.ts` argues each column beside it.
--
-- no table is rebuilt. all three are plain creates, so none of the rebuild hand-edits apply: no
-- deferral, no unqualified CHECK, no backtick strip, no index moved ahead of a drop. `STRICT` is
-- hand-written onto each `CREATE TABLE`, since drizzle's snapshot cannot record it.
--
-- `zapier_key` is a singleton on the shape `quickbooks_connection` uses, and no row is seeded: a
-- deployment that has not minted a key has none.
--
-- a subscription is ended, never deleted, and `zapier_subscription_open_hook_idx` is unique over
-- open rows only, so a hook whose earlier subscription ended can subscribe again.
--
-- both of `zapier_delivery`'s foreign keys are `NO ACTION`, like every other domain key in this
-- schema, and each is indexed. `zapier_delivery` is created ahead of `zapier_subscription`, which
-- sqlite allows: a foreign key's parent is resolved when a row is written, not when the table is.
--
-- no backfill: a delivery row is owed only for an event after a Zap subscribed.
CREATE TABLE `zapier_delivery` (
	`subscription_id` text NOT NULL,
	`event_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`leased_until` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`subscription_id`, `event_id`),
	FOREIGN KEY (`subscription_id`) REFERENCES `zapier_subscription`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payment`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "zapier_delivery_event_id_not_blank_check" CHECK(trim("zapier_delivery"."event_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "zapier_delivery_status_check" CHECK("zapier_delivery"."status" in ('pending', 'sent', 'failed', 'dropped')),
	CONSTRAINT "zapier_delivery_attempts_check" CHECK("zapier_delivery"."attempts" >= 0),
	CONSTRAINT "zapier_delivery_last_error_not_blank_check" CHECK("zapier_delivery"."last_error" is null or trim("zapier_delivery"."last_error", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
CREATE INDEX `zapier_delivery_due_idx` ON `zapier_delivery` (`status`,`next_attempt_at`,`subscription_id`,`event_id`,`leased_until`);--> statement-breakpoint
CREATE INDEX `zapier_delivery_payment_idx` ON `zapier_delivery` (`payment_id`);--> statement-breakpoint
CREATE TABLE `zapier_key` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "zapier_key_id_check" CHECK("zapier_key"."id" = 'zapier'),
	CONSTRAINT "zapier_key_key_hash_check" CHECK(length("zapier_key"."key_hash") = 64 and "zapier_key"."key_hash" not glob '*[^0-9a-f]*')
) STRICT;
--> statement-breakpoint
CREATE TABLE `zapier_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`hook_url` text NOT NULL,
	`ended_at` integer,
	`ended_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "zapier_subscription_trigger_check" CHECK("zapier_subscription"."trigger" in ('new_gift', 'new_donor')),
	CONSTRAINT "zapier_subscription_hook_url_check" CHECK(substr("zapier_subscription"."hook_url", 1, 8) = 'https://'),
	CONSTRAINT "zapier_subscription_ended_reason_check" CHECK("zapier_subscription"."ended_reason" is null or "zapier_subscription"."ended_reason" in ('unsubscribed', 'gone', 'key_replaced')),
	CONSTRAINT "zapier_subscription_ended_check" CHECK(("zapier_subscription"."ended_at" is null) = ("zapier_subscription"."ended_reason" is null))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `zapier_subscription_open_hook_idx` ON `zapier_subscription` (`hook_url`) WHERE "zapier_subscription"."ended_at" is null;