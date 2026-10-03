import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { routeFiles } from './vite/route-files';
import { versionDefine } from './version-define';

// how this app is built and how it is served in dev, and both run in workerd.
//
// `cloudflare()` is what puts the worker runtime under the dev server: it reads ./wrangler.jsonc,
// binds D1 and the four rate limiters through miniflare, and persists their state to
// .wrangler/state — the same place `wrangler d1 migrations apply --local` writes, so the local
// database is shared and survives a restart. it must come before `reactRouter()`, which builds the
// server bundle the worker entry loads.
//
// the build writes into build/ and, beside it, a deploy configuration redirection at
// .wrangler/deploy/config.json naming the generated config `wrangler deploy` then uploads.
// scripts/preflight-deploy.js reads both, and its header is where that chain is argued.
//
// the port `pnpm dev` serves on is pinned rather than left to vite's default because the app
// spells the dev address out: `trustedOrigins` in src/lib/server/auth/index.ts lists it, and
// better-auth refuses a sign-in POST from an origin that is not in that list. `strictPort` makes a
// collision fail loudly instead of moving the server to a port nothing expects. 5322 is
// packages/console-ui's dev server and 5323 is packages/gallery's (each package's own
// vite.config.ts), so all three run side by side.
const DEV_PORT = 5321;

// the Workers AI binding has no local simulator, and a remote session for it needs a Cloudflare
// sign-in the dev server would otherwise die without. so `pnpm dev` opens none unless
// `BETTER_GIVING_REMOTE_AI=1` is set: without it the binding is miniflare's stand-in, whose every
// call throws, and src/lib/server/ai/generate.ts answers that as the binding being absent.
// CONTRIBUTING.md (Setup) says how to opt in. it reaches no build: a build binds from
// ./wrangler.jsonc whatever this says.
const REMOTE_AI = process.env.BETTER_GIVING_REMOTE_AI === '1';

export default defineConfig({
	server: { port: DEV_PORT, strictPort: true },
	// the release this build was cut from, or `null` where its environment named none.
	// ./version-define.ts is where the name, the reading and the type are stated together.
	define: versionDefine,
	// static/ rather than vite's default public/: it is where scripts/stage-embed.js puts the
	// donation form's embed, and vite copies this directory into the client build whole. the chain
	// that reaches a pasted snippet runs through here — CLAUDE.md states its three steps and
	// scripts/preflight-deploy.js counts what lands.
	publicDir: 'static',
	resolve: {
		// `$lib`, which most of src/ already imports through. declared here rather than left to a
		// plugin because ./tsconfig.json declares the same alias and nothing joins the two.
		alias: { $lib: resolve(import.meta.dirname, 'src/lib') }
	},
	plugins: [
		cloudflare({ viteEnvironment: { name: 'ssr' }, remoteBindings: REMOTE_AI }),
		reactRouter(),
		// `virtual:route-files`, which src/lib/page/slug.ts reads instead of an `import.meta.glob`
		// over ./src/routes/ — ./vite/route-files.ts's header argues why.
		routeFiles(resolve(import.meta.dirname, 'src/routes'))
	]
});
