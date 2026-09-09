import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',

	// must stay equal to `migrations_dir` in wrangler.jsonc — `wrangler d1 migrations
	// apply` reads that path and would silently find nothing if these drifted.
	out: './migrations',

	// plain sqlite, never `driver: 'd1-http'`. drizzle-kit's only job here is to emit
	// SQL; `wrangler d1 migrations apply` is what applies it, and the test pool reads the
	// same files through `readD1Migrations`. `d1-http` would have drizzle-kit talk to the
	// D1 HTTP API itself — a second migration path, needing an account id and API token
	// that neither wrangler nor the tests use.
	//
	// drizzle-kit also writes `meta/` (snapshots + _journal.json) into `out`. wrangler
	// reads only `*.sql` from migrations_dir, so it is inert there — and it must be
	// committed, because it is the state `drizzle-kit generate` diffs against.
	dialect: 'sqlite'
});
