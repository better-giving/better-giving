-- employer matching: `gift_match`, one row per gift, holding the token of the donor's page for it
-- (`/gift/{token}`), the employer they named and the stamps of the claim since: pack sent or failed,
-- reminder due and sent, filed, matched and voided, each `_by` beside its stamp, and the count of
-- the pack's sends that failed.
-- `src/lib/server/db/schema.ts` argues each.
--
-- one new table, born `STRICT`. no table is rebuilt and no row is written: a gift already recorded
-- has no row here until the app writes one for it.
CREATE TABLE `gift_match` (
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
	CONSTRAINT "gift_match_token_check" CHECK(length("gift_match"."token") = 32 and "gift_match"."token" not glob '*[^0123456789abcdefghjkmnpqrstvwxyz]*'),
	CONSTRAINT "gift_match_employer_not_blank_check" CHECK("gift_match"."employer" is null or trim("gift_match"."employer", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "gift_match_employer_length_check" CHECK(length("gift_match"."employer") <= 200),
	CONSTRAINT "gift_match_filed_by_check" CHECK(("gift_match"."filed_at" is null) = ("gift_match"."filed_by" is null)),
	CONSTRAINT "gift_match_filed_by_not_blank_check" CHECK("gift_match"."filed_by" is null or trim("gift_match"."filed_by", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "gift_match_matched_by_check" CHECK(("gift_match"."matched_at" is null) = ("gift_match"."matched_by" is null)),
	CONSTRAINT "gift_match_matched_by_not_blank_check" CHECK("gift_match"."matched_by" is null or trim("gift_match"."matched_by", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "gift_match_voided_by_check" CHECK(("gift_match"."voided_at" is null) = ("gift_match"."voided_by" is null)),
	CONSTRAINT "gift_match_voided_by_not_blank_check" CHECK("gift_match"."voided_by" is null or trim("gift_match"."voided_by", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "gift_match_void_reason_check" CHECK(("gift_match"."voided_at" is null) = ("gift_match"."void_reason" is null)),
	CONSTRAINT "gift_match_void_reason_not_blank_check" CHECK("gift_match"."void_reason" is null or trim("gift_match"."void_reason", char(32, 9, 10, 11, 12, 13, 160)) <> ''),
	CONSTRAINT "gift_match_pack_tries_check" CHECK("gift_match"."pack_tries" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `gift_match_donation_id_idx` ON `gift_match` (`donation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gift_match_token_idx` ON `gift_match` (`token`);--> statement-breakpoint
CREATE INDEX `gift_match_reminder_due_idx` ON `gift_match` (`reminder_due_at`) WHERE "gift_match"."reminder_due_at" is not null and "gift_match"."reminded_at" is null and "gift_match"."filed_at" is null and "gift_match"."matched_at" is null and "gift_match"."voided_at" is null;