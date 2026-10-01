import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../render.testing';
import { MoveStatus, ProgressBar } from './ProgressBar.jsx';

// what a reader of the tree is told when a bar appears. a live region announces a change to its own
// contents, never its name and never its arrival, and a region inserted a moment before its words
// is one a reader commonly has not registered yet. so over a move the region stands for the whole
// life of the document and only its words change (`MoveStatus`, which both callers mount beside
// the line: packages/console-ui/src/root.tsx, packages/app/src/routes/_app.tsx); the document's own
// cells arrive with the document and write their words a task after it.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** the one status region under `root`. */
function region(root: HTMLElement): HTMLElement {
	const found = root.querySelectorAll<HTMLElement>('[role="status"]');
	if (found.length !== 1) throw new Error(`expected one status region, found ${found.length}`);
	return found[0] as HTMLElement;
}

describe('the status words over a move', () => {
	it('stands empty before any move, says the move when it starts, and is emptied after', () => {
		const status = mount(MoveStatus, { label: '' });
		const standing = region(status.root);
		expect(standing.textContent).toBe('');

		status.again({ label: 'Opening Stripe' });
		expect(region(status.root)).toBe(standing);
		expect(standing.textContent).toBe('Opening Stripe');

		status.again({ label: '' });
		expect(region(status.root)).toBe(standing);
		expect(standing.textContent).toBe('');
	});

	it('speaks through its contents and not through a name a region never announces', () => {
		const status = mount(MoveStatus, { label: 'Opening Stripe' });

		expect(region(status.root).hasAttribute('aria-label')).toBe(false);
	});

	it('is the only region over a move: the line itself says nothing', () => {
		const { root } = mount(ProgressBar, { overMove: true });

		expect(root.querySelectorAll('[role="status"]')).toHaveLength(0);
		expect(root.textContent).toBe('');
	});
});

describe("the progress bar as the document's own cells", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('arrives with its region empty and writes its label into it afterwards', () => {
		vi.useFakeTimers();
		const { root } = mount(ProgressBar, { label: 'Starting', overMove: false });

		expect(region(root).textContent).toBe('');

		act(() => vi.advanceTimersByTime(0));
		expect(region(root).textContent).toBe('Starting');
		expect(region(root).hasAttribute('aria-label')).toBe(false);
	});
});
