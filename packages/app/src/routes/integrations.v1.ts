import {
	integrationsCallerRateLimitKey,
	integrationsKeyRateLimitKey,
	isRateLimited
} from '$lib/server/api/rate-limit';
import {
	admitKey,
	callerRateLimitRefusal,
	INTEGRATIONS_BASE_PATH,
	keyRateLimitRefusal,
	notFoundRefusal,
	readOnlyRefusal
} from '$lib/server/integrations/surface';
import { touchLastUsed } from '$lib/server/integrations/keys';
import { database, platform } from '../context';
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
// every address under the prefix that no list answers is this surface's JSON 404, behind the same
// key check: the bare prefix (this file's `loader`), a path beneath it no route serves
// (./integrations.v1.$.ts), and react router's own `.data` address for a list (`noSingleFetch`).
//
// a request that passes the method check is charged twice, and where each charge sits is what it
// bounds:
//
// - **per address, first**, on `API_RATE_LIMITER` under this surface's own key
//   (`integrationsCallerRateLimitKey` in $lib/server/api/rate-limit.ts), ahead of the key lookup
//   and whatever the request presents — so it bounds what one address costs before anything is
//   known about it: the indexed read each well-formed key costs, and so guessing. it is sized
//   above the per-key bucket (wrangler.jsonc has both numbers), so it reaches a real key only when
//   one address runs several keys flat out. a caller the edge attributes no address to is not
//   charged it at all, rather than pooled with every other such caller into one bucket anyone
//   could hold closed on every integration: the 256-bit key and the per-key bucket still bound
//   them.
// - **per key, once admitted**, on `INTEGRATIONS_KEY_RATE_LIMITER` under the key's row id
//   (`integrationsKeyRateLimitKey`) — how fast one key reads the database, with two keys on one
//   host holding two budgets. it cannot be charged before the lookup that names the key, and that
//   lookup is the read the charge above bounds.
//
// both fail open, as `isRateLimited` argues.
//
// when the key was last used is recorded once the route beneath has answered, through
// `waitUntil`, so its write never queues ahead of the route's own reads on D1 — at most once a
// minute per key, decided on the row the lookup already read, so a key used within the minute
// costs no statement (`touchLastUsed` in $lib/server/integrations/keys.ts).

/**
 * GET and HEAD, and nothing else. react router hands OPTIONS to a loader and POST, PUT, PATCH and
 * DELETE to an action, so without this a route with no action would answer a write with the
 * framework's own 405 and no `Allow`, and a keyed OPTIONS would read the loader. a method outside
 * those seven — PROPFIND, QUERY — never reaches this: react router's server runtime would answer
 * it with its own 405 before any middleware runs, so ../worker.ts answers it with this same
 * refusal before the request reaches react router at all.
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
	const answer = await next();
	ctx.waitUntil(touchLastUsed(db, admitted));
	return answer;
};

/**
 * a list asked for at its `.data` address is refused, never answered. react router's server
 * runtime reads any path ending `.data` as its own single-fetch request (`derive` in
 * react-router/dist/development/lib/server-runtime/server.js), runs this layout's `loader` beside
 * the list's, and answers both as a turbo-stream with neither's `cache-control`. that is no
 * address this surface publishes, and donor records must not leave it in a second format a cache
 * may keep. the path is read off the request itself, which keeps its `.data`; the router's `url`
 * has it stripped.
 */
const noSingleFetch: Route.MiddlewareFunction = ({ request }, next) => {
	const { pathname } = new URL(request.url);
	return pathname.endsWith('.data') ? notFoundRefusal(pathname) : next();
};

export const middleware: Route.MiddlewareFunction[] = [readOnly, keyGate, noSingleFetch];

/**
 * the bare surface address, which react router matches as this layout with no child beneath it —
 * and without a loader answers 400 with its own internal message. a 404 naming the lists instead,
 * for a caller who trimmed a URL to see what is here.
 */
export function loader(_: Route.LoaderArgs): Response {
	return notFoundRefusal(INTEGRATIONS_BASE_PATH);
}
