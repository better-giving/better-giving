-- a `webhook_delivery` row may be `dropped` — a `gift.refunded` event withheld because its refund
-- no longer stands, which is not a failure — and carries `detail`, a JSON object of what its
-- payload needs that cannot be read again at send. `src/lib/server/db/schema.ts` argues both.
--
-- changing a CHECK is not one of sqlite's native ALTERs, so `webhook_delivery` is the
-- create-copy-drop-rename rebuild `src/lib/server/db/schema.ts`'s rule 2 describes, with the
-- hand-edits CONTRIBUTING.md -> Migrations lists: `defer_foreign_keys` in place of drizzle's inert
-- `foreign_keys` pair, `STRICT` on `__new_webhook_delivery`, and every `CHECK` unqualified. the
-- copy names no `detail`: the old table has none, and D1 reads an unknown double-quoted name as
-- its own text. no table references `webhook_delivery`, so the drop leaves no child row to
-- resolve. every row is copied as it stands: nothing already `failed` is reread as dropped, and
-- every `detail` is null.
PRAGMA defer_foreign_keys=true;--> statement-breakpoint
CREATE TABLE `__new_webhook_delivery` (
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
	`detail` text,
	FOREIGN KEY (`destination_id`) REFERENCES `webhook_destination`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "webhook_delivery_id_check" CHECK(length("id") = 40 and "id" glob 'msg_*' and substr("id", 5) not glob '*[^0-9a-f-]*'),
	CONSTRAINT "webhook_delivery_event_check" CHECK("event" in ('gift.made', 'gift.refunded', 'gift.dispute_opened', 'donor.added', 'donor.updated', 'recurring_gift.started', 'recurring_gift.updated', 'recurring_gift.charge_failed', 'recurring_gift.ended')),
	CONSTRAINT "webhook_delivery_subject_id_not_blank_check" CHECK(trim("subject_id", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "webhook_delivery_status_check" CHECK("status" in ('pending', 'delivered', 'failed', 'dropped')),
	CONSTRAINT "webhook_delivery_attempts_check" CHECK("attempts" >= 0),
	CONSTRAINT "webhook_delivery_last_status_check" CHECK("last_status" is null or "last_status" between 100 and 599),
	CONSTRAINT "webhook_delivery_last_error_not_blank_check" CHECK("last_error" is null or trim("last_error", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "webhook_delivery_detail_object_check" CHECK("detail" is null or (json_valid("detail") and json_type("detail") = 'object')),
	CONSTRAINT "webhook_delivery_delivered_check" CHECK(("status" = 'delivered') = ("delivered_at" is not null))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_webhook_delivery`("id", "destination_id", "event", "subject_id", "status", "attempts", "next_attempt_at", "leased_until", "last_status", "last_error", "delivered_at", "created_at", "updated_at") SELECT "id", "destination_id", "event", "subject_id", "status", "attempts", "next_attempt_at", "leased_until", "last_status", "last_error", "delivered_at", "created_at", "updated_at" FROM `webhook_delivery`;--> statement-breakpoint
DROP TABLE `webhook_delivery`;--> statement-breakpoint
ALTER TABLE `__new_webhook_delivery` RENAME TO `webhook_delivery`;--> statement-breakpoint
PRAGMA defer_foreign_keys=false;--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_delivery_event_idx` ON `webhook_delivery` (`destination_id`,`event`,`subject_id`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_due_idx` ON `webhook_delivery` (`status`,`next_attempt_at`,`id`,`leased_until`);