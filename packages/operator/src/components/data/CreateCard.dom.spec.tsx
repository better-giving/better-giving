import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { CreateCard } from './CreateCard.jsx';

// the press that leads a list is the registry's `ds-card-create`
// (../../registry/styles/card-css.css), and the ghost that stands it at a record's height is the
// one thing ../../styles/adm.css draws around it. what is asserted is that the press wears the
// registry's class and nothing of this package's beside it, that the plus is out of its name, and
// that the ghost is hidden from a reader and is no part of the press.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

const SAMPLE = (
	<div className="adm-record">
		<span className="adm-record__title">Program name</span>
	</div>
);

function holder(root: HTMLElement): Element {
	const found = root.querySelector('.adm-create');
	if (found === null) throw new Error('the create card drew no holder');
	return found;
}

describe('a create card mounted into a document', () => {
	it("is the registry's create press, named by its word alone", () => {
		const root = render(CreateCard, {
			href: '/admin/programs/new',
			ghost: SAMPLE,
			children: 'Create program'
		});
		const press = holder(root).querySelector('a');

		expect(press?.className).toBe('ds-card-create');
		expect(press?.getAttribute('href')).toBe('/admin/programs/new');
		expect(press?.textContent).toBe('Create program');
		// the plus is the press's first child, the icon the registry sizes, and out of the name.
		expect(press?.firstElementChild?.tagName.toLowerCase()).toBe('svg');
		expect(press?.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
	});

	it('stands the hidden sample beside the press rather than inside it', () => {
		const root = render(CreateCard, { href: '#', ghost: SAMPLE, children: 'Create program' });
		const ghost = holder(root).querySelector('.adm-create__ghost');

		expect(ghost?.getAttribute('aria-hidden')).toBe('true');
		expect(ghost?.closest('a')).toBeNull();
		expect(ghost?.querySelector('.adm-record__title')?.textContent).toBe('Program name');
	});

	it('becomes whatever element it is handed', () => {
		const root = render(CreateCard, { as: 'button', type: 'button', children: 'New campaign' });

		expect(holder(root).querySelector('button.ds-card-create')?.getAttribute('type')).toBe(
			'button'
		);
	});
});
