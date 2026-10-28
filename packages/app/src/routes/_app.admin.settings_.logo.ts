import { data } from 'react-router';
import { photoUpload } from '$lib/admin/unreached';
import { STAFF_USER_ID } from '$lib/server/auth';
import { notFound } from '$lib/server/db/load-failure';
import { readPostedPhoto } from '$lib/server/images/intake';
import { putNewOrgProfileLogo, removeOrgProfileLogo } from '$lib/server/org/queries';
import { imageSrc } from '$lib/page/image-src';
import { database, staff } from '../context';
import type { Route } from './+types/_app.admin.settings_.logo';

// the organisation's logo, put on by `POST` and taken off by `DELETE`, which the Settings screen
// (./_app.admin.settings.tsx) asks by fetcher. an `action` with no component, out of that screen's
// layout nesting by the `settings_` in its name, and an address of its own because the photo is
// the whole body: `readPostedPhoto` ($lib/server/images/intake.ts) reads it off the request with
// its size bound, which a body already read by `formData()` would have spent.
//
// **only the deployer's session reaches it**, the predicate the screen reads, and a member is
// answered with not-found before the body is read.
//
// the photo is stored in the one `batch()` that puts it on and frees the logo it replaces
// (`putNewOrgProfileLogo` in $lib/server/org/queries.ts), so an upload refused or failed leaves no
// image behind. the answers are the images route's shape (`UploadAnswer` in
// $lib/admin/page-edit/photo-upload.ts): the logo stored, or `error` with its sentence — a 413 for size,
// a 400 for a file that is no photo, a 409 for a profile that is missing or moved, and a 500 marked
// `failed` where the write threw, since a fetcher's thrown error lands on the screen's boundary.

const NOT_HERE =
	'No logo to change for a member’s session. The organisation’s logo is changed from the ' +
	'deployer’s session: sign in with `ADMIN_PASSWORD` at /login.';

const NO_PROFILE = 'Save the organisation details first, then add the logo.';
const STALE = 'The logo changed while this was sent. Send it again.';

export async function action({ context, request }: Route.ActionArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);
	const db = context.get(database);

	if (request.method === 'DELETE') {
		const removed = await removeOrgProfileLogo(db);
		if (removed === 'stale') return data({ error: STALE }, 409);
		return { logo: null };
	}

	const photo = await readPostedPhoto(db, request);
	if (!photo.ok) return data({ error: photo.error }, photo.refusal === 'too-large' ? 413 : 400);
	const put = await putNewOrgProfileLogo(db, photo).catch((e: unknown) => {
		console.error('putting the logo on failed:', e);
		return 'failed' as const;
	});
	switch (put) {
		case 'written':
			return { logo: { id: photo.id, src: imageSrc(photo.id) } };
		case 'no-profile':
			return data({ error: NO_PROFILE }, 409);
		case 'stale':
			return data({ error: STALE }, 409);
		case 'failed':
			return data({ error: 'the logo was not stored; send it again', reason: 'failed' }, 500);
	}
}

export function clientAction({ serverAction }: Route.ClientActionArgs) {
	return photoUpload(serverAction);
}
