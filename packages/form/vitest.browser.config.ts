import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// the pool that runs specs in a real Chromium, for the one thing happy-dom (the `dom` project in
// vitest.config.ts) cannot prove about the embeddable form's custom element: layout, `@container`
// breakpoints and `oklch(from var(--seed) …)`-derived color are all things a lightweight DOM
// computes as strings, not as a rendered box — so an assertion against them there would be
// asserting the fixture, not the element.
//
// deliberately not one of `vitest.config.ts`'s `projects`, so it never runs from plain
// `vitest`/`pnpm test` and never gates `deploy` (see `test:browser` in package.json). two reasons,
// not one:
//
//  - cost: a browser download (`playwright install`) and per-run startup that the rest of this
//    suite does not pay.
//  - what's actually at stake: a wrong color ramp or a missed breakpoint is a visual regression
//    in a widget, not a corrupted book, so it does not need to sit behind the same one-way door as
//    `deploy`'s other gates.
//
// `.github/workflows/ci.yml`'s `browser-test` job runs this on every push to `main` and every
// pull request, apart from its `test` job, so this is a scope choice
// about `deploy`'s gate, not about who runs the suite at all.

export default defineConfig({
	test: {
		name: 'browser',
		expect: { requireAssertions: true },
		// a spy or fake one test installs is restored before the next runs; vitest 4 leaves this off
		restoreMocks: true,
		include: ['src/**/*.browser.{test,spec}.{js,ts}'],
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(),
			instances: [{ browser: 'chromium' }]
		}
	}
});
