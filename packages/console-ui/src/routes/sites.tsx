import { redirect } from 'react-router';

// /sites — an address that moved, kept because it was one.
//
// where a donation form may be loaded is the third of the four jobs a gift needs, which ./_index.tsx
// folds, and what was on this screen is that fold's panel whole (../lib/sites-fold.tsx). the move is
// what puts the site list on the same page as the deployment's own state: the list decides whether
// any form loads at all, and a screen an operator had to leave the page to reach is one they leave
// holding the page's other three answers in their head.
//
// **307 and not 301**, for ./connect.tsx's reason: a permanent redirect is one a browser caches past
// the day it stops being true, and nothing here promises this address for good. this one was the
// likeliest of the four to be bookmarked while it was a screen — it is the only errand an operator
// comes back to every time they put a form on a new site — which is the whole reason the file is
// still here.
//
// no component, which is what makes this an address and not a screen: the redirect is answered
// before anything renders, and a module with a component would be a screen nobody can reach. it is
// a `clientLoader` because nothing on this surface is served — ../../react-router.config.ts states
// why — so the router answers this in the browser, out of the bundle it already holds.
export function clientLoader() {
	throw redirect('/', 307);
}
