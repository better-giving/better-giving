import { data } from 'react-router';
import { photoUpload } from '$lib/admin/unreached';
import { takePostedPhoto } from '$lib/server/images/intake';
import { database } from '../context';
import type { Route } from './+types/_app.admin.images';

// a photo posted from the dashboard, stored: an `action` with no component, which the editor asks
// by fetcher and which answers `{ id, width, height }`. under the protected layout by its name, so
// anyone signed in may store one; the photo belongs to nothing until a block or a program names
// its id, and each of those writes refuses an id no stored image has.
//
// the body is `multipart/form-data` with the photo in `file`, taken by the one photo intake
// ($lib/server/images/intake.ts), whose header states every bound it holds a post to.
//
// a refusal is a 400, or a 413 for size, whose `error` names the limit; a store that throws is a
// 500 marked `failed`, because a fetcher's thrown error lands on the editor's error boundary and
// takes the editor with it. an upload that never reached the server is answered in the browser
// the same way, by `clientAction` ($lib/admin/unreached.ts); the action is still the one writer.

/**
 * a GET, a HEAD or an OPTIONS, which react router sends to a route's `loader`.
 *
 * written rather than left out: a route module with no `loader` answers a GET with the
 * framework's own 400. `Allow` is required on a 405
 * (https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/405).
 */
export function loader(): Response {
	return new Response('This address takes a photo by POST.', {
		status: 405,
		headers: { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' }
	});
}

export async function action({ context, request }: Route.ActionArgs) {
	const taken = await takePostedPhoto(context.get(database), request);
	if (taken.ok) return { id: taken.id, width: taken.width, height: taken.height };
	switch (taken.refusal) {
		case 'too-large':
			return data({ error: taken.error }, 413);
		case 'refused':
			return data({ error: taken.error }, 400);
		case 'failed':
			return data({ error: taken.error, reason: 'failed' }, 500);
	}
}

export function clientAction({ serverAction }: Route.ClientActionArgs) {
	return photoUpload(serverAction);
}
