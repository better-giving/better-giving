import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import DonationForms from './_app.admin.forms._index';

// what a form's card offers and what it does not hold.
//
// mounted rather than rendered to a string, and that is why this file is in the dom pool: every
// control on the card is a `Link`, and a link only resolves to an address inside a router.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style or a class. what is asserted is which controls a card carries, where they point, and what
// the card does not carry.

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

/** the two forms every case below is drawn over, as the loader projects them. */
const GENERAL = {
	id: 'frm_general',
	name: 'General Fund',
	status: 'live' as const,
	origins: ['https://riverbanktrust.org']
};

const APPEAL = {
	id: 'frm_appeal',
	name: 'Winter Appeal',
	status: 'draft' as const,
	origins: []
};

/** the screen as it stands over those two, with whatever the address is asking about. */
function screen(
	embedding: { id: string; name: string; runtime: string; element: string } | null = null
): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/forms',
			Component: () =>
				createElement(DonationForms as never, {
					loaderData: { created: null, embedding, forms: [GENERAL, APPEAL] },
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/forms'] }));
}

it('leaves the snippet off the card: it is behind the Embed control now', () => {
	const root = screen();

	expect(root.querySelector('pre')).toBe(null);
	expect(root.textContent).not.toContain('bg-donate-form');
});

/** every link on the screen, by the address it points at. */
function links(root: HTMLElement): HTMLAnchorElement[] {
	return [...root.querySelectorAll('a')];
}

/** the accessible name of a link: the label the screen states, or the words in it. */
function named(link: HTMLAnchorElement): string {
	return link.getAttribute('aria-label') ?? link.textContent ?? '';
}

it('offers each form its own donation page and its own snippet', () => {
	const found = links(screen()).map((link) => [named(link), link.getAttribute('href')]);

	expect(found).toContainEqual(['View donation page', '/frm_general']);
	expect(found).toContainEqual(['View donation page', '/frm_appeal']);
	// the accessible name carries the record, so the two Embed controls are told apart by a reader
	// meeting either of them out of the card it stands in.
	expect(found).toContainEqual(['Embed General Fund', '/admin/forms?embed=frm_general']);
	expect(found).toContainEqual(['Embed Winter Appeal', '/admin/forms?embed=frm_appeal']);
});

it('draws both controls on a draft, whose page and snippet both refuse until it is published', () => {
	// the draft is `APPEAL`, and it is offered exactly what the live form is offered. this screen
	// withholds nothing over a state it cannot repair: publishing is a press on the form's own page.
	const drawn = links(screen()).map(named);

	expect(drawn.filter((name) => name === 'View donation page')).toHaveLength(2);
	expect(drawn.filter((name) => name.startsWith('Embed '))).toHaveLength(2);
});

/**
 * the form the address is asking about, as the loader hands the card over: the two placements, not
 * the joined block.
 *
 * the strings are this file's own and are not the real snippet — what the card owes is one slab per
 * half, in order, and packages/form/src/embed/snippet.spec.ts is where the halves themselves are
 * held.
 */
const ASKED = {
	id: GENERAL.id,
	name: GENERAL.name,
	runtime: '<script src="https://example.org/embed.js" async></script>\n<style>…</style>',
	element: '<bg-donate-form form="frm_general"></bg-donate-form>'
};

it('puts no card on the screen while the address asks about nothing', () => {
	expect(screen().querySelector('dialog')).toBe(null);
});

/** the card the address asked for, which every case below is about. */
function cardOn(root: HTMLElement): HTMLElement {
	const card = root.querySelector('dialog');
	if (card === null) throw new Error('the screen drew no embed card');
	return card;
}

it('holds a slab per placement, the runtime first and the element second', () => {
	const card = cardOn(screen(ASKED));

	// two blocks and their order is the instruction: the runtime goes once per page, the element
	// goes wherever the form appears, and an integrator following the card top to bottom pastes them
	// in that order.
	const slabs = [...card.querySelectorAll('pre')];
	expect(slabs).toHaveLength(2);
	expect(slabs[0]?.textContent).toContain('<script src=');
	expect(slabs[1]?.textContent).toBe(ASKED.element);
});

it('names each copy control for the placement it takes, not just for the record', () => {
	const card = cardOn(screen(ASKED));

	// two controls in one card, so the record alone does not tell them apart: what a reader meeting
	// either of them has to know is which of the two halves it puts on the clipboard.
	const copies = [...card.querySelectorAll('button')]
		.map((button) => button.getAttribute('aria-label') ?? '')
		.filter((name) => name.startsWith('Copy'));

	expect(copies).toEqual(['Copy the script for General Fund', 'Copy the element for General Fund']);
});

it('titles the card with the form’s name in quotes', () => {
	// the quotes are the seam between the verb and the name: `Embed General Fund` reads as one
	// run-on phrase.
	expect(cardOn(screen(ASKED)).textContent).toContain('Embed \u201cGeneral Fund\u201d');
});

it('offers the way out and the page the sites are ticked on', () => {
	// one leaves the question behind, and the other is where the requirement the card states is
	// acted on.
	const out = [...cardOn(screen(ASKED)).querySelectorAll('a')].map((link) =>
		link.getAttribute('href')
	);

	expect(out).toContain('/admin/forms');
	expect(out).toContain('/admin/forms/frm_general');
});
