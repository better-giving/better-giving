import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',

	// the directory `pnpm db:migrate` (scripts/migrate.ts) and the db spec pool
	// (src/lib/server/db/database.testing.ts) read — both would silently find nothing if this drifted.
	out: './migrations',

	// plain sqlite, with no driver and no `dbCredentials`. drizzle-kit's only job here is to emit
	// SQL; scripts/migrate.ts is what applies it. a database url here would let `drizzle-kit push`
	// or `migrate` write the schema too — a second migration path that records nothing in
	// `d1_migrations`, so the next `db:migrate` would replay files onto tables that already exist.
	//
	// drizzle-kit also writes `meta/` (snapshots + _journal.json) into `out`. scripts/migrate.ts
	// reads only `*.sql`, so it is inert there — and it must be committed, because it is the state
	// `drizzle-kit generate` diffs against.
	dialect: 'sqlite'
});
