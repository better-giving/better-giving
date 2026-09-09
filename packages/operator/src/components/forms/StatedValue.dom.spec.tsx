import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { StatedValue } from './StatedValue.jsx';

// a value the operator is not being asked to set. the block is a grid, so what a case here is about
// is which rows are in it — and, since the value's rung and its figures are class toggles on the one
// span, which classes stand on that span.
//
// a component spec is `.tsx` and both pools collect either extension — ./Field.dom.spec.tsx says
// why.

// the value is read as the span that is not the label, so a case may assert which rung class it
// wears without naming one to find it by.
const value = (root: HTMLElement) =>
	root.querySelector('.adm-stated > span:not(.adm-stated__label)');

describe('a stated value mounted into a document', () => {
	it('draws no label row where the value is named from where it sits', () => {
		// a section heading above it is the name, and an empty row left in the grid is a gap the
		// reader is left to account for.
		const root = render(StatedValue, { value: 'Riverbank Trust' });

		expect(root.querySelector('.adm-stated__label')).toBeNull();
	});

	it('sets a value at the reading rung when it is asked for neither figures nor the display one', () => {
		const root = render(StatedValue, { label: 'Currency', value: 'GBP' });

		expect(value(root)?.className).toBe('adm-stated__value');
	});

	it('sets the display rung in the reading rung place rather than over it', () => {
		// one class or the other, so neither rule has to outrank the one it stands in for.
		const root = render(StatedValue, {
			label: 'Raised in September',
			value: '$12,480.00',
			display: true
		});

		expect(value(root)?.classList.contains('adm-headline__value')).toBe(true);
		expect(value(root)?.classList.contains('adm-stated__value')).toBe(false);
	});

	it('stands a figure on one stem at either rung', () => {
		// the rung and the figures are two decisions: a count is read across the same whether it is
		// the figure the screen is read for or one of the two beside it.
		const reading = render(StatedValue, { label: 'Gifts in September', value: '84', num: true });
		const shown = render(StatedValue, {
			label: 'Raised in September',
			value: '$12,480.00',
			num: true,
			display: true
		});

		expect(value(reading)?.className).toBe('adm-stated__value adm-num');
		expect(value(shown)?.className).toBe('adm-headline__value adm-num');
	});
});
