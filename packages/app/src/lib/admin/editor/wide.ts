import { useSyncExternalStore } from 'react';

// whether the editor is at its wide breakpoint, the width `.adm-sheet` stands at the right edge
// from (packages/operator/src/styles/adm.css). the AI panel is a docked column from here and a
// sheet below it, and the bar's AI press is drawn only below it; the two read this one answer so
// they never disagree about which of the two the operator has.
//
// the server draws the wide editor. a phone's first paint then holds a docked column, which
// `.adm-aipanel` keeps out of sight below the breakpoint until this reads the real width; the
// other way round, a wide screen's preview would shrink under the operator once the panel arrived.

/** the wide breakpoint, one of the two literals packages/operator/src/styles/tokens.css allows. */
const WIDE = '(min-width: 64rem)';

function subscribe(changed: () => void): () => void {
	const query = window.matchMedia(WIDE);
	query.addEventListener('change', changed);
	return () => query.removeEventListener('change', changed);
}

export function useWide(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(WIDE).matches,
		() => true
	);
}
