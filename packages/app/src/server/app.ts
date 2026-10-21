import type { ServerBuild } from 'react-router';
import { createRequestHandler } from 'react-router';
import { readStaffCredential } from '$lib/server/auth/credential';
import { readAuthEnv } from '$lib/server/auth/env';
import { INTEGRATIONS_BASE_PATH, readOnlyRefusal } from '$lib/server/integrations/surface';
import { createDb } from '$lib/server/db/client';
import { stampClientIp } from '$lib/server/runtime/client-ip';
import { withForwardedProto } from '$lib/server/runtime/forwarded-proto';
import { type Scheduler, startScheduler } from '$lib/server/runtime/scheduler';
import { CRON_RUNS } from '../cron-runs';
import { type Runtime, requestContext } from '../request-context';

// the router half of the server: what every request ../../server/start.ts does not answer from a
// static file reaches. this module is the server bundle's entry (`environments.ssr` in
// ../../vite.config.ts), so the build writes it to build/server/index.js, and `pnpm dev` loads it
// through vite.
//
// one request context is built per request from what the process built at start, so nothing
// downstream reads configuration off a module. what goes into it is ../request-context.ts's, so
// that a spec can seed the same one; ../context.ts is where the rule is written.
//
// `import.meta.env.MODE` is what tells react router whether to serve an error to the browser or
// swallow it: `development` renders the stack, anything else does not.

const handleRequest = createRequestHandler(
	// asserted for one field. `exactOptionalPropertyTypes` (../../../../tsconfig.base.json) makes
	// `basename?: string` and `basename: string | undefined` different types, and react router
	// declares the first on `ServerBuild` and the second on this virtual module. the module is
	// written by the build rather than by anything here, so the difference is absorbed at the one
	// call site instead of by loosening the flag for the whole package.
	() => import('virtual:react-router/server-build') as Promise<ServerBuild>,
	import.meta.env.MODE
);

/** one request in, its answer out. `peer` is the TCP peer address, `null` where there was none. */
export type App = (request: Request, peer: string | null) => Promise<Response>;

/**
 * the app over `runtime`. `trustedProxyHeader` is `TRUSTED_PROXY_HEADER` as configured
 * ($lib/server/runtime/client-ip.ts and forwarded-proto.ts state the rules it feeds).
 */
export function createApp(runtime: Runtime, trustedProxyHeader: string | undefined): App {
	return async (arrived, peer) => {
		if (unroutedOnReadApi(arrived)) return readOnlyRefusal(arrived.method);
		const request = withForwardedProto(arrived, trustedProxyHeader);
		stampClientIp(request, peer, trustedProxyHeader);
		return handleRequest(request, requestContext(runtime));
	};
}

/**
 * why the process must not serve on `env`, or `null`: a set `ADMIN_PASSWORD` sign-in would refuse
 * (`readStaffCredential` in $lib/server/auth/credential.ts). read here rather than in
 * ../../server/index.ts because the entry runs from source and the root `Dockerfile`'s runtime
 * stage copies no workspace package, while the bundle inlines the ones this reads.
 */
export function startRefusal(env: Env): string | null {
	const staff = readStaffCredential(readAuthEnv(env));
	return staff.ok ? null : staff.message;
}

/**
 * fires ../cron-runs.ts's table on its schedule, each run on a database handle of its own and on
 * `runtime`'s deferred-work tracker, so shutdown waits for a run in flight.
 */
export function startCron(runtime: Runtime): Scheduler {
	const { env, deferred, client } = runtime;
	const runs = Object.fromEntries(
		Object.entries(CRON_RUNS).map(([expression, run]) => [
			expression,
			(now: Date) => run(env, createDb(client), now)
		])
	);
	return startScheduler(runs, deferred);
}

/**
 * the methods react router's server runtime routes: any other it answers with its own 405 before
 * a middleware runs (`isValidMethod` in react-router/dist/development/lib/router/router.js, which
 * upper-cases the method first).
 */
const ROUTED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * whether `request` asks the read API with a method react router never routes, so that the
 * surface's own 405 is answered in place of the framework's (src/routes/integrations.v1.ts).
 */
function unroutedOnReadApi(request: Request): boolean {
	if (ROUTED_METHODS.has(request.method.toUpperCase())) return false;
	const { pathname } = new URL(request.url);
	if (!pathname.startsWith(INTEGRATIONS_BASE_PATH)) return false;
	// the prefix itself, a path beneath it, or its `.data` address; not `/integrations/v10`.
	return /^(?:$|[/.])/.test(pathname.slice(INTEGRATIONS_BASE_PATH.length));
}
