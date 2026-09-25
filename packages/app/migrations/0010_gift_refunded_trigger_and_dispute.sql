-- a gift can be disputed, and a Zap can listen for a refund. `dispute` is new: one row per dispute
-- a processor opened, keyed on the refund-direction `payment` row holding the money it withdrew,
-- with `outcome` null while open and `won` or `lost` once closed, `closed_at` set exactly when
-- `outcome` is, and a verbatim `reason` that is never blank. `zapier_subscription` takes a third
-- trigger, `gift_refunded`. `src/lib/server/db/schema.ts` argues each column beside it.
--
-- `dispute` is a plain create, and nothing references it. `STRICT` is hand-written onto it, since
-- drizzle's snapshot cannot record it; `strict.workers.spec.ts` catches its absence. its one
-- foreign key is `NO ACTION`, and its primary key is the index that key is found by.
--
-- widening a CHECK is not one of sqlite's native ALTERs, so `zapier_subscription` is the
-- create-copy-drop-rename rebuild `src/lib/server/db/schema.ts`'s rule 2 describes, of a table
-- `zapier_delivery.subscription_id` references, with the hand-edits CONTRIBUTING.md -> Migrations
-- lists:
--
-- the pragma. drizzle emitted `PRAGMA foreign_keys=OFF`/`=ON`, which is inert inside the
-- migration's one transaction, so the `DROP` failed on every delivery row pointing at a
-- subscription. `defer_foreign_keys` stands in its place: those rows point at the name
-- `zapier_subscription`, which the rename hands back. nothing checks that they resolve:
-- `defer_foreign_keys=false` clears the violations deferred so far, so the commit finds none, and
-- `newest-migration.workers.spec.ts`'s "leaves no foreign key pointing at nothing" is the one
-- guard. the key is `NO ACTION`, so there is no cascade for the drop to fire and no delivery row
-- is deleted.
--
-- `STRICT` is hand-written onto the `__new_` table.
--
-- every CHECK on the `__new_` table is unqualified. drizzle qualified them with the `__new_`
-- table, which `ALTER TABLE ... RENAME TO` does not rewrite, and sqlite 3.43 refuses the rename
-- over it.
--
-- the copy names the seven columns the old table holds, all of them unchanged.
--
-- the drop searches `zapier_delivery` for each subscription it deletes by the primary key, which
-- leads with `subscription_id`, so no index moves ahead of the drop. the one index re-emitted is
-- the partial unique index on `hook_url`, which is not functional, so there is no backtick to strip.
--
-- no backfill: no dispute has been recorded and no Zap has subscribed to `gift_refunded`.
CREATE TABLE `dispute` (
	`payment_id` text PRIMARY KEY NOT NULL,
	`outcome` text,
	`respond_by` integer,
	`reason` text,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payment`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dispute_outcome_check" CHECK("dispute"."outcome" is null or "dispute"."outcome" in ('won', 'lost')),
	CONSTRAINT "dispute_closed_with_outcome_check" CHECK(("dispute"."outcome" is null) = ("dispute"."closed_at" is null)),
	CONSTRAINT "dispute_reason_not_blank_check" CHECK("dispute"."reason" is null or trim("dispute"."reason", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
PRAGMA defer_foreign_keys=true;--> statement-breakpoint
CREATE TABLE `__new_zapier_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`hook_url` text NOT NULL,
	`ended_at` integer,
	`ended_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "zapier_subscription_trigger_check" CHECK("trigger" in ('new_gift', 'new_donor', 'gift_refunded')),
	CONSTRAINT "zapier_subscription_hook_url_check" CHECK(substr("hook_url", 1, 8) = 'https://'),
	CONSTRAINT "zapier_subscription_ended_reason_check" CHECK("ended_reason" is null or "ended_reason" in ('unsubscribed', 'gone', 'key_replaced')),
	CONSTRAINT "zapier_subscription_ended_check" CHECK(("ended_at" is null) = ("ended_reason" is null))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_zapier_subscription`("id", "trigger", "hook_url", "ended_at", "ended_reason", "created_at", "updated_at") SELECT "id", "trigger", "hook_url", "ended_at", "ended_reason", "created_at", "updated_at" FROM `zapier_subscription`;--> statement-breakpoint
DROP TABLE `zapier_subscription`;--> statement-breakpoint
ALTER TABLE `__new_zapier_subscription` RENAME TO `zapier_subscription`;--> statement-breakpoint
PRAGMA defer_foreign_keys=false;--> statement-breakpoint
CREATE UNIQUE INDEX `zapier_subscription_open_hook_idx` ON `zapier_subscription` (`hook_url`) WHERE "zapier_subscription"."ended_at" is null;
