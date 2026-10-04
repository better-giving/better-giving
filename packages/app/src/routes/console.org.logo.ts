import { consoleReport } from '$lib/server/console/report';
import { consoleJson, consoleMethodNotAllowed } from '$lib/server/console/surface';
import { freeImageStatements } from '$lib/server/images/free';
import { takePostedPhoto } from '$lib/server/images/intake';
import {
	type ProfileLogoWrite,
	removeOrgProfileLogo,
	setOrgProfileLogo
} from '$lib/server/org/queries';
import { consoleSession, database } from '../context';
import type { Route } from './+types/console.org.logo';

// the organisation's logo, put on by `POST` and taken off by `DELETE`, behind the credential check
// on ./console.ts like every route on this surface.
//
// the post is the photo the console resized and forwarded unread, as `multipart/form-data` with
// the photo in `file`, taken by the same intake the dashboard's photos are
// ($lib/server/images/intake.ts) so the bounds are written once. the logo it replaces is freed in
// the write that replaces it (`setOrgProfileLogo` in $lib/server/org/queries.ts).
//
// every refusal is the console's 422 with the sentence at `errors.logo`, a size bound's included:
// that is the one answer the console draws under the logo box, and any other status reads to it as
// a write that never landed. a photo stored and then not put on — refused, or the write throwing —
// is freed before the answer, so no upload that failed leaves an image behind. success answers the
// report, as ./console.org.ts does.

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST' && request.method !== 'DELETE') {
		return consoleMethodNotAllowed(request.method, ALLOW);
	}
	const db = context.get(database);
	if (request.method === 'DELETE') {
		const removed = await removeOrgProfileLogo(db);
		if (removed === 'stale') return refused(STALE);
	} else {
		const taken = await takePostedPhoto(db, request);
		if (!taken.ok) {
			if (taken.refusal === 'failed') return notStored(taken.error);
			return refused(taken.error);
		}
		let set: ProfileLogoWrite | null = null;
		try {
			set = await setOrgProfileLogo(db, taken.id);
		} finally {
			if (set !== 'written') await db.batch(freeImageStatements(db, taken.id));
		}
		if (set !== 'written') {
			return refused(set === 'no-profile' ? NO_PROFILE : set === 'stale' ? STALE : NOT_PUT_ON);
		}
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
/** the photo just stored was no photo to put on: not reachable from the intake, answered anyway. */
const NOT_PUT_ON = 'The logo was not put on. Send it again.';

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
