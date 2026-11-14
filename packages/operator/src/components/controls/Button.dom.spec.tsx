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
	it('puts the mark and the words straight into the press, in the order they were handed', () => {
		// the registry's button is a flex row whose gap stands between its items, so the mark and the
		// words are items of the press itself.
		const button = only(render(Button, { mark: 'plus', children: 'Add a form' }));

		expect([button.firstElementChild?.classList.contains('adm-mark'), button.textContent]).toEqual([
			true,
			'Add a form'
		]);
	});
});

describe('a press a caller says is in flight', () => {
	it('carries the attribute through, which is what the registry draws the wait off', () => {
		// ../../registry/styles/button-css.css draws `[aria-busy='true']` as the disabled fill with
		// the label still in it, so the label is in the tree and nothing is drawn over it.
		const button = only(render(Button, { 'aria-busy': true, children: 'Save' }));

		expect([button.getAttribute('aria-busy'), button.textContent, button.children.length]).toEqual([
			'true',
			'Save',
			0
		]);
	});

	it('carries the attribute’s own word as well as the boolean', () => {
		// a caller spreading props through from somewhere else hands over the string the platform
		// stores.
		const button = only(render(Button, { 'aria-busy': 'true', children: 'Save' }));

		expect(button.matches("[aria-busy='true']")).toBe(true);
	});

	it('is not busy for a button that is not, whichever way that is said', () => {
		for (const busy of [undefined, false, 'false'] as const) {
			const button = only(render(Button, { 'aria-busy': busy, children: 'Save' }));

			expect(button.matches("[aria-busy='true']")).toBe(false);
		}
	});
});

describe('what the element wears', () => {
	it('is dressed the same however it is drawn', () => {
		const asButton = only(render(Button, { variant: 'primary', children: 'Save' })).className;
		const asLink = only(
			render(Button, { as: 'a', variant: 'primary', children: 'Save' })
		).className;

		expect([asButton, asLink]).toEqual([
			'ds-btn ds-btn-primary adm-btn',
			'ds-btn ds-btn-primary adm-btn'
		]);
	});

	it('wears the registry’s rank for every variant, and the secondary rank for the default', () => {
		const ranks = (['default', 'primary', 'danger', 'quiet', 'soft'] as const).map(
			(variant) => only(render(Button, { variant, children: 'Go' })).classList[1]
		);

		expect(ranks).toEqual([
			'ds-btn-secondary',
			'ds-btn-primary',
			'ds-btn-destructive',
			'ds-btn-ghost',
			'ds-btn-soft'
		]);
	});

	it('wears the small tier and the hooks a screen places a quiet small press by', () => {
		const button = only(render(Button, { variant: 'quiet', size: 'sm', children: 'Copy' }));

		expect(button.className).toBe(
			'ds-btn ds-btn-ghost ds-btn-sm adm-btn adm-btn--quiet adm-btn--sm'
		);
	});

	it('adds a caller’s class to its own rather than standing in for them', () => {
		const button = only(render(Button, { className: 'adm-moresheet__close', children: 'Close' }));

		expect(button.className).toBe('ds-btn ds-btn-secondary adm-btn adm-moresheet__close');
	});
});

// a press drawn with a mark and no words is named by its `aria-label` and squared on its tier's
// height, and the class is the only thing that says so: ../../registry/styles/button-css.css draws
// `.ds-btn-icon` and no screen writes it.
describe('a press that is a mark alone', () => {
	const classes = (props: Record<string, unknown>) =>
		only(render(Button, { 'aria-label': 'Remove', ...props })).classList;

	it('is squared when it has a mark and no words', () => {
		expect(classes({ mark: 'x' }).contains('ds-btn-icon')).toBe(true);
	});

	it('is squared when the words it was handed draw nothing', () => {
		expect(classes({ mark: 'x', children: false }).contains('ds-btn-icon')).toBe(true);
	});

	it('keeps its padding when words stand beside the mark', () => {
		expect(classes({ mark: 'plus', children: 'Add a form' }).contains('ds-btn-icon')).toBe(false);
	});
});
