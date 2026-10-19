import type { ServerBuild } from 'react-router';
import { createRequestHandler } from 'react-router';
import { INTEGRATIONS_BASE_PATH, readOnlyRefusal } from '$lib/server/integrations/surface';
import { stampClientIp } from '$lib/server/runtime/client-ip';
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
 * ($lib/server/runtime/client-ip.ts states the rule it feeds).
 */
export function createApp(runtime: Runtime, trustedProxyHeader: string | undefined): App {
	return async (request, peer) => {
		if (unroutedOnReadApi(request)) return readOnlyRefusal(request.method);
		stampClientIp(request, peer, trustedProxyHeader);
		return handleRequest(request, requestContext(runtime));
	};
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
