import { defineConfig } from 'vitest/config';

// packages/operator's own test pools, so that this package is exercised where it lives rather than
// only through whichever surface happens to import it. it is a leaf: it mounts no route, binds
// nothing and touches no database, so a `*.workers.spec.ts` is unrepresentable here.
//
// what it exists to run is the cases no consumer can write. the sweeps in src/styles/raw-values.ts
// are called by each surface with globs of its own, and a caller can only ever assert that its own
// files are clean — which is the same result whether the escape hatch works or the sweep is blind.
// src/styles/raw-values.spec.ts is where the hatch is actually opened, against a fixture. the
// other is src/save-state.react.ts: a hook needs a real DOM to mount into, and this leaf has none
// of its own outside a test pool, so the react binding is only ever covered from in here.
//
// src/components/raw-values.spec.ts is the third and is an ordinary caller of those sweeps rather
// than a case no consumer could write — it is here because the components it globs are. so are the
// specs beside the parts in src/components/**: the two surfaces that render them can each only
// assert what its own screens do with a part, and the part's own markup is answerable here.
//
// two pools, split by what a spec needs. node starts faster and is enough for pure logic;
// `*.dom.spec.*` runs in happy-dom, which is a document to render into and nothing more — no
// /admin screen gets a `*.browser.spec.ts` (CLAUDE.md) and nothing in this package is about
// appearance either.
//
// both pools collect `.tsx` as well as `.ts`, because a spec over a part writes that part's node
// props as jsx and jsx is not legal in a `.ts` file. the two globs stay each other's complement at
// both extensions: widened on one side only, a `.tsx` spec is collected by neither project and
// reads as a suite that passes.
export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		// a spy or fake one test installs is restored before the next runs; vitest 4 leaves this off
		restoreMocks: true,
		// a stubbed global is restored before the next test runs too
		unstubGlobals: true,
		projects: [
			{
				extends: true,
				test: {
					name: 'node',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{ts,tsx}'],
					// the dom pool owns these; without the exclusion node would collect them too
					// and fail on `document` being undefined.
					exclude: ['src/**/*.dom.{test,spec}.{ts,tsx}']
				}
			},
			{
				extends: true,
				test: {
					name: 'dom',
					environment: 'happy-dom',
					include: ['src/**/*.dom.{test,spec}.{ts,tsx}']
				}
			}
		]
	}
});
