import { data } from 'react-router';
import { photoUpload } from '$lib/admin/unreached';
import { bannerRefusal } from '$lib/org/banner';
import { imageSrc } from '$lib/page/image-src';
import { STAFF_USER_ID } from '$lib/server/auth';
import { notFound } from '$lib/server/db/load-failure';
import { readPostedPhoto } from '$lib/server/images/intake';
import { putNewOrgProfileBanner, removeOrgProfileBanner } from '$lib/server/org/queries';
import { database, staff } from '../context';
import type { Route } from './+types/_app.admin.settings_.banner';

// the donation page's banner, put on by `POST` and taken off by `DELETE`, which the Settings screen
// (./_app.admin.settings.tsx) asks by fetcher — the logo's address (./_app.admin.settings_.logo.ts)
// over `org_profile.banner_image_id`, and the same in every way but one: a photo that is no banner
// by `bannerRefusal` ($lib/org/banner.ts) is refused with a 400 before anything is stored, since the
// intake's bounds (`readPostedPhoto` in $lib/server/images/intake.ts) are any photo's.
//
// **only the deployer's session reaches it**, and a member is answered with not-found before the
// body is read. the answers are `BannerAnswer` ($lib/org/banner.ts): the banner stored, or `error`
// with its sentence — a 413 for size, a 400 for a file that is no photo or no banner, a 409 for a
// profile that is missing or moved, and a 500 marked `failed` where the write threw.

const NOT_HERE =
	'No banner to change for a member’s session. The donation page’s banner is changed from the ' +
	'deployer’s session: sign in with `ADMIN_PASSWORD` at /login.';

const NO_PROFILE = 'Save the organisation details first, then add the banner.';
const STALE = 'The banner changed while this was sent. Send it again.';

export async function action({ context, request }: Route.ActionArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);
	const db = context.get(database);

	if (request.method === 'DELETE') {
		const removed = await removeOrgProfileBanner(db);
		if (removed === 'stale') return data({ error: STALE }, 409);
		return { banner: null };
	}

	const photo = await readPostedPhoto(db, request);
	if (!photo.ok) return data({ error: photo.error }, photo.refusal === 'too-large' ? 413 : 400);
	const refused = bannerRefusal(photo.width, photo.height);
	if (refused !== null) return data({ error: refused }, 400);
	const put = await putNewOrgProfileBanner(db, photo).catch((e: unknown) => {
		console.error('putting the banner on failed:', e);
		return 'failed' as const;
	});
	switch (put) {
		case 'written':
			return { banner: { id: photo.id, src: imageSrc(photo.id) } };
		case 'no-profile':
			return data({ error: NO_PROFILE }, 409);
		case 'stale':
			return data({ error: STALE }, 409);
		case 'failed':
			return data({ error: 'the banner was not stored; send it again', reason: 'failed' }, 500);
	}
}

export function clientAction({ serverAction }: Route.ClientActionArgs) {
	return photoUpload(serverAction);
}
