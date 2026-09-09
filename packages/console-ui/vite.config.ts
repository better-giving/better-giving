import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vitest/config';

// the operator console's dev server and its test pool, and the build that writes the ui a binary
// carries.
//
// **what the build writes is a static client bundle, and nothing here targets a platform.** the go
// binary embeds that bundle and serves it (packages/console/ui/embed.go), so the build's output is
// an asset rather than something a host runs: ../react-router.config.ts says `ssr: false`, so the
// build writes `build/client/index.html` and the modules under it, and every read and press in
// them is a call to that binary. what lands in `build/server/` is the module react router renders
// that one document with, at build time — a step's own input rather than a service, and this
// package declares nothing that could run it: no server package, and no preset naming a platform.
// src/never-deployed.spec.ts holds those absences.
//
// the port is pinned so that `pnpm run console` opens the same address every time, and `strictPort`
// is what makes a second copy fail loudly rather than move itself to a port the first one's tab is
// not on. 5321 is packages/app's dev server, 5323 is packages/gallery's and 5324 is packages/form's
// (each package's own vite.config.ts), so all four run side by side.
const DEV_PORT = 5322;

// where the go half of the console answers under `pnpm run console`, which runs the two together.
//
// **vite proxies to go rather than go proxying vite, and the direction is what keeps one origin.**
// the browser holds one page on this port, so a fetch to `/api` is same-origin and carries no cors
// question at all — which is the arrangement the deployed binary has for real, with the ui served
// from the same process.
//
// **the entry is an object so that `changeOrigin` can be stated, and the string shorthand would
// flip it.** vite turns `'/api': '<target>'` into `{ target, changeOrigin: true }` and leaves an
// object form alone, so the shorthand — the shorter thing to write here — rewrites `Host` to this
// target while forwarding the browser's `Origin` untouched. packages/console/internal/server
// compares exactly those two, so under the shorthand every `/api` call in dev would arrive claiming
// an origin that is not the host it reached, and be refused 403. written out, the request reaches
// go announcing the host the browser used, and the same guard that holds for the binary holds here
// with nothing relaxed for dev.
//
// 5325 rather than the four above it: those are dev servers a contributor may have running, and a
// collision would be silent — vite's proxy reports a refused connection as a 500 on the fetch.
const API_PORT = 5325;

export default defineConfig({
	server: {
		port: DEV_PORT,
		strictPort: true,
		proxy: { '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false } }
	},
	// the components this console renders are workspace-linked `.jsx` — packages/operator's,
	// imported directly. excluded from the dependency prebundler, they stay source and reach this
	// project's own transform, which is what turns a tag into a call; prebundled, they would reach
	// the console with no jsx transform in front of them.
	//
	// the four below are the opposite case: real dependencies, reached only through the bare imports
	// inside those excluded components, so the prebundler does not meet one until a screen asks for
	// it. a dependency discovered mid-session is what makes vite re-optimise and reload the
	// document, and a reload drops whatever was typed into an open fold — naming them here moves
	// that to startup, once, before anyone is holding a form.
	//
	// **each is written `@better-giving/operator > name` and a bare `name` does not work.** these
	// are packages/operator's dependencies and this package declares none of them, so pnpm's layout
	// leaves them out of packages/console-ui/node_modules entirely and vite resolves a bare id from
	// this package's own root — it reports `failed to resolve dependency ... present in client
	// 'optimizeDeps.include'` at startup and prebundles nothing. the `>` form is vite's path for a
	// nested dependency of an excluded package, which is what the `exclude` above makes this one.
	// keep the list level with the bare imports packages/operator's components actually make.
	//
	// a reload can still arrive from outside this file, and no screen may be written as though it
	// could not: vite's browser client reloads the document by itself whenever the dev server's
	// socket drops, and reports that only in the browser's own console, never in the terminal.
	optimizeDeps: {
		exclude: ['@better-giving/operator'],
		include: [
			'@better-giving/operator > @ark-ui/react/hover-card',
			'@better-giving/operator > @ark-ui/react/popover',
			'@better-giving/operator > @ark-ui/react/portal',
			'@better-giving/operator > lucide-react'
		]
	},
	plugins: [reactRouter()],
	test: {
		expect: { requireAssertions: true },
		// a spy or fake one test installs is restored before the next runs; vitest 4 leaves this off
		restoreMocks: true,
		// a stubbed global is restored before the next test runs too
		unstubGlobals: true,
		// one pool and no second one. every spec in this package reads files off disk — the two
		// gates in src/ are both sweeps over the tree, and the ledger's is a read of one screen —
		// so there is nothing here that needs a DOM, and a `*.workers.spec.ts` is unrepresentable:
		// this package binds nothing and touches no database.
		environment: 'node',
		include: ['src/**/*.{test,spec}.ts']
	}
});
