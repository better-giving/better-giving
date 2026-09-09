import { RouterContextProvider } from 'react-router';
import { requestDb } from '$lib/server/db/client';
import { database, platform } from './context';

/**
 * everything a loader, an action or a middleware may reach for, built once for one request.
 *
 * one function rather than a few lines in ./worker.ts, because the worker entry is not the only
 * caller: a spec that drives a route inside the workers pool has to seed the same context the
 * deployment does (./route-request.testing.ts), and a second copy of this is a spec that passes
 * against a request shape no request ever has.
 *
 * what belongs here is what every surface may need and nothing that costs a read. the bindings and
 * the D1 handle qualify — both are allocation only. the session does not: resolving one is two D1
 * reads, and the surfaces that have no session are most of them, so it stays where it is decided,
 * on the gate over the screens that need it ($lib/server/auth/gate.ts).
 *
 * seeded above the router rather than in a `middleware` on the root route. root middleware runs
 * for every route, the payment processor's callback included, and its body must be read exactly
 * once by the handler that owns it (CLAUDE.md) — ./root.tsx's header is where that ban is written.
 */
export function requestContext(env: Env, ctx: ExecutionContext): RouterContextProvider {
	const context = new RouterContextProvider();
	context.set(platform, { env, ctx });
	context.set(database, requestDb(env));
	return context;
}
