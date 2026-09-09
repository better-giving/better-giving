import { redirect } from 'react-router';

// /receipts — an address that moved, kept because it was one.
//
// what carries a receipt out of this deployment is one of the jobs ./_index.tsx folds, and what was
// on this screen is that fold's panel whole (../lib/smtp-fold.tsx). the move is what puts the test
// send beside the organisation profile a receipt is printed from and the mail settings it goes out
// over: three readings an operator had to hold across two addresses to know whether a donor gets
// anything at all.
//
// **307 and not 301**, for ./connect.tsx's reason: a permanent redirect is one a browser caches past
// the day it stops being true, and nothing here promises this address for good. an operator who
// bookmarked it while it was a screen is the whole reason the file is still here.
//
// no component, which is what makes this an address and not a screen: the redirect is answered
// before anything renders, and a module with a component would be a screen nobody can reach. it is
// a `clientLoader` because nothing on this surface is served — ../../react-router.config.ts states
// why — so the router answers this in the browser, out of the bundle it already holds.
export function clientLoader() {
	throw redirect('/', 307);
}
