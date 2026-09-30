import { describe, expect, it } from 'vitest';
import { mount, render } from '../render.testing';
import { CheckboxGroups } from './CheckboxGroups.jsx';

// one question answered from several named lists. what is asserted is what the component decides
// and ./CheckboxGroup.jsx does not: every box submits under the question's one name, each list is
// named by a legend of its own under the question's, and a refusal is the question's — drawn once,
// and marked on every box, where a failed submit's focus lands, and on no fieldset. a refusal is
// also a live region, so a second submission refused in the same words has to arrive as a new node
// or nobody hears it.

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

	it('draws a refusal once, and marks every box with it and no fieldset', () => {
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
		for (const box of root.querySelectorAll('input')) {
			expect(box.getAttribute('aria-invalid')).toBe('true');
			expect(box.getAttribute('aria-describedby')).toBe('ev-err');
		}
		for (const group of root.querySelectorAll('fieldset')) {
			expect(group.hasAttribute('aria-invalid')).toBe(false);
			expect(group.hasAttribute('aria-describedby')).toBe(false);
		}
	});

	it('keeps a box’s own lines beside the refusal it points at', () => {
		const root = render(CheckboxGroups, {
			id: 'ev',
			name: 'events',
			legend: 'Events',
			error: 'choose at least one',
			groups: [
				{
					id: 'ev-gifts',
					legend: 'Gifts',
					items: [{ id: 'ev-gift-made', label: 'Made', note: 'Sent once a gift settles.' }]
				}
			]
		});

		expect(root.querySelector('input')?.getAttribute('aria-describedby')).toBe(
			'ev-err ev-gift-made-note'
		);
	});

	it('redraws the refusal as a new node on each revision, words unchanged', () => {
		const props = {
			id: 'ev',
			name: 'events',
			legend: 'Events',
			error: 'choose at least one',
			groups: GROUPS
		};
		const { root, again } = mount(CheckboxGroups, { ...props, revision: 1 });
		const first = root.querySelector('[role="alert"]');

		again({ ...props, revision: 1 });
		expect(root.querySelector('[role="alert"]')).toBe(first);

		again({ ...props, revision: 2 });
		const second = root.querySelector('[role="alert"]');
		expect(second).not.toBeNull();
		expect(second).not.toBe(first);
		expect(second?.textContent).toBe('choose at least one');
	});

	it('says nothing is wrong until it is refused', () => {
		const root = render(CheckboxGroups, {
			id: 'ev',
			name: 'events',
			legend: 'Events',
			groups: GROUPS
		});

		expect(root.querySelector('.adm-field__error')).toBeNull();
		for (const box of root.querySelectorAll('input')) {
			expect(box.hasAttribute('aria-invalid')).toBe(false);
			expect(box.hasAttribute('aria-describedby')).toBe(false);
		}
	});
});
