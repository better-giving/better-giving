import { defineConfig } from 'vite';

// the donation form's dev page, and nothing that produces an artifact.
//
// ./package.json's `build` names ./vite.embed.config.ts explicitly on both of its two passes, so
// this file is reached only by a bare `vite` — which is what `dev` runs and what nothing else
// runs. the embed the app serves is built by that other config and staged into packages/app by
// packages/app/scripts/stage-embed.js, and neither step reads this file or ./index.html.
//
// no `test` block either: vitest resolves ./vitest.config.ts ahead of this file and does not merge
// the two, so the `server` and `dom` projects declared there are still the whole of `pnpm test`.
//
// the port is pinned so `pnpm run form` opens the same address every time, and `strictPort` is what
// makes a second copy fail loudly rather than move itself to a port the first one's tab is not on.
// 5321 is packages/app's dev server (packages/app/server/index.ts) and 5323 is packages/gallery's
// (each package's own vite.config.ts), so all three run side by side.
const DEV_PORT = 5324;

export default defineConfig({
	server: { port: DEV_PORT, strictPort: true }
});
