-- adds the webhook destinations, the events each takes, and `webhook_delivery`, the outbox their
-- posts are sent from; `src/lib/server/db/schema.ts` argues each.
CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`destination_id` text NOT NULL,
	`event` text NOT NULL,
	`subject_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`leased_until` integer,
	`last_status` integer,
	`last_error` text,
	`delivered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `webhook_destination`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "webhook_delivery_id_check" CHECK(length("webhook_delivery"."id") = 40 and "webhook_delivery"."id" glob 'msg_*' and substr("webhook_delivery"."id", 5) not glob '*[^0-9a-f-]*'),
	CONSTRAINT "webhook_delivery_event_check" CHECK("webhook_delivery"."event" in ('gift.made', 'gift.refunded', 'gift.dispute_opened', 'donor.added', 'donor.updated', 'recurring_gift.started', 'recurring_gift.updated', 'recurring_gift.charge_failed', 'recurring_gift.ended')),
	CONSTRAINT "webhook_delivery_subject_id_not_blank_check" CHECK(trim("webhook_delivery"."subject_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "webhook_delivery_status_check" CHECK("webhook_delivery"."status" in ('pending', 'delivered', 'failed')),
	CONSTRAINT "webhook_delivery_attempts_check" CHECK("webhook_delivery"."attempts" >= 0),
	CONSTRAINT "webhook_delivery_last_status_check" CHECK("webhook_delivery"."last_status" is null or "webhook_delivery"."last_status" between 100 and 599),
	CONSTRAINT "webhook_delivery_last_error_not_blank_check" CHECK("webhook_delivery"."last_error" is null or trim("webhook_delivery"."last_error", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "webhook_delivery_delivered_check" CHECK(("webhook_delivery"."status" = 'delivered') = ("webhook_delivery"."delivered_at" is not null))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_delivery_event_idx` ON `webhook_delivery` (`destination_id`,`event`,`subject_id`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_due_idx` ON `webhook_delivery` (`status`,`next_attempt_at`,`id`,`leased_until`);--> statement-breakpoint
CREATE TABLE `webhook_destination` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`signing_secret` text NOT NULL,
	`paused_at` integer,
	`failing_since` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "webhook_destination_url_check" CHECK(substr("webhook_destination"."url", 1, 8) = 'https://'),
	CONSTRAINT "webhook_destination_signing_secret_check" CHECK(length("webhook_destination"."signing_secret") = 50 and "webhook_destination"."signing_secret" glob 'whsec_*' and substr("webhook_destination"."signing_secret", 7) not glob '*[^A-Za-z0-9+/=]*')
) STRICT;
--> statement-breakpoint
CREATE TABLE `webhook_destination_event` (
	`destination_id` text NOT NULL,
	`event` text NOT NULL,
	PRIMARY KEY(`destination_id`, `event`),
	FOREIGN KEY (`destination_id`) REFERENCES `webhook_destination`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "webhook_destination_event_event_check" CHECK("webhook_destination_event"."event" in ('gift.made', 'gift.refunded', 'gift.dispute_opened', 'donor.added', 'donor.updated', 'recurring_gift.started', 'recurring_gift.updated', 'recurring_gift.charge_failed', 'recurring_gift.ended'))
) STRICT;
