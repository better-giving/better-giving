import { Button } from '@better-giving/operator/components/controls/Button';
import { Shell } from '@better-giving/operator/components/shell/Shell';
import { parseRail } from '@better-giving/operator/rail-preference';
import type { ReactNode } from 'react';
import {
	isRouteErrorResponse,
	Link,
	Outlet,
	useLocation,
	useNavigation,
	useRouteError,
	useRouteLoaderData,
	useSubmit
} from 'react-router';
import { currentDestination, destinationGroupsFor } from '$lib/admin/destinations';
import { operatorLinks } from '$lib/admin/operator-links';
import { RouterLink } from '$lib/admin/router-link';
import { APP_NAME } from '$lib/admin/screen-title';
import { parseViewerZone, VIEWER_ZONE_COOKIE } from '$lib/admin/viewer-time';
import { ViewerZoneProvider } from '$lib/admin/viewer-time.react';
import { ErrorState, errorTitle } from '$lib/error-state';
import { imageSrc } from '$lib/page/image-src';
import { STAFF_USER_ID } from '$lib/server/auth';
import { staffGate } from '$lib/server/auth/gate';
import { readSetupState } from '$lib/server/config/setup-state';
import { database, platform, staff } from '../context';
import { UnframedError } from '../unframed-error';
import type { Route } from './+types/_app';

// the layout every screen behind the login sits under, and where the session gate is mounted for
// all of them. the one route behind the login outside it is the editor's preview, which mounts the
// session gate itself because this frame would be drawn around it (./preview.$pageId.tsx).
//
// pathless: the `_` prefix keeps the segment out of the URL, so /admin is /admin and this file is
// what decides that reaching it needs a session. **being under this route is what makes a route
// gated** — there is no group id and no naming convention standing in for it — and
// ../routes.spec.ts holds every route in the app to that: under this layout, the preview, or on the
// public allow-list with the reason typed beside it.
//
// the gate is here rather than on ../root.tsx because middleware on the root runs for every route,
// the payment processor's callback included, and its body must be read exactly once by the handler
// that owns it (CLAUDE.md). see $lib/server/auth/gate.ts for what the gate resolves and where the
// signing key read now falls.
//
// it is also the frame: the operator shell (`Shell` in @better-giving/operator) is drawn once here
// rather than by each screen, so a screen under this route draws its own heading and content and
// nothing else. a screen that fails is drawn inside the same frame by `ErrorBoundary` below, so the
// rail stays.

export const middleware: Route.MiddlewareFunction[] = [staffGate];

/** the way out, a route of its own (./_app.admin.sign-out.ts). */
const SIGN_OUT_PATH = '/admin/sign-out';

/** where the mark at the head of the rail goes. */
const HOME = { href: '/admin', label: 'Dashboard' } as const;

/** the Donation page's editor, in the account menu. */
const DONATION_PAGE_EDITOR = '/admin/donation-page';

/** the published Donation page (./_index.tsx), in the top bar and the account menu. */
const DONATION_PAGE = '/';

// the sheet every screen beneath this layout wears, linked once here rather than by each of them.
export const links = operatorLinks;

// the loader is the gate's before it is the frame's. react router runs server middleware on a
// client-side navigation only when the navigation asks the server for something, so a screen under
// here with no loader of its own would be entered without the gate having run for it. one loader
// on this route makes every navigation into the protected surface a request the gate sees.
export async function loader({ request, context }: Route.LoaderArgs) {
	// the top bar names the organisation and the rail's head draws its logo: `null` where there is
	// no row or the read did not land, and the bar then says what the software is instead. a read
	// that throws is swallowed ($lib/server/config/setup-state.ts), because this layout covers the
	// screens that explain a database which is not answering, on exactly the deployment that needs
	// them.
	const state = await readSetupState(context.get(database), context.get(platform).env);
	const logo = state?.profile?.logoImageId ?? null;
	const user = context.get(staff);

	// an explicit projection, because everything returned here is serialized into the page: a
	// column a later better-auth or a wider org profile adds is not published by accident. the
	// session's user crosses as the two words the account block draws and nothing else of it.
	//
	// `deployer` is the predicate the pages behind the rail's deployer rows read, read again here
	// so a member is drawn no row leading to their not-found ($lib/admin/destinations.ts).
	//
	// `viewerZone` is the zone the `admin_zone` cookie names, so an instant on any screen beneath
	// renders on the server in the viewer's own day ($lib/admin/viewer-time.react.tsx). the cookie is
	// `Path=/`, so it rides on document and data requests alike, `/admin.data` included. before the
	// browser has written one, and for a value that is no zone, this is null, and `useViewerZone` falls
	// back to the browser's own zone, or to UTC where this runtime cannot write in that one
	// (`LocalTime`).
	//
	// `railCollapsed` is the rail as the shell's own cookie left it (@better-giving/operator's
	// rail-preference.ts), so the server draws it that way and the first client render matches.
	return {
		orgName: state?.profile?.legalName ?? null,
		// the logo at the address the app serves every image from (./image.$id.ts).
		orgLogo: logo === null ? null : imageSrc(logo),
		staff: { name: user.name, email: user.email },
		deployer: user.id === STAFF_USER_ID,
		viewerZone: parseViewerZone(cookieValue(request.headers, VIEWER_ZONE_COOKIE)),
		railCollapsed: parseRail(request.headers.get('cookie'))
	};
}

