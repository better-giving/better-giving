import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, render } from '../render.testing';
import { SaveButton } from './SaveButton.jsx';

// what the button keeps when a caller states something of its own, and what it says out loud when a
// save lands. two of a button's attributes are answers this component has already given — the class
// list it draws itself in, and whether the press is closed — and a caller has its own reasons to
// state either: a screen pins a state for a specimen, and a fold closes every control on it while a
// run is going. taken over rather than taken in, each of those loses the component's half: the class
// list drops all four of its names, and the group's own "there is nothing to save" stops closing the
// press.
//
// ../forms/Field.jsx, ../forms/SelectWithNote.jsx and ../forms/CheckboxGroup.jsx each compose a
// caller's `className` into their own; this is the fourth.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** the button the component drew, which is where every case reads its attributes off. */
function pressed(root: HTMLElement): HTMLButtonElement {
	const drawn = root.querySelector('button');
	if (drawn === null) throw new Error('the component drew no button');
	return drawn;
}

describe('a save button mounted into a document', () => {
	it('keeps its own drawing when a caller states a class of its own', () => {
		// the caller's class is a state pinned on the specimen, not a replacement for the four names
		// that make this a primary button reporting a save. replaced, the specimen is an unstyled
		// element and reads as the sheet having lost the rule.
		const root = render(SaveButton, { state: 'done', className: 'is-focus' });

		expect([...pressed(root).classList].toSorted()).toEqual([
			'adm-btn',
			'adm-btn--primary',
			'adm-save',
			'is-done',
			'is-focus'
		]);
	});

	it('stays closed for its own state when a caller says nothing about the press', () => {
		// a fold states `disabled` from a condition of its own and hands over `undefined` while that
		// condition is false. spread over the component's answer, that re-opens a press on a group
		// holding nothing to save.
		const root = render(SaveButton, { state: 'disabled', disabled: undefined });

		expect(pressed(root).disabled).toBe(true);
	});

	it('lets a caller close a press its state would leave open', () => {
		// the other half of the same composition: the group has something to save and the page is
		// writing, so the press is closed for the caller's reason and not the state's.
		const root = render(SaveButton, { state: 'idle', disabled: true });

		expect(pressed(root).disabled).toBe(true);
	});

	it('closes its own press while its own write is in flight', () => {
		// a press left open under `aria-busy` is one operator intent and two writes: the second press
		// starts a second navigation while the first is still going. `state` is computed by callers
		// from the router's navigation state and turns pending only after the submission has begun,
		// so closing it here drops no submission of its own.
		const root = render(SaveButton, { state: 'pending' });

		expect(pressed(root).disabled).toBe(true);
	});

	it('keeps its resting label under its own write and stands the dots over it', () => {
		// a press in flight reports with three dots and no second word: swapped for one, the button
		// resizes at the moment it is closed, and the row of actions around it reflows under the hand
		// that just pressed it. the label is what the button is called, so it stays in the tree.
		const button = pressed(render(SaveButton, { state: 'pending', label: 'Save receipts' }));

		expect([
			button.getAttribute('aria-busy'),
			button.textContent,
			button.querySelector('.adm-btn__dots')?.children.length
		]).toEqual(['true', 'Save receipts', 3]);
	});

	it('draws no dots when nothing of its own is in flight', () => {
		for (const state of ['idle', 'done', 'disabled'] as const) {
			const button = pressed(render(SaveButton, { state }));

			expect([state, button.querySelector('.adm-btn__dots')]).toEqual([state, null]);
		}
	});

	it('writes no class for resting, which is what the primary button already draws', () => {
		// `.adm-save.is-idle` matches no rule in ../../styles/adm.css, so a name written for it is a
		// class nothing draws — which paints nothing, errors nowhere, and reads as a state the sheet
		// handles.
		const root = render(SaveButton, { state: 'idle' });

		expect([...pressed(root).classList].toSorted()).toEqual([
			'adm-btn',
			'adm-btn--primary',
			'adm-save'
		]);
	});
});

