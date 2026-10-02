import { useEffect, useState } from 'react';
import {
	armedAfter,
	confirming,
	drawn,
	expireAfter,
	type SaveFacts,
	type SaveState
} from './save-state';

// the react binding of ./save-state.ts: a hook that keeps two pieces of state and nothing else —
// the flag the four seconds write, and what the render before this one was reporting and whether a
// confirmation was armed on it, which `armedAfter` reads to decide the next. every rule the button
// draws by is in that module and none of them is restated here.
//
// both facts arrive from the caller, `changed` included — this file is the only binding and names
// no form layer of its own. what the second rule in ./save-state.ts costs is stated there: a group
// with a control that posts and comes back cannot be answered for by a flag a form library keeps,
// and the caller is what knows it.

export type { SaveFacts, SaveState };

/**
 * the state of the button at the foot of one group.
 *
 * the facts are read at render, so a button arrives drawing what its group already is: a save that
 * landed reports on the first paint, and a group with nothing in it to save has nothing to press
 * from the same one.
 */
export function useSaveState(facts: SaveFacts): SaveState {
	const [expired, setExpired] = useState(false);

	// whether a confirmation is armed is a fact about the render before as well as this one, so it
	// is adjusted while rendering rather than in an effect: an effect would draw one frame of the
	// tick over an undone edit before taking it off, and that frame is what the region announces.
	const reporting = confirming(facts);
	const [seen, setSeen] = useState({ reporting, armed: true });
	const armed = armedAfter(seen.armed, seen.reporting, facts);
	if (seen.reporting !== reporting || seen.armed !== armed) setSeen({ reporting, armed });

	// whether the tick is drawn as the dependency, so the run that arms a timer is the run where the
	// button started drawing it — a second save into the same group re-arms rather than inheriting
	// the first one's four seconds, and a slow round trip does not spend the window while the
	// button still says `Saving`.
	const shown = reporting && armed;
	useEffect(() => expireAfter(shown, setExpired), [shown]);

	return drawn(facts, armed, expired);
}
