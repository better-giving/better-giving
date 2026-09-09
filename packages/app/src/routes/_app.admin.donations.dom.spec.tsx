import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import Donations from './_app.admin.donations';

// the dedication cell, drawn.
//
// what it covers: the one sentence this screen composes rather than looks up. every other cell is a
// value the loader already turned into a string, and ./_app.admin.donations.workers.spec.ts is
// where those are asserted — but `In memory of Margaret Chen` is the phrase and the honoree joined
// here, in the page, and a join that lost the space or put the name first would ship with every
// workers case green.
//
// it also holds the column apart from the message beside it. a dedication is a structured fact the
// organisation reports on and a message is free text a donor wrote, and the whole argument for a
// seventh column is that folding one into the other re-fuses them.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style or a class. what is asserted is which cell holds which words.

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
		repeating: false,
		tribute: null,
		program: null,
		...over
	};
}

/**
 * the screen, drawn over the gifts given.
 *
 * mounted directly rather than inside a `createRoutesStub`, which is what ./_app.admin.forms.new
 * .dom.spec.tsx needs and this does not: nothing on this screen navigates or submits, so there is
 * no router state for a stub to hold. `params` and `matches` are what the generated props type
 * still asks for, and the cast is that spec's — the props under test are `loaderData` alone.
 */
function screen(donations: Gift[]): HTMLElement {
	return mount(
		createElement(Donations as never, {
			loaderData: { donations, limit: 50, hasMore: false },
			params: {},
			matches: []
		})
	);
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
