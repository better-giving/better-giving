import { Button } from '@better-giving/operator/components/controls/Button';
import { AppShell } from '@better-giving/operator/components/shell/AppShell';
import { MoveStatus, ProgressBar } from '@better-giving/operator/components/status/ProgressBar';
import { holdBar, movesPage, openingLabel, pageDrawn } from '@better-giving/operator/progress-bar';
import { useEffect } from 'react';
import {
	data,
	Form,
	isRouteErrorResponse,
	Outlet,
	redirect,
	useLocation,
	useNavigation
} from 'react-router';
import { ScreenCrumbs, useCrumbs } from '$lib/admin/crumbs';
import { currentDestination, destinationGroupsFor } from '$lib/admin/destinations';
import { operatorLinks } from '$lib/admin/operator-links';
import { RouterLink } from '$lib/admin/router-link';
import { APP_NAME } from '$lib/admin/screen-title';
import { SetupGate } from '$lib/admin/setup-gate';
import { STAFF_USER_ID } from '$lib/server/auth';
import { staffGate } from '$lib/server/auth/gate';
import type { SetupLine } from '$lib/server/config/readiness';
import { setupOutstanding } from '$lib/server/config/readiness';
import { readSetupState } from '$lib/server/config/setup-state';
import { database, platform, setupState, staff } from '../context';
import { ErrorBoundary as RootErrorBoundary } from '../root';
import type { Route } from './+types/_app';

// the layout every screen behind the login sits under, and the one place the session gate and the
// set-up gate are mounted.
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
//
// and it draws the bar over a move to another screen, held by `clientMiddleware` below. the rule
// that bar keeps is packages/operator/src/progress-bar.ts's header.

/** the one route beneath this layout that runs whatever set-up's state: see `middleware`. */
const SIGN_OUT_PATH = '/admin/sign-out';

/** what the set-up gate in `middleware` answers a read with, and `ErrorBoundary` draws. */
type SetupAnswer = { readonly shape: 'setup'; readonly lines: SetupLine[] };

const isSetupAnswer = (error: unknown): error is { data: SetupAnswer } =>
	isRouteErrorResponse(error) && (error.data as Partial<SetupAnswer> | null)?.shape === 'setup';

// **the dashboard is not served while any of the five set-up jobs is unfinished**, which is what
// lets every screen under this layout be written against a deployment that is set up (CLAUDE.md).
// middleware rather than this route's loader, because a loader runs beside its children's and an
// action runs before any of them: thrown before `next()`, this is the only place where no child
// reads and no child writes. the sign-in screen refuses on the same reading, so an operator meets
// this before typing a password rather than after (./login.tsx).
//
// after `staffGate`, so an anonymous caller is sent to the login rather than told how far set-up
// has got. one reading per request, handed to the loader through `setupState` (../context.ts) for
// the identity band.
//
// written inline in the exported array: react router strips that export from the browser bundle,
// and a module-scope `const` holding the gate would survive it (`reachesServerTree` in
// ../routes.testing.ts).
export const middleware: Route.MiddlewareFunction[] = [
	staffGate,
	async ({ context, request, url }, next) => {
		// a stale tab must always be able to give its session up, and a sign-out reads nothing set-up
		// decides (./_app.admin.sign-out.ts).
		if (url.pathname === SIGN_OUT_PATH) return next();

		// a read that did not land answers `null` and gates nothing: this layout covers the screens
		// that explain a database which is not answering, on exactly the deployment that needs them
		// ($lib/server/config/setup-state.ts).
		const state = await readSetupState(context.get(database), context.get(platform).env);
		context.set(setupState, state);
		if (state === null || setupOutstanding(state.lines) === 0) return next();

		// a write is refused unrun and sent back to the address it came from as a read, which is what
		// draws the gate — the operator sees why, rather than a press that silently did nothing.
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			throw redirect(url.pathname + url.search, 303);
		}

		// thrown before `next()`, so no loader has run and the router looks for a boundary from the
		// highest matched route with a loader — this one, since the root has none
		// (react-router/docs/how-to/middleware.md, "next() and Error Handling"). the address is left
		// alone rather than redirected, so an operator who finishes the set-up and presses Check again
		// lands on the screen they were going to.
		const answer: SetupAnswer = { shape: 'setup', lines: state.lines };
		throw data(answer, { status: 503 });
	}
];

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

