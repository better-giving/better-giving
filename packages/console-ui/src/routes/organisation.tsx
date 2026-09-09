import { redirect } from 'react-router';

// /organisation — an address that moved, kept because it was one.
//
// the legal identity this deployment asks for gifts under is the first of the four jobs a gift
// needs, which ./_index.tsx folds, and what was on this screen is that fold's panel whole
// (../lib/org-fold.tsx). it is a fold rather than a screen because a page that already reports where the job stands has nowhere honest
// to send somebody for the controls that do it.
//
// **307 and not 301**, for ./connect.tsx's reason: a permanent redirect is one a browser caches
// past the day it stops being true, and nothing here promises this address for good.
//
// no component, which is what makes this an address and not a screen: the redirect is answered
// before anything renders, and a module with a component would be a screen nobody can reach. it is
// a `clientLoader` because nothing on this surface is served — ../../react-router.config.ts states
// why — so the router answers this in the browser, out of the bundle it already holds.
export function clientLoader() {
	throw redirect('/', 307);
}
