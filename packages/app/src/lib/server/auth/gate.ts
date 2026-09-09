import { data, redirect, type MiddlewareFunction } from 'react-router';
import { auth as authForRequest, database, platform, staff } from '../../../context';
import { readAuthEnv } from './env';
import { createAuth } from './index';
import { LOGIN_PATH, NEXT_PARAM } from './next';
import { resolveAuthSecret } from './signing-key';

/**
 * what react router hands a server `middleware`, taken off the framework's own type rather than
 * restated: a route module's generated `Route.MiddlewareFunction` is the same shape with the
 * route's params filled in, and a shape written out here would be a second copy to keep true.
 *
 * the declared return is `Promise<Response>` rather than the framework's `Response | void`. a
 * server middleware that swallows the response would leave the request with nothing to answer
 * with, and stating it here is what lets a caller — this module's spec included — hold the
 * response without narrowing a case the gate does not have.
 */
type GateArgs = Parameters<MiddlewareFunction<Response>>[0];
type GateNext = Parameters<MiddlewareFunction<Response>>[1];

/**
 * the gate in front of every screen behind the login, as a route `middleware`.
 *
 * it is mounted on the protected layout — `src/routes/_app.tsx` exports it — and never on the
 * root. middleware on the root runs for every route, the payment processor's callback included,
 * and the signature is computed over that request's body exactly as sent (CLAUDE.md).
 *
 * a `middleware` rather than a check each loader repeats, and that is the whole shape of it: a
 * loader written without the check would be served to anyone, and nothing would report it. what
 * decides whether a route is behind this gate is where it sits in the route tree, which
 * `src/routes.spec.ts` holds every route to — every route is under this layout, on the public
 * allow-list with the reason typed beside it, or on the console surface.
 *
 * it resolves the session once and hands it down with `context.set(staff, …)`, so no loader
 * beneath resolves one of its own. `src/routes.spec.ts` refuses a route under the layout that
 * reaches for `createAuth`, `resolveAuthSecret` or `getSession`.
 *
 * **this is where the signing key read now falls.** the key is normally a row rather than a
 * secret (./signing-key.ts), so resolving it is one D1 read — and mounting the gate on the layout
 * is what keeps every surface outside it from paying for one: the public api, the processor's
 * callback, the console surface and every 404 resolve no session and read no key. the login pays
 * it because it signs one in.
 */
export async function staffGate(
	{ context, request, url }: GateArgs,
	next: GateNext
): Promise<Response> {
	const { env } = context.get(platform);
	// the request's own handle, seeded above the router (src/request-context.ts) and taken off the
	// context here like every other surface takes it. built from the binding here instead, this
	// would be a second module naming `DB` — and the surfaces outside this layout, which is most
	// of them, would each be a third (CLAUDE.md, src/context.ts).
	const db = context.get(database);
	const authEnv = readAuthEnv(env);

	const signingKey = await resolveAuthSecret(db, authEnv);
	if (!signingKey.ok) {
		// 500 rather than a redirect to the login: nothing the caller sent is wrong, and a
		// deployment that cannot sign a cookie cannot sign one at the login either. the message
		// names the table and the command that mints the row.
		throw data(signingKey.message, { status: 500 });
	}

	// the origin is passed rather than configured: `createAuth` derives the trusted-origin list
	// and the cookie `Secure` policy from it, so a deployment answers correctly on workers.dev and
	// on a custom domain without a deploy-time variable naming either.
	const auth = createAuth(db, authEnv, {
		secret: signingKey.secret,
		requestOrigin: url.origin
	});

	// `returnHeaders` because better-auth rolls the session forward on read — past `updateAge`
	// (./index.ts) `getSession` writes a fresh expiry and a fresh cookie — and nothing copies that
	// cookie onto the response for us. dropped, an operator is signed out seven days after signing
	// in however much they used the app in between.
	const { headers, response: session } = await auth.api.getSession({
		headers: request.headers,
		returnHeaders: true
	});

	if (!session) {
		// turned away carrying where they were going, so the sign-in can put them back there. the
		// whole request target and not just its path — a deep link into /admin names a tab or a
		// filter in its query as often as not, and dropping it lands the operator on a page that is
		// not the one the link was for.
		//
		// one percent-encoded parameter, so a `?` in the destination cannot read as the login's own
		// query. what may be returned to is `safeNext`'s decision at the other end (./next.ts) —
		// this side mints the value and validates nothing, because the parameter that arrives at
		// the login is whatever a caller put in a url and never only what was minted here.
		//
		// `url` and never `request.url`: after the first navigation the browser asks react router
		// for a screen at `<path>.data` with routing parameters of its own, and `url` is that
		// request normalised back to the address the operator was going to. minted off the request
		// instead, the login would send them to a serialized payload.
		const destination = `${url.pathname}${url.search}`;
		throw redirect(`${LOGIN_PATH}?${NEXT_PARAM}=${encodeURIComponent(destination)}`, 303);
	}

	context.set(staff, session.user);
	// the instance goes down with the session, for the one route beneath that still has to ask
	// auth for something: signing out (src/routes/_app.admin.sign-out.ts). see src/context.ts.
	context.set(authForRequest, auth);

	const response = await next();
	for (const cookie of headers.getSetCookie()) response.headers.append('set-cookie', cookie);
	return response;
}
