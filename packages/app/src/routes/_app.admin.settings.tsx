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

export function loader({ context }: Route.LoaderArgs) {
	if (context.get(staff).id !== STAFF_USER_ID) {
		notFound('No page at /admin/settings for a member’s session. Settings are the deployer’s.');
	}
	throw redirect(href('/admin/settings/organisation'));
}
