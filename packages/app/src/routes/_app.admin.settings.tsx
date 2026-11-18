import { href, redirect } from 'react-router';
import { STAFF_USER_ID } from '$lib/server/auth';
import { notFound } from '$lib/server/db/load-failure';
import { staff } from '../context';
import type { Route } from './+types/_app.admin.settings';

// Settings is no page of its own: its sections are the three routes beside this one
// (./_app.admin.settings_.organisation.tsx, ./_app.admin.settings_.notifications.tsx,
// ./_app.admin.settings_.mail.tsx), and the rail's Settings row is their parent
// ($lib/admin/destinations.ts). an address that names Settings alone lands on the first.
//
// a member is answered not-found here as on every section, rather than sent on to one, so the
// redirect says nothing a member's session may not know.

const FIRST_SECTION = href('/admin/settings/organisation');

function refuseMember(context: Route.LoaderArgs['context']) {
	if (context.get(staff).id !== STAFF_USER_ID) {
		notFound('No page at /admin/settings for a member’s session. Settings are the deployer’s.');
	}
}

export function loader({ context }: Route.LoaderArgs) {
	refuseMember(context);
	throw redirect(FIRST_SECTION);
}

// a POST here names no section, so no section's action can own its boxes: the body is left
// unread, nothing is written, and the 303 lands the tab on the first section as a GET.
export function action({ context }: Route.ActionArgs) {
	refuseMember(context);
	throw redirect(FIRST_SECTION, 303);
}
