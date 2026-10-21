import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { FormOriginsFields } from './origins-fields';

// where a form loads, as the group states it: the sites an operator ticked, which may be none.
//
// what it covers is that nothing ticked is said, as an empty state rather than a fault, and that
// the group only asks for a tick where there is a box to tick. a form is for embedding and has no
// page of its own, so no address is stated beside the boxes.
//
// in the dom pool because what is asserted is which boxes exist beside what the group says, and
// which boxes the sentence describes. the sentence carries a react router link, so the group is
// mounted under a router.
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

/** the group as a form screen mounts it, with nothing refused, for the deployer unless said. */
function group(options: { sites: string[]; ticked?: string[]; deployer?: boolean }): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/forms/f1',
			Component: () =>
				createElement(FormOriginsFields, {
					box: { id: 'origins', name: 'allowed_origins', ticked: options.ticked ?? [] },
					sites: options.sites,
					deployer: options.deployer ?? true
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/forms/f1'] }));
}

/** every value a box would submit. */
function boxValues(root: HTMLElement): string[] {
	return [...root.querySelectorAll('input[type="checkbox"]')].map(
		(box) => (box as HTMLInputElement).value
	);
}

/** the group's standing sentence, which is what says whether the form is on any site. */
function hint(root: HTMLElement): string {
	return root.querySelector('#origins-hint')?.textContent ?? '';
}

const WHERE_A_SITE_COMES_FROM =
	'A site that is not here is added under Which sites your forms go on.';

it('says a form with nothing ticked is on no site, and asks for a tick', () => {
	const root = group({ sites: ['https://example.org'] });
	expect(hint(root)).toBe(
		`Not on any site yet. Tick the sites you’ll paste this form on. ${WHERE_A_SITE_COMES_FROM}`
	);
	expect(boxValues(root)).toEqual(['https://example.org']);
	// the hint describes every box, so the empty state is read where the operator is about to tick.
	const box = root.querySelector('input[type="checkbox"]');
	expect(box?.getAttribute('aria-describedby')).toContain('origins-hint');
});

it('asks for no tick where there is no box to tick', () => {
	const root = group({ sites: [] });
	expect(hint(root)).toBe(`Not on any site yet. ${WHERE_A_SITE_COMES_FROM}`);
	expect(boxValues(root)).toEqual([]);
});

it('says only where a site comes from once one is ticked', () => {
	const root = group({ sites: ['https://example.org'], ticked: ['https://example.org'] });
	expect(hint(root)).toBe(WHERE_A_SITE_COMES_FROM);
});

it('states no donation page beside the sites', () => {
	const root = group({ sites: ['https://example.org'] });
	expect(root.textContent ?? '').not.toContain('Donation page');
});

it('links where a site comes from to the sites card on the forms list', () => {
	const root = group({ sites: ['https://example.org'] });
	const link = root.querySelector('#origins-hint a');
	expect(link?.textContent).toBe('Which sites your forms go on');
	expect(link?.getAttribute('href')).toBe('/admin/forms#sites');
});

it('tells a member to ask whoever set up this site, with no link to a card they cannot open', () => {
	const root = group({ sites: ['https://example.org'], deployer: false });
	expect(hint(root)).toBe(
		'Not on any site yet. Tick the sites you’ll paste this form on. To use a site that is not here, ask whoever set up this site to add it.'
	);
	expect(root.querySelector('#origins-hint a')).toBeNull();
});
