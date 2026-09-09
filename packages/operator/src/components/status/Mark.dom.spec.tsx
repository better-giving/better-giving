import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Mark } from './Mark.jsx';

// which of the two things a mark is, in the tree a reader who cannot see it is given. a mark beside
// a word it repeats is decoration and belongs to neither the tree nor the reading; a mark that is
// the whole of what a control says has to carry that name itself, and a mark that is both at once
// is named to nobody.
//
// what these hold is the contract, not the markup the component happens to write today: ./Mark.jsx
// draws the two as separate shapes so that a rule reading the source can see which properties stand
// on which of them, and either shape could be rewritten without either case here noticing. what
// would fail is the tree changing — a decorative mark that stops being hidden, or a named one that
// is hidden as well.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** the element the mark drew, which is where a case reads it off. */
function drawn(root: HTMLElement): Element {
	const found = root.firstElementChild;
	if (found === null) throw new Error('the mark drew nothing');
	return found;
}

describe('a mark mounted into a document', () => {
	it('is out of the tree entirely when it is given no name', () => {
		const root = render(Mark, { name: 'trash-2' });
		const mark = drawn(root);

		expect(mark.getAttribute('aria-hidden')).toBe('true');
		expect(mark.hasAttribute('role')).toBe(false);
		expect(mark.hasAttribute('aria-label')).toBe(false);
	});

	it('is an image carrying that name when it is given one', () => {
		const root = render(Mark, { name: 'pencil', label: 'Edit this form' });
		const mark = drawn(root);

		expect(mark.getAttribute('role')).toBe('img');
		expect(mark.getAttribute('aria-label')).toBe('Edit this form');
		expect(mark.hasAttribute('aria-hidden')).toBe(false);
	});
});
