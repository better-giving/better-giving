import type { ShouldRevalidateFunctionArgs } from 'react-router';

// every address parameter that opens a dialog on this console, and the reading that keeps opening
// one off the loader.
//
// **the dialogs are parameters on the address rather than component state**, which is what makes
// the way out of each a link and what makes Escape and the browser's own back button answer the
// same way (../routes/_index.tsx and ./connect-panel.tsx each state the arrangement over the press
// they draw). the cost of that is a link press being a navigation: without a word from
// `shouldRevalidate` the router re-reads the page before the dialog can draw, and the whole of that
// read is loopback round trips — so the press an operator made sits doing nothing for as long as
// the binary takes to answer.
//
// **the set has one home because the reading below is over all of it at once.** what it asks is
// whether an address differs from the one before it in nothing but these, so a parameter minted at
// the screen that draws its dialog is one this reading counts as a real change: that dialog opens
// after the wait this module exists to remove, and nothing goes wrong loudly enough to say so. a
// new dialog is a name added here and read at its screen from here.

/** what the address carries while the head's close confirm is up, which is the whole of what draws it. */
export const CLOSE_PARAM = 'close';

/**
 * what the address carries while the connect panel's confirm over leaving cloudflare is up.
 *
 * it is spelled for the sign-in the dialog is about and not for the press that ends it, which is
 * the spelling an operator's address bar carries (./connect-panel.tsx).
 */
export const SIGNIN_PARAM = 'signin';

const DIALOG_PARAMS = [CLOSE_PARAM, SIGNIN_PARAM];

/** an address with every dialog parameter taken off it, which is what two of them are compared by. */
function withoutDialogs(url: URL): string {
	const params = new URLSearchParams(url.search);
	for (const name of DIALOG_PARAMS) params.delete(name);
	return `${url.pathname}?${params}`;
}

/**
 * whether this navigation does nothing but open or drop a dialog, and so has nothing to re-read.
 *
 * **a submission is never one of these however the address moves**, and that is the arm that
 * matters: the connect panel's sign-out posts and answers with a redirect from `/?signin` to `/`,
 * which is a pair of addresses this would otherwise read as the dialog being dropped — and a page
 * that skipped the read there would go on drawing the cloudflare account it has just signed out of.
 * `formMethod` is what separates the two: the router carries the submission through the redirect it
 * followed (`getLoadingNavigation` in the installed `react-router`), and a link press has none.
 */
export function opensOrDropsDialog({
	currentUrl,
	nextUrl,
	formMethod
}: ShouldRevalidateFunctionArgs): boolean {
	if (formMethod !== undefined) return false;
	return withoutDialogs(currentUrl) === withoutDialogs(nextUrl);
}
