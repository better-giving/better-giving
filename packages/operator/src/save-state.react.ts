import { useEffect, useState } from 'react';
import { confirming, drawn, expireAfter, type SaveFacts, type SaveState } from './save-state';

// the react binding of ./save-state.ts: a hook that keeps the one flag the four seconds write and
// nothing else. every rule the button draws by is in that module and none of them is restated
// here.
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

	// the trio's own answer as the dependency, so the run that arms a timer is the run where the
	// button started drawing the tick — a second save into the same group re-arms rather than
	// inheriting the first one's four seconds, and a slow round trip does not spend the window
	// while the button still says `Saving`.
	const reporting = confirming(facts);
	useEffect(() => expireAfter(reporting, setExpired), [reporting]);

	return drawn(facts, expired);
}
