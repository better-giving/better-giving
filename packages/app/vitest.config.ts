import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { routeFiles } from './vite/route-files';
import { versionDefine } from './version-define';

// the spec pools, and a config of their own rather than a `test` block inside ./vite.config.ts.
//
// that file is the build: `reactRouter()` stands up a route manifest, and that has nothing to do
// with a spec that imports a module and calls it. vitest reads this file in preference to that one, so the two never meet.
//
// three projects, split by what a spec needs.
//
// `*.db.spec.ts` runs in node against a real libSQL file — anything that touches the database
// belongs there, because the things worth asserting about it (STRICT rejects a float, `batch()`
// rolls back, a UNIQUE index refuses a redelivery) are properties of the database and cannot be
// proven against a stand-in.
//
// `*.dom.spec.*` runs in happy-dom, and what it is for is the one thing a server render cannot
// reach: a state react router only ever puts a screen in while a navigation is in flight. a
// `renderToStaticMarkup` is one pass, so `useNavigation()` is idle in every one of them — the
// screen's busy arm is unrenderable there. mounted into a document with an action that has not
// settled, it is the real state rather than a stand-in for it, and the same pool is where a part
// handed react router's `Link` is pressed to see the router take the press.
//
// it is not the browser spec CLAUDE.md bans: happy-dom is a document to render into and nothing
// more, and nothing in this pool reads appearance — the ban is on freezing a dashboard screen's
// CSS, and no case here reads a computed style.
//
// everything else runs in node, which is faster to start and enough for pure logic.

export default defineConfig({
	// the same constant ./vite.config.ts builds with: a spec that mounts the console surface meets the
	// name its report reads. the variable is unset when the suite runs, so what a spec reads is
	// `null`, which is what a checkout build answers with too.
	define: versionDefine,
	// the "server" project below resolves src/lib/page/slug.ts, which imports `virtual:route-files`
	// — the same plugin ./vite.config.ts registers for the build, so a spec sees the same route
	// list a request does.
	plugins: [routeFiles(resolve(import.meta.dirname, 'src/routes'))],
	test: {
		expect: { requireAssertions: true },
		// a spy or fake one test installs is restored before the next runs; vitest 4 leaves this off
		restoreMocks: true,
		// a stubbed global (fetch, and its kind) is restored before the next test runs too
		unstubGlobals: true,
		projects: [
			{
				extends: true,
				resolve: {
					// `$lib`, which most of src/ imports through. ./vite.config.ts declares the same
					// alias for the build and ./tsconfig.json for the type check; nothing joins the
					// three.
					alias: { $lib: resolve(import.meta.dirname, 'src/lib') }
				},
				test: {
					name: 'server',
					environment: 'node',
					// four roots, and each is a place a spec sits beside its subject: `src/` is the
					// app, `scripts/` the operator scripts and `server/` the HTTP server — plain node
					// with no DOM under either — and the package root, where the config specs that
					// read this package's own config files live (./form-rules.spec.ts).
					include: [
						'src/**/*.{test,spec}.{js,ts}',
						'scripts/**/*.{test,spec}.{js,ts}',
						'server/**/*.{test,spec}.{js,ts}',
						'*.{test,spec}.{js,ts}'
					],
					exclude: [
						// the dom pool owns these; node would collect a `.ts` one and fail on
						// `document` being undefined.
						'src/**/*.dom.{test,spec}.{js,ts}',
						// and the db project these, so each runs once and against its own file.
						'src/**/*.db.{test,spec}.{js,ts}',
						'server/**/*.db.{test,spec}.{js,ts}'
					]
				}
			},
			{
				extends: true,
				resolve: { alias: { $lib: resolve(import.meta.dirname, 'src/lib') } },
				test: {
					name: 'db',
					environment: 'node',
					// a real libSQL file per spec file, with every committed migration applied
					// (src/lib/server/db/database.testing.ts). that module holds the handle at module
					// scope, so it relies on vitest's default `isolate: true` — one module registry per
					// spec file, so one database per spec file. turning isolation off would hand every
					// file the first one's rows.
					include: ['src/**/*.db.{test,spec}.ts', 'server/**/*.db.{test,spec}.ts']
				}
			},
			{
				extends: true,
				resolve: { alias: { $lib: resolve(import.meta.dirname, 'src/lib') } },
				test: {
					name: 'dom',
					environment: 'happy-dom',
					// `.tsx` as well as `.ts`, because a spec that mounts a screen writes that
					// screen's node props as jsx and jsx is not legal in a `.ts` file.
					include: ['src/**/*.dom.{test,spec}.{ts,tsx}']
				}
			}
		]
	}
});
