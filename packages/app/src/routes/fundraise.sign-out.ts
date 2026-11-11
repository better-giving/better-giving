import { href, redirect } from 'react-router';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { endSupporterSession } from '$lib/server/supporters/session';
import { database } from '../context';
import type { Route } from './+types/fundraise.sign-out';

// Sign out, from a signed-in supporter screen's top bar (`signOutAction` in
// $lib/supporter/area/shell.tsx): the session ended whatever state it is in, its cookie cleared, and
// on to the sign-in screen. an action with no component.

/** a GET, a HEAD or an OPTIONS, which this address answers with the method it takes. */
export function loader(): Response {
	return new Response('This address signs a supporter out by POST.', {
		status: 405,
		headers: { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' }
	});
}

export async function action({ context, request }: Route.ActionArgs) {
	refuseWriteFromAnotherOrigin(request);
	const clear = await endSupporterSession(context.get(database), request);
	return redirect(href('/fundraise/sign-in'), { status: 303, headers: { 'Set-Cookie': clear } });
}
