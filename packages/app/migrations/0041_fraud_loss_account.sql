-- 5900 Fraud loss: an expense account for money lost to fraud or written off, which is not a
-- processor's fee and so has no place in 5200. `POSTING_ACCOUNTS.fraudLoss` in
-- `src/lib/server/db/accounts.ts` names the same id, and `accounts.db.spec.ts` asserts the two agree.
--
-- the row's shape is 5200's in `0000_initial_schema.sql`: postable, not deductible, not a tax, no
-- parent. the bare `ON CONFLICT DO NOTHING` is that file's too, so a second run on a database that
-- already holds the row leaves it as it stands.
INSERT INTO `account` (`id`, `code`, `name`, `type`, `is_deductible`, `is_tax`, `is_postable`, `tax_rate_e8`, `parent_id`, `created_at`, `updated_at`)
VALUES ('01a1f654-cd8e-7e4b-8d49-7015b1d3d452', '5900', 'Fraud loss', 'expense', 0, 0, 1, NULL, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER))
ON CONFLICT DO NOTHING;
