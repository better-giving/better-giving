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
//    `deploy`'s other gates. it needs a human to run it before shipping a change that touches the
//    seed properties or the container queries — which `test:browser` is for.
//
// this is a deliberate scope choice, not an oversight: the visual assertions are real coverage
// that a maintainer must remember to run by hand, and that is the drift risk this file accepts in
// exchange for keeping `deploy` fast for everyone else.

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
