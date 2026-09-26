import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import Donations from './_app.admin.donations._index';

// the dedication cell, drawn.
//
// what it covers: the one sentence this screen composes rather than looks up. every other cell is a
// value the loader already turned into a string, and ./_app.admin.donations._index.workers.spec.ts is
// where those are asserted — but `In memory of Margaret Chen` is the phrase and the honoree joined
// here, in the page, and a join that lost the space or put the name first would ship with every
// workers case green.
//
// it also holds the column apart from the message beside it. a dedication is a structured fact the
// organisation reports on and a message is free text a donor wrote, and the whole argument for a
// seventh column is that folding one into the other re-fuses them.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style. what a case names a class for is where a thing is drawn — which line the press stands on —
// or which tone rung a `StatusWord` stands on, off its `adm-state--<tone>` class; never what either
// looks like there.

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

type Gift = Parameters<typeof Donations>[0]['loaderData']['donations'][number];

/** one gift as the loader hands it over, dedicated to nobody unless a case says otherwise. */
function gift(over: Partial<Gift> = {}): Gift {
	return {
		id: '019fb300-0000-7000-8000-000000000001',
		donorName: 'Ada Okafor',
		amount: '$123.45',
		receivedOn: '2026-07-04',
		source: 'Annual appeal',
		note: null,
		status: 'completed',
		paidWith: 'Card',
		repeating: false,
		tribute: null,
		program: null,
		trackingId: null,
		...over
	};
}

/**
 * the screen, drawn over the gifts given.
 *
 * inside a `createRoutesStub`, because the Add donation link is a router `Link` and has nothing to
 * resolve against without one. `params` and `matches` are what the generated props type still asks
 * for, and the cast is ./_app.admin.forms.new.dom.spec.tsx's — the props under test are `loaderData`
 * alone.
 */
