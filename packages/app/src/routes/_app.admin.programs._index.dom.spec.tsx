import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import type { ProgramStatus } from '$lib/programs/statuses';
import Programs from './_app.admin.programs._index';

// what the causes list offers and what it does not hold.
//
// mounted rather than rendered to a string, and that is why this file is in the dom pool: the way
// on to every screen this list reaches is a `Link`, and a link only resolves to an address inside a
// router.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style. the classes named below are read as structure and never as appearance — which card leads
// the list, and which head carries a mark.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
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

/** a cause as the loader projects it: the whole of what this screen is given about one. */
type Projected = {
	id: string;
	name: string;
	description: string | null;
	status: ProgramStatus;
};

/**
 * the two causes the populated cases are drawn over, and the second has no description. neither
 * shares a word with the sample inside the create card, so no assertion below can be satisfied by
 * that sample standing in for a record.
 */
const WELLS: Projected = {
	id: 'prg_wells',
	name: 'Riverbank wells',
	description: 'Filters for every village along the river.',
	status: 'active'
};

const LEGACY: Projected = {
	id: 'prg_legacy',
	name: 'Legacy appeal',
	description: null,
	status: 'archived'
};

/** the screen as it stands over whatever causes the deployment has. */
function screen(programs: Projected[] = [WELLS, LEGACY]): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/programs',
			Component: () =>
				createElement(Programs as never, {
					loaderData: { created: null, programs },
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/programs'] }));
}

/** the list every case below reads, and it is always drawn. */
function list(root: HTMLElement): HTMLElement {
	const drawn = root.querySelector<HTMLElement>('.adm-list');
	if (drawn === null) throw new Error('the screen drew no list');
	return drawn;
}

it('leads the list with the way to add to it, on an empty list and a populated one alike', () => {
	// the create card is the list's first card in both readings, which is what makes the empty list
	// the same screen as the full one rather than a sentence standing in for it.
	for (const programs of [[], [WELLS, LEGACY]]) {
		const lead = list(screen(programs)).firstElementChild;

		expect(lead?.getAttribute('href')).toBe('/admin/programs/new');
		expect(lead?.textContent).toContain('Create program');
	}
});

/**
 * the cards a reader can reach, which is every record on the list and not the sample inside the
 * create card: that one wears a record's classes on purpose, and is hidden.
 */
function records(root: HTMLElement): HTMLElement[] {
	return [...list(root).querySelectorAll<HTMLElement>('.adm-record')].filter(
		(card) => card.closest('[aria-hidden="true"]') === null
	);
}

it('carries a cause’s mark on the line its name is on, with its status word', () => {
	const head = records(screen())[0]?.querySelector('.adm-record__head--marked');

	// the mark leads the head, before the name: the rail carries the same glyph for Programs, so a
	// card and the destination that reached it agree on sight.
	expect(head?.firstElementChild?.className).toBe('adm-record__mark');
	expect(head?.querySelector('h2 a')?.getAttribute('href')).toBe('/admin/programs/prg_wells');
	expect(head?.lastElementChild?.textContent).toBe('Active');
});

it('draws the create card and nothing else while the deployment has no causes', () => {
	const root = screen([]);

	// no sentence stands in for the empty list, so there is one card on the screen and it is the way
	// to end the emptiness.
	expect(records(root)).toHaveLength(0);
	expect(list(root).childElementCount).toBe(1);
	expect(root.querySelector('.adm-empty')).toBe(null);
});

it('puts no press over the page, on either reading', () => {
	// the page's one press is in the list now, so a header holding a second copy of it would be two
	// ways to the same screen a card apart.
	for (const programs of [[], [WELLS, LEGACY]]) {
		expect(screen(programs).querySelector('.adm-pageheader')).toBe(null);
	}
});
