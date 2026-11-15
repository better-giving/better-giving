-- `gift_match.pack_tries` counts the pack's sends that failed, so the sweep that sends the packs
-- owed stops trying one (`PACK_TRIES` in `src/lib/server/matching/pack.ts`). `src/lib/server/db/schema.ts`
-- argues it.
--
-- a new table-level `CHECK` is not one of sqlite's native ALTERs, so `gift_match` is the
-- create-copy-drop-rename rebuild `src/lib/server/db/schema.ts`'s rule 2 describes, with the
-- hand-edits CONTRIBUTING.md -> Migrations lists: `defer_foreign_keys` in place of drizzle's inert
-- `foreign_keys` pair, `STRICT` on `__new_gift_match`, and every `CHECK` unqualified. the copy
-- leaves `pack_tries` out, since the old table has none, and every row takes its default of 0. no
-- table references `gift_match`, and its three indexes are made again on the renamed table.
PRAGMA defer_foreign_keys=true;--> statement-breakpoint
CREATE TABLE `__new_gift_match` (
	`id` text PRIMARY KEY NOT NULL,
	`donation_id` text NOT NULL,
	`token` text NOT NULL,
	`employer` text,
	`pack_sent_at` integer,
	`pack_failed_at` integer,
	`reminder_due_at` integer,
	`reminded_at` integer,
	`filed_at` integer,
	`filed_by` text,
	`matched_at` integer,
	`matched_by` text,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text,
	`created_at` integer NOT NULL,
	`pack_tries` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`donation_id`) REFERENCES `donation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gift_match_token_check" CHECK(length("token") = 32 and "token" not glob '*[^0123456789abcdefghjkmnpqrstvwxyz]*'),
	CONSTRAINT "gift_match_employer_not_blank_check" CHECK("employer" is null or trim("employer", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "gift_match_employer_length_check" CHECK(length("employer") <= 200),
	CONSTRAINT "gift_match_filed_by_check" CHECK(("filed_at" is null) = ("filed_by" is null)),
	CONSTRAINT "gift_match_filed_by_not_blank_check" CHECK("filed_by" is null or trim("filed_by", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "gift_match_matched_by_check" CHECK(("matched_at" is null) = ("matched_by" is null)),
	CONSTRAINT "gift_match_matched_by_not_blank_check" CHECK("matched_by" is null or trim("matched_by", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "gift_match_voided_by_check" CHECK(("voided_at" is null) = ("voided_by" is null)),
	CONSTRAINT "gift_match_voided_by_not_blank_check" CHECK("voided_by" is null or trim("voided_by", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "gift_match_void_reason_check" CHECK(("voided_at" is null) = ("void_reason" is null)),
	CONSTRAINT "gift_match_void_reason_not_blank_check" CHECK("void_reason" is null or trim("void_reason", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "gift_match_pack_tries_check" CHECK("pack_tries" >= 0)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_gift_match`("id", "donation_id", "token", "employer", "pack_sent_at", "pack_failed_at", "reminder_due_at", "reminded_at", "filed_at", "filed_by", "matched_at", "matched_by", "voided_at", "voided_by", "void_reason", "created_at") SELECT "id", "donation_id", "token", "employer", "pack_sent_at", "pack_failed_at", "reminder_due_at", "reminded_at", "filed_at", "filed_by", "matched_at", "matched_by", "voided_at", "voided_by", "void_reason", "created_at" FROM `gift_match`;--> statement-breakpoint
DROP TABLE `gift_match`;--> statement-breakpoint
ALTER TABLE `__new_gift_match` RENAME TO `gift_match`;--> statement-breakpoint
PRAGMA defer_foreign_keys=false;--> statement-breakpoint
CREATE UNIQUE INDEX `gift_match_donation_id_idx` ON `gift_match` (`donation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gift_match_token_idx` ON `gift_match` (`token`);--> statement-breakpoint
CREATE INDEX `gift_match_reminder_due_idx` ON `gift_match` (`reminder_due_at`) WHERE "gift_match"."reminder_due_at" is not null and "gift_match"."reminded_at" is null and "gift_match"."filed_at" is null and "gift_match"."matched_at" is null and "gift_match"."voided_at" is null;