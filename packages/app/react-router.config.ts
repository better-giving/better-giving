import type { Config } from '@react-router/dev/config';

// what react router is told about this app, and the whole of it is two facts.
//
// `appDirectory` is `src` rather than the default `app` because everything else in this package
// already reads that name: `$lib` is src/lib (./tsconfig.json), every spec pool globs `src/**`
// (./vitest.config.ts), and the styles chain enters at src/app.css.
//
// no preset is listed and none belongs. what runs this app on cloudflare is
// `@cloudflare/vite-plugin` in ./vite.config.ts, which builds the worker entry ./wrangler.jsonc
// names and serves it in workerd in dev as well as in the build.
export default {
	appDirectory: 'src',
	// every screen reads D1 and the platform env through a loader, and none of that can run in a
	// browser.
	ssr: true
} satisfies Config;
