// the `cloudflare:test` module's types, plus the bindings this repo's pool provides.
//
// a reference here rather than a third entry in tsconfig's `types`: this file already exists
// for the test-only bindings declared below, so what a workers spec needs is one file rather
// than a declaration here and a name in a config two directories up. this file is inside
// `src`, so the generated include picks it up and every `*.workers.spec.ts` sees the module
// without importing anything.

/// <reference types="@cloudflare/vitest-pool-workers/types" />

// `env` from `cloudflare:test` is typed as `Cloudflare.Env`: the app's own `Env`
// (../runtime/env.ts) plus the D1 binding this pool runs every workers spec against. they go on
// that interface rather than on `ProvidedEnv`, which this version no longer reads.
type AppEnv = Env;

declare namespace Cloudflare {
	interface Env extends AppEnv {
		/** the database ./d1.setup.ts migrates and every workers spec reads. */
		DB: D1Database;
		/** the committed `migrations/` files, read by `readD1Migrations` at config time. */
		TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
	}
}
