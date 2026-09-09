import { redirect } from 'react-router';

/**
 * the app's entrance, which forwards to the home screen — the dashboard, which is the staff
 * surface's own address and the first cell on its rail ($lib/admin/destinations.ts).
 *
 * how far this deployment has been set up is not a page here and is not a gate in front of the
 * staff surface: it is settled on the console, beside the controls that repair each part of it. so
 * there is nothing here for a browser to read.
 *
 * the route exists without a page because addresses do: `/` is where sign-in lands by default,
 * where a bookmark points, and what somebody types when they want "the app". one redirect keeps
 * all of those working and keeps what "home" means decided in one place.
 *
 * a bare path, as every server redirect in this app is: nothing configures a base path today, so a
 * fork that ever did would change every server redirect in this app at once rather than one call
 * site at a time.
 */
export function loader() {
	return redirect('/admin', 303);
}

// a route module has to have one, and this one never renders: the loader redirects on every
// request that reaches it.
export default function Index() {
	return null;
}
