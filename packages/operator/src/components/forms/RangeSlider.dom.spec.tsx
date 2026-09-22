import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../render.testing';
import { RangeSlider } from './RangeSlider.jsx';

// two thumbs along a scale of stops. what a case here is about is what an assistive reader is told
// about each thumb, what a key press hands the caller, and that nothing reaches a form's payload.
//
// a component spec is `.tsx` and both pools collect either extension — ./Field.dom.spec.tsx says
// why.

const STOPS = ['$1', '$5', '$25', '$100', '$10,000'];

function slider(onValueChange: (value: [number, number]) => void = () => {}) {
	return render(RangeSlider, {
		stops: STOPS,
		value: [1, 3],
		onValueChange,
		thumbLabels: ['Smallest gift', 'Largest gift']
	});
}

function thumbs(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('[role="slider"]')];
}

describe('a range slider mounted into a document', () => {
	it('names each thumb and reads its stop out as the stop, not as a position', () => {
		const [lower, upper] = thumbs(slider());

		expect(lower?.getAttribute('aria-label')).toBe('Smallest gift');
		expect(lower?.getAttribute('aria-valuetext')).toBe('$5');
		expect(upper?.getAttribute('aria-label')).toBe('Largest gift');
		expect(upper?.getAttribute('aria-valuetext')).toBe('$100');
	});

	it('draws the first and the last stop at the two ends', () => {
		const ends = slider().querySelector('.adm-range__ends');

		expect([...(ends?.children ?? [])].map((end) => end.textContent)).toEqual(['$1', '$10,000']);
	});

	it('hands the caller both positions when a thumb is moved by key', async () => {
		const onValueChange = vi.fn();
		const [lower] = thumbs(slider(onValueChange));
		if (lower === undefined) throw new Error('no lower thumb');

		// the machine takes each event on a microtask after react's handler, so the act is awaited.
		await act(async () => lower.focus());
		await act(async () => {
			lower.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		});

		expect(onValueChange).toHaveBeenLastCalledWith([2, 3]);
	});

	it('submits nothing: no named element and no input of its own', () => {
		// a form holding the slider posts what it posted without it — the bounds it stands for are
		// the caller's own boxes.
		const root = slider();

		expect(root.querySelector('[name]')).toBeNull();
		expect(root.querySelector('input')).toBeNull();
	});
});
