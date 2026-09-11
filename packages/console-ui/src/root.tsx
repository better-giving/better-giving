import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import type { Route } from './+types/root';
import { endsWithin } from './lib/motion-end';
import { ProductFoot } from './lib/product-foot';
import { startingBarFinishing, startingBarLanded, subscribeStartingBar } from './lib/starting-bar';
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
// which project a tab belongs to and the title says which of its two surfaces — the console is one
// page and `TITLE` in ./routes/_index.tsx is the whole of it.
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
 * what says the wait is over, so ./routes/_index.tsx's `clientLoader` flips the bar to its rush and
 * waits until all twenty cells have stood on screen for the beat a full bar is seen for — the rush
 * puts the twentieth cell on its own last instant, so its end is the bar arriving and the dwell
 * after it is the bar being seen. ./lib/starting-bar.ts is the signal between the two, because a
 * fallback stands in for a route that has not rendered and there are no props between them. a bar
 * taken away part full reports that the console gave up on the reading rather than that it
 * arrived.
 *
 * **it carries no head.** every head after this one is an identity with the one press across from
 * it (./lib/head-strip.tsx), and this screen has read neither — so there is nothing for a band to
 * hold, and an empty band over a bar reads worse than none: a rule drawn under nothing says the
 * page has already drawn a head and left it blank.
 *
 * **bare**, because a bar is the whole of it and a box around it draws a boundary around nothing —
 * the state `bare` in packages/operator/src/components/shell/AppShell.jsx is written for.
 *
 * the foot stands here as it does on every screen after it, with no release in it: nothing has been
 * read yet, and a strip that appeared, vanished and came back over the first two paints would be the
 * one moving thing on a page that is otherwise still (./lib/product-foot.tsx).
 */
export function HydrateFallback() {
	const finishing = useSyncExternalStore(
		subscribeStartingBar,
		startingBarFinishing,
		// the build renders this document once to write index.html, where nothing has read and
		// nothing can have finished (../vite.config.ts).
		startingBarFinishing
	);
	const bar = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const cells = bar.current;
		if (!finishing || cells === null) return;
		let landed = false;
		const land = () => {
			if (landed) return;
			landed = true;
			startingBarLanded();
		};
		/* the rush and the dwell after it are both drawn on `::before` and both dispatch their
		   `animationend` at the span, so the name is what tells them apart. `adm-dwell` is the
		   hold, and its end is the one that says the bar has been seen full
		   (packages/operator/src/styles/adm.css). */
		const ended = (e: AnimationEvent) => {
			if (e.animationName === 'adm-dwell') land();
		};
		cells.addEventListener('animationend', ended);
		/* the backstop, for a hold no sheet reached this pseudo-element to run. it covers the rush
		   in front of the dwell as well as the dwell itself, which is why the delay is read beside
		   the duration (./lib/motion-end.ts). */
		const step = getComputedStyle(cells, '::before');
		const capped = setTimeout(land, endsWithin(step.animationDuration, step.animationDelay));
		return () => {
			cells.removeEventListener('animationend', ended);
			clearTimeout(capped);
		};
	}, [finishing]);

	return (
		<PanelRoute bare foot={<ProductFoot version="" />}>
			<title>{TITLE}</title>
			<div className="adm-stack adm-stack--tight adm-stack--centred">
				{/* polite, and the label is the one word a reader of the tree gets: what the bar's rush
				    reports is that the wait is over, which the screen it is replaced by states in its
				    own words a moment later. the bar itself is decorative — its cells are drawn by the
				    sheet and say nothing a reader could read — so it is hidden from the tree and the
				    wrapper speaks for it. */}
				<div role="status" aria-label="Starting">
					<span
						ref={bar}
						className={finishing ? 'adm-braille-bar is-finishing' : 'adm-braille-bar'}
						aria-hidden="true"
					/>
				</div>
			</div>
		</PanelRoute>
	);
}

export default function App() {
	return <Outlet />;
}
