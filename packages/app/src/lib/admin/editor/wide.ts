import { useSyncExternalStore } from 'react';

// whether the editor is at its wide breakpoint, the width `.adm-sheet` stands at the right edge
// from (packages/operator/src/styles/adm.css). the AI panel is a docked column from here and a
// sheet below it, and the bar's AI press is drawn only below it; the two read this one answer so
// they never disagree about which of the two the operator has.
//
// the server draws the wide editor. a phone's first paint then holds a docked column, which
// `.adm-aipanel` keeps out of sight below the breakpoint until this reads the real width; the
// other way round, a wide screen's preview would shrink under the operator once the panel arrived.
//
// `useMiddle` is the same answer for the middle breakpoint, which the publish bar's presses take
// one line from (`.adm-publishbar__quiet` in adm.css): the bar puts them in the order they are drawn
// at the width it is at, so the focus walks them as they read. the server draws them at the middle
// width too, and the sheet's `order` draws that order the phone's way until this reads the width.

/** a breakpoint, one of the two literals packages/operator/src/styles/tokens.css allows. */
function breakpoint(media: string) {
	return {
		subscribe: (changed: () => void) => {
			const query = window.matchMedia(media);
			query.addEventListener('change', changed);
			return () => query.removeEventListener('change', changed);
		},
		reached: () => window.matchMedia(media).matches
	};
}

const WIDE = breakpoint('(min-width: 64rem)');
const MIDDLE = breakpoint('(min-width: 44rem)');
const serverDraws = () => true;

export function useWide(): boolean {
	return useSyncExternalStore(WIDE.subscribe, WIDE.reached, serverDraws);
}

export function useMiddle(): boolean {
	return useSyncExternalStore(MIDDLE.subscribe, MIDDLE.reached, serverDraws);
}
