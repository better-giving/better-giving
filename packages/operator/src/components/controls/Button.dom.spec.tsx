import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Button } from './Button.jsx';

// `as` is the whole subject here: it names the element this control becomes, and the cases below
// are the three kinds of thing a caller may hand it.
//
// the two tag names are what every screen wrote before the prop took a component, and they are
// still what a screen with no router to reach for writes. the third is the one the prop was widened
// for, and what it buys is asserted a surface away, under an actual router
// (packages/app/src/lib/admin/button-navigates.dom.spec.tsx) — this package has none and must not.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

function only(root: HTMLElement): Element {
	const found = root.firstElementChild;
	// a case that read `null` here would assert nothing about a control that is not there.
	if (found === null) throw new Error('the button drew nothing');
	return found;
}

describe('the element a caller asks for', () => {
	it('is a button when nobody asks for anything', () => {
		expect(only(render(Button, { children: 'Save' })).tagName).toBe('BUTTON');
	});

	it('is an anchor on the tag name, and carries the href through', () => {
		const link = only(render(Button, { as: 'a', href: '/somewhere', children: 'Go' }));

		expect([link.tagName, link.getAttribute('href')]).toEqual(['A', '/somewhere']);
	});

	it('is whatever component it is handed, with that component’s own props', () => {
		/** stands in for a router's link: it takes a `to` rather than an `href`. */
		const Stub = ({ to, ...rest }: { to: string } & Record<string, unknown>) => (
			<a data-to={to} {...rest} />
		);
		const link = only(render(Button, { as: Stub, to: '/somewhere', children: 'Go' }));

		expect(link.getAttribute('data-to')).toBe('/somewhere');
	});
});

describe('what a button draws inside itself', () => {
	it('puts the mark and the words in one span, so the pair can be hidden together', () => {
		// the span is what the dots stand over, and what keeps the two boxes the same size: the label
		// keeps its own width under a press rather than being swapped for a word of another length.
		const label = only(render(Button, { mark: 'plus', children: 'Add a form' })).firstElementChild;

		expect([
			label?.className,
			label?.querySelector('.adm-mark') !== null,
			label?.textContent
		]).toEqual(['adm-btn__label', true, 'Add a form']);
	});
});

describe('a press a caller says is in flight', () => {
	it('draws three dots over a label that is still in the tree', () => {
		// the dots are the whole report: `aria-busy` is what a reader is told, so the mark beside it
		// is hidden from them and says nothing twice.
		const button = only(render(Button, { 'aria-busy': true, children: 'Save' }));
		const dots = button.querySelector('.adm-btn__dots');

		expect([
			button.getAttribute('aria-busy'),
			button.textContent,
			dots?.getAttribute('aria-hidden'),
			dots?.children.length
		]).toEqual(['true', 'Save', 'true', 3]);
	});

	it('reads the attribute’s own word as well as the boolean', () => {
		// a caller spreading props through from somewhere else hands over the string the platform
		// stores, and a button that only took the boolean would draw nothing for a press that is
		// really going.
		const button = only(render(Button, { 'aria-busy': 'true', children: 'Save' }));

		expect(button.querySelector('.adm-btn__dots')?.children.length).toBe(3);
	});

	it('draws nothing for a button that is not busy, whichever way that is said', () => {
		// `'false'` is a non-empty string and truthy, so a button reading the prop rather than its
		// value would pulse over every press that had ever finished.
		for (const busy of [undefined, false, 'false'] as const) {
			const button = only(render(Button, { 'aria-busy': busy, children: 'Save' }));

			expect([
				button.querySelector('.adm-btn__dots'),
				button.matches("[aria-busy='true']")
			]).toEqual([null, false]);
		}
	});
});

describe('what the element wears', () => {
	it('is dressed the same however it is drawn', () => {
		const asButton = only(render(Button, { variant: 'primary', children: 'Save' })).className;
		const asLink = only(
			render(Button, { as: 'a', variant: 'primary', children: 'Save' })
		).className;

		expect([asButton, asLink]).toEqual(['adm-btn adm-btn--primary', 'adm-btn adm-btn--primary']);
	});
});
