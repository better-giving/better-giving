import { redirect } from 'react-router';

// /payments — an address that moved, kept because it was one.
//
// it listed the processors, and each now has a page of its own under this address:
// ./_sections.payments.stripe.tsx and ./_sections.payments.paypal.tsx. a bare `/payments` names
// neither, so it opens Stripe's, the first of the two in the rail. it is the address an operator is
// likeliest to be holding, because it is the one they go looking for on somebody else's prompting:
// Stripe writes to say an endpoint is failing, and this is where they came to read about their
// account.
//
// **the two pages under this address are not its children.** their files are named under the
// sections layout, `_sections.payments.*`, so this module is no prefix of theirs and its redirect
// never runs in front of them.
//
// **307 and not 301**: a permanent redirect is one a browser caches past the day it stops being
// true, and nothing here promises this address for good.
//
// no component, which is what makes this an address and not a screen: the redirect is answered
// before anything renders. it is a `clientLoader` because nothing on this surface is served —
// ../../react-router.config.ts states why.
export function clientLoader() {
	throw redirect('/payments/stripe', 307);
}
