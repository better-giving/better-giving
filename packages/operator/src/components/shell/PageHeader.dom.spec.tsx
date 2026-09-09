import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { PageHeader } from './PageHeader.jsx';

// the header's title block, which is a thing rather than a wrapper: `.adm-pageheader__title` in
// ../../styles/adm.css is what stands the standfirst off the heading, and the row's own gap sits
// between that block and what acts on the page rather than inside it. a refactor that hoists the
// two lines into the row, or drops the class off the block, puts the sentence back against the
// title with nothing on the screen saying a rule stopped matching.
//
// inside it the name and the word set beside it are their own row, `.adm-pageheader__name`. the
// block is a single column, so a `beside` flattened into it is the word stacked under the title
// instead of standing on its baseline — a difference that renders, and that no gate in this
// repository can read. the cases below hold the markup those two rules are written against.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** the block the header drew its name and its standfirst into. */
function titleBlock(root: HTMLElement): Element {
	const found = root.querySelector('.adm-pageheader__title');
	// a header that drew no block would answer every query below with `null`, which reads as a
	// standfirst that is absent rather than as one in the wrong place.
	if (found === null) throw new Error('the header drew no title block');
	return found;
}

/** the row inside that block holding the name and whatever was set beside it. */
function nameRow(root: HTMLElement): Element {
	const found = titleBlock(root).querySelector('.adm-pageheader__name');
	if (found === null) throw new Error('the header drew no name row');
	return found;
}

describe('a page header mounted into a document', () => {
	it('draws the standfirst inside the title block, under the heading', () => {
		const root = render(PageHeader, {
			title: 'Connect Cloudflare',
			standfirst: 'better-giving runs inside a Cloudflare account you own.'
		});

		expect([...titleBlock(root).children].map((child) => child.className)).toEqual([
			'adm-pageheader__name',
			'adm-standfirst'
		]);
		expect([...nameRow(root).children].map((child) => child.tagName)).toEqual(['H1']);
		expect(titleBlock(root).querySelector('.adm-standfirst')?.textContent).toBe(
			'better-giving runs inside a Cloudflare account you own.'
		);
	});

	it('keeps the block a child of the row, so the row gap never falls between the two lines', () => {
		// the row spaces its own children apart. a block hoisted out of it, or two lines put
		// straight into it, is the row's gap landing where the title block's step should be.
		const root = render(PageHeader, {
			title: 'Set up this deployment',
			standfirst: 'Everything this deployment needs lives in one Cloudflare account.',
			pageAction: <button type="button">Run setup</button>
		});
		const row = root.querySelector('.adm-pageheader__row');

		expect(titleBlock(root).parentElement).toBe(row);
		expect([...(row?.children ?? [])].map((child) => child.className)).toEqual([
			'adm-pageheader__title',
			''
		]);
	});

	it('sets the word beside the title in the name’s own row, above the standfirst', () => {
		const root = render(PageHeader, {
			title: 'Riverbank appeal',
			beside: <span className="adm-caption">Taking gifts</span>,
			standfirst: 'One form, embedded on the appeal page.'
		});

		expect([...nameRow(root).children].map((child) => child.tagName)).toEqual(['H1', 'SPAN']);
		expect([...titleBlock(root).children].map((child) => child.className)).toEqual([
			'adm-pageheader__name',
			'adm-standfirst'
		]);
		expect(nameRow(root).querySelector('.adm-caption')?.textContent).toBe('Taking gifts');
	});

	it('draws the word beside a title carrying no standfirst', () => {
		const root = render(PageHeader, {
			title: 'Riverbank appeal',
			beside: <span className="adm-caption">Taking gifts</span>
		});

		expect([...nameRow(root).children].map((child) => child.tagName)).toEqual(['H1', 'SPAN']);
		expect(titleBlock(root).querySelector('.adm-standfirst')).toBeNull();
	});

	it('draws the heading and nothing else where the caller states no standfirst', () => {
		// the step is the block's `gap`, which is drawn between children and never above the first
		// one, so a header with one line is that line and no space under it. an empty paragraph here
		// would be a stray step over whatever the page opens with.
		const root = render(PageHeader, {
			title: 'Donation forms',
			pageAction: <button type="button">New form</button>
		});

		expect([...titleBlock(root).children].map((child) => child.className)).toEqual([
			'adm-pageheader__name'
		]);
		expect([...nameRow(root).children].map((child) => child.tagName)).toEqual(['H1']);
		expect(root.querySelector('.adm-standfirst')).toBeNull();
	});
});

describe('the page header’s slots', () => {
	// the word beside the title and the action at the end of the row are two slots and neither is
	// called `action`. packages/app/src/routes.spec.ts reads a JSX attribute name as an identifier,
	// so a route exporting `action` and writing `action={…}` here reaches its own handler
	// through its own component and is reported as D1 and the stripe client in the bundle a visitor
	// downloads. that spec holds the mounted case; this one holds the name, so a rename here fails
	// where the name lives rather than in a sweep whose message names neither.
	const source = readFileSync('src/components/shell/PageHeader.jsx', 'utf8').replace(
		/\/\*[\s\S]*?\*\//g,
		' '
	);

	it('reads the part it is meant to be guarding', () => {
		expect(source).toContain('export function PageHeader');
	});

	it('names no slot `action`', () => {
		expect(source.match(/\baction\b/g)).toBeNull();
	});

	it('names both the slot beside the title and the one after it', () => {
		expect(source).toContain('beside');
		expect(source).toContain('pageAction');
	});
});
