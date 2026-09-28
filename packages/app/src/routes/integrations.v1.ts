import {
	integrationsCallerRateLimitKey,
	integrationsKeyRateLimitKey,
	isRateLimited
} from '$lib/server/api/rate-limit';
import {
	admitKey,
	callerRateLimitRefusal,
	integrationsRefusal,
	keyRateLimitRefusal,
	readOnlyRefusal
} from '$lib/server/integrations/surface';
import { touchLastUsed } from '$lib/server/integrations/keys';
import { database, integrationsKey, platform } from '../context';
import type { Route } from './+types/integrations.v1';

// the layout every route of the read API sits under, and the one place the method and the key are
// checked.
//
// a route file named `integrations.v1.<anything>` nests beneath it and inherits both checks by
// existing, the mounting ./zapier.ts and ./console.ts make for their own credentials and for the
// same reason: a check each route called leaves the next route open the day it is written.
// ../routes.spec.ts holds that every route served under `/integrations/v1` is under this file.
//
// what the surface is and what every answer on it carries is $lib/server/integrations/surface.ts's
// header. neither check reads the body.
//
// a request that passes the method check is charged twice, and where each charge sits is what it
// bounds:
//
// - **per address, first**, on `API_RATE_LIMITER` under this surface's own key
//   (`integrationsCallerRateLimitKey` in $lib/server/api/rate-limit.ts), for every request and
//   ahead of the key lookup — so it bounds what one address costs before anything is known about
//   it: the indexed read each well-formed key costs, and so guessing. that binding counts 600 a
//   minute against a key's 120, so it reaches a real key only when one address runs more than five
//   keys flat out. callers the edge attributes no address to share one bucket, as on `/api/v1`.
// - **per key, once admitted**, on `INTEGRATIONS_KEY_RATE_LIMITER` under the key's row id
//   (`integrationsKeyRateLimitKey`) — how fast one key reads the database, from however many
//   addresses it is presented, with two keys on one host holding two budgets. it cannot be charged
//   before the lookup that names the key, and that lookup is the read the charge above bounds.
//
// both fail open, as `isRateLimited` argues.
//
// the admitted row goes down on the context (`integrationsKey` in ../context.ts). when the key was
// last used is recorded after the answer, through `waitUntil`, at most once a minute per key and
// decided on the row the lookup already read, so a key used within the minute costs no statement
// (`touchLastUsed` in $lib/server/integrations/keys.ts).

/**
 * GET and HEAD, and nothing else. react router hands OPTIONS to a loader and every other method to
 * an action, so without this a route with no action would answer a write with the framework's own
 * 405 and no `Allow`, and a keyed OPTIONS would read the loader.
 */
const readOnly: Route.MiddlewareFunction = ({ request }, next) =>
	request.method === 'GET' || request.method === 'HEAD' ? next() : readOnlyRefusal(request.method);

const keyGate: Route.MiddlewareFunction = async ({ context, request }, next) => {
	const { env, ctx } = context.get(platform);
	const db = context.get(database);
	if (await isRateLimited(env.API_RATE_LIMITER, integrationsCallerRateLimitKey(request)))
		return callerRateLimitRefusal();
	const admitted = await admitKey(db, request.headers.get('authorization'));
	if (admitted instanceof Response) return admitted;
	if (
		await isRateLimited(env.INTEGRATIONS_KEY_RATE_LIMITER, integrationsKeyRateLimitKey(admitted.id))
	)
		return keyRateLimitRefusal();
	ctx.waitUntil(touchLastUsed(db, admitted));
	context.set(integrationsKey, admitted);
	return next();
};

export const middleware: Route.MiddlewareFunction[] = [readOnly, keyGate];

/**
 * the bare surface address, which react router matches as this layout with no child beneath it —
 * and without a loader answers 400 with its own internal message. a 404 naming the surface
 * instead, for a caller who trimmed a URL to see what is here.
 */
export function loader(_: Route.LoaderArgs): Response {
	return integrationsRefusal(
		404,
		'not_found',
		'There is nothing served at /integrations/v1 itself. It is the prefix every endpoint of this deployment’s read API sits under.',
		'Call an endpoint on it, such as GET /integrations/v1/gifts.'
	);
}
