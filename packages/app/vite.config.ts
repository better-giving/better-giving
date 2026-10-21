import { reactRouter } from '@react-router/dev/vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { routeFiles } from './vite/route-files';
import { versionDefine } from './version-define';

// how this app is built, and the vite half of `pnpm dev`.
//
// the build writes the browser's files into build/client/ and the server bundle into
// build/server/index.js, whose entry is ./src/server/app.ts rather than react router's own server
// build: that module wraps the router in what the server entry hands it per request
// (./server/start.ts). `pnpm dev` runs ./server/index.ts, which starts vite in middleware mode over
// this same file, so dev and the build share one config.

export default defineConfig({
	environments: {
		ssr: { build: { rollupOptions: { input: './src/server/app.ts' } } }
	},
	// the release this build was cut from, or `null` where its environment named none.
	// ./version-define.ts is where the name, the reading and the type are stated together.
	define: versionDefine,
	// static/ rather than vite's default public/: it is where scripts/stage-embed.js puts the
	// donation form's embed, and vite copies this directory into the client build whole. the chain
	// that reaches a pasted snippet runs through here — AGENTS.md states its three steps.
	publicDir: 'static',
	resolve: {
		// `$lib`, which most of src/ already imports through. declared here rather than left to a
		// plugin because ./tsconfig.json declares the same alias and nothing joins the two.
		alias: { $lib: resolve(import.meta.dirname, 'src/lib') }
	},
	plugins: [
		reactRouter(),
		// `virtual:route-files`, which src/lib/page/slug.ts reads instead of an `import.meta.glob`
		// over ./src/routes/ — ./vite/route-files.ts's header argues why.
		routeFiles(resolve(import.meta.dirname, 'src/routes'))
	]
});
