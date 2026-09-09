import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import { FormOriginsFields } from './origins-fields';

// where a form loads, as the group states it: the deployment's own donation page, which is always
// there, and the sites an operator listed, which may be none.
//
// what it covers is that the group says one true thing either way. the donation page is stated and
// never a control — a form loads on it whatever this screen is used to do, so a box that looked
// untickable would be a control an operator would try — and no site listed is a complete state the
// group warns about not at all.
//
// in the dom pool because what is asserted is which controls exist: a value that is stated and a
// value that is ticked are one string on the screen and two different things in the tree, and the
// difference is `input` elements rather than text.
//
// nothing here reads a class or asks how any of it looks, which is what keeps it clear of
// CLAUDE.md's ban on a browser spec over a dashboard screen.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

const PAGE = 'https://give.example.workers.dev';

/** the group as a form screen mounts it, with nothing ticked and nothing refused. */
function group(options: { sites: string[] }): HTMLElement {
	return mount(
		createElement(FormOriginsFields, {
			box: { id: 'origins', name: 'allowed_origins', ticked: [] },
			sites: options.sites,
			donatePageOrigin: PAGE
		})
	);
}

/** every value a box would submit, which is what tells a stated address from a ticked one. */
function boxValues(root: HTMLElement): string[] {
	return [...root.querySelectorAll('input[type="checkbox"]')].map(
		(box) => (box as HTMLInputElement).value
	);
}

/** the hint, which is the only place a site is said to come from. */
const WHERE_A_SITE_COMES_FROM = 'A site that is not here';

it('states the donation page beside the sites, and never as a box', () => {
	const root = group({ sites: ['https://example.org'] });
	expect(root.textContent ?? '').toContain(PAGE);
	expect(boxValues(root)).toEqual(['https://example.org']);
});

it('says nothing is wrong when the page is the only place the form loads', () => {
	const root = group({ sites: [] });
	const said = root.textContent ?? '';
	// no site listed is where this form loads and not a fault: the page is stated, the group is
	// empty, and what stands under it is the standing sentence rather than a warning. there is no
	// state left in which the group warns, because the deployment's own address is always one.
	expect(said).toContain(PAGE);
	expect(said).not.toContain('Loads nowhere');
	expect(said).toContain(WHERE_A_SITE_COMES_FROM);
	expect(boxValues(root)).toEqual([]);
});
