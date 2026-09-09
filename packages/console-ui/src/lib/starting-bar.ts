// the one signal between the bar the document draws while it is starting and the reading that
// replaces it.
//
// ../root.tsx draws that bar and ../routes/_index.tsx's `clientLoader` is what knows the reading
// has landed, and the two share nothing: a fallback stands in for a route that has not rendered, so
// there are no props between them and no component above both. this module is the seam — the
// fallback subscribes, the loader flips it and waits for the bar to land.
//
// **it is per page and not per call, which is why it is module state.** one bar is drawn once and
// finished once, and every reading after the first is a revalidation with the page already on the
// screen and no fallback under it — so a later pass has no bar to finish and does not wait.

import { MOTION_CAP_MS } from './motion-end';

/** what a drawer of the bar is told when the state changes: `useSyncExternalStore`'s shape. */
type Watcher = () => void;

/** whether the bar has been told to rush to its end. */
let finishing = false;

/** every drawer of the bar. one page draws one, and the set is what makes the subscription plain. */
const watchers = new Set<Watcher>();

/**
 * the fallback's side: told whenever the state below changes, and handed back its way out.
 */
export function subscribeStartingBar(watcher: Watcher): () => void {
	watchers.add(watcher);
	return () => {
		watchers.delete(watcher);
	};
}

/** the fallback's reading: whether the bar is to draw its finish. */
export function startingBarFinishing(): boolean {
	return finishing;
}

/** what releases the pass that is waiting on the bar, and `null` where none is waiting. */
let release: (() => void) | null = null;

/** whether a pass has already finished the bar, which the hydrating pass is the only one to do. */
let signalled = false;

/**
 * the loader's side: finish the bar, and wait for it.
 *
 * every pass after the first is a revalidation drawn under the page itself, where the fallback and
 * its bar are long gone — so it finishes nothing and waits for nothing.
 */
export function finishStartingBar(): Promise<void> {
	if (signalled) return Promise.resolve();
	signalled = true;
	finishing = true;
	for (const watcher of watchers) watcher();
	return new Promise((settle) => {
		/* nothing but the bar itself can say the rush has landed, so a bar that was never drawn
		   would hold the console's first screen for as long as it is open. the cap is what makes
		   the wait a wait rather than a dependency on a fallback having mounted. */
		const capped = setTimeout(() => release?.(), MOTION_CAP_MS);
		release = () => {
			release = null;
			clearTimeout(capped);
			settle();
		};
	});
}

/** the bar's side: the rush has landed on its last cell, so the screen may be replaced. */
export function startingBarLanded(): void {
	release?.();
}
