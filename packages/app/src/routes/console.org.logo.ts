import { consoleReport } from '$lib/server/console/report';
import { consoleJson, consoleMethodNotAllowed } from '$lib/server/console/surface';
import { readPostedPhoto } from '$lib/server/images/intake';
import { putNewOrgProfileLogo, removeOrgProfileLogo } from '$lib/server/org/queries';
import { consoleSession, database } from '../context';
import type { Route } from './+types/console.org.logo';

// the organisation's logo, put on by `POST` and taken off by `DELETE`, behind the credential check
// on ./console.ts like every route on this surface.
//
// the post is the photo the console resized and forwarded unread, as `multipart/form-data` with
// the photo in `file`, checked by the same intake the dashboard's photos are
// ($lib/server/images/intake.ts) so the bounds are written once. the photo is stored in the one
// `batch()` that puts it on and frees the logo it replaces (`putNewOrgProfileLogo` in
// $lib/server/org/queries.ts), so an upload refused or failed leaves no image behind.
//
// every refusal is the console's 422 with the sentence at `errors.logo`, a size bound's included:
// that is the one answer the console draws under the logo box, and any other status reads to it as
// a write that never landed. a write that throws is the console's shaped 500 (`notStored`), never a
// thrown error, which react router would answer with a body the console cannot read. success
// answers the report, as ./console.org.ts does.

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST' && request.method !== 'DELETE') {
		return consoleMethodNotAllowed(request.method, ALLOW);
	}
	const db = context.get(database);
	if (request.method === 'DELETE') {
		const removed = await removeOrgProfileLogo(db);
		if (removed === 'stale') return refused(STALE);
	} else {
		const photo = await readPostedPhoto(db, request);
		if (!photo.ok) return refused(photo.error);
		const put = await putNewOrgProfileLogo(db, photo).catch((e: unknown) => {
			console.error('putting the logo on failed:', e);
			return 'failed' as const;
		});
		if (put === 'failed') return notStored('the logo was not stored; send it again');
		if (put !== 'written') return refused(put === 'no-profile' ? NO_PROFILE : STALE);
	}
	return consoleJson(await consoleReport(db, context.get(consoleSession), request.url));
}

/** the read this address does not answer. `GET /console` is the report. */
export function loader({ request }: Route.LoaderArgs): Response {
	return consoleMethodNotAllowed(request.method, ALLOW);
}

const ALLOW = 'POST, DELETE';

const NO_PROFILE = 'Save the organisation’s legal name first, then add the logo.';
const STALE = 'The logo changed while this was sent. Send it again.';

function refused(sentence: string): Response {
	return consoleJson(
		{
			error: 'logo_refused',
			message: `The logo was not changed: ${sentence}`,
			fix: 'Fix what `errors.logo` names and send the logo again.',
			errors: { logo: sentence }
		},
		422
	);
}

function notStored(message: string): Response {
	return consoleJson({ error: 'logo_not_stored', message, fix: 'Send the logo again.' }, 500);
}
