-- a dispute may close `refunded`: the organisation's own full refund closed it while it was open,
-- which is not a loss. `src/lib/server/db/schema.ts`'s `DISPUTE_OUTCOMES` argues it.
--
-- widening a CHECK is not one of sqlite's native ALTERs, so `dispute` is the create-copy-drop-rename
-- rebuild `src/lib/server/db/schema.ts`'s rule 2 describes, with the hand-edits CONTRIBUTING.md ->
-- Migrations lists: `defer_foreign_keys` in place of drizzle's inert `foreign_keys` pair, `STRICT`
-- on `__new_dispute`, and every `CHECK` unqualified. no table references `dispute`, so the drop
-- leaves no child row to resolve, and `dispute_updated_at_idx` is made again on the renamed table.
-- every row is copied as it stands: no dispute already closed `lost` is reread as `refunded`.
PRAGMA defer_foreign_keys=true;--> statement-breakpoint
CREATE TABLE `__new_dispute` (
	`payment_id` text PRIMARY KEY NOT NULL,
	`outcome` text,
	`respond_by` integer,
	`reason` text,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payment`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dispute_outcome_check" CHECK("outcome" is null or "outcome" in ('won', 'lost', 'refunded')),
	CONSTRAINT "dispute_closed_with_outcome_check" CHECK(("outcome" is null) = ("closed_at" is null)),
	CONSTRAINT "dispute_reason_not_blank_check" CHECK("reason" is null or trim("reason", char(32, 9, 10, 11, 12, 13, 160)) <> '')
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_dispute`("payment_id", "outcome", "respond_by", "reason", "closed_at", "created_at", "updated_at") SELECT "payment_id", "outcome", "respond_by", "reason", "closed_at", "created_at", "updated_at" FROM `dispute`;--> statement-breakpoint
DROP TABLE `dispute`;--> statement-breakpoint
ALTER TABLE `__new_dispute` RENAME TO `dispute`;--> statement-breakpoint
PRAGMA defer_foreign_keys=false;--> statement-breakpoint
CREATE INDEX `dispute_updated_at_idx` ON `dispute` (`updated_at`,`payment_id`);