function screen(donations: Gift[]): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/donations',
			Component: () =>
				createElement(Donations as never, {
					loaderData: { donations, limit: 50, hasMore: false },
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/donations'] }));
}

/**
 * what the one row holds under the column headed `label`.
 *
 * read by the header's position rather than by a class or a key, because that is what a reader
 * does: the first cell of a row is its `th` and the rest are `td`s, so the column's index is one
 * ahead of the cell's in the body.
 */
function cell(root: HTMLElement, label: string): string {
	const headers = [...root.querySelectorAll('thead th')].map((th) => th.textContent);
	const at = headers.indexOf(label);
	expect(at, `no column headed ${label}`).toBeGreaterThanOrEqual(0);
	const row = root.querySelector('tbody tr');
	const held = at === 0 ? row?.querySelector('th') : row?.querySelectorAll('td')[at - 1];
	return held?.textContent ?? '';
}

it('draws no heading of its own: the frame names the page in a hidden one', () => {
	expect(screen([gift({})]).querySelector('h1')).toBe(null);
});

it('links to adding a donation that arrived in hand, on the line that counts them', () => {
	const root = screen([gift()]);
	const link = [...root.querySelectorAll('a')].find((a) => a.textContent === 'Add donation');

	expect(link?.getAttribute('href')).toBe('/admin/donations/new');
	// the press is the table's, drawn on the line that counts the gifts rather than in a band of
	// its own over the page.
	expect(root.querySelector('.adm-tablelead')?.contains(link ?? null)).toBe(true);
});

it('opens the accountant’s export, beside the press that adds a gift', () => {
	const root = screen([gift()]);
	const link = [...root.querySelectorAll('a')].find((a) => a.textContent === 'Export');

	expect(link?.getAttribute('href')).toBe('/admin/donations/export');
	// on the same line as the press that adds one: both act on the list, and the export is the only
	// way out of what the list holds.
	expect(root.querySelector('.adm-tablelead')?.contains(link ?? null)).toBe(true);
});

it('keeps the press on a deployment that has taken no gifts', () => {
	// the screen an operator is most likely to be pressing it on, and the one where the line it
	// now sits on states no count.
	const link = [...screen([]).querySelectorAll('a')].find((a) => a.textContent === 'Add donation');
	expect(link?.getAttribute('href')).toBe('/admin/donations/new');
});

it('puts no press over the page, on either reading', () => {
	// the header band is gone: a second copy of the press above the count would be two ways to the
	// same screen a line apart.
	for (const donations of [[], [gift()]]) {
		expect(screen(donations).querySelector('.adm-pageheader')).toBe(null);
	}
});

it('states the dedication as the sentence a fundraiser says', () => {
	const root = screen([gift({ tribute: { kind: 'memory', honoree: 'Margaret Chen' } })]);
	expect(cell(root, 'Dedication')).toBe('In memory of Margaret Chen');
});

it('says in honor of a gift given for somebody living', () => {
	// the two kinds are one word apart and both slot into "in ___ of", so a lookup keyed wrong
	// reads as a working screen on half the rows.
	const root = screen([gift({ tribute: { kind: 'honor', honoree: 'Margaret Chen' } })]);
	expect(cell(root, 'Dedication')).toBe('In honor of Margaret Chen');
});

it('keeps the dedication out of the message the donor wrote', () => {
	// the whole argument for a column of its own: a message is free text and never parsed, a
	// dedication is a fact the organisation reports on, and one cell holding both is the two
	// re-fused.
	const root = screen([
		gift({
			note: 'Thank you for everything you do.',
			tribute: { kind: 'memory', honoree: 'Margaret Chen' }
		})
	]);
	expect(cell(root, 'Message')).toBe('Thank you for everything you do.');
	expect(cell(root, 'Dedication')).toBe('In memory of Margaret Chen');
});

it('states the cause the gift was credited to', () => {
	// the name as it is stored, and no word around it: the column's header is what says what it is.
	const root = screen([gift({ program: 'Clean water' })]);
	expect(cell(root, 'Program')).toBe('Clean water');
});

it('leaves the cause empty on a gift credited to none', () => {
	const root = screen([gift()]);
	expect(cell(root, 'Program')).toBe('—');
});

it('leaves the cell empty on a gift given for nobody', () => {
	// the table dashes and mutes an empty cell itself, which is why the page reaches for no
	// fallback of its own — `—` here is `DataTable`'s and not this screen's.
	const root = screen([gift()]);
	expect(cell(root, 'Dedication')).toBe('—');
});

it('prints the rail under the column headed for it', () => {
	// the loader resolves the word, so what this reads is that the column and the cell agree on
	// their key: a typo in either leaves a dashed column standing beside a green workers spec.
	const root = screen([gift({ paidWith: 'Venmo' })]);
	expect(cell(root, 'Paid with')).toBe('Venmo');
});

it('draws the coin and how much of it arrived beside a crypto gift’s rail', () => {
	const root = screen([gift({ paidWith: 'Crypto', coinReceived: '19.36121163 XRP' })]);
	expect(cell(root, 'Paid with')).toBe('Crypto 19.36121163 XRP');
	expect(cell(root, 'Amount')).toBe('$123.45');
});

it('draws the rail alone on a crypto gift nothing has arrived in', () => {
	const root = screen([gift({ status: 'pending', paidWith: 'Crypto' })]);
	expect(cell(root, 'Paid with')).toBe('Crypto');
});

it('leaves the rail empty on a gift nothing has been attempted on', () => {
	// `DataTable` dashes and mutes an empty cell itself, which is why the page reaches for no
	// fallback — a rail invented for a gift that has none is a claim about money that never moved.
	const root = screen([gift({ paidWith: null })]);
	expect(cell(root, 'Paid with')).toBe('—');
});

it('draws a pending grant’s tracking id beside its state, as a literal to type', () => {
	// the organisation marks the grant received in Chariot's dashboard by this id, so it is drawn as
	// code: something an operator retypes.
	const root = screen([
		gift({ status: 'pending', paidWith: 'Donor-advised fund', trackingId: 'L9E182VBGP' })
	]);
	expect(cell(root, 'Status')).toBe('Pending Tracking ID L9E182VBGP');
	expect(root.querySelector('tbody code')?.textContent).toBe('L9E182VBGP');
	// the status column is narrow at a phone's width; the label wraps above the id, the id never splits.
	expect(root.querySelector('tbody code')?.classList.contains('adm-code--unbroken')).toBe(true);
});

it('draws no tracking id on a gift that has none', () => {
	const root = screen([gift({ status: 'pending' })]);
	expect(cell(root, 'Status')).toBe('Pending');
	expect(root.querySelector('tbody code')).toBe(null);
});

it('draws a disputed gift’s word in the tone of a gift waiting on somebody', () => {
	const root = screen([gift({ status: 'disputed' })]);
	expect(cell(root, 'Status')).toBe('Disputed');
	const word = root.querySelector('tbody .adm-state');
	expect(word?.textContent).toBe('Disputed');
	expect(word?.classList.contains('adm-state--attention')).toBe(true);
	expect(word?.classList.contains('adm-state--done')).toBe(false);
});
