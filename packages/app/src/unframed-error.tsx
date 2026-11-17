import { Button } from '@better-giving/operator/components/controls/Button';
import { isRouteErrorResponse, Link, useLocation, useMatches, useRouteError } from 'react-router';
import { APP_NAME } from '$lib/admin/screen-title';
import { ErrorState, errorTitle } from '$lib/error-state';
// the operator stylesheet is linked from inside this tree, and only here: ./root.tsx's header and
// $lib/admin/operator-links.ts argue why the document itself carries none.
import operatorSheet from './app.css?url';

/** the ids react router gives the donor pages, ./routes/donate.tsx and ./routes/$slug.tsx. */
const DONOR_PAGE_ROUTE_IDS: ReadonlySet<string> = new Set(['routes/donate', 'routes/$slug']);

/**
 * the error page of everything the operator shell does not frame: the donor pages, the screens
 * outside the login, and a failure of the protected layout's own reading — drawn by ./root.tsx's
 * `ErrorBoundary`, and by ./routes/_app.tsx's where the layout has no reading to frame it with. a
 * screen under the layout fails inside the shell, in the same words, both drawn by `ErrorState`
 * ($lib/error-state.tsx).
 *
 * it reads the error and the matches off the router and nothing else, so it renders under any
 * boundary and has nothing left to fail under it.
 *
 * it is also the one thing in this app under no surface, and therefore the one place a stylesheet
 * is linked from inside a tree rather than from a route's `links`: react 19 hoists a
 * `<link rel="stylesheet" precedence>` into the head, which is how a boundary that can replace any
 * screen — a donor page included — still arrives dressed.
 */
export function UnframedError() {
	const error = useRouteError();
	const status = isRouteErrorResponse(error) ? error.status : 500;

	// react hoists this into the head. `precedence` is what makes it a hoisted stylesheet rather
	// than a tag rendered where it stands, and its value only orders it against other hoisted
	// sheets — there are none here.
	const sheet = <link rel="stylesheet" precedence="operator" href={operatorSheet} />;

	// the tab names the state drawn, in $lib/admin/screen-title.ts's shape, and react
	// hoists the tag into the head as it does the sheet. it reads the project's name rather than the
	// organisation's off the layout's match, because the layout's own read may be what failed and
	// this page depends on no data. `<Meta />` draws no title over it: it reads no route beneath a
	// boundary, and neither ./root.tsx nor ./routes/_app.tsx exports `meta`.
	//
	// a donor page is the organisation's and not the project's, so there the second half is the
	// word its own tab falls back to (`meta` in ./routes/donate.tsx). which page this is comes off
	// the matched route's id and never its data, for the same reason the name does.
	const onDonorPage = useMatches().some((match) => DONOR_PAGE_ROUTE_IDS.has(match.id));
	const tab = (face: string) => <title>{`${face} · ${onDonorPage ? 'Donate' : APP_NAME}`}</title>;

	// the failures able to reach here are written where the failure is known and mark their
	// commands and variable names with backticks — the message for a pin that names no address
	// names `BETTER_AUTH_URL` and how to set it ($lib/server/auth/pin.ts). react router hides the
	// text of anything it did not expect, so the fallback is a state rather than a sentence
	// somebody wrote for it. a 4xx is the app answering, not failing: the form layer refuses a
	// hand-built body with a 400 ($lib/server/conform.ts), and its sentence is drawn as page copy
	// on every page this boundary replaces, a donor page included.
	const message = isRouteErrorResponse(error) && typeof error.data === 'string' ? error.data : '';
	const arrival = useLocation().key;

	// the 404 alone has a way out, the dashboard, which every staff session may open. `Link` and
	// never a bare anchor: /admin is one document and a way out that reloads it throws away the
	// whole client for a destination the router already has ($lib/admin/button-navigates.dom.spec.tsx).
	// a donor holds no staff session, so on a donor page it is a sign-in screen they cannot pass and
	// is not drawn at all; and a donor is told only that the page did not load, never the
	// deployment's sentence or its logs.
	return (
		<main>
			{sheet}
			{tab(errorTitle(status, onDonorPage))}
			<ErrorState
				status={status}
				message={message}
				arrival={arrival}
				donor={onDonorPage}
				way={
					onDonorPage ? undefined : (
						<Button as={Link} to="/admin" variant="primary">
							Go to dashboard
						</Button>
					)
				}
			/>
		</main>
	);
}
