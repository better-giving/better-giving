import { useSyncExternalStore } from 'react';

// whether the editor is at its middle breakpoint, which the publish bar's presses take one line
// from (`.adm-publishbar__quiet` in packages/operator/src/styles/adm.css): the bar puts them in the
// order they are drawn at the width it is at, so the focus walks them as they read. the server draws
// them at the middle width, and the sheet's `order` draws that order the phone's way until this
// reads the width.

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

const MIDDLE = breakpoint('(min-width: 44rem)');
const serverDraws = () => true;

export function useMiddle(): boolean {
	return useSyncExternalStore(MIDDLE.subscribe, MIDDLE.reached, serverDraws);
}
