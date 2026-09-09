import { createExecutionContext, env as poolEnv } from 'cloudflare:test';
import { createStaticHandler, isRouteErrorResponse, type RouteObject } from 'react-router';
import { requestContext } from './request-context';

// one request through a route module's own `loader`, `action` and `middleware`, inside workerd
// against the real D1 the pool binds.
//
// **this is the pattern every route spec in this app uses, and it lives here once because nothing
// documents it.** react router documents testing a component with `createRoutesStub`
// (react-router/docs/start/framework/testing.md) and `@cloudflare/vitest-pool-workers` documents
// binding a runtime; neither says how to drive a server route inside the other, and the answer is
// not the obvious one — calling the exported `loader` directly runs the route with no middleware
// above it, which on this app's public api is the whole rate limit and on /admin is the whole
// session gate. a spec written that way passes against an endpoint nothing meters.
//
// so what runs below is what the deployment runs: `createStaticHandler(...).queryRoute(...)`, which
// is the same call `handleResourceRequest` makes inside react router's own server runtime
// (react-router/dist/*/lib/server-runtime/server.js). three details of it are load-bearing and
// each is a thing to get wrong once:
//
// - **`generateMiddlewareResponse` is what turns middleware on.** without that option `queryRoute`
//   runs the matched handler and no middleware at all, and it does so silently — there is no
//   error, only a chain that did not run. it is also the reason a `requestContext` here must be a
//   `RouterContextProvider` rather than a plain object; the framework asserts that.
// - **the target route is the router's to choose, not a spec's.** `queryRoute` takes an optional
//   `routeId` and nothing here passes one, so the route that answers is the deepest one the URL
//   actually matched. that is the claim worth keeping honest: a request to a layout's own path
//   must be answered by the layout, and a spec that named the leaf would answer it with the leaf.
// - **`OPTIONS` reaches the `loader`.** react router sends `GET`, `HEAD` and `OPTIONS` to a
//   route's `loader` and only the mutating methods to its `action`, so a CORS preflight is a
//   loader call — which is why the endpoints on `/api/v1` branch on the method inside one.
//
// what this does not stand in for is the file-system routing above it: the chain a spec states
// here is a list of modules, and nothing in workerd can read ./routes.ts to check it against the
// tree (`flatRoutes` reads the filesystem). ./routes.spec.ts is what holds that half — every route
// served under a surface is under that surface's layout — and the two together are the claim. a
// chain stated here that no longer matches the tree fails there.

/** one route module in a chain, as ./routes.ts resolves the file it came from. */
export interface MountedRoute {
	/**
	 * the path react router resolved for that file, relative to its parent: `api/v1` for the
	 * layout, `forms/:id/config` for the leaf beneath it. `node -e` over ./routes.ts prints them,
	 * and ./routes.spec.ts is what holds the nesting they describe.
	 *
	 * `undefined` for a pathless layout, which is what the protected layout is: it adds no segment
	 * to the address of anything beneath it, and that is the whole of how a gate covers a screen
	 * without appearing in its url.
	 */
	readonly path: string | undefined;
	/**
	 * the module itself, imported the way the route file exports it — `import * as config from
	 * './api.v1.forms.$id.config'`.
	 *
	 * the three handlers are typed as functions and no further, and that is not laziness. a route
	 * module's `loader` is written against its own generated `Route.LoaderArgs`, whose `params` are
	 * the ones its own path guarantees (`{ id: string }`), while the router's `LoaderFunction`
	 * promises only `Params<string>` — so the module is *narrower* than the slot, which under
	 * `strictFunctionTypes` is not assignable. the narrowing is sound exactly when the module is
	 * mounted at the path its file name spells, and that is what ../routes.spec.ts holds. so the
	 * one cast that absorbs it lives in `nest` below, stated once, rather than at every call site.
	 */
	readonly module: {
		readonly middleware?: readonly ((...args: never[]) => unknown)[] | undefined;
		readonly loader?: ((...args: never[]) => unknown) | undefined;
		readonly action?: ((...args: never[]) => unknown) | undefined;
	};
}

/** sends one request into a mounted chain. `env` swaps the deploy-time values for that request. */
export type RouteRequester = (
	request: Request,
	options?: { readonly env?: Env }
) => Promise<Response>;

/**
 * mounts a chain of route modules, outermost first, and answers requests against it.
 *
 * the request context is `requestContext` — the same one src/worker.ts seeds — so a loader takes
 * its bindings and its D1 handle off the context exactly as it does in the deployment. `env`
 * defaults to the pool's own bindings; a case that needs a deploy-time value set or unset passes
 * its own.
 */
export function mountRoutes(chain: readonly MountedRoute[]): RouteRequester {
	const routes = nest(chain);

	return async (request, options = {}) => {
		const handler = createStaticHandler(routes);
		const context = requestContext(options.env ?? poolEnv, createExecutionContext());

		try {
			return asResponse(
				await handler.queryRoute(request, {
					requestContext: context,
					// no `routeId`, so the router picks the match — see this file's header.
					// no `normalizePath` either: that option exists for react router's own `.data`
					// addresses, and a resource route is never asked for at one.
					generateMiddlewareResponse: async (queryRoute) => {
						try {
							return asResponse(await queryRoute(request));
						} catch (error) {
							return errorResponse(error);
						}
					}
				})
			);
		} catch (error) {
			return errorResponse(error);
		}
	};
}

/**
 * the chain as react router's own route objects: each entry the parent of the next.
 *
 * the cast is the variance `MountedRoute` describes, absorbed here so no spec carries one. it is
 * the same widening react router's own build performs when it puts a typed route module into the
 * server bundle's route manifest.
 */
function nest(chain: readonly MountedRoute[]): RouteObject[] {
	const [head, ...rest] = chain;
	if (!head) throw new Error('a route chain needs at least one module');
	const handlers = head.module as Pick<RouteObject, 'middleware' | 'loader' | 'action'>;
	const children = rest.length > 0 ? { children: nest(rest) } : {};
	// left off rather than set to `undefined`: this package sets `exactOptionalPropertyTypes`, and
	// a pathless layout is a route object with no `path` key at all.
	const path = head.path === undefined ? {} : { path: head.path };
	return [{ ...path, ...handlers, ...children }];
}

/**
 * whatever a handler produced, as the response the deployment would send.
 *
 * the same three cases react router's own `handleResourceRequest` handles, in the same order: a
 * `Response` is the answer, a string is a body, and anything else is JSON.
 */
function asResponse(result: unknown): Response {
	if (result instanceof Response) return result;
	if (typeof result === 'string') return new Response(result);
	return Response.json(result);
}

/**
 * a thrown value, as the response the deployment would send.
 *
 * a thrown `Response` is one of the two ways a middleware or a loader short-circuits — the gate
 * throws a redirect rather than returning one — so it is an answer rather than a fault. a route
 * error response is the framework's own 4xx/5xx. anything else is a bug in the code under test,
 * and it answers 500
 * the way the deployment would, with the error's text in the body: a spec whose subject threw
 * should read the reason off the failing assertion rather than off an opaque status.
 */
function errorResponse(error: unknown): Response {
	if (error instanceof Response) return error;
	if (isRouteErrorResponse(error)) {
		return Response.json(error.data, { status: error.status, statusText: error.statusText });
	}
	return new Response(`Unexpected Server Error\n\n${String(error)}`, {
		status: 500,
		headers: { 'content-type': 'text/plain' }
	});
}
