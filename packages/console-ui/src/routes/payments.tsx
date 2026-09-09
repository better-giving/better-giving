import { redirect } from 'react-router';

// /payments — an address that moved, kept because it was one.
//
// what takes the money is the second of the four jobs a gift needs, which ./_index.tsx folds, and
// what was on this screen is that fold's panel whole (../lib/payments-fold.tsx). it was the last of
// the four to move, so this is the address most recently true — and the one an operator is likeliest to be
// holding, because it is the only one they go looking for on somebody else's prompting: Stripe
// writes to say an endpoint is failing, and this is where they came to read what it says about
// their account.
//
// the move is what puts the three Stripe values beside the site list the form loads on and the mail
// that carries the receipt out. an operator who deployed, pasted two keys and then walked to a
// second address to find out whether a card can be charged was reading two of the same four answers
// on two pages.
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
