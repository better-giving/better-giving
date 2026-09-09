import { defineConfig } from 'vitest/config';

// one pool, node. a template here is never mounted — it is rendered to a string by react-dom's
// server renderer (`@react-email/render`'s `render()`, called from src/render.ts), and a spec
// asserts against the string that comes back. nothing under this package needs a document, so
// there is no dom pool the way packages/operator carries one.
export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		// a spy or fake one test installs is restored before the next runs; vitest 4 leaves this off
		restoreMocks: true,
		// a stubbed global is restored before the next test runs too
		unstubGlobals: true,
		environment: 'node',
		include: ['src/**/*.{test,spec}.{ts,tsx}']
	}
});
