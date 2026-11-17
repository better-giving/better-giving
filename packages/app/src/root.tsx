import type { ReactNode } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import type { Route } from './+types/root';
// the operator stylesheet is not linked here, and that absence is the mechanism: the document
// below renders the donor pages, `/donate` and each campaign's address, as well as every operator
// screen, and the donation form's sheets are unlayered while every operator declaration is
// layered (./app.css) — so a document that carried both would let one side outrank the other on
// every property only one of them sets. each surface links its own chain from its own `links`;
// $lib/admin/operator-links.ts is where that is argued and src/routes.spec.ts is what holds it.
// the error page is the one exception, and links it from inside its own tree (./unframed-error.tsx).
import { UnframedError } from './unframed-error';

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
// (../vite.config.ts), which vite copies whole into the client build — the directory the Node
// server serves static files from (../server/start.ts).
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
				{/* an empty nonce in place of the one `ServerRouter` hands down: a browser hides a nonce's
				    value from the page, and the client is never handed one, so a link drawn with it
				    hydrates as a mismatch. a link needs none — `style-src` and `script-src` both take
				    'self' (./document-policy.ts). */}
				<Links nonce="" />
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
 * the error page of everything the operator shell does not frame (./unframed-error.tsx).
 *
 * an address matching no route matches nothing under `./routes/_app.tsx` either, so the gate never
 * runs for it and there is no session in the answer at all — which is what makes this reachable on
 * a deployment whose database is not answering. it renders inside `Layout` above, which depends on
 * no data, so this has nothing left to fail under it.
 *
 * nothing under `/api/v1` renders it: those routes answer with json or with the framework's own
 * fallback, so the public surface is unchanged by anything here.
 */
export function ErrorBoundary() {
	return <UnframedError />;
}
