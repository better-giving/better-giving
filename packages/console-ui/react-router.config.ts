import type { Config } from '@react-router/dev/config';

// what react router is told about this app, and the whole of it is two facts.
//
// `appDirectory` is `src` rather than the default `app` because everything else in this package
// already reads that name: src/never-deployed.spec.ts and src/raw-values.spec.ts are both sweeps
// over src/, and the styles chain enters at src/app.css.
//
// **no preset is listed here, and none belongs.** a preset is what configures a react router build
// on a hosting platform's behalf. the build writes the client bundle the go binary embeds
// (packages/console/ui/embed.go), and what makes that an asset rather than a deployment is that
// nothing here names a platform to run it on and no server package could serve it.
// src/never-deployed.spec.ts holds those absences.
export default {
	appDirectory: 'src',
	// **nothing on this surface is served, and `false` is what makes that structural.** every read
	// and every press is a call to the go binary on the loopback address (src/api/client.ts), which
	// is what holds the cloudflare sign-in and does the work — so a route module here carries a
	// `clientLoader` and a `clientAction` and never the server halves, and the build writes the
	// static bundle that binary embeds (packages/console/ui/embed.go). src/never-deployed.spec.ts
	// holds this line, because a `true` here would write a request handler nothing in this package
	// could run.
	ssr: false
} satisfies Config;
