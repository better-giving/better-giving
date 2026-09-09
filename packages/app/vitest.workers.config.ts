import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { versionDefine } from './version-define';

// the pool that runs specs inside workerd, against a real D1.
//
// its own config file rather than a `projects` entry in vitest.config.ts, because the pool brings
// a runtime with it and every other spec in this package runs in node. some of these specs import
// a route module and call its loader or its action directly, which is a plain module and needs no
// plugin; what it needs is the `$lib` alias below, and a bare alias is the whole of it.
//
// no `main`. the pool's `main` is optional, and pointing it at the worker entry wrangler.jsonc
// names would tie `test` to a build having already happened — and nothing anywhere orders one
// ahead of it. the suite runs in lefthook.yml's pre-commit hook, behind `format`, `lint` and
// `check` and no build at all, so the gate would either fail on a clean checkout or silently test
// a stale bundle. these specs bind D1 and nothing else, so there is no entrypoint to point at.
//
// the bindings are declared here rather than read from wrangler.jsonc for the same
// reason: `wrangler.configPath` would pull in that file's `main`, and CONTRIBUTING.md
// (Tests) states that the pool never points at it. what a local test binds is stated
// below instead — smaller buckets than the deployment's, and no entrypoint at all.

export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			miniflare: {
				compatibilityDate: '2026-07-22',
				compatibilityFlags: ['nodejs_compat'],
				d1Databases: ['DB'],
				// the same binding `wrangler.jsonc` declares, with a much smaller bucket. what a
				// spec can hold the hook to is that it refuses before it resolves and that the
				// preflight is not exempt, and six hundred requests would prove neither of those
				// twice — so the number here is chosen to make the refusal quick to reach, and
				// the specs read it by asking until they are refused rather than by counting.
				// the deployment's own number is a policy and lives in wrangler.jsonc; that the
				// binding is declared there at all, under this name and with a period the
				// refusal's `Retry-After` still tells the truth about, is held by
				// src/lib/server/api/rate-limit.config.spec.ts, which reads that file.
				//
				// nothing in the type system holds it. `wrangler types` does write
				// `API_RATE_LIMITER` into worker-configuration.d.ts, but that file is gitignored
				// and `check` is `react-router typegen && tsc --noEmit` — only `prepare` and a manual
				// `pnpm wrangler types` regenerate it, so on the machine where somebody
				// edits wrangler.jsonc the stale copy goes on declaring a binding the config no
				// longer has.
				ratelimits: {
					// wider than the two tighter buckets below, in the order wrangler.jsonc sets
					// and src/lib/server/api/rate-limit.config.spec.ts holds for it: the surface
					// bucket bounds a caller against one read and the endpoint buckets bound what
					// a submission costs, so a surface bucket no looser than theirs refuses first
					// and none of them can ever be the thing that answers. that is not only a
					// missing case — it is a spec for the quote endpoint's own bucket that goes
					// green while the bucket is unreachable
					// (src/routes/api.v1.forms.$id.donations.workers.spec.ts).
					API_RATE_LIMITER: { namespace_id: '7412', simple: { limit: 20, period: 60 } },
					// the two tighter buckets the deployment also declares, both small enough to
					// exhaust in a handful of calls. the specs that charge these ask until they are
					// refused and give each case an address of its own, so no case here depends on
					// the number — only on it being small.
					QUOTE_RATE_LIMITER: { namespace_id: '7413', simple: { limit: 3, period: 60 } },
					SIGN_IN_RATE_LIMITER: { namespace_id: '7414', simple: { limit: 3, period: 60 } }
				},
				// the committed migration SQL, parsed into statements and handed to the
				// runtime as a binding. `applyD1Migrations` in the setup file is what runs
				// them — migrations are never a boot side effect here either.
				bindings: {
					TEST_MIGRATIONS: await readD1Migrations(resolve(import.meta.dirname, 'migrations'))
				}
			}
		}))
	],
	// the same constant ./vite.config.ts builds with, because a spec here imports the console
	// surface and the surface reads it — a pool that left it undefined would meet a name nothing
	// declared. the variable is unset when the suite runs, so what these specs read is `null`,
	// which is what a checkout build answers with too.
	define: versionDefine,
	// pinned, not inferred: run via `--config`, vitest otherwise resolves the root to the
	// pool package inside node_modules and finds no specs at all.
	root: import.meta.dirname,
	resolve: {
		// `$lib` is the alias most of src/ imports through, declared here because no plugin in
		// this config knows the name. the specs under `src/lib/server/**` reach each other with
		// relative paths and need none of it; a spec for a route module does, because a route
		// imports `$lib/...` — that is the repo's convention everywhere in `src/routes`, and
		// rewriting one route to `../../../../lib` to suit its test would be the test dictating
		// the source.
		alias: {
			$lib: resolve(import.meta.dirname, 'src/lib')
		}
	},
	test: {
		name: 'workers',
		expect: { requireAssertions: true },
		// a spy or fake one test installs is restored before the next runs; vitest 4 leaves this off
		restoreMocks: true,
		// a stubbed global is restored before the next test runs too
		unstubGlobals: true,
		include: ['src/**/*.workers.{test,spec}.{js,ts}'],
		setupFiles: ['./src/lib/server/db/d1.setup.ts']
	}
});
