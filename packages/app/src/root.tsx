import { ErrorPanel } from '@better-giving/operator/components/shell/ErrorPanel';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { ReactNode } from 'react';
import {
	isRouteErrorResponse,
	Link,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useRouteError
} from 'react-router';
import type { Route } from './+types/root';
// the operator stylesheet is not imported here, and that absence is the mechanism: the document
// below renders the donor's page at `/{form_id}` as well as every operator screen, and the donation
// form's four sheets are unlayered while every operator declaration is layered (./app.css) — so a
// document that carried both would let one side outrank the other on every property only one of
// them sets. each surface links its own chain from its own `links`; $lib/admin/operator-links.ts is
// where that is argued and src/routes.spec.ts is what holds it.
import operatorSheet from './app.css?url';

// the document every screen is rendered into.
//
// **no `middleware` export belongs on this route.** middleware here runs for every route in the
// app, the payment processor's callback included, and anything that touches that request ahead of
// its handler breaks signature verification at runtime with nothing else reporting it (CLAUDE.md).
// a gate belongs on the layout that covers the screens it gates, never here.

// the project's own mark, and it is the project's rather than the organisation's: nothing here is
// org-editable (CLAUDE.md), so a fork inherits this file and this icon.
//
// declared rather than left to the filename convention, so the tag is in the document the server
// renders instead of a request the browser makes on its own for an address no route claims.
// ../static/favicon.ico is where the file is: static/ is this package's public directory
// (../vite.config.ts), which vite copies whole into the client build — the assets directory the
// deployed worker serves.
export function links(): Route.LinkDescriptors {
	return [{ rel: 'icon', href: '/favicon.ico', type: 'image/x-icon' }];
}

export function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

/**
 * the app's one error page, and it is on the root rather than on the protected layout
 * deliberately.
 *
 * an address matching no route matches nothing under `./routes/_app.tsx` either, so the gate never
 * runs for it and there is no session in the answer at all — which is what makes this reachable on
 * a deployment whose database is not answering. it renders inside `Layout` above, which depends on
 * no data, so this has nothing left to fail under it.
 *
 * it is also the one thing in this app under no surface, and therefore the one place a stylesheet
 * is linked from inside a tree rather than from a route's `links`: react 19 hoists a
 * `<link rel="stylesheet" precedence>` into the head, which is how a boundary that can replace any
 * screen — the donor's page included — still arrives dressed.
 *
 * nothing under `/api/v1` renders it: those routes answer with json or with the framework's own
 * fallback, so the public surface is unchanged by anything here.
 */
export function ErrorBoundary() {
	const error = useRouteError();
	const status = isRouteErrorResponse(error) ? error.status : 500;

	// react hoists this into the head. `precedence` is what makes it a hoisted stylesheet rather
	// than a tag rendered where it stands, and its value only orders it against other hoisted
	// sheets — there are none here.
	const sheet = <link rel="stylesheet" precedence="operator" href={operatorSheet} />;

	// the panel has two faces and the 404 is the one with a way out: an address that is not there
	// on a working deployment has somewhere to send anybody, while a deployment that would serve
	// the next screen is the thing that failed. `ErrorPanel` draws the panel; the address is this
	// app's and is stated here, because the part is a leaf shared with another surface whose route
	// table is not this one's.
	//
	// `Link` and never a bare anchor: /admin is one document and a way out that reloads it throws
	// away the whole client for a destination the router already has
	// ($lib/admin/button-navigates.dom.spec.tsx).
	if (status === 404) {
		return (
			<>
				{sheet}
				<ErrorPanel
					code="404"
					title="No such page"
					wayOut="Go to forms"
					wayOutProps={{ as: Link, to: '/admin/forms' }}
				>
					It may have been deleted, or the address may be wrong.
				</ErrorPanel>
			</>
		);
	}

	// the failures able to reach here are written where the failure is known and mark their
	// commands and variable names with backticks — the gate's message names the table and the
	// command that mints the signing key ($lib/server/auth/signing-key.ts). react router hides the
	// text of anything it did not expect, so the fallback is a state rather than a sentence
	// somebody wrote for it.
	const message = isRouteErrorResponse(error) && typeof error.data === 'string' ? error.data : '';

	return (
		<>
			{sheet}
			<ErrorPanel code="500" title="This deployment could not answer">
				<MarkedText
					text={
						message ||
						'Nothing more is known here. This deployment’s logs say why: the Cloudflare dashboard has them, and `pnpm run logs` reads them from a checkout.'
					}
				/>
			</ErrorPanel>
		</>
	);
}
