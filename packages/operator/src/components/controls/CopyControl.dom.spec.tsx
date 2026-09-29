import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closedRungOf } from '../closed-look.testing';
import { render } from '../render.testing';
import { CopyControl } from './CopyControl.jsx';

// the control is the whole of what a copy is: it takes the text, puts it on the clipboard, reports
// on itself and says so out loud. every case here is about one of those four, and the third is the
// one nothing else in this repository can answer — a control that reports by giving way to a span
// is gone from under the finger that pressed it, and there is no screen mounting this part for a
// browser test to reach.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** what a worded control's caller says its refusal left the reader. */
const WAY_OUT = 'Open agent prompt, after this button, opens it to copy by hand.';

/** the clipboard the case is holding, so it can answer or refuse. */
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
	// only the two the control calls. react's own `act` drains its work on a task of its own, and a
	// suite that faked every timer would leave it waiting on a clock nobody advances — while a suite
	// that faked none would let the control's zero-delay task fire inside that drain, which is the
	// moment the case below is reading between.
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	writeText = vi.fn(() => Promise.resolve());
	// happy-dom has no clipboard, and the real one would be the browser's rather than the case's.
	Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
	vi.useRealTimers();
});

function button(root: HTMLElement): HTMLButtonElement {
	const found = root.querySelector('button');
	// a case that read `null` here would assert nothing about a control that is not there.
	if (found === null) throw new Error('the control drew no button');
	return found;
}

/** a worded control's resting face: its mark and its words. */
function rest(root: HTMLElement): Element {
	const found = root.querySelector('.adm-copyface__rest');
	if (found === null) throw new Error('the control drew no resting face');
	return found;
}

/** whether the resting face is held out of sight under an outcome. */
function held(root: HTMLElement): boolean {
	return rest(root).classList.contains('adm-copyface__rest--held');
}

/** the outcome a worded control draws over its resting face, if it is drawing one. */
function outcome(root: HTMLElement): Element | null {
	return root.querySelector('.adm-copyface__outcome');
}

function region(root: HTMLElement): Element {
	const found = root.querySelector('[aria-live]');
	if (found === null) throw new Error('the control drew no live region');
	return found;
}

/**
 * a press, and the microtasks the attempt settles in.
 *
 * the drain is a count rather than one await: the clipboard call and the state writes after it are
 * a promise chain of no stated length, and a scope that closed on the wrong tick would leave a case
 * reading the markup from before the press. no timer runs in here — that is what the fake clock
 * above is for.
 */
async function press(root: HTMLElement) {
	await act(async () => {
		button(root).click();
		for (let tick = 0; tick < 10; tick++) await Promise.resolve();
	});
}

/** the clock moved on, which is what runs the control's own timers. */
async function elapse(ms: number) {
	await act(async () => {
		vi.advanceTimersByTime(ms);
	});
}

