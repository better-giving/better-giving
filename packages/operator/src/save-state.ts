// what a group's save button draws: the confirmation of a write that landed, and whether there is
// anything left to press. the rules, and none of the framework that binds them.
//
// three rules and none of them is the one a reader would write from the description, which is what
// earns them a module instead of an expression at each save button. every operator surface that
// draws one binds through the same file, ./save-state.react.ts, and a second copy of these is how
// two screens would come to disagree about what changed — so they are stated once here. a binding
// hands in the three facts, keeps the one flag a timer writes, and returns what this module
// computes.
//
// the first rule is that a confirmation clears the moment the boxes are edited again. a button
// still reading `Saved` over a field somebody has just changed is telling them their edit is
// stored.
//
// the second is which "changed" is being asked about, and it is the caller's to answer rather than
// this module's — ./save-state.react.ts names no form layer of its own. both operator surfaces
// answer it with the form layer's own reading of its values against the values it was seeded with
// (`useAdminForm` in packages/app/src/lib/admin/use-admin-form.ts, and
// packages/console-ui/src/lib/use-console-form.ts): it is derived rather than sampled, so a group
// whose rows are added and dropped by a control that changes the payload and posts nothing moves it
// with no event to read at. the one group whose arming is not that comparison — the program group on
// /admin/forms/[id] — hands in a reading of its own and says there why.
//
// the third is that a confirmation ends. both halves of what draws one are durable — the marker a
// redirect published stands until the next `load`, and a form nobody is touching stays untainted —
// so a tick with nothing to stop it is still on the button ten minutes and several presses later,
// over boxes the operator stopped thinking about. it clears `CONFIRMATION_MS` after it appears,
// which is well past the announcement of it:
// `packages/operator/src/components/controls/SaveButton.jsx` says the confirmation through a polite
// region a task after it appears, and empties that region when it clears — a clear says nothing, so
// the only thing announced is the write the operator pressed for.
// `packages/operator/src/components/controls/CopyControl.jsx` reverts the same way at two seconds
// and the two numbers are deliberately apart — a copy reports a control the eye is already
// on, and a save button sits at the foot of a form whose last box may still be where the operator
// is looking.
//
// those four seconds are the operator's reading time, so they are counted from the moment the
// button starts drawing the tick — `landed && !changed && !pending` — and not from the moment the
// data behind it commits. the two are not the same instant: an answer commits before the reads it
// sets off come back, and the group goes on drawing `Saving` for the whole of that wait. a window
// armed on the data alone spends itself under a button that never drew a tick, and a write that is
// stored is reported to nobody — which is why the group's own press being in flight is a fact of
// this module rather than a rung the caller adds after it. a round trip inside four seconds hides
// it; every one past four seconds has it.
//
// counting from what is drawn is also what reports a second save into the same group. the marker
// never moves across one: the operator edits, saves, and the form is rebound from the result, so a
// timer armed on the marker would have run out during the first save and left the second drawing
// no tick at all. `expireAfter` is where that is held, by taking the trio's own answer and nothing
// else.
//
// only the confirmation is timed. `disabled` is untouched by it, so a button whose tick has
// cleared is back to its own label with nothing to press, which is where a group with no edits in
// it rests anyway.

/** what one save button is drawing, from the group it belongs to. */
export type SaveState = {
	/** whether this group's own write is in flight, which is what the button says before anything else. */
	readonly pending: boolean;
	/** whether this button's own write is the one being reported right now. */
	readonly done: boolean;
	/** whether there is nothing in the group left to save. */
	readonly disabled: boolean;
};

/**
 * the two facts a save button is drawn from, both of them the surface's to answer.
 *
 * `landed` is that this group's marker came off the redirect that landed *and* that no later
 * request has come back with something else to say. what a marker counts as belongs to the surface
 * — the dashboard's is `packages/app/src/lib/admin/saved-section.ts` — and the screen is where
 * "what else is on the page" is known.
 *
 * `changed` is whether the group holds anything to save; the second rule above is what it costs to
 * answer.
 *
 * `pending` is this group's own press still in flight, and this group's alone — a write somewhere
 * else on the page draws no `Saving` here and holds nothing back. it is handed in because the
 * button drawing it is what the four seconds are counted from.
 */
export type SaveFacts = {
	landed: boolean;
	changed: boolean;
	pending: boolean;
};

/** how long a confirmation stands before it clears itself. */
export const CONFIRMATION_MS = 4000;

/** whether the group is reporting a write right now, before the four seconds are counted. */
export function confirming({ landed, changed, pending }: SaveFacts): boolean {
	return landed && !changed && !pending;
}

/**
 * what the button draws, from the group's facts and whether its confirmation has run out.
 *
 * `disabled` is a fact about the group and nothing else — a group with nothing in it to save draws
 * a button with nothing to press, from the first paint and on whichever side rendered it.
 *
 * `pending` comes back out untouched so that the rung it outranks and the window it holds off are
 * read off one value. handed to the timer here and to the label at the caller, the two answers are
 * free to disagree, and a button drawing `Saving` over a confirmation already counting down is
 * exactly what that disagreement looks like.
 */
export function drawn(facts: SaveFacts, expired: boolean): SaveState {
	return {
		pending: facts.pending,
		done: confirming(facts) && !expired,
		disabled: !facts.changed
	};
}

/**
 * the four seconds, as the body of whatever effect the binding runs.
 *
 * called with the trio's own answer, so the run that arms a timer is the run where the button
 * started drawing the tick — which is what makes a second save into the same group re-arm rather
 * than go unreported, and what keeps a slow round trip from spending the window behind `Saving`.
 * `report` is written and never read in here, so writing it starts nothing.
 *
 * the returned teardown is the binding's to run before every re-run as well as on the way out, so
 * there is one timer at a time and none left behind by a screen that has gone.
 */
export function expireAfter(reporting: boolean, report: (expired: boolean) => void): () => void {
	report(false);
	if (!reporting) return () => {};

	const timer = setTimeout(() => report(true), CONFIRMATION_MS);
	return () => clearTimeout(timer);
}
