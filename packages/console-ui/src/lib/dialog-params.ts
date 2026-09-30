import type { ReactNode } from 'react';
import { createElement } from 'react';
import type {
	LinkProps,
	Location,
	NavigateFunction,
	ShouldRevalidateFunctionArgs
} from 'react-router';
import { Link, useLocation, useNavigate } from 'react-router';
import { saidClosing } from './close-answer';
import { droppedSinceRead } from './console-reading';
import { saidRefused } from './refused-answer';

// every address parameter that opens a dialog on this console, and the reading that keeps opening
// one off the loader.
//
// **the dialogs are parameters on the address rather than component state**, which is what makes
// Escape, the dialog's own way out and the browser's back button answer the same way
// (./close-confirm.tsx and ./cloudflare-account.tsx draw them), save the close over the
// cloudflare gate, which opens from state (../routes/_sections.tsx's `ErrorBoundary` says why).
// every opener on this console pushes its entry carrying {@link OPENED_HERE}, and the way out
// steps back over an entry that carries it, so the history holds no entry for a dialog once it is
// left and Back after it leaves the page; an address that arrived carrying the parameter — typed,
// or `/cloudflare-plan`'s redirect — has no entry of the page before it to step back to, so its way
// out takes that entry's place instead ({@link leaveDialog}). the cost of the address is a link
// press being a navigation: without a word from `shouldRevalidate` the
// router re-reads the page before the dialog can draw, and the whole of that read is loopback round
// trips — so the press an operator made sits doing nothing for as long as the binary takes to
// answer.
//
// **a link that only opens or drops a dialog still re-reads where a press was dropped since the
// reading on screen was taken** (`droppedSinceRead` in ./console-reading.ts). a dialog link pressed
// while a page's save is in flight replaces that save's navigation: the router throws its answer
// away, the write lands on the binary all the same, and the page would go on drawing what it held
// before it — the save's tick never drawn, the rail and the boxes a write behind. nothing the router
// hands `shouldRevalidate` says so, so every `clientAction` watches its own request, which the
// router aborts when another navigation replaces it, in its action or in the re-read after it
// (`watchPress` there), and the count is compared with the one the drawn reading was taken after.
// the openers are never held for it, the close's included, since the binary finishes a press
// before it shuts anything down: the dialog opens once the write is answered and the page read
// after it. a dialog link runs no loader otherwise, which is what leaves a fetcher's re-read still
// out under it to land — and why no route on this console states a `clientMiddleware`: one on any
// route has the router run the load step for every navigation, which throws that re-read away.
//
// **the set has one home because the reading below is over all of it at once.** what it asks is
// whether an address differs from the one before it in nothing but these, so a parameter minted at
// the screen that draws its dialog is one this reading counts as a real change: that dialog opens
// after the wait this module exists to remove, and nothing goes wrong loudly enough to say so. a
// new dialog is a name added here and read at its screen from here.

/** what the address carries while the head's close confirm is up, which is the whole of what draws it. */
export const CLOSE_PARAM = 'close';

/** what the address carries while the account panel is up (./cloudflare-account.tsx). */
export const ACCOUNT_PARAM = 'account';

const DIALOG_PARAMS = [CLOSE_PARAM, ACCOUNT_PARAM];

/** the history state every dialog opener on this console pushes its entry with. */
export const OPENED_HERE = { openedHere: true } as const;

/** the link every dialog opener is drawn as: its address, pushed carrying {@link OPENED_HERE}. */
export const DialogLink = (props: Omit<LinkProps, 'state'>): ReactNode =>
	createElement(Link, { ...props, state: OPENED_HERE });

const openedHere = (state: unknown): boolean =>
	typeof state === 'object' && state !== null && 'openedHere' in state && state.openedHere === true;

/**
 * a dialog's way out, from `location` to `back`, the page's address without the parameter: back
 * over the entry an opener pushed, or in place of one the address arrived as.
 */
export function leaveDialog(
	navigate: NavigateFunction,
	location: Location,
	back: string
): void | Promise<void> {
	if (openedHere(location.state)) return navigate(-1);
	return navigate(back, { replace: true, preventScrollReset: true });
}

/** {@link leaveDialog} over the location a dialog is drawn at, for a way out to call. */
export function useLeaveDialog(): (back: string) => void {
	const navigate = useNavigate();
	const location = useLocation();
	return (back) => {
		void leaveDialog(navigate, location, back);
	};
}

/** an address with every dialog parameter taken off it, which is what two of them are compared by. */
function withoutDialogs(url: URL): string {
	const params = new URLSearchParams(url.search);
	for (const name of DIALOG_PARAMS) params.delete(name);
	return `${url.pathname}?${params}`;
}

/**
 * whether this navigation does nothing but open or drop a dialog, and so has nothing to re-read.
 *
 * **a submission is never one of these however the address moves**: a press made from inside a
 * dialog posts at that dialog's address, and a page that skipped the read over it would go on
 * drawing what the press has just changed. `formMethod` is what separates the two: the router
 * carries the submission through any redirect it followed (`getLoadingNavigation` in the installed
 * `react-router`), and a link press has none.
 */
export function opensOrDropsDialog({
	currentUrl,
	nextUrl,
	formMethod
}: ShouldRevalidateFunctionArgs): boolean {
	if (formMethod !== undefined) return false;
	return withoutDialogs(currentUrl) === withoutDialogs(nextUrl);
}

/**
 * the `shouldRevalidate` every console route with a loader states: every press re-reads, except the
 * one that ends the process it would read and one turned down over its boxes (./refused-answer.ts),
 * and no link that only opens or drops a dialog does, unless a press was dropped since the reading
 * on screen was taken.
 *
 * the binary answers the close and then stops, so a read after it cannot land: it reaches nothing,
 * the loader rejects, and the operator meets the boundary that says the console crashed in place of
 * the blank page closing it leaves. the answer carries the reading that stops it
 * (./close-answer.ts), which is what the router hands `actionResult` over for — a fetcher's answer
 * included, which is how the close is posted (./close-confirm.tsx).
 */
export function consoleRereads(args: ShouldRevalidateFunctionArgs): boolean {
	if (saidClosing(args.actionResult)) return false;
	if (saidRefused(args.actionResult)) return false;
	if (opensOrDropsDialog(args)) return droppedSinceRead();
	return args.defaultShouldRevalidate;
}
