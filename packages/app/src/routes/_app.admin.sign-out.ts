import { redirect } from 'react-router';
import { LOGIN_PATH } from '$lib/server/auth/next';
import { auth } from '../context';
import type { Route } from './+types/_app.admin.sign-out';

/**
 * the way out, which is a form action and never a call from the browser.
 *
 * writes are form actions or endpoints in this app and there are no client-side mutation paths in
 * /admin (CLAUDE.md), and a sign-out is a write: it deletes the session row. the control that
 * posts here is on the rail in ./_app.tsx.
 *
 * it is under the protected layout rather than beside the login, which is what makes it
 * unreachable without a session — so there is no address here for a caller with nothing to give
 * up, and the gate answers one with the login like any other screen. the auth instance it signs
 * out through is the gate's own, off the request context (../context.ts): a second one here would
 * read the signing-key row again and would be a route resolving auth of its own, which
 * ../routes.spec.ts refuses.
 *
 * no component and no `loader`, so nothing of this module reaches a browser bundle and there is
 * nothing at this address to read. a bare path in the redirect, as every server redirect in this
 * app is — ./_app._index.tsx says what a fork configuring a base path would change at once.
 */
export async function action({ context, request }: Route.ActionArgs) {
	// `returnHeaders` because the clearing cookie is on the response better-auth builds for its own
	// HTTP surface, which this deployment does not serve — nothing else copies it onto ours, and
	// dropped, the browser goes on sending a credential it was told to give up.
	const { headers } = await context.get(auth).api.signOut({
		headers: request.headers,
		returnHeaders: true
	});

	const response = redirect(LOGIN_PATH, 303);
	for (const cookie of headers.getSetCookie()) response.headers.append('set-cookie', cookie);
	return response;
}
