import { type FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useSaveState } from './save-state.react';

// one form's element, the rung its button draws, and whether a press goes at all — everything an
// operator form does the same that is not about a value in a box.
//
// **it is the button's four rungs and nothing else, and the line it stops at is a form library.**
// what a box is called, whether it may hold what it holds, which one a refusal is about and where
// focus goes when a press is turned down are one library's answers, composed once per surface at
// that surface's own seam (packages/console-ui/src/lib/use-console-form.ts) — so a second statement
// of them here would be the thing this package exists to prevent. what is left is this, and it
// names no form library, no schema, no box and no message.
//
// so nothing here reads a value. the two facts that would need one arrive from the caller —
// {@link SavedFormInputs.changed} and {@link SavedFormInputs.press} — one of them stated outright
// by a caller whose form layer already keeps it, and this module takes either without knowing what
// was looked at.
//
// it is here rather than beside its callers because more than one operator surface has a form: the
// rule for promoting a module into this package is a second caller, and the copy that would have
// been the cheaper answer is exactly how the two would drift.

/** how the button at the foot of a form is drawn. */
export type SavedFormState = 'pending' | 'done' | 'disabled' | 'idle';

export type SavedFormInputs = {
	/** this form's own answer to its own press, whatever it says. */
	report: unknown;
	/** whether that answer is the one that left something on the deployment, which is what it reports. */
	landed: boolean;
	/**
	 * whether the boxes have nothing left to say, which is what empties them. `landed` where the
	 * caller states nothing.
	 *
	 * the two come apart on a press that turned out to have nothing to do: it changed nothing and so
	 * reports nothing, and the boxes are still spent — left holding what was typed, the same press is
	 * armed again to do the same nothing.
	 */
	spent?: boolean;
	/**
	 * whether this form holds anything to save.
	 *
	 * **two shapes, because a caller knows it in one of two ways.** a caller whose form layer keeps
	 * the reading hands the answer itself, taken at every render: conform's own `dirty` is derived
	 * from the values that layer holds rather than from the document, so a row added or dropped by a
	 * list intent moves it with nothing to sample at
	 * (packages/console-ui/src/lib/use-console-form.ts). a caller with no such layer hands in a
	 * reading instead, taken off its own element at every keystroke — and ./save-state.ts's second
	 * rule is what that costs: a group whose rows are added and dropped by a control that posts and
	 * comes back changes what such a reading returns without anything having set a flag, so it is
	 * re-read rather than remembered.
	 *
	 * **it is stated either way and this module has no reading of its own.** what counts as changed
	 * turns on what the boxes were drawn with — a box holding something is not the same as a box
	 * that was edited on a form seeded from what is stored — and that is the caller's to know.
	 */
	changed: boolean | ((form: HTMLFormElement) => boolean);
	/**
	 * the caller's own reading of its press, taken as the press is made: `false` holds it back.
	 *
	 * **a press whose outcome is already on the screen is stopped rather than spent.** the caller is
	 * what can tell — a box still holding exactly what the last answer turned down, a box the form
	 * itself marks as wanted standing empty — and what it may look at is a fact its own boxes are
	 * already drawing, never a second opinion about what a value may be. this hook restates none of
	 * that and reads none of it; all it does is not start.
	 *
	 * **it is stopped at the form and not at the button**, so it holds back whichever control
	 * submits — the ones that ask in a card first submit from inside it — and so that nothing starts
	 * at all: `preventDefault` is what a router's own `Form` reads before it submits anything, and a
	 * press stopped here begins no navigation, which is what keeps the button off `Saving` for a
	 * press that was never made.
	 *
	 * whatever the caller draws and wherever it puts focus is the caller's, and is why this takes a
	 * reading rather than a list of names: the boxes belong to the form layer, which is the half
	 * this module is not (packages/console-ui/src/lib/use-console-form.ts).
	 */
	press?: () => boolean;
	/** something else on the screen is writing, which holds every control on it closed. */
	busy: boolean;
	/**
	 * this form's own press is in flight, which is the rung the button draws before any other.
	 *
	 * it is also what the confirmation's four seconds wait for, and both readings are taken off this
	 * one flag — a form whose write lands before the reads it sets off come back is drawing `Saving`
	 * over an answer that is already stored, and a window counted from the answer would be gone by
	 * the time there was a tick to read (./save-state.ts).
	 */
	pending: boolean;
};

export function useSavedFormState(inputs: SavedFormInputs): {
	form: RefObject<HTMLFormElement | null>;
	state: SavedFormState;
	/**
	 * re-read at every keystroke, so a form put back the way it was has nothing left to send.
	 *
	 * it takes no event: which box was typed in is a fact about a value, and the seam that owns the
	 * boxes is where it is read.
	 */
	onInput: () => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	/**
	 * the same emptying a landed write does, for a caller that has its own reason to do it — a form
	 * put away with something still typed into it.
	 */
	reset: () => void;
} {
	const form = useRef<HTMLFormElement>(null);
	// every form this serves arrives holding exactly what is stored, so there is nothing to send
	// until something is typed or a control is pressed — and there is no form element to read at the
	// first paint anyway. it is the reading's own state and no caller that states the answer has
	// one: a flag kept beside a fact the caller already holds is a second thing to keep true.
	const [sampled, setSampled] = useState(false);
	const stated = typeof inputs.changed === 'boolean' ? inputs.changed : null;
	const changed = stated ?? sampled;
	const { report, landed } = inputs;
	const spent = inputs.spent ?? landed;

	/* the boxes emptied and the button put back to having nothing to send — the pair, because either
	   one alone is a form that disagrees with its own control: emptied boxes under a button still
	   armed would send the empty form, and a cleared flag over boxes still holding something is a
	   press an operator cannot make.

	   **the boxes are emptied by the write that landed.** over a value that can never be read back
	   that is the whole of what keeps a stored one off the screen; over a value that can, the
	   emptied box is replaced by the row above it, which now reads what is actually held.

	   the element's own reset is what puts a stated reading back: a form layer keeping one is
	   watching the document for that event and rebuilds its values off it, so there is no second
	   flag here to clear. */
	const reset = useCallback(() => {
		form.current?.reset();
		setSampled(false);
	}, []);

	// the report itself is the dependency and not the fact it carries: two presses into the same
	// form answer the same way, and a run keyed on the answer would empty the boxes once.
	useEffect(() => {
		if (!spent) return;
		reset();
	}, [report, spent, reset]);

	/* the press in flight goes in rather than being read beside what comes back: it is the rung the
	   button draws first and the thing the confirmation's four seconds wait for, and one answer to
	   it is what keeps those two from disagreeing (./save-state.ts). */
	const save = useSaveState({ landed, changed, pending: inputs.pending });
	return {
		form,
		state: save.pending
			? 'pending'
			: save.done
				? 'done'
				: save.disabled || inputs.busy
					? 'disabled'
					: 'idle',
		onInput: () => {
			const read = inputs.changed;
			// nothing is read off the element where the caller states the answer outright: it is
			// already true of the render this keystroke is in.
			if (typeof read !== 'function') return;
			const element = form.current;
			if (element === null) return;
			setSampled(read(element));
		},
		onSubmit: (event) => {
			if (inputs.press?.() === false) event.preventDefault();
		},
		reset
	};
}
