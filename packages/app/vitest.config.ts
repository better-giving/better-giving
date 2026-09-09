import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// the spec pools, and a config of their own rather than a `test` block inside ./vite.config.ts.
//
// that file is the build: `@cloudflare/vite-plugin` and `reactRouter()` between them stand up a
// worker runtime and a route manifest, and neither has anything to do with a spec that imports a
// module and calls it. vitest reads this file in preference to that one, so the two never meet.
//
// three pools, split by what a spec needs.
//
// `*.workers.spec.ts` runs inside workerd against a real D1 — anything that touches the database
// belongs there, because the things worth asserting about it (STRICT rejects a float, `batch()`
// rolls back, a UNIQUE index refuses a redelivery) are properties of D1 and cannot be proven
// against a stand-in. ./vitest.workers.config.ts is that pool, and its header says why it is a
// file rather than an entry here.
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
	test: {
		expect: { requireAssertions: true },
		// a spy or fake one test installs is restored before the next runs; vitest 4 leaves this off
		restoreMocks: true,
		// a stubbed global (fetch, and its kind) is restored before the next test runs too
		unstubGlobals: true,
		projects: [
			'./vitest.workers.config.ts',
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
					// three roots, and each is a place a spec sits beside its subject: `src/` is the
					// app, `scripts/` the operator scripts — plain node with no binding and no DOM
					// under them — and the package root, where the config specs that read this
					// package's own config files live (./form-rules.spec.ts).
					include: [
						'src/**/*.{test,spec}.{js,ts}',
						'scripts/**/*.{test,spec}.{js,ts}',
						'*.{test,spec}.{js,ts}'
					],
					exclude: [
						// the workers pool owns these; without the exclusion node would collect them
						// too and fail on the `cloudflare:test` import.
						'src/**/*.workers.{test,spec}.{js,ts}',
						// and the dom pool these; node would collect a `.ts` one and fail on
						// `document` being undefined.
						'src/**/*.dom.{test,spec}.{js,ts}'
					]
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
