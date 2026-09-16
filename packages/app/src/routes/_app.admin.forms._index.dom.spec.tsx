import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import DonationForms from './_app.admin.forms._index';

// what a form's card offers and what it does not hold.
//
// mounted rather than rendered to a string, and that is why this file is in the dom pool: every
// press on the card is a `Link`, and a link only resolves to an address inside a router.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style. the classes named below are read as structure and never as appearance — which card leads
// the list, which head carries a mark, and which list is the record's foot.

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

/** a form as the loader projects it: the whole of what this screen is given about one. */
type Projected = {
	id: string;
	name: string;
	status: 'live' | 'draft';
	origins: string[];
};

/**
 * the two forms every case below is drawn over: one live and served on two sites, one draft served
 * on none. neither shares a word with the sample inside the create card, so no assertion below can
 * be satisfied by that sample standing in for a record.
 */
const GENERAL: Projected = {
	id: 'frm_general',
	name: 'General Fund',
	status: 'live',
	origins: ['https://riverbanktrust.org', 'https://give.riverbanktrust.org']
};

const APPEAL: Projected = {
	id: 'frm_appeal',
	name: 'Winter Appeal',
	status: 'draft',
	origins: []
};

/** the embed card as the loader hands it over, or `null` while the address asks about nothing. */
type Asked = {
	id: string;
	name: string;
	runtime: string;
	element: string;
	site: string | null;
};

