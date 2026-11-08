import { reactRouter } from '@react-router/dev/vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { routeFiles } from './vite/route-files';
import { versionDefine } from './version-define';

// how this app is built, and the vite half of `pnpm dev`.
//
// the build writes the browser's files into build/client/ and the server bundle into
// build/server/index.js, whose entry is ./src/server/app.ts rather than react router's own server
// build: that module wraps the router in what the server entry hands it per request
// (./server/start.ts). `pnpm dev` runs ./server/index.ts, which starts vite in middleware mode over
// this same file, so dev and the build share one config.

// the form's tokens.css `@import`s the registry's `variables.css`, whose own `@import "./fonts.css"`
// is the 35-face sheet; the form takes the six-face subset instead (packages/form/vite.registry-faces.ts
// states why). the same swap here, but only for the form's copy: packages/operator's variables.css
// imports the same specifier and keeps the full sheet for /admin, so the form's alias would reach it
// too. vite resolves a css `@import` through its alias table alone (a plugin's resolveId never sees
// it, and an alias `customResolver` is deprecated) and reads an imported file from disk without a
// transform, so the one import that reaches the form's variables.css is replaced by that file's text
// with the faces import repointed. the form's directory is found through its exported tokens.css,
// since a relative path into packages/form is refused (biome.jsonc).
const formStyles = dirname(
	createRequire(import.meta.url).resolve('@better-giving/form/styles/tokens.css')
);
const formVariablesImport = "@import '../registry/styles/variables.css';";
const formRegistryFaces: Plugin = {
	name: 'form-registry-faces',
	enforce: 'pre',
	transform(code, id) {
		const [path, query] = id.split('?');
		// `?url` is a js stub naming the sheet; the css itself arrives as `?transform-only`.
		if (path !== resolve(formStyles, 'tokens.css') || query === 'url') return null;
		if (!code.includes(formVariablesImport)) {
			this.error(`the form's tokens.css no longer holds ${formVariablesImport}`);
		}
		const registry = resolve(formStyles, '../registry/styles');
		const variables = readFileSync(resolve(registry, 'variables.css'), 'utf8').replace(
			/@import "\.\/(fonts|colors)\.css";/g,
			(_, name) => `@import "${resolve(registry, name === 'fonts' ? 'fonts-core' : name)}.css";`
		);
		return code.replace(formVariablesImport, variables);
	}
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
		alias: { $lib: resolve(import.meta.dirname, 'src/lib') }
	},
	plugins: [
		formRegistryFaces,
		reactRouter(),
		// `virtual:route-files`, which src/lib/page/slug.ts reads instead of an `import.meta.glob`
		// over ./src/routes/ — ./vite/route-files.ts's header argues why.
		routeFiles(resolve(import.meta.dirname, 'src/routes'))
	]
});