describe('a copy control mounted into a document', () => {
	it('puts the text it was handed on the clipboard', () => {
		const root = render(CopyControl, { text: 'pnpm run deploy' });

		button(root).click();

		expect(writeText).toHaveBeenCalledWith('pnpm run deploy');
	});

	it('copies nothing while closed, and keeps the focus a closed native button would drop', () => {
		const root = render(CopyControl, { text: 'bgz_key', disabled: true });
		button(root).focus();

		button(root).click();

		expect(writeText).not.toHaveBeenCalled();
		expect(button(root).getAttribute('aria-disabled')).toBe('true');
		expect(button(root).hasAttribute('disabled')).toBe(false);
		expect(document.activeElement).toBe(button(root));
	});

	it('draws closed while closed, rather than at rest under a press that does nothing', () => {
		const root = render(CopyControl, { text: 'bgz_key', disabled: true });

		expect(closedRungOf(button(root))).not.toBeNull();
	});

	it('draws at rest while open', () => {
		const root = render(CopyControl, { text: 'bgz_key' });

		expect(closedRungOf(button(root))).toBeNull();
	});

	it('hands a refused copy to its caller, and a landed one to nobody', async () => {
		// the caller is what can put the text where it can be taken by hand — ../forms/Field.jsx
		// shows a masked box's value on a refusal.
		const onBlocked = vi.fn();
		const root = render(CopyControl, { text: 'bgz_key', onBlocked });

		await press(root);
		expect(onBlocked).not.toHaveBeenCalled();

		writeText.mockRejectedValue(new Error('permission refused'));
		await press(root);
		expect(onBlocked).toHaveBeenCalledOnce();
	});

	it('is named for what it copies rather than for the act', () => {
		const root = render(CopyControl, {
			text: 'pnpm run deploy',
			label: 'Copy the deploy command'
		});

		expect(button(root).getAttribute('aria-label')).toBe('Copy the deploy command');
	});

	it('draws its wording after the mark, and is named by exactly the words it draws', () => {
		// a name that differed from the drawn words would leave a voice user saying words the
		// control does not answer to (WCAG 2.5.3).
		const root = render(CopyControl, {
			text: 'You are integrating…',
			wording: 'Copy agent prompt',
			wayOut: WAY_OUT,
			onBlocked: () => {}
		});
		const [mark, words] = rest(root).childNodes;

		expect(mark).toBeInstanceOf(SVGElement);
		expect(words?.textContent).toBe('Copy agent prompt');
		expect(button(root).textContent).toBe('Copy agent prompt');
		expect(button(root).getAttribute('aria-label')).toBe('Copy agent prompt');
	});

	it('reports each outcome as an unworded control does, and draws its wording again once settled', async () => {
		const onBlocked = vi.fn();
		const root = render(CopyControl, {
			text: 'You are integrating…',
			wording: 'Copy agent prompt',
			wayOut: WAY_OUT,
			onBlocked
		});

		await press(root);
		expect(outcome(root)?.querySelector('svg')).not.toBeNull();
		expect(outcome(root)?.textContent).toBe('');
		expect(button(root).getAttribute('aria-label')).toBe('Copied');

		await elapse(2000);
		expect(outcome(root)).toBeNull();
		expect(held(root)).toBe(false);

		writeText.mockRejectedValue(new Error('permission refused'));
		await press(root);
		expect(outcome(root)?.textContent).toBe('Copy blocked');
		expect(button(root).getAttribute('aria-label')).toBe('Copy blocked');
		expect(onBlocked).toHaveBeenCalledOnce();

		await elapse(2000);
		expect(button(root).getAttribute('aria-label')).toBe('Copy agent prompt');
	});

	it('keeps its resting words in the box under either outcome, so it keeps its width', async () => {
		// the outcome is drawn over the resting words rather than in their place: a control that
		// shrank to the tick would move everything after it on the row, and back two seconds later.
		const root = render(CopyControl, {
			text: 'You are integrating…',
			wording: 'Copy agent prompt',
			wayOut: WAY_OUT,
			onBlocked: () => {}
		});

		await press(root);
		expect(rest(root).textContent).toBe('Copy agent prompt');
		expect(held(root)).toBe(true);

		await elapse(2000);
		writeText.mockRejectedValue(new Error('permission refused'));
		await press(root);
		expect(rest(root).textContent).toBe('Copy agent prompt');
		expect(held(root)).toBe(true);
	});

	it('cannot be worded without being told of a refusal', () => {
		// a worded control stands where nothing prints the text, so the refusal is survivable only
		// through what its caller does. `pnpm run check` is what runs this case; the render is here
		// so the case asserts something at run time as well.
		// @ts-expect-error — `onBlocked` is required beside `wording`.
		const root = render(CopyControl, {
			text: 'You are integrating…',
			wording: 'Copy agent prompt',
			wayOut: WAY_OUT
		});

		expect(button(root).getAttribute('aria-label')).toBe('Copy agent prompt');
	});

	it('cannot be worded without saying the way out of a refusal', () => {
		// @ts-expect-error — `wayOut` is required beside `wording`.
		const root = render(CopyControl, {
			text: 'You are integrating…',
			wording: 'Copy agent prompt',
			onBlocked: () => {}
		});

		expect(button(root).getAttribute('aria-label')).toBe('Copy agent prompt');
	});

	it("says a worded control's way out with the refusal, and keeps its name to the drawn words", async () => {
		// focus stays on the control, so what the caller drew for the refusal is next in the tab
		// order and reported by nothing else.
		writeText.mockRejectedValue(new Error('permission refused'));
		const root = render(CopyControl, {
			text: 'You are integrating…',
			wording: 'Copy agent prompt',
			wayOut: WAY_OUT,
			onBlocked: () => {}
		});

		await press(root);
		await elapse(0);

		expect(region(root).textContent).toBe(`Copy blocked. ${WAY_OUT}`);
		expect(button(root).getAttribute('aria-label')).toBe('Copy blocked');
	});

	it('is still the same button, and still focused, once the copy has landed', async () => {
		// the defect this closes: reporting by swapping the control for a span takes the control out
		// from under the finger that pressed it, at the instant a reader wants to hear what happened.
		const root = render(CopyControl, { text: 'pnpm run deploy' });
		const pressed = button(root);
		pressed.focus();

		await press(root);

		expect(button(root)).toBe(pressed);
		expect(document.activeElement).toBe(pressed);
		expect(pressed.getAttribute('aria-label')).toBe('Copied');
	});

	it('announces the copy in a region that is not the control', async () => {
		const root = render(CopyControl, { text: 'pnpm run deploy' });

		await press(root);
		await elapse(0);

		expect(region(root).textContent).toBe('Copied');
		expect(region(root).contains(button(root))).toBe(false);
	});

	it('clears the region before writing it again, so a second press is still announced', async () => {
		// a region handed the word it is already holding is not a change and is announced by nobody.
		const root = render(CopyControl, { text: 'pnpm run deploy' });

		await press(root);
		await elapse(0);
		expect(region(root).textContent).toBe('Copied');

		await press(root);
		expect(region(root).textContent).toBe('');

		await elapse(0);
		expect(region(root).textContent).toBe('Copied');
	});

	it('says the clipboard refused rather than answering a press with nothing', async () => {
		writeText.mockRejectedValue(new Error('insecure origin'));
		const root = render(CopyControl, { text: 'pnpm run deploy' });

		await press(root);
		await elapse(0);

		// the drawn word and the name are the same words: a name that did not contain the visible
		// one would leave a voice user with nothing to say (WCAG 2.5.3).
		expect(button(root).textContent).toBe('Copy blocked');
		expect(button(root).getAttribute('aria-label')).toBe('Copy blocked');
		expect(region(root).textContent).toBe('Copy blocked');
	});

	it('offers itself again once the outcome has settled', async () => {
		const root = render(CopyControl, { text: 'pnpm run deploy', label: 'Copy the deploy command' });

		await press(root);
		expect(button(root).getAttribute('aria-label')).toBe('Copied');

		await elapse(2000);

		expect(button(root).getAttribute('aria-label')).toBe('Copy the deploy command');
		expect(region(root).textContent).toBe('');
	});
});
