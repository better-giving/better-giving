import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// the gallery's dev server and its test pool, and nothing that produces an artifact.
//
// no `build` script names a command in ./package.json, and the root package.json's `build` script
// filters to @better-giving/app alone — the forward AGENTS.md → Workspace describes for operator
// commands, and it names no other package.
//
// the port is pinned so `pnpm run gallery` opens the same address every time, and `strictPort` is
// what makes a second copy fail loudly rather than move itself to a port the first one's tab is not
// on. 5321 is packages/app's dev server and 5324 is packages/form's (see each package's own
// vite.config.ts), so all three run side by side.
const DEV_PORT = 5323;

// the design registry's variables.css, which ./src/app.css imports, `@import`s the registry's red
// hat round faces as `./fonts.css`. no preview is set in them: the gallery is set in plain red hat
// from packages/operator/src/styles/fonts.css, as /admin is, so that import resolves to an empty
// sheet here as it does in packages/app/vite.config.ts, and the copied file stays as the registry
// wrote it. the specifier is matched whole, and only variables.css writes it.
const noRegistryFaces = {
	find: /^\.\/fonts\.css$/,
	replacement: resolve(import.meta.dirname, 'vite.no-registry-faces.css')
};

export default defineConfig({
	server: { port: DEV_PORT, strictPort: true },
	resolve: { alias: [noRegistryFaces] },
	// the components this page renders are workspace-linked `.jsx` — packages/operator's, imported
	// directly. excluded from the dependency prebundler, they stay source and reach this project's
	// own transform, which is what turns a tag into a call; prebundled, they would reach the gallery
	// with no jsx transform in front of them.
	optimizeDeps: { exclude: ['@better-giving/operator'] },
	plugins: [react()],
	test: {
		expect: { requireAssertions: true },
		// a spy or fake one test installs is restored before the next runs; vitest 4 leaves this off
		restoreMocks: true,
		// one pool and no second one. every spec in this package is a sweep over files on disk, so
		// there is nothing here that needs a DOM.
		environment: 'node',
		include: ['src/**/*.{test,spec}.ts']
	}
});
