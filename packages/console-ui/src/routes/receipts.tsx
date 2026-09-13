import { redirect } from 'react-router';

// /receipts — an address that moved, kept because it was one.
//
// what carries a receipt out of this deployment is the mail it sends, and what was on this screen
// is that page's form whole, test send included (./_sections.smtp.tsx, ../lib/smtp-fold.tsx).
//
// **307 and not 301**: a permanent redirect is one a browser caches past the day it stops being
// true, and nothing here promises this address for good. an operator who bookmarked it while it
// was a screen is the whole reason the file is still here.
//
// no component, which is what makes this an address and not a screen: the redirect is answered
// before anything renders. it is a `clientLoader` because nothing on this surface is served —
// ../../react-router.config.ts states why.
export function clientLoader() {
	throw redirect('/smtp', 307);
}
