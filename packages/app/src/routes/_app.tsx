import { Button } from '@better-giving/operator/components/controls/Button';
import { AppShell } from '@better-giving/operator/components/shell/AppShell';
import { Form, Outlet, useLocation } from 'react-router';
import { currentDestination, DESTINATIONS } from '$lib/admin/destinations';
import { operatorLinks } from '$lib/admin/operator-links';
import { RouterLink } from '$lib/admin/router-link';
import { APP_NAME } from '$lib/admin/screen-title';
import { SetupGate } from '$lib/admin/setup-gate';
import { staffGate } from '$lib/server/auth/gate';
import { setupOutstanding } from '$lib/server/config/readiness';
import { readSetupState } from '$lib/server/config/setup-state';
import { database, platform } from '../context';
import type { Route } from './+types/_app';

// the layout every screen behind the login sits under, and the one place the session gate is
// mounted.
//
// pathless: the `_` prefix keeps the segment out of the URL, so /admin is /admin and this file is
// what decides that reaching it needs a session. **being under this route is what makes a route
// gated** — there is no group id and no naming convention standing in for it — and
// ../routes.spec.ts holds every route in the app to that: under this layout, on the public
// allow-list with the reason typed beside it, or on the console surface.
//
// the gate is here rather than on ../root.tsx because middleware on the root runs for every route,
// the payment processor's callback included, and its body must be read exactly once by the handler
// that owns it (CLAUDE.md). see $lib/server/auth/gate.ts for what the gate resolves and where the
// signing key read now falls.
//
// it is also the frame: the shell, the rail and the way out are drawn once here rather than by
// each screen, so a screen under this route is a screen and nothing else. every part of that frame
// is `@better-giving/operator`'s and is dressed by packages/operator/src/styles/adm.css — this
// file states no arrangement, no breakpoint and no count.

export const middleware: Route.MiddlewareFunction[] = [staffGate];

// the sheet every screen beneath this layout wears, linked once here rather than by each of them.
export const links = operatorLinks;

// the loader is the gate's before it is the frame's. react router runs server middleware on a
// client-side navigation only when the navigation asks the server for something, so a screen under
// here with no loader of its own would be entered without the gate having run for it. one loader
// on this route makes every navigation into the protected surface a request the gate sees.
export async function loader({ context }: Route.LoaderArgs) {
	// the identity band names the organisation, so every screen behind the login needs this row —
	// and the five jobs this layout gates on are read off the same call
	// ($lib/server/config/setup-state.ts).
	//
	// a failure is swallowed, unlike every other read in this app. this loader runs for every screen
	// behind the login, including the ones that exist to explain a database that is not answering,
	// so throwing would replace the screens able to say what is wrong with the error page, on
	// exactly the deployment that needs them.
	const state = await readSetupState(context.get(database), context.get(platform).env);

	// **the dashboard is not served while any of the five is unfinished**, which is what lets every
	// screen under this layout be written against a deployment that is set up (CLAUDE.md). the
	// sign-in screen refuses on the same reading, so an operator meets this before typing a
	// password rather than after (../routes/login.tsx).
	if (state !== null && setupOutstanding(state.lines) > 0) {
		return { shape: 'setup' as const, lines: state.lines };
	}

	// an explicit projection, because everything returned here is serialized into the page: a
	// column a later better-auth or a wider org profile adds is not published by accident.
	return { shape: 'ready' as const, orgName: state?.profile?.legalName ?? null };
}

export default function ProtectedLayout({ loaderData }: Route.ComponentProps) {
	// the destination is decided from the address rather than from a route id, because what marks
	// a cell is which section the reader is in and a section is several routes deep
	// ($lib/admin/destinations.ts).
	const { pathname } = useLocation();

	// the gate stands in place of the frame and the screen alike, so no child route renders and no
	// rail offers a destination this deployment is not serving ($lib/admin/setup-gate.tsx). the
	// address is left alone rather than redirected, so an operator who finishes the set-up and
	// presses Check again lands on the screen they were going to.
	if (loaderData.shape === 'setup') return <SetupGate lines={loaderData.lines} />;

	return (
		<AppShell
			// before anyone has saved the organisation's details on the console there is no name to
			// show, so it says what the software is rather than printing an empty band. the word is
			// shared with every screen's tab title, which falls back to the same one
			// ($lib/admin/screen-title.ts).
			org={loaderData.orgName ?? APP_NAME}
			destinations={DESTINATIONS}
			link={RouterLink}
			current={currentDestination(pathname)}
			signOut={
				// a form and not a button that calls something: writes are form actions in this app
				// and there are no client-side mutation paths in /admin (CLAUDE.md). the action is
				// a route of its own (./_app.admin.sign-out.ts) rather than a named action on
				// whichever screen is mounted, because the way out is on every screen and only one
				// of them would have it.
				//
				// `.adm-signout` is what keeps two words from breaking across two lines when an
				// organisation's long name contests the identity band's row; the shell renders
				// this same node at the foot of the rail too, where the class reaches nothing.
				<Form method="post" action="/admin/sign-out" className="adm-signout">
					<Button variant="quiet" size="sm">
						Sign out
					</Button>
				</Form>
			}
		>
			<Outlet />
		</AppShell>
	);
}
