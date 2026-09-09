import { defineConfig } from 'vitest/config';

// packages/form's own test config. this package mounts no react-router route and binds no D1, so
// it needs neither the app's reactRouter plugin nor a cloudflareTest pool — two projects are the
// whole of what a spec here can need.
//
// `*.dom.spec.ts` runs in happy-dom — structure, attributes, events, slots and the custom
// element's upgrade lifecycle, without paying for a real browser. everything else runs in node,
// which is faster to start and enough for pure logic. a third pool, `browser`
// (vitest.browser.config.ts), exists outside this list — see that file for why it is not one of
// these projects.
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
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: [
						// no `*.workers.spec.ts` exists under this package today, deliberately: the form
						// touches no database, and packages/form/tsconfig.json carries no ambient types
						// for `cloudflare:test`, so one would fail typecheck before it ever mattered
						// which pool ran it. excluded here rather than left to fall into this pool by
						// omission, so the naming convention still means the same thing everywhere in
						// the repo.
						'src/**/*.workers.{test,spec}.{js,ts}',
						// the dom pool owns these; without the exclusion node would collect them too
						// and fail on `document`/`customElements` being undefined.
						'src/**/*.dom.{test,spec}.{js,ts}',
						// the browser pool (vitest.browser.config.ts) owns these; same reason, plus
						// they expect `test.browser`'s `page`/`userEvent` globals.
						'src/**/*.browser.{test,spec}.{js,ts}'
					]
				}
			},
			{
				extends: true,
				// picks the browser build of any dependency that ships one, the same reason
				// packages/app/vite.config.ts's `dom` project sets it: without it a dual-build package resolves to
				// its server/node build under this pool, where the two can behave differently, and an
				// assertion about what happens once the element is on the screen would be asserting
				// against a build nothing serves a real page.
				resolve: { conditions: ['browser'] },
				test: {
					name: 'dom',
					// a lightweight DOM is blind to the two things the element actually needs proven
					// — layout and `@container`/`oklch(from …)`-derived output — so it earns no keep
					// for those. what it does earn its keep for is structure, attributes, events,
					// slots and the upgrade lifecycle, and happy-dom's shadow DOM and custom-element
					// support covers that surface. the two properties this pool cannot see stay with
					// the `browser` project, run out of band from `test`/`deploy` (see
					// vitest.browser.config.ts).
					environment: 'happy-dom',
					// a `<script src>` reaching the document is what the embed loader does, and
					// happy-dom loads no external script — it logs a DOMException for each one and
					// carries on. that turns an assertion about an installed script tag into a passing
					// test buried under a stack trace that reads like a failure, so the insertion is
					// treated as having succeeded instead. nothing is fetched either way, and no
					// assertion is softened: the tag and its attributes are what those specs read.
					environmentOptions: {
						happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } }
					},
					include: ['src/**/*.dom.{test,spec}.{js,ts}'],
					// vitest replaces a CSS import with an empty string unless this is on, and the
					// element imports its three stylesheets as `?inline` to build the constructed
					// sheets it adopts. off, the shadow root under test is styled by nothing and every
					// assertion about that CSS reads an empty string — which fails loudly for one that
					// expects content and passes silently for one that expects an absence.
					css: true
				}
			}
		]
	}
});
