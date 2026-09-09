import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

	it('is named for what it copies rather than for the act', () => {
		const root = render(CopyControl, {
			text: 'pnpm run deploy',
			label: 'Copy the deploy command'
		});

		expect(button(root).getAttribute('aria-label')).toBe('Copy the deploy command');
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