/**
 * the raw value of the cookie `name`, or null where the request carries none. not react router's
 * `createCookie`, which reads a value it signed or encoded itself: the browser writes this one as is.
 */
function cookieValue(headers: Headers, name: string): string | null {
	for (const element of headers.get('cookie')?.split(';') ?? []) {
		const at = element.indexOf('=');
		if (at !== -1 && element.slice(0, at).trim() === name) return element.slice(at + 1).trim();
	}
	return null;
}

type LayoutData = Route.ComponentProps['loaderData'];

/** the shell around `children`, drawn from the layout's own reading. */
function Frame({ data, children }: { readonly data: LayoutData; readonly children: ReactNode }) {
	// the destination is decided from the address rather than from a route id, because what marks
	// a row is which section the reader is in and a section is several routes deep
	// ($lib/admin/destinations.ts).
	const { pathname } = useLocation();
	const navigation = useNavigation();
	const submit = useSubmit();

	return (
		<Shell
			initialCollapsed={data.railCollapsed}
			// before anyone has saved the organisation's details there is no name to show, so it says
			// what the software is rather than printing an empty bar. the word is shared with every
			// screen's tab title, which falls back to the same one ($lib/admin/screen-title.ts).
			orgName={data.orgName ?? APP_NAME}
			orgLogo={data.orgLogo ?? undefined}
			home={HOME}
			groups={destinationGroupsFor(data.deployer)}
			current={currentDestination(pathname)}
			staff={data.staff}
			donationPage={DONATION_PAGE}
			editDonationPage={DONATION_PAGE_EDITOR}
			// a form post and not a call: writes are actions in this app (AGENTS.md → Boundaries). the
			// action is a route of its own (./_app.admin.sign-out.ts) because the way out is on every
			// screen and only one of them would have it.
			onSignOut={() => submit(null, { method: 'post', action: SIGN_OUT_PATH })}
			// the line runs over a move to another page. the pathname and never the whole address: a
			// search parameter changes what is over the page it is on, and a press on the page reports
			// at its own control.
			navigating={navigation.location !== undefined && navigation.location.pathname !== pathname}
			link={RouterLink}
		>
			<ViewerZoneProvider serverZone={data.viewerZone}>{children}</ViewerZoneProvider>
		</Shell>
	);
}

export default function ProtectedLayout({ loaderData }: Route.ComponentProps) {
	return (
		<Frame data={loaderData}>
			<Outlet />
		</Frame>
	);
}

/**
 * a screen beneath that failed, drawn inside the frame so the rail stays: a 404 for a record that
 * is not there or a page a member may not open, and the 500 for a read that did not land.
 *
 * where the layout has no reading — its own loader failed, or the gate threw before it ran, which
 * react router hands to this boundary (react-router/docs/how-to/middleware.md, "next() and Error
 * Handling") — there is no frame to draw, and it is the root's unframed page instead. never a
 * rethrow: react's server render has no boundary to catch one, so the document request fails its
 * render and leaves the page to react router's retry.
 */
export function ErrorBoundary() {
	const error = useRouteError();
	const data = useRouteLoaderData<LayoutData>('routes/_app');
	const arrival = useLocation().key;
	if (data === undefined) return <UnframedError />;

	const status = isRouteErrorResponse(error) ? error.status : 500;
	const message = isRouteErrorResponse(error) && typeof error.data === 'string' ? error.data : '';
	return (
		<Frame data={data}>
			<title>{`${errorTitle(status, false)} · ${data.orgName ?? APP_NAME}`}</title>
			<ErrorState
				status={status}
				message={message}
				arrival={arrival}
				way={
					<Button as={Link} to={HOME.href} variant="primary">
						Go to dashboard
					</Button>
				}
			/>
		</Frame>
	);
}
