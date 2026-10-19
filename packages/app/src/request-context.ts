import type { Client } from '@libsql/client';
import { RouterContextProvider } from 'react-router';
import { createDb } from '$lib/server/db/client';
import type { Deferred } from '$lib/server/runtime/deferred';
import { database, platform } from './context';

/**
 * what the process built at start and every request shares: the configuration, the deferred-work
 * tracker, the database client.
 */
export interface Runtime {
	readonly env: Env;
	readonly deferred: Deferred;
	readonly client: Client;
}

/**
 * everything a loader, an action or a middleware may reach for, built once for one request.
 *
 * one function rather than a few lines in ./server/app.ts, because the server entry is not the only
 * caller: a spec that drives a route has to seed the same context the deployment does
 * (./route-request.testing.ts), and a second copy of this is a spec that passes against a request
 * shape no request ever has.
 *
 * what belongs here is what every surface may need and nothing that costs a read. the configuration
 * and the database handle qualify — both are allocation only. the session does not: resolving one
 * is two database reads, and the surfaces that have no session are most of them, so it stays where
 * it is decided, on the gate over the screens that need it ($lib/server/auth/gate.ts).
 *
 * seeded above the router rather than in a `middleware` on the root route. root middleware runs
 * for every route, the payment processor's callback included, and its body must be read exactly
 * once by the handler that owns it (CLAUDE.md) — ./root.tsx's header is where that ban is written.
 */
export function requestContext({ env, deferred, client }: Runtime): RouterContextProvider {
	const context = new RouterContextProvider();
	context.set(platform, { env, deferred });
	context.set(database, createDb(client));
	return context;
}
