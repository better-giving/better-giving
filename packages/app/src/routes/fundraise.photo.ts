import { data } from 'react-router';
import { isRateLimited, supporterPhotoRateLimitKey } from '$lib/server/api/rate-limit';
import { refuseWriteFromAnotherOrigin } from '$lib/server/auth/gate';
import { readPostedBody } from '$lib/server/images/intake';
import { checkSupporterPhoto } from '$lib/server/supporters/photo';
import { readSupporterSession } from '$lib/server/supporters/session';
import { database, platform } from '../context';
import type { Route } from './+types/fundraise.photo';

// a supporter's page photo, stored: an `action` with no component, which the photo box posts its
// crop to (`uploadUrl` in $lib/supporter/area/photo-field.tsx) and which answers `{ id }`. a signed-in
// supporter's alone — the staff endpoint (./_app.admin.images.ts) stays behind the staff gate — and
// a caller with no session is answered 401 before the body is read. a visitor starting their first
// fundraiser has no session, and posts the photo with the start itself (./fundraise._index.tsx).
//
// the body is the one photo intake's ($lib/server/images/intake.ts): PNG, JPEG or WebP by its own
// bytes, never an SVG, under the photo cap. a photo narrower than a page photo is
// (`checkSupporterPhoto` in $lib/server/supporters/photo.ts) is refused with a 400 before anything
// is stored, as the banner's address refuses one that is no banner. the photo belongs to nothing
// until a start or an edit names its id, and each of those refuses an id no stored image has; an
// edit also refuses one anything but its own page holds (`unheldBeyond` in
// $lib/server/images/free.ts).
//
// photos are rows in the one database file, so each is charged before its body is read, against
// the supporter alone, whichever session or network posts it, on `SUPPORTER_PHOTO_RATE_LIMITER`: a
// day's count. never against the network, so supporters behind one address are not refused as a
// group. the sweep frees a photo nothing holds a day after it was stored (`UNHELD_PHOTO_KEEP_MS` in
// $lib/server/supporters/sweep.ts), so a supporter can leave at most twice that count unheld.

/** what a supporter past the day's count is told, beside the photo box. */
const TOO_MANY_PHOTOS =
	'You’ve added as many photos as we can take today. Use one you’ve already added, or try again tomorrow.';

/** a GET, a HEAD or an OPTIONS, which this address answers with the method it takes. */
export function loader(): Response {
	return new Response('This address takes a photo by POST.', {
		status: 405,
		headers: { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' }
	});
}

export async function action({ context, request }: Route.ActionArgs) {
	refuseWriteFromAnotherOrigin(request);
	const db = context.get(database);
	const signedIn = await readSupporterSession(db, request, new Date());
	if (signedIn === null) return data({ error: 'Sign in to add a photo.' }, 401);
	const limiter = context.get(platform).env.SUPPORTER_PHOTO_RATE_LIMITER;
	if (await isRateLimited(limiter, supporterPhotoRateLimitKey(signedIn.supporterId))) {
		return data({ error: TOO_MANY_PHOTOS }, 429);
	}
	const posted = await readPostedBody(request);
	const photo = posted.ok ? await checkSupporterPhoto(db, posted.body.get('file'), 'file') : posted;
	if (!photo.ok) return data({ error: photo.error }, photo.refusal === 'too-large' ? 413 : 400);
	try {
		await db.batch(photo.statements);
	} catch (e) {
		console.error('storing a supporter’s photo failed:', e);
		return data({ error: 'the photo was not stored; post it again', reason: 'failed' }, 500);
	}
	return { id: photo.id };
}
