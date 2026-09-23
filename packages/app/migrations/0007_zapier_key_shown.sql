-- the console shows the Zapier key on every visit, so `zapier_key` keeps the key itself beside its
-- hash. `key_hash` is untouched and still what a request is admitted by. `src/lib/server/db/schema.ts`
-- argues the column beside it.
--
-- no table is rebuilt: a native `ADD COLUMN` with the check on the column, which sqlite tests
-- against the row already there.
--
-- no backfill: a key minted before this migration was never stored, so its row reads `key` null.
ALTER TABLE `zapier_key` ADD `key` text CONSTRAINT "zapier_key_key_check" CHECK("zapier_key"."key" is null or (length("zapier_key"."key") = 47 and "zapier_key"."key" glob 'bgz_*' and substr("zapier_key"."key", 5) not glob '*[^A-Za-z0-9_-]*'));
