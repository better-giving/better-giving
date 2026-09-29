import { Button } from '@better-giving/operator/components/controls/Button';
import { AppShell } from '@better-giving/operator/components/shell/AppShell';
import { ProgressBar } from '@better-giving/operator/components/status/ProgressBar';
import { holdBar, movesPage, openingLabel, pageDrawn } from '@better-giving/operator/progress-bar';
import { useEffect } from 'react';
import { Form, Outlet, useLocation, useMatches, useNavigation } from 'react-router';
import { ScreenCrumbs, useCrumbs } from '$lib/admin/crumbs';
import { currentDestination, DESTINATION_GROUPS } from '$lib/admin/destinations';
import { operatorLinks } from '$lib/admin/operator-links';
import { RouterLink } from '$lib/admin/router-link';
import { APP_NAME } from '$lib/admin/screen-title';
import { SetupGate } from '$lib/admin/setup-gate';
import { staffGate } from '$lib/server/auth/gate';
import { setupOutstanding } from '$lib/server/config/readiness';
import { readSetupState } from '$lib/server/config/setup-state';
import { database, platform } from '../context';
import type { Route } from './+types/_app';

// the layout every screen behind the login sits under, and where the session gate is mounted for
// all of them. the one route behind the login outside it is the editor's preview, which mounts the
// same gate itself because this frame would be drawn around it (./preview.$pageId.tsx).
//
// pathless: the `_` prefix keeps the segment out of the URL, so /admin is /admin and this file is
// what decides that reaching it needs a session. **being under this route is what makes a route
// gated** — there is no group id and no naming convention standing in for it — and
// ../routes.spec.ts holds every route in the app to that: under this layout, the preview, on the
// public allow-list with the reason typed beside it, or on the console surface.
//
// the gate is here rather than on ../root.tsx because middleware on the root runs for every route,
// the payment processor's callback included, and its body must be read exactly once by the handler
// that owns it (CLAUDE.md). see $lib/server/auth/gate.ts for what the gate resolves and where the
// signing key read now falls.
//
// it is also the frame: the shell, the rail and the way out are drawn once here rather than by
// each screen, so a screen under this route is a screen and nothing else. every part of that frame
// is `@better-giving/operator`'s and is dressed by packages/operator/src/styles/adm.css — this
// file states no arrangement, no breakpoint and no count. a screen whose `handle` is a
// `BareHandle` — the editor — is drawn without the frame, across the whole window.
//
// and it draws the bar over a move to another screen, held by `clientMiddleware` below. the rule
// that bar keeps is packages/operator/src/progress-bar.ts's header.

export const middleware: Route.MiddlewareFunction[] = [staffGate];

/** whether the frame, and with it the bar over a move, is on the screen. */
let framed = false;

// the hold on that bar. middleware rather than this route's loader, because it wraps the reading
// of whichever child is being entered, and this loader does not run again on a move between two of
// them; the router commits the new page only once this resolves.
//
// **a move from outside the frame holds nothing** — the sign-in screen's redirect in, or a move off
// the set-up gate: no bar is drawn there, and a hold would wait out the bar's cap for a rush nobody
// can see (packages/operator/src/motion-end.ts).
export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
	async ({ request }, next) => {
		if (!framed) return;
		const bar = holdBar(new URL(request.url).pathname);
		await next();
		await bar.finish();
	}
];

/**
 * what a screen drawn across the whole window exports as `handle`: the editor, whose own bar is
 * the way out (`$lib/admin/editor/editor-shell.tsx`). the gate and the set-up gate hold it as they
 * hold every screen; only the frame is left off.
 */
export type BareHandle = { readonly frame: 'bare' };

function isBare(handle: unknown): boolean {
	return (
		typeof handle === 'object' && handle !== null && 'frame' in handle && handle.frame === 'bare'
	);
}

/** where the globe beside the organisation's name goes: the Donation page's editor. */
const DONATION_PAGE_EDITOR = { href: '/admin/donation-page', label: 'Donation page' } as const;

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
	const at = currentDestination(pathname);
	const crumbs = useCrumbs();
	const bare = useMatches().some((match) => isBare(match.handle));
	const navigation = useNavigation();
	useEffect(() => pageDrawn(pathname), [pathname]);
	const ready = loaderData.shape === 'ready';
	useEffect(() => {
		framed = ready;
		return () => {
			framed = false;
		};
	}, [ready]);
	const moving =
		navigation.location !== undefined && movesPage(navigation.location.pathname, pathname);

	// the gate stands in place of the frame and the screen alike, so no child route renders and no
	// rail offers a destination this deployment is not serving ($lib/admin/setup-gate.tsx). the
	// address is left alone rather than redirected, so an operator who finishes the set-up and
	// presses Check again lands on the screen they were going to.
	if (loaderData.shape === 'setup') return <SetupGate lines={loaderData.lines} />;

	const progress = moving ? (
		<ProgressBar label={openingLabel(navigation.location?.state)} overMove />
	) : null;

	if (bare) {
		return (
			<>
				{progress}
				<Outlet />
			</>
		);
	}

	return (
		<>
			{progress}
			<AppShell
				// before anyone has saved the organisation's details on the console there is no name to
				// show, so it says what the software is rather than printing an empty band. the word is
				// shared with every screen's tab title, which falls back to the same one
				// ($lib/admin/screen-title.ts).
				org={loaderData.orgName ?? APP_NAME}
				site={DONATION_PAGE_EDITOR}
				groups={DESTINATION_GROUPS}
				link={RouterLink}
				current={at}
				head={
					// the strip is drawn only for a trail, the section's name being its first crumb. every
					// other screen is named by its tab title and the marked rail cell, so no strip repeats it.
					crumbs.length >= 2 ? <ScreenCrumbs /> : undefined
				}
				wayOut={
					// a form and not a button that calls something: writes are form actions in this app
					// and there are no client-side mutation paths in /admin (CLAUDE.md). the action is
					// a route of its own (./_app.admin.sign-out.ts) rather than a named action on
					// whichever screen is mounted, because the way out is on every screen and only one
					// of them would have it.
					//
					// `.adm-signout` is what keeps two words from breaking across two lines when an
					// organisation's long name contests the identity band's row, and what the collapsed
					// rail keys its foot off; `.adm-signout__word` is the word it hides there, leaving the
					// mark.
					<Form method="post" action="/admin/sign-out" className="adm-signout">
						<Button variant="quiet" size="sm" mark="log-out">
							<span className="adm-signout__word">Sign out</span>
						</Button>
					</Form>
				}
			>
				{
					// a screen that is its destination's own page draws no title, and the tab title and the
					// marked rail cell name it to the eye; this is the in-document name a screen reader
					// jumps to. a screen under a section draws its own `h1`, so it gets none here.
					// `tabIndex` -1 so a screen can land focus on it when a press removed the control
					// that held it (./_app.admin.campaigns._index.tsx).
					at?.kind === 'page' ? (
						<h1 className="adm-vh" tabIndex={-1}>
							{at.label}
						</h1>
					) : null
				}
				<Outlet />
			</AppShell>
		</>
	);
}
