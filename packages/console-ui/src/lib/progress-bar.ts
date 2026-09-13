// the one signal between the console's progress bar and the reading that replaces the screen it
// stands over.
//
// ../root.tsx draws that bar — as the document's own waiting face while the app starts, and over
// the page being left while a navigation reads the next one — and a route's `clientLoader` is what
// knows the reading has landed. the two share nothing: a fallback stands in for a route that has
// not rendered, and a pending navigation's page has not rendered either, so there are no props
// between them and no component above both. this module is the seam — the bar subscribes, the
// loader flips it and waits for the bar to land.
//
// **it is module state because there is one bar and one page on the screen.** a reading taken for
// the page already drawn is a revalidation under that page, with no bar over it, so it finishes
// nothing and waits for nothing.

import { MOTION_CAP_MS } from './motion-end';

/** what a drawer of the bar is told when the state changes: `useSyncExternalStore`'s shape. */
type Watcher = () => void;

/** whether the bar has been told to rush to its end. */
let finishing = false;

/** every drawer of the bar. one page draws one, and the set is what makes the subscription plain. */
const watchers = new Set<Watcher>();

const tell = () => {
	for (const watcher of watchers) watcher();
};

/** the bar's side: told whenever the state below changes, and handed back its way out. */
export function subscribeProgressBar(watcher: Watcher): () => void {
	watchers.add(watcher);
	return () => {
		watchers.delete(watcher);
	};
}

/** the bar's reading: whether it is to draw its finish. */
export function progressBarFinishing(): boolean {
	return finishing;
}

/** what releases the pass that is waiting on the bar, and `null` where none is waiting. */
let release: (() => void) | null = null;

/** the bar's side: the rush has landed on its last cell, so the screen may be replaced. */
export function progressBarLanded(): void {
	release?.();
}

/** the pathname of the page on the screen, and `null` before the first one has been drawn. */
let drawn: string | null = null;

/**
 * ../root.tsx's side: the page at this pathname is the one on the screen now.
 *
 * the bar that finished for it went when this page replaced the one it stood over, so the finish is
 * put down here. the next bar mounts on the press, before its reading takes a pass (`holdBar`) — the
 * route module loads first — and a finish still up would open that bar at its rush and drop it back
 * to filling.
 */
export function pageDrawn(pathname: string): void {
	drawn = pathname;
	if (finishing) {
		finishing = false;
		tell();
	}
}

/**
 * whether a reading of `to` stands behind the bar, with `on` the pathname drawn now.
 *
 * the pathname and never the whole address: a search parameter on this console opens or drops a
 * dialog over the page it is on (./dialog-params.ts), and a press re-reads that page and reports at
 * its own control. before anything is drawn, every reading is behind the bar the document draws.
 */
export function movesPage(to: string, on: string | null): boolean {
	return on === null || to !== on;
}

/**
 * the history state a link carries to name what the bar over its move says, written beside the
 * link — `<Link state={opening('Opening Stripe')}>`. the words are what the bar's status region is
 * read as; the bar over a move shows none.
 */
export const opening = (label: string) => ({ opening: label });

/** what the bar over a move says, read off the pending location's state. */
export function openingLabel(state: unknown): string {
	if (typeof state !== 'object' || state === null || !('opening' in state)) return 'Opening';
	return typeof state.opening === 'string' ? state.opening : 'Opening';
}

/** a loader's hold on the bar, taken as its reading starts and finished once the reading is in. */
export type BarPass = { finish: () => Promise<void> };

const passedStraight: BarPass = { finish: () => Promise.resolve() };

/** which navigation the bar is standing for: each one behind the bar takes the next. */
let latest = 0;

/**
 * the loader's side, for a reading of `to`: taken before anything is read, and finished after.
 *
 * `finish` flips the bar to its rush and resolves once the bar has been seen full, and resolves at
 * once for a re-read of the page already drawn.
 *
 * **a navigation a later one took the place of finishes nothing.** the router throws its reading
 * away, and the bar standing now is the later one's — a rush on its say-so would put a full bar
 * over a reading still in flight. so taking a pass puts the bar back to filling and lets go of any
 * pass still waiting on it.
 */
export function holdBar(to: string): BarPass {
	if (!movesPage(to, drawn)) return passedStraight;
	const pass = ++latest;
	release?.();
	if (finishing) {
		finishing = false;
		tell();
	}
	return { finish: () => (pass === latest ? finishBar() : Promise.resolve()) };
}

function finishBar(): Promise<void> {
	finishing = true;
	tell();
	return new Promise((settle) => {
		/* nothing but the bar itself can say the rush has landed, so a bar that was never drawn
		   would hold the screen for as long as the console is open. the cap is what makes the wait a
		   wait rather than a dependency on a bar having mounted. */
		const capped = setTimeout(done, MOTION_CAP_MS);
		function done() {
			if (release === done) release = null;
			clearTimeout(capped);
			settle();
		}
		release = done;
	});
}
