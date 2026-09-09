import type { SaveState } from '@better-giving/operator/save-state.react';

// the one rung-picker every save button on the dashboard is drawn through.
//
// `packages/operator/src/save-state.ts` answers what a group *is* — pending, reporting, holding
// nothing — and `packages/operator/src/components/controls/SaveButton.jsx` draws one of four
// states. this is the step between them, and it is a module rather than an expression at each
// button for the reason the precedence below is worth stating once: two screens picking their own
// order is two screens that disagree about what a group which has just saved looks like.

/**
 * which of the library's four states a group's save button draws.
 *
 * the order is the precedence: a submission in flight outranks the confirmation of the one before
 * it, and a confirmation outranks having nothing to press — a group that has just saved holds
 * nothing to save, so the two are true together and the tick is the one worth drawing.
 *
 * all three rungs come off the one value, `pending` included, because the confirmation's four
 * seconds are counted from the same flag: read separately here, the label and the window are free
 * to answer differently for one group.
 */
export function buttonState(save: SaveState): 'pending' | 'done' | 'disabled' | 'idle' {
	if (save.pending) return 'pending';
	if (save.done) return 'done';
	return save.disabled ? 'disabled' : 'idle';
}