/** the words the region holds while the button is reporting a save. */
const CONFIRMATION = 'Saved. Nothing else on this page changed.';

/**
 * the region the button says a save through.
 *
 * it refuses a region that is the press or stands inside it, which is the shape this half of the
 * file was written against: a region on an interactive control reports every change the control
 * makes to its own contents, so the tick arriving over the label and the label coming back are both
 * announcements nobody pressed for.
 */
function region(root: HTMLElement): Element {
	const found = root.querySelector('[aria-live]');
	if (found === null) throw new Error('the button drew no live region');
	if (found === pressed(root) || found.contains(pressed(root)))
		throw new Error('the live region is the press itself');
	return found;
}

describe('a save button reporting a write to a reader', () => {
	beforeEach(() => {
		// only the two the button calls, for ./CopyControl.dom.spec.tsx's reason: react's own `act`
		// drains its work on a task of its own, and a suite that faked every timer would leave it
		// waiting on a clock nobody advances — while a suite that faked none would let the button's
		// zero-delay task fire inside that drain, which is the moment the repeat case below reads
		// between.
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		return () => vi.useRealTimers();
	});

	/** the clock moved on, which is what runs the button's own deferred write. */
	async function elapse(ms: number) {
		await act(async () => {
			vi.advanceTimersByTime(ms);
		});
	}

	it('is not itself the region it reports through, in any of its four states', () => {
		// a live region on the control is the hazard ./CopyControl.jsx's own comment is about, and on
		// this button it is every state but resting — so the tick landing over the label and the label
		// coming back is announced twice for one press.
		for (const state of ['idle', 'pending', 'done', 'disabled'] as const) {
			const root = render(SaveButton, { state });

			expect(pressed(root).hasAttribute('aria-live')).toBe(false);
		}
	});

	it('reports through one region and not two', () => {
		// two overlapping regions on one control is two readers' worth of report for one write, and
		// the inner one goes with the state that mounted it.
		const root = render(SaveButton, { state: 'done' });

		expect(root.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(1);
	});

	it('says the save through a region standing beside the press', async () => {
		const { root, again } = mount(SaveButton, { state: 'idle' });

		again({ state: 'pending' });
		again({ state: 'done' });
		await elapse(0);

		expect(region(root).textContent).toBe(CONFIRMATION);
	});

	it('clears the region before writing it again, so a second save is still announced', async () => {
		// the defect this closes. a save reports the same words every time, and a region handed what
		// it is already holding is not a change and is announced by nobody — so an operator who saves
		// the same group twice hears the first one and silence for the second.
		const { root, again } = mount(SaveButton, { state: 'idle' });

		again({ state: 'pending' });
		again({ state: 'done' });
		await elapse(0);
		const said = region(root);
		expect(said.textContent).toBe(CONFIRMATION);

		// the operator edits the group and saves it again: the tick clears, the write goes, and the
		// same words come back.
		again({ state: 'idle' });
		again({ state: 'pending' });
		again({ state: 'done' });
		expect(said.textContent).toBe('');

		await elapse(0);
		expect(said.textContent).toBe(CONFIRMATION);
		// and it is the same node throughout: a region unmounted and mounted again arrives carrying
		// its own text, which is one insertion rather than a change and is announced by nobody
		// either.
		expect(region(root)).toBe(said);
	});

	it('empties the region when the confirmation clears, which says nothing', async () => {
		const { root, again } = mount(SaveButton, { state: 'pending' });

		again({ state: 'done' });
		await elapse(0);
		expect(region(root).textContent).toBe(CONFIRMATION);

		// packages/operator/src/save-state.ts clears the tick four seconds after it appears. a clear
		// is not a sentence, so nothing is announced for it — and the region is empty for the next
		// save to write into.
		again({ state: 'idle' });

		expect(region(root).textContent).toBe('');
	});
});
