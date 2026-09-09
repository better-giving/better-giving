import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSaveState } from './save-state.react';

// what ./save-state.react.ts does once it is on a screen — which is the whole of what it is,
// since the rules it draws by are ./save-state.ts's and are the same three either binding is
// wired to.
//
// mounted rather than called, because every claim here is about a run after the first: the timer
// really armed, the flag it writes really landing on a second render. a hook has no answers
// outside a render, so react-dom is what a spec about one costs.
//
// `landed` is held true throughout, which is the case that matters: the marker a redirect
// published does not move between two saves into the same group, so a confirmation that ended has
// to be able to start again with nothing about `landed` changing.
//
// a react state hook stands in for whatever form layer the surface ends up with. what a binding
// takes off it is one boolean, and no library is named on this side (./save-state.react.ts).

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** the hook mounted onto a button, with the things a spec needs to do to it. */
function mounted() {
	const container = document.createElement('div');
	document.body.append(container);

	let setChanged: ((changed: boolean) => void) | undefined;
	let setPending: ((pending: boolean) => void) | undefined;
	function Group() {
		const [changed, edited] = useState(false);
		const [pending, pressing] = useState(false);
		setChanged = edited;
		setPending = pressing;
		const state = useSaveState({ landed: true, changed, pending });
		return createElement('button', {
			type: 'submit',
			disabled: state.disabled,
			className: state.done ? 'is-done' : ''
		});
	}

	const root = createRoot(container);
	act(() => root.render(createElement(Group)));

	const button = () => container.querySelector('button');
	return {
		/** whether the confirmation is drawn right now — the class the sheet swaps the label on. */
		get confirming() {
			return button()?.classList.contains('is-done') ?? false;
		},
		/** whether there is anything left to press. */
		get pressable() {
			return button()?.hasAttribute('disabled') === false;
		},
		/** a box in the group edited. */
		edit() {
			act(() => setChanged?.(true));
		},
		/** the write coming back: a form layer rebinds itself from a good result. */
		save() {
			act(() => setChanged?.(false));
		},
		/** the press made, which is the group's own write in flight. */
		press() {
			act(() => setPending?.(true));
		},
		/** the reads the write set off coming back, which is where the button's dots stop. */
		settle() {
			act(() => setPending?.(false));
		},
		wait(ms: number) {
			act(() => vi.advanceTimersByTime(ms));
		},
		stop() {
			act(() => root.unmount());
			container.remove();
		}
	};
}

describe('the confirmation a react save button draws', () => {
	afterEach(() => {
		document.body.innerHTML = '';
		vi.useRealTimers();
	});

	it('clears itself four seconds after it appears', () => {
		// the defect this is here for: both halves of a confirmation are durable — the marker
		// stands until the next load and an untouched form stays unedited — so a tick with
		// nothing to end it is still on the button long after the operator has moved on.
		vi.useFakeTimers();
		const button = mounted();

		expect(button.confirming).toBe(true);
		button.wait(3999);
		expect(button.confirming).toBe(true);
		button.wait(1);
		expect(button.confirming).toBe(false);

		button.stop();
	});

	it('clears the moment a box is edited, without waiting out the four seconds', () => {
		// a button still reading `Saved` over a field somebody has just changed is telling them
		// their edit is stored, and no timer may stand between the edit and the tick going.
		vi.useFakeTimers();
		const button = mounted();

		button.wait(1000);
		expect(button.confirming).toBe(true);

		button.edit();
		expect(button.confirming).toBe(false);

		button.stop();
	});

	it('reports a second save into the same group', () => {
		// the marker never moves across this, which is why the timer is armed on what the button is
		// drawing and not on the marker: the operator edits, saves, and the form is rebound from the
		// result. armed on the marker the second save would draw no tick at all, having spent its
		// four seconds during the first.
		vi.useFakeTimers();
		const button = mounted();

		button.wait(4000);
		expect(button.confirming).toBe(false);

		button.edit();
		button.save();
		expect(button.confirming).toBe(true);

		button.wait(4000);
		expect(button.confirming).toBe(false);

		button.stop();
	});

	it('starts counting where the tick is drawn and not where the answer commits', () => {
		// the defect this is here for: an answer commits before the reads it sets off come back, so
		// the group goes on drawing its dots over a write that is already stored. counted from the
		// answer, the four seconds are spent behind those dots and the operator is shown no tick at
		// all — which is every round trip past four seconds, and no round trip under them.
		vi.useFakeTimers();
		const button = mounted();

		button.edit();
		button.press();
		button.save();
		expect(button.confirming).toBe(false);

		button.wait(11000);
		expect(button.confirming).toBe(false);

		button.settle();
		expect(button.confirming).toBe(true);
		button.wait(4000);
		expect(button.confirming).toBe(false);

		button.stop();
	});

	it('offers nothing to press for a group with nothing to save, from the first paint', () => {
		// `disabled` is a fact about the group and answerable wherever the group is, so it is
		// answered on the first render rather than left until something has hydrated.
		vi.useFakeTimers();
		const button = mounted();

		expect(button.pressable).toBe(false);
		button.edit();
		expect(button.pressable).toBe(true);
		button.save();
		expect(button.pressable).toBe(false);

		button.stop();
	});

	it('leaves nothing running when the screen goes', () => {
		// a navigation away mid-confirmation must not leave a timer holding a state setter for a
		// component that has been unmounted.
		vi.useFakeTimers();
		const button = mounted();

		expect(vi.getTimerCount()).toBe(1);
		button.stop();
		expect(vi.getTimerCount()).toBe(0);
	});
});
