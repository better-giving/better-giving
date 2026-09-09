import { meterPublicApi } from '$lib/server/api/meter';
import type { Route } from './+types/api.v1';

// the layout every route on the public api sits under, and the one place the surface's limit is
// charged.
//
// it is served at `/api/v1`, so a route file named `api.v1.<anything>` nests beneath it and
// inherits the middleware below by existing. **that is what makes the bound a property of the
// surface rather than of the endpoints somebody remembered** — the alternative, a limiter each
// endpoint calls, leaves the next endpoint unmetered the day it is written with nothing reporting
// it. $lib/server/api/meter.ts argues that at length and ../routes.spec.ts is what holds it:
// every route served under `/api/v1` is under this file, and none of them charges a bucket of its
// own.
//
// this surface is public, unauthenticated and payment-initiating, and CLAUDE.md names four things
// an endpoint here owes: CORS from the form's own `allowed_origins`, rate limiting, Turnstile, and
// amount bounds re-read from the form record. the limit is the one that is the same question for
// every route, so it is the one that lives here. the other three are decided against the form the
// request named or the body it carried, so each endpoint owes its own.
//
// no session anywhere under here. nothing may read `context.get(staff)` — there is no
// value to get, since the gate that sets one is mounted on a layout this surface is not under
// (../context.ts).

export const middleware: Route.MiddlewareFunction[] = [meterPublicApi];

/**
 * the bare surface address, which is a route react router matches whether or not anyone meant it
 * to be one: a layout with a path of its own is a branch in the route tree, so `/api/v1` resolves
 * to this file with no child beneath it. without a loader here the framework answers it 400,
 * quoting its own internal message about a route id nobody outside this repository has heard of —
 * which on a public surface is a caller who trimmed a URL being told they made a bad request.
 *
 * 404 and a sentence naming the surface, because a caller here is a person or an agent exploring —
 * the embedded form never asks for this address. no `error` code, for the reason the limiter's
 * refusal mints none: `API_ERROR_CODES` in packages/form/src/v1.ts is a permanent wire vocabulary
 * whose members each name the screen that fixes them, and no screen fixes a URL with nothing at
 * the end of it.
 *
 * no CORS headers, and there are none to give: the echo on this surface is built from one form's
 * `allowed_origins` (../lib/server/api/cors.ts) and this address names no form. that is the same
 * trade the config endpoint's own not-found answer takes.
 *
 * it does not double as the surface's 404. a path under `/api/v1` that no route claims matches
 * nothing at all, so it never reaches this file and never reaches the meter either — which is
 * exactly the shape the retired hook had, and the reason it is worth saying: an unmatched path is
 * the cheapest unmetered request this deployment answers, and it costs no read.
 */
export function loader(_: Route.LoaderArgs): Response {
	return Response.json(
		{
			message:
				'There is nothing served at /api/v1 itself. It is the prefix every endpoint on this deployment’s public API sits under.',
			fix: 'Call an endpoint on it, such as GET /api/v1/forms/{formId}/config.'
		},
		{ status: 404, headers: { 'cache-control': 'no-store' } }
	);
}