// the sheet every screen beneath this layout wears, linked once here rather than by each of them.
export const links = operatorLinks;

// the loader is the gate's before it is the frame's. react router runs server middleware on a
// client-side navigation only when the navigation asks the server for something, so a screen under
// here with no loader of its own would be entered without the gate having run for it. one loader
// on this route makes every navigation into the protected surface a request the gate sees.
export async function loader({ context }: Route.LoaderArgs) {
	// the identity band names the organisation, off the row the set-up gate already read: `null`
	// where that read did not land, and the band then says what the software is instead.
	const state = context.get(setupState);

	// an explicit projection, because everything returned here is serialized into the page: a
	// column a later better-auth or a wider org profile adds is not published by accident.
	//
	// `deployer` is the predicate the pages in the rail's Integrations group read, read again here
	// so a member is drawn no cell leading to their not-found ($lib/admin/destinations.ts).
	return {
		orgName: state?.profile?.legalName ?? null,
		deployer: context.get(staff).id === STAFF_USER_ID
	};
}

export default function ProtectedLayout({ loaderData }: Route.ComponentProps) {
	// the destination is decided from the address rather than from a route id, because what marks
	// a cell is which section the reader is in and a section is several routes deep
	// ($lib/admin/destinations.ts).
	const { pathname } = useLocation();
	const at = currentDestination(pathname);
	const crumbs = useCrumbs();
	const navigation = useNavigation();
	useEffect(() => pageDrawn(pathname), [pathname]);
	useEffect(() => {
		framed = true;
		return () => {
			framed = false;
		};
	}, []);
	const moving =
		navigation.location !== undefined && movesPage(navigation.location.pathname, pathname);

	return (
		<>
			{/* the words stand for the whole life of the document and the line only for the move: a
			    region that arrived with the move is one a reader has not registered by the time its
			    words land (`MoveStatus` in packages/operator/src/components/status/ProgressBar.jsx). */}
			<MoveStatus label={moving ? openingLabel(navigation.location?.state) : ''} />
			{moving ? <ProgressBar overMove /> : null}
			<AppShell
				// before anyone has saved the organisation's details on the console there is no name to
				// show, so it says what the software is rather than printing an empty band. the word is
				// shared with every screen's tab title, which falls back to the same one
				// ($lib/admin/screen-title.ts).
				org={loaderData.orgName ?? APP_NAME}
				groups={destinationGroupsFor(loaderData.deployer)}
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
					<Form method="post" action={SIGN_OUT_PATH} className="adm-signout">
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
					at?.kind === 'page' ? <h1 className="adm-vh">{at.label}</h1> : null
				}
				<Outlet />
			</AppShell>
		</>
	);
}

/**
 * the set-up gate, drawn from the answer `middleware` throws, and the root's page for anything else.
 *
 * the gate stands in place of the frame and the screen alike, so no child route renders and no
 * rail offers a destination this deployment is not serving ($lib/admin/setup-gate.tsx). every other
 * failure beneath this layout is drawn by the root's boundary, as it would be with none here. it is
 * rendered rather than rethrown, because no react error boundary catches a throw during the server
 * render, so a rethrow here fails the whole document.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	if (isSetupAnswer(error)) {
		// the tab names the gate as the root's page names its faces, with the project's name: the gate
		// answers before the read that carries the organisation's.
		return (
			<>
				<title>{`Finish setting up this deployment · ${APP_NAME}`}</title>
				<SetupGate lines={error.data.lines} />
			</>
		);
	}
	return <RootErrorBoundary />;
}
