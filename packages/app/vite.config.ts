import { reactRouter } from '@react-router/dev/vite';
import { resolve } from 'node:path';
import { type Alias, defineConfig } from 'vite';
import { routeFiles } from './vite/route-files';
import { versionDefine } from './version-define';

// how this app is built, and the vite half of `pnpm dev`.
//
// the build writes the browser's files into build/client/ and the server bundle into
// build/server/index.js, whose entry is ./src/server/app.ts rather than react router's own server
// build: that module wraps the router in what the server entry hands it per request
// (./server/start.ts). `pnpm dev` runs ./server/index.ts, which starts vite in middleware mode over
// this same file, so dev and the build share one config.

// the design registry's `variables.css` writes `@import "./fonts.css"`, and neither lock
// (bg-design.json, packages/form/bg-design.json) copies the registry's `fonts` item, so in both
// copies that reach this build, packages/operator's through src/app.css and packages/form's through
// the form's tokens.css, the import names no file and the build fails on it. this alias resolves it
// to an empty sheet, so the copied files stay as the registry wrote them, which `pnpm design:check`
// holds. faces come from elsewhere: /admin and the donor pages from
// packages/operator/src/styles/fonts.css, and the form loads none (AGENTS.md, "one look, one
// source"). an alias rather than a plugin, because vite resolves a css `@import` through its alias
// table alone; the specifier is matched whole, from any importer, so a copied `fonts` item that
// lands as a sibling `./fonts.css` is emptied by it too.
const noRegistryFaces: Alias = {
	find: /^\.\/fonts\.css$/,
	replacement: resolve(import.meta.dirname, 'vite/no-registry-faces.css')
};

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
		alias: [{ find: '$lib', replacement: resolve(import.meta.dirname, 'src/lib') }, noRegistryFaces]
	},
	plugins: [
		reactRouter(),
		// `virtual:route-files`, which src/lib/page/slug.ts reads instead of an `import.meta.glob`
		// over ./src/routes/ — ./vite/route-files.ts's header argues why.
		routeFiles(resolve(import.meta.dirname, 'src/routes'))
	]
});
