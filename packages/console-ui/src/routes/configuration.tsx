import { redirect } from 'react-router';

// /configuration — an address that moved, kept because it was one.
//
// it was the one address every value this deployment is configured with was set from, so a bookmark
// on it is likely. what it held is now on the page of the job each value serves, and it opens on the
// first of them: the password that lets anyone reach /admin (./_sections.password.tsx).
// `BETTER_AUTH_URL` has a box on none of them — the app falls back to the origin a request arrived
// on where nothing is pinned, and ../lib/deploy-vars.ts states what a pinned one decides and why
// this console offers no box for it.
//
// **307 and not 301**: a permanent redirect is one a browser caches past the day it stops being
// true, and nothing here promises this address for good.
//
// no component, which is what makes this an address and not a screen: the redirect is answered
// before anything renders, and a module with a component would be a screen nobody can reach. it is
// a `clientLoader` because nothing on this surface is served — ../../react-router.config.ts states
// why — so the router answers this in the browser, out of the bundle it already holds.
export function clientLoader() {
	throw redirect('/password', 307);
}