/** the screen as it stands over whatever forms the deployment has, and whatever the address asks. */
function screen(
	embedding: Asked | null = null,
	forms: Projected[] = [GENERAL, APPEAL]
): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/forms',
			Component: () =>
				createElement(DonationForms as never, {
					loaderData: { created: null, embedding, forms },
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/forms'] }));
}

/** the list every case below reads, and it is always drawn. */
function list(root: HTMLElement): HTMLElement {
	const drawn = root.querySelector<HTMLElement>('.adm-list');
	if (drawn === null) throw new Error('the screen drew no list');
	return drawn;
}

/**
 * the cards a reader can reach, which is every record on the list and not the sample inside the
 * create card: that one wears a record's classes on purpose, and is hidden.
 */
function records(root: HTMLElement): HTMLElement[] {
	return [...list(root).querySelectorAll<HTMLElement>('.adm-record')].filter(
		(card) => card.closest('[aria-hidden="true"]') === null
	);
}

/** the presses at the foot of one record, in the order the card draws them. */
function foot(card: HTMLElement | undefined): HTMLAnchorElement[] {
	if (card === undefined) throw new Error('the screen drew no such record');
	return [...card.querySelectorAll<HTMLAnchorElement>('.adm-record__foot a')];
}

it('leads the list with the way to add to it, on an empty list and a populated one alike', () => {
	// the create card is the list's first card in both readings, which is what makes the empty list
	// the same screen as the full one rather than a sentence standing in for it.
	for (const forms of [[], [GENERAL, APPEAL]]) {
		const lead = list(screen(null, forms)).firstElementChild;

		expect(lead?.getAttribute('href')).toBe('/admin/forms/new');
		expect(lead?.textContent).toContain('Create donation form');
	}
});

it('draws the create card and nothing else while the deployment has no forms', () => {
	const root = screen(null, []);

	// no sentence stands in for the empty list, so there is one card on the screen and it is the way
	// to end the emptiness.
	expect(records(root)).toHaveLength(0);
	expect(list(root).childElementCount).toBe(1);
	expect(root.querySelector('.adm-empty')).toBe(null);
});

it('carries a form’s mark on the line its name is on, with its status word', () => {
	const head = records(screen())[0]?.querySelector('.adm-record__head--marked');

	// the mark leads the head, before the name: the rail carries the same glyph for Donation forms
	// ($lib/admin/destinations.ts), so a card and the destination that reached it agree on sight.
	expect(head?.firstElementChild?.className).toBe('adm-record__mark');
	expect(head?.querySelector('h2 a')?.getAttribute('href')).toBe('/admin/forms/frm_general');
	expect(head?.lastElementChild?.textContent).toBe('Live');
});

it('ends a record with its own page and then each of its sites, in the form’s own order', () => {
	// the foot is the record's ways out, and the order is the form's: its own donation page first,
	// because every form has one, then the sites as the form lists them.
	const presses = foot(records(screen())[0]);

	expect(presses.map((press) => press.textContent?.trim())).toEqual([
		'form page',
		'https://riverbanktrust.org',
		'https://give.riverbanktrust.org'
	]);
	expect(presses[0]?.getAttribute('href')).toBe('/frm_general');
});

it('aims a site’s press at that site on that form', () => {
	// the press carries both halves, so the card it opens names the site the operator pressed rather
	// than leaving them to match it up themselves.
	const press = foot(records(screen())[0])[1];

	expect(press?.getAttribute('href')).toBe(
		'/admin/forms?embed=frm_general&site=https%3A%2F%2Friverbanktrust.org'
	);
	// the accessible name carries the record, so a reader meeting the press out of the card it
	// stands in is told which form it embeds — the job the Embed button it replaced was doing.
	expect(press?.getAttribute('aria-label')).toBe(
		'Embed General Fund on https://riverbanktrust.org'
	);
});

it('gives a form with no sites a foot of its own page alone', () => {
	// the draft is `APPEAL`, and it is offered its own page exactly as the live form is: this screen
	// withholds nothing over a state it cannot repair, and publishing is a press on the form's own
	// page. a form nobody has ticked a site on has one press and no list of them.
	const presses = foot(records(screen())[1]);

	expect(presses.map((press) => press.textContent?.trim())).toEqual(['form page']);
	expect(presses[0]?.getAttribute('href')).toBe('/frm_appeal');
});

it('puts nothing over the list and no labelled value inside a card, on either reading', () => {
	for (const forms of [[], [GENERAL, APPEAL]]) {
		const root = screen(null, forms);

		// the page's one press is in the list now, so a header holding a second copy of it would be
		// two ways to the same screen a card apart, and the hint that stood over the records went
		// with the buttons it was qualifying.
		expect(root.querySelector('.adm-pageheader')).toBe(null);
		expect(root.querySelector('.adm-hint')).toBe(null);
		// the sites are the presses now rather than a value read beside a label.
		expect(root.textContent).not.toContain('Sites');
		expect(root.textContent).not.toContain('View donation page');
	}
});

it('leaves the snippet off the card: it is behind a press at the foot now', () => {
	const root = screen();

	expect(root.querySelector('pre')).toBe(null);
	expect(root.textContent).not.toContain('bg-donate-form');
});

/**
 * the form the address is asking about, as the loader hands the card over: the two placements, not
 * the joined block.
 *
 * the strings are this file's own and are not the real snippet — what the card owes is one slab per
 * half, in order, and packages/form/src/embed/snippet.spec.ts is where the halves themselves are
 * held.
 */
const ASKED: Asked = {
	id: GENERAL.id,
	name: GENERAL.name,
	runtime: '<script src="https://example.org/embed.js" async></script>\n<style>…</style>',
	element: '<bg-donate-form form="frm_general"></bg-donate-form>',
	site: null
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
	expect(cardOn(screen(ASKED)).textContent).toContain('Embed “General Fund”');
});

it('names the site the press carried, and the list alone when there was none', () => {
	// the press said which site it was for, so the card says it back: an operator with three sites
	// reads where this paste is going rather than checking the address bar for it.
	const aimed = cardOn(screen({ ...ASKED, site: 'https://riverbanktrust.org' }));
	expect(aimed.textContent).toContain('Paste this into https://riverbanktrust.org.');

	// and with no site the sentence is the one every reading kept before there were presses to aim
	// it: what the snippet is allowed on, and where to widen that.
	const plain = cardOn(screen(ASKED));
	expect(plain.textContent).toContain('It loads only on the sites this form lists.');
	expect(plain.textContent).not.toContain('Paste this into');
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
