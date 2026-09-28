import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { CheckboxGroups } from './CheckboxGroups.jsx';

// one question answered from several named lists. what is asserted is what the component decides
// and ./CheckboxGroup.jsx does not: every box submits under the question's one name, each list is
// named by a legend of its own under the question's, and a refusal is the question's — marked on
// the outer group, drawn once, and on no box.

const GROUPS = [
	{
		id: 'ev-gifts',
		legend: 'Gifts',
		items: [
			{ id: 'ev-gift-made', label: 'Made', value: 'gift.made' },
			{ id: 'ev-gift-refunded', label: 'Refunded', value: 'gift.refunded' }
		]
	},
	{
		id: 'ev-donors',
		legend: 'Donors',
		items: [{ id: 'ev-donor-added', label: 'Added', value: 'donor.added', defaultChecked: true }]
	}
];

function outer(root: HTMLElement): HTMLFieldSetElement {
	const found = root.querySelector('fieldset');
	if (found === null) throw new Error('no group was drawn');
	return found;
}

describe('boxes in named groups', () => {
	it('submits every box under one name, and names each list under the question', () => {
		const root = render(CheckboxGroups, {
			id: 'ev',
			name: 'events',
			legend: 'Events',
			groups: GROUPS
		});
		const boxes = [...root.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
		const inner = [...outer(root).querySelectorAll(':scope > .adm-checkgroups > fieldset')];

		expect(boxes.map((b) => b.name)).toEqual(['events', 'events', 'events']);
		expect(boxes.map((b) => b.value)).toEqual(['gift.made', 'gift.refunded', 'donor.added']);
		expect(boxes[2]?.checked).toBe(true);
		expect(outer(root).querySelector(':scope > legend')?.textContent).toBe('Events');
		expect(inner.map((f) => f.querySelector(':scope > legend')?.textContent)).toEqual([
			'Gifts',
			'Donors'
		]);
	});

	it('marks a refusal once, on the question, and on no box', () => {
		const root = render(CheckboxGroups, {
			id: 'ev',
			name: 'events',
			legend: 'Events',
			error: 'choose at least one',
			groups: GROUPS
		});
		const errors = root.querySelectorAll('.adm-field__error');

		expect(errors).toHaveLength(1);
		expect(errors[0]?.id).toBe('ev-err');
		expect(errors[0]?.textContent).toBe('choose at least one');
		expect(outer(root).getAttribute('aria-invalid')).toBe('true');
		expect(outer(root).getAttribute('aria-describedby')).toBe('ev-err');
		for (const box of root.querySelectorAll('input')) {
			expect(box.hasAttribute('aria-invalid')).toBe(false);
		}
	});

	it('says nothing is wrong until it is refused', () => {
		const root = render(CheckboxGroups, {
			id: 'ev',
			name: 'events',
			legend: 'Events',
			groups: GROUPS
		});

		expect(root.querySelector('.adm-field__error')).toBeNull();
		expect(outer(root).hasAttribute('aria-invalid')).toBe(false);
		expect(outer(root).hasAttribute('aria-describedby')).toBe(false);
	});
});
