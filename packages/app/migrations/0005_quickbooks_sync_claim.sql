-- a delivery run claims a queue row before it sends it, so one gift reaches the company's books
-- once. `quickbooks_sync` gains `leased_until`: while it is in the future the row belongs to the
-- run that wrote it, and a run takes a row with an update's own `where` rather than a read in
-- front of a write. it is a column and not a fourth status, so `quickbooks_sync_status_check` is
-- untouched. `src/lib/server/db/schema.ts` argues it beside the column.
--
-- `quickbooks_sync_status_idx` is replaced by `quickbooks_sync_status_due_idx`, on the order the
-- sweep reads in as well as the status it filters on: on `status` alone a backlog parked behind an
-- outage was re-sorted on every run.
--
-- no table is rebuilt. the column is appended, so it is a native `ADD COLUMN` and none of the
-- rebuild hand-edits apply — no deferral, no unqualified CHECK, no backtick strip, no index moved
-- ahead of a drop — and there is no `CREATE TABLE` here to hand-write `STRICT` onto.
DROP INDEX `quickbooks_sync_status_idx`;--> statement-breakpoint
ALTER TABLE `quickbooks_sync` ADD `leased_until` integer;--> statement-breakpoint
CREATE INDEX `quickbooks_sync_status_due_idx` ON `quickbooks_sync` (`status`,`created_at`,`entry_group_id`);
