import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../render.testing';
import { ProgressBar } from './ProgressBar.jsx';

// what a reader of the tree is told when the bar appears. a live region announces a change to its
// own contents, never its name and never its arrival: one that mounts already holding its words
// is one insertion, and both callers mount the bar only while a move is under way
// (packages/console-ui/src/root.tsx, packages/app/src/routes/_app.tsx). so the region has to be
// standing empty when the words are written into it.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** the bar's status region. */
function region(root: HTMLElement): HTMLElement {
	const found = root.querySelector<HTMLElement>('[role="status"]');
	if (found === null) throw new Error('the bar drew no status region');
	return found;
}

describe.each([
	{ shape: 'the line over a move', overMove: true },
	{ shape: "the document's own cells", overMove: false }
])('the progress bar as $shape', ({ overMove }) => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('arrives with its region empty and writes its label into it afterwards', () => {
		vi.useFakeTimers();
		const { root } = mount(ProgressBar, { label: 'Opening Stripe', overMove });

		expect(region(root).textContent).toBe('');

		act(() => vi.advanceTimersByTime(0));
		expect(region(root).textContent).toBe('Opening Stripe');
	});

	it('speaks through its contents and not through a name a region never announces', () => {
		vi.useFakeTimers();
		const { root } = mount(ProgressBar, { label: 'Starting', overMove });
		act(() => vi.advanceTimersByTime(0));

		expect(region(root).hasAttribute('aria-label')).toBe(false);
		expect(region(root).getAttribute('aria-live') ?? 'polite').toBe('polite');
	});

	it('says a new label when the move it reports changes', () => {
		vi.useFakeTimers();
		const bar = mount(ProgressBar, { label: 'Opening Stripe', overMove });
		act(() => vi.advanceTimersByTime(0));

		bar.again({ label: 'Opening PayPal', overMove });
		act(() => vi.advanceTimersByTime(0));
		expect(region(bar.root).textContent).toBe('Opening PayPal');
	});
});
