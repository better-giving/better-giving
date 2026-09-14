import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { ProgressBar } from '@better-giving/operator/components/status/ProgressBar';
import { movesPage, openingLabel, pageDrawn } from '@better-giving/operator/progress-bar';
import { type ReactNode, useEffect } from 'react';
import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLocation,
	useNavigation
} from 'react-router';
import type { Route } from './+types/root';
import { ProductFoot } from './lib/product-foot';
import { TITLE } from './routes/_index';
// the one place the console's stylesheet enters the app, and it must stay singular: a route
// rendering outside this document is a route with no styles at all. one import, because
// ./app.css declares the cascade layers and then imports the sheets in the order they have to be
// read.
import './app.css';

// the document every screen is rendered into.
//
// **no loader, and nothing here travels between screens.** every outcome in this console reports at
// the control that carried it, on the screen that carried it — which is why the one-shot cookie
// this route used to consume is gone: forgetting the recorded Cloudflare account lands back on the
// screen the press is on, and the connect panel standing where the shell was is the outcome.

// the same mark the dashboard carries, and the two dev servers run side by side — so the icon says
// which project a tab belongs to and the title says which of its two surfaces: every page's title
// ends with `TITLE` in ./routes/_index.tsx.
//
// ../public/favicon.ico is where the file is, and this package resolves it differently from the
// other one: vite's `publicDir` defaults to `public` under the project root and ../vite.config.ts
// sets neither, so the dev server serves that directory at the root and the build copies it whole
// into `build/client`, which is what the binary embeds (packages/console/ui/embed.go).
export function links(): Route.LinkDescriptors {
	return [{ rel: 'icon', href: '/favicon.ico', type: 'image/x-icon' }];
}

export function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="text-scale" content="scale" />
				<Meta />
				<Links />
			</head>
			<body>
				<div style={{ display: 'contents' }}>{children}</div>
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

/**
 * what stands where the page goes while the first reading lands.
 *
 * it is here rather than beside the page it stands in for, because a client-rendered app draws one
 * waiting face and the document owns it (../react-router.config.ts is `ssr: false`). the tab is
 * titled from here for the same reason: nothing was served, so nothing has named it yet.
 *
 * it says nothing about what is coming, because every reading behind it is on this machine — a
 * loopback call to the binary — and a sentence explaining a wait this short is a sentence the
 * operator meets only when something is already wrong. **no heading either**: the bar is the whole
 * of it, the way a page-load bar is on a site that draws one. it is `.adm-braille-bar` off
 * packages/operator/src/styles/adm.css, a terminal's bar in braille cells, and it fills the way
 * such a bar does — fast at first, then slower, never reaching the end on its own — because nothing
 * is measured while the reading is in flight. a bar that is filling is what says the wait is a wait
 * and not a screen that has stopped.
 *
 * **it finishes, and is seen finished, before this screen is replaced.** the reading landing is
 * what says the wait is over, so the route's `clientLoader` flips the bar to its rush and waits
 * until all twenty cells have stood on screen for the beat a full bar is seen for
 * (packages/operator/src/components/status/ProgressBar.jsx). a bar taken away part full reports
 * that the console gave up on the reading rather than that it arrived.
 *
 * **it carries no head and no rail.** every screen after this one states the account and the press
 * that ends the console — in a head (./lib/head-strip.tsx) or at the rail's foot
 * (./routes/_sections.tsx) — and this screen has read neither, so there is nothing for a band to
 * hold, and an empty band over a bar reads worse than none: a rule drawn under nothing says the page
 * has already drawn a head and left it blank.
 *
 * **bare**, because a bar is the whole of it and a box around it draws a boundary around nothing —
 * the state `bare` in packages/operator/src/components/shell/AppShell.jsx is written for.
 *
 * the foot stands here as it does under `/`'s faces, with no release in it: nothing has been read
 * yet, and a strip that appeared, vanished and came back over the first two paints would be the one
 * moving thing on a page that is otherwise still (./lib/product-foot.tsx).
 */
export function HydrateFallback() {
	return (
		<PanelRoute bare foot={<ProductFoot version="" />}>
			<title>{TITLE}</title>
			<div className="adm-stack adm-stack--tight adm-stack--centred">
				<ProgressBar label="Starting" overMove={false} />
			</div>
		</PanelRoute>
	);
}

/**
 * every screen, and the bar over the one being left while the next one is read.
 *
 * **a move to another page is drawn under the bar from the moment it is asked for**, and the page
 * being left stays drawn beneath it: the destination's `clientLoader` holds it back until the bar
 * has finished and been seen full, the rule the document's own bar above follows. a press or a
 * dialog on the page already drawn is not a move (`movesPage` in
 * packages/operator/src/progress-bar.ts) — a press reports at its own control. what it says is
 * loading is carried by the link that was pressed (`opening` there).
 *
 * **it stands exactly as long as the router is moving**, so a move that lands on an error boundary
 * or is taken over by a second press leaves no bar behind: both end the navigation this reads.
 */
export default function App() {
	const navigation = useNavigation();
	const { pathname } = useLocation();
	useEffect(() => pageDrawn(pathname), [pathname]);
	const moving =
		navigation.location !== undefined && movesPage(navigation.location.pathname, pathname);

	return (
		<>
			{moving ? <ProgressBar label={openingLabel(navigation.location?.state)} overMove /> : null}
			<Outlet />
		</>
	);
}
