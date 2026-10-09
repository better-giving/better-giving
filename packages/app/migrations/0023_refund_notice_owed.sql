-- adds `payment.notice_owed_since`, the donor's notice of a refund still owed;
-- `src/lib/server/db/schema.ts` argues it. no data step: a refund already written owes nothing.
ALTER TABLE `payment` ADD `notice_owed_since` integer;
