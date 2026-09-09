import type { MiddlewareFunction } from 'react-router';
import { consoleSession, platform } from '../../../context';
import { consoleAccess } from './access';
import { consoleRefusalResponse } from './surface';

/**
 * what react router hands a server `middleware`, taken off the framework's own type rather than
 * restated — the same shape ../auth/gate.ts and ../api/meter.ts take, and for the same reason: a
 * route module's generated `Route.MiddlewareFunction` is this with the route's params filled in,
 * and a shape written out here would be a second copy to keep true.
 */
type ConsoleGateArgs = Parameters<MiddlewareFunction<Response>>[0];
type ConsoleGateNext = Parameters<MiddlewareFunction<Response>>[1];

/**
 * the check in front of the operator console's surface, as a route `middleware` on that surface's
 * own layout.
 *
 * **it is mounted once, on `src/routes/console.ts`, and a route added under `/console` inherits it
 * by sitting there.** that placement is the whole decision, and it is the same one the other two
 * surfaces take one category over: a check each route called would be allow-by-default, so the
 * route somebody writes without the call is served to anyone, reads like every other route on the
 * surface, and nothing at runtime reports it. `src/routes.spec.ts` holds the mounting — every
 * route served under `/console` is under that layout, and none of them checks a credential of its
 * own.
 *
 * what the check proves, what the credential is and why every refusal is 401 are ./access.ts's and
 * are not restated here. what this file owns is where it runs and what a route gets afterwards.
 *
 * **it never touches `request.body`, and none added beside it may.** it reads `platform.env` and
 * one header. that is CLAUDE.md's rule — the body is read exactly once, by the endpoint that owns
 * it — and it is also why the credential is a bearer header rather than a signature over the body:
 * a check above the endpoint cannot read bytes the endpoint has yet to parse.
 *
 * it runs before the D1 handle is touched and before anything is built from a credential, which is
 * what makes a wrong token cost no read and no binding call — and that, rather than a limiter, is
 * what bounds a caller guessing at a 256-bit value. ./surface.ts is where that contingency is
 * written down.
 *
 * the refusal is returned, and returning it is what stops the route running: react router takes a
 * `Response` returned from a server middleware as the answer and never calls `next()`. the trap is
 * one step to the side of that — a middleware that returns *nothing* has `next()` called for it,
 * so a refusal dropped on the floor serves the request as if the check had passed.
 *
 * no session is resolved and no auth instance is built. there is no cookie on this surface and
 * nothing may read one, so the signing key read that the gate over the screens pays for is not
 * paid here (../auth/gate.ts).
 */
export async function consoleGate(
	{ context, request }: ConsoleGateArgs,
	next: ConsoleGateNext
): Promise<Response> {
	const { env } = context.get(platform);

	const access = consoleAccess(env, request.headers, new Date());
	if (!access.ok) return consoleRefusalResponse(access.refusal);

	// the expiry and nothing else goes down to the routes: the token stays in this function, so no
	// route on the surface is able to answer with it (src/context.ts).
	context.set(consoleSession, access.session);
	return next();
}
