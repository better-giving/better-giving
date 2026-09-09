import { createContext } from 'react-router';
// types and nothing else, so no server module is pulled into a bundle by this import — the app's
// own tsconfig sets `verbatimModuleSyntax`, which makes `import type` erase verbatim.
import type { Auth } from '$lib/server/auth';
import type { ConsoleSession } from '$lib/server/console/access';
import type { Db } from '$lib/server/db/client';

/**
 * the platform a request arrived on, as a react router request context.
 *
 * **this is how a loader or an action reaches a binding, and the only way.** src/worker.ts seeds
 * it once per request from the `fetch` handler's own arguments and hands it to
 * `createRequestHandler`; a loader takes it back with `context.get(platform)`. a handle built from
 * a binding — the D1 client, the auth instance, the stripe client — is constructed per request and
 * seeded into this same provider, never assigned at module scope: a module-scope value put into a
 * context satisfies the type and breaks the rule silently, because **the context is the delivery
 * mechanism and not the lifetime.** CLAUDE.md is where that ban is argued.
 *
 * a `RouterContext` rather than a plain object because that is the only shape a route
 * `middleware` can add to: middleware hands a resolved value down to the loaders beneath it with
 * `context.set(...)` on this same provider, and a seam of any other shape cannot be extended
 * without being rebuilt. that is also why the seeding is in the worker entry, above the router,
 * rather than in a `middleware` on the root route — root middleware runs for every route,
 * including the payment processor's callback, whose body must be read exactly once by the handler
 * that owns it.
 */
export const platform = createContext<{
	readonly env: Env;
	readonly ctx: ExecutionContext;
}>();

/**
 * the database handle for this request, built once in src/request-context.ts.
 *
 * **it is set for every request this app answers, and no route builds one of its own.** the rule
 * it keeps is CLAUDE.md's: `db/client.ts` is the only module that names the binding, and a handle
 * built per route is that name written once per route, on a growing number of routes.
 *
 * it is seeded in the entry beside `platform` rather than by a `middleware`, and that placement is
 * the whole of it: a middleware sets nothing for a route outside the layout it is mounted on, and
 * the surfaces needing a handle most sit outside every layout there is — the public api, the
 * processor's callback, the console wire surface. so a loader takes it with `context.get(database)`
 * whatever surface it is on.
 *
 * the cost is one drizzle wrapper allocated for a request that never reads: no binding call and no
 * I/O, which is what the D1 handle is — see `requestDb` in $lib/server/db/client.ts.
 */
export const database = createContext<Db>();

/**
 * the signed-in staff user, resolved once by the gate on the protected layout.
 *
 * set by `staffGate` in src/lib/server/auth/gate.ts and read by the loaders beneath it. it has no
 * `null` case and that is the point: a loader under the layout cannot be reached by an anonymous
 * request, so a session it had to narrow would be a branch nothing can take. outside the layout
 * there is no value to get, which is what makes "resolve the session in one place" a shape rather
 * than a habit.
 */
export const staff = createContext<Auth['$Infer']['Session']['user']>();

/**
 * the auth instance the gate built for this request, for the one thing a route beneath it still
 * has to ask auth to do: end the session.
 *
 * it rides the same hand-down as `staff` above and for the same reason. building one takes the
 * signing key, which is normally a D1 row ($lib/server/auth/signing-key.ts), and the gate has
 * already read it and already constructed the instance — so a route that built its own would pay
 * for the row twice and would also be resolving auth of its own, which `src/routes.spec.ts`
 * refuses for every route under the layout.
 *
 * there is no `null` case here either: the only routes that can reach it are the ones the gate ran
 * for.
 */
export const auth = createContext<Auth>();

/**
 * what a caller on the console surface proved, resolved once by the check on that surface.
 *
 * set by `consoleGate` in src/lib/server/console/gate.ts and read by the three routes beneath it.
 * it carries when the session ends and nothing else — **the token itself never leaves the gate**,
 * so no route can compare it, log it or answer with it, and a route added beside them inherits
 * that by taking this value.
 *
 * no `null` case, for the reason `staff` above has none: a route on that surface cannot be reached
 * by a caller the check refused. it is a separate context from `staff` rather than a widening of
 * it because the two are different proofs — a session cookie against a bearer credential — and a
 * screen that could narrow one into the other is a screen able to be entered by the wrong one.
 */
export const consoleSession = createContext<ConsoleSession>();
