import type { Config } from '@react-router/dev/config';

// what react router is told about this app, and the whole of it is two facts.
//
// `appDirectory` is `src` rather than the default `app` because everything else in this package
// already reads that name: `$lib` is src/lib (./tsconfig.json), every spec pool globs `src/**`
// (./vitest.config.ts), and the styles chain enters at src/app.css.
//
// no preset is listed and none belongs. the server entry is ./server/index.ts, which serves the
// build ./vite.config.ts writes, and in dev runs vite in middleware mode over the same config.
export default {
	appDirectory: 'src',
	// every screen reads the database and the server env through a loader, and none of that can run in a
	// browser.
	ssr: true
} satisfies Config;
