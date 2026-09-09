import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

// every committed migration applied to the pool's D1 before any spec runs.
//
// `readD1Migrations` (see vitest.workers.config.ts) reads the same `migrations/` files
// `wrangler d1 migrations apply` ships, so what is under test here is the SQL that
// deploys — not a schema rebuilt from a drizzle snapshot, which is exactly the gap that
// lets `STRICT` go missing.

beforeAll(async () => {
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
