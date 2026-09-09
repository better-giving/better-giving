import type { MiddlewareFunction } from 'react-router';
import { platform } from '../../../context';
import { refuseIfRateLimited } from './rate-limit';

/**
 * what react router hands a server `middleware`, taken off the framework's own type rather than
 * restated — the same shape ../auth/gate.ts takes and for the same reason: a route module's
 * generated `Route.MiddlewareFunction` is this with the route's params filled in, and a shape
 * written out here would be a second copy to keep true.
 */
type MeterArgs = Parameters<MiddlewareFunction<Response>>[0];
type MeterNext = Parameters<MiddlewareFunction<Response>>[1];

/**
 * the bound on `/api/v1`, as a route `middleware` on the surface's own layout.
 *
 * **it is mounted once, on `src/routes/api.v1.ts`, and a route added to that surface inherits it
 * by sitting there.** that placement is the whole decision. a limiter called from each endpoint is
 * allow-by-default in exactly the shape the gate on the protected layout just removed: the
 * endpoint somebody writes without the call is unmetered, it reads like every other endpoint, and
 * nothing at runtime reports it. what is at stake is not a nicety — this surface is public,
 * unauthenticated and payment-initiating (CLAUDE.md), so an unmetered endpoint there is an
 * unbounded D1 read anyone on the internet can issue in a loop.
 *
 * `src/routes.spec.ts` is what holds the mounting: every route served under `/api/v1` is under
 * that layout, and no route beneath it charges a bucket of its own.
 *
 * charged before anything reads, which is where the old hook charged it and why. the read this
 * bounds is the one the endpoint cannot avoid — an id nothing matches still costs a `form` lookup,
 * and by the time a route has been chosen that lookup is already owed. a refused request never
 * reaches a loader, so it never spends it. see ./rate-limit.ts for what a request counts against
 * and why the form id is not part of the key.
 *
 * the preflight is charged too, and is not a special case here because it is not a special case to
 * the router: react router routes `OPTIONS` to the matched route's `loader`, so a preflight runs
 * the same chain as the read it precedes. it is also the cheapest request an attacker can issue
 * and it still costs a `form` lookup.
 *
 * **this middleware never touches `request.body`, and none added beside it may.** it reads the
 * caller's address off a header and nothing else. the processor's callback is on a different
 * surface for a related reason — its signature is computed over the body exactly as sent — and the
 * layout this is mounted on covers `/api/v1` alone, never `/api`.
 *
 * the refusal is returned, and returning it is what stops the endpoint running: react router takes
 * a `Response` returned from a server middleware as the answer and never calls `next()`
 * (`callRouteMiddleware` in react-router's router). the trap is one step to the side of that — a
 * middleware that returns *nothing* has `next()` called for it, so a charge whose refusal is
 * dropped on the floor serves the request as if nothing had happened.
 *
 * Turnstile and the amount bounds CLAUDE.md names alongside CORS and this limit are not here and
 * are not missing: both are decided against a submission's own body and a form record, so they
 * belong to the endpoint that takes one. CORS is likewise per-endpoint, because the echo is built
 * from the form the request named (./cors.ts).
 */
export async function meterPublicApi(
	{ context, request }: MeterArgs,
	next: MeterNext
): Promise<Response> {
	const { env } = context.get(platform);

	const refusal = await refuseIfRateLimited(env.API_RATE_LIMITER, request);
	if (refusal) return refusal;

	return next();
}
