-- adds `payment.notice_owed_since`, the donor's notice of a refund still owed, and
-- `payment.notice_maybe_sent_at`, a run's send of it that may have gone;
-- `src/lib/server/db/schema.ts` argues both. no data step: a refund already written owes nothing.
ALTER TABLE `payment` ADD `notice_owed_since` integer;--> statement-breakpoint
ALTER TABLE `payment` ADD `notice_maybe_sent_at` integer;
