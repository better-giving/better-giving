import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished, vi } from 'vitest';
import { useAfterPaint } from './after-paint';

// words a screen arrives with, held back until the status line they go in has been drawn empty:
// the frames are run by hand here, so each one is a step the spec takes.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** `requestAnimationFrame` run by hand: `frame()` runs every callback queued before it. */
function framesByHand(): { frame: () => void } {
	let queued = new Map<number, FrameRequestCallback>();
	let next = 0;
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		next += 1;
		queued.set(next, callback);
		return next;
	});
	vi.stubGlobal('cancelAnimationFrame', (handle: number) => queued.delete(handle));
	return {
		frame() {
			const due = queued;
			queued = new Map();
			for (const callback of due.values()) callback(0);
		}
	};
}

function Line({ words }: { readonly words: string | null }) {
	return createElement('p', { role: 'status' }, useAfterPaint(words));
}

function mount(words: string | null) {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(createElement(Line, { words })));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return {
		line: () => root.querySelector('[role="status"]')?.textContent,
		redraw: (next: string | null) => act(() => mounted.render(createElement(Line, { words: next })))
	};
}

it('writes the words only once the line has been through a painted frame empty', () => {
	const frames = framesByHand();
	const { line } = mount('Destination added.');

	expect(line()).toBe('');
	act(() => frames.frame());
	expect(line()).toBe('');
	act(() => frames.frame());
	expect(line()).toBe('Destination added.');
});

it('writes nothing for no words, and follows the words when they change', () => {
	const frames = framesByHand();
	const { line, redraw } = mount(null);
	act(() => frames.frame());
	act(() => frames.frame());
	expect(line()).toBe('');

	redraw('Deleted https://crm.example.net/hooks.');
	act(() => frames.frame());
	act(() => frames.frame());

	expect(line()).toBe('Deleted https://crm.example.net/hooks.');
});
