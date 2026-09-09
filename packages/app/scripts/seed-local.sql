-- the one row a contributor's local D1 needs before the dashboard is served and a donation form
-- can be added, applied by hand and only ever with `--local`.
--
-- **not a migration, and it runs on no deployment.** migrations/ is applied by the two paths
-- CLAUDE.md → Bans names and this is neither of them; the values below are invented, so a
-- deployment that took them would be soliciting gifts under a registration that does not exist.
-- it is also not a file an organisation edits — CLAUDE.md → Product surface keeps the repository
-- free of those, and what makes this one exempt is that it is a fixture for a database that is a
-- cache: the local sqlite file is deleted and rebuilt whenever the state goes stale
-- (CONTRIBUTING.md → Troubleshooting), and this is what fills it again.
--
-- **it finishes two of the five set-up jobs, both of them rows on `org_profile`**
-- (src/lib/server/config/readiness.ts): `organisation`, which is the registered name and the EIN
-- a donation form is refused without, and `notifications`, which is the address operational mail
-- goes to. the gate in src/routes/_app.tsx draws the set-up screen in place of every dashboard
-- screen until all five read done.
--
-- **the other three are nothing this file could write.** `payments` and `smtp` are deploy-time
-- values a contributor puts in `.dev.vars` (src/lib/server/config/env.ts) and never rows, and
-- `password` is one too. so a checkout that has run this still meets the gate on those three, and
-- that is the whole of what is left.
--
-- **no `site` row is seeded and none is needed.** a checkout serves its own donation page on the
-- app's own route at `/{form_id}` (src/routes/$formId.tsx), so a form is given to there without
-- being ticked onto any site.
--
-- **re-running it is safe.** the row is a singleton pinned to `default` by `org_profile_id_check`,
-- and the conflict arm fills only a column that is still empty — an EIN or an address typed on the
-- console since the first run survives every later one. `legal_name` is NOT NULL, so a row that
-- exists already has one and the arm leaves it alone.
--
-- run it from the repository root, after the migrations:
--
--   pnpm wrangler d1 execute DB --local --file scripts/seed-local.sql

insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
values (
	'default',
	'Example Foundation',
	'12-3456789',
	'ops@example.org',
	-- milliseconds, which is what `timestamp_ms` means on these two columns in
	-- src/lib/server/db/schema.ts — a row written in seconds reads as january 1970 on every screen.
	unixepoch() * 1000,
	unixepoch() * 1000
)
on conflict(id) do update set
	tax_id = coalesce(org_profile.tax_id, excluded.tax_id),
	notification_email = coalesce(org_profile.notification_email, excluded.notification_email),
	updated_at = excluded.updated_at;
