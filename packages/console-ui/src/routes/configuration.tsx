import { redirect } from 'react-router';

// /configuration — an address that moved, kept because it was one.
//
// it was the one address every value this deployment is configured with was set from, so a bookmark
// on it is likelier than one on ./connect.tsx or ./setup.tsx, which are kept for the same reason.
// what it held is with the job each value serves: the pair that lets anyone reach /admin is set by
// the deploy press on ./_index.tsx, the mail credentials and the settings a receipt is sent under in
// that same page's last fold (../lib/smtp-fold.tsx), the Turnstile pair in its sites fold
// (../lib/sites-fold.tsx), all three Stripe values on ./payments.tsx.
// `BETTER_AUTH_URL` has a box on none of them — the app derives that origin per request, and
// ../lib/deploy-vars.ts states why this console offers no box for it.
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
