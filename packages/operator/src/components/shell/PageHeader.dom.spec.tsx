import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesIn, sheet } from '../../styles/sheet-rule.testing';
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

	it('draws no heading at all where the caller states no title', () => {
		// a screen whose name is already read directly above the header — the trail's last crumb —
		// hands none, and what would otherwise be drawn is that word twice a line apart. the whole
		// name row goes rather than its contents: an empty heading is a name-shaped gap, and the
		// block's `gap` would then spend a step over the standfirst for a line that draws nothing.
		const root = render(PageHeader, {
			standfirst: 'What was given in a range of days, as the file your accountant imports.'
		});

		expect([...titleBlock(root).children].map((child) => child.className)).toEqual([
			'adm-standfirst'
		]);
		expect(root.querySelector('h1')).toBeNull();
		expect(root.querySelector('.adm-pageheader__name')).toBeNull();
	});

	it('starts a standfirst stated with no title at the row’s leading edge', () => {
		// the sentence opens the page the way a heading would, so it stands where one would stand:
		// at the column's start, over the content it introduces. the row stands what it holds at the
		// far end only where it holds what acts on the page and nothing else — a sentence pushed
		// there sits off to one side of the list it is about. the dom pool computes no style, so
		// what is asked is which rule in ../../styles/adm.css stating the row's spread matches it.
		const spreads = rulesIn(sheet('adm.css')).filter(
			({ selector, stated }) =>
				selector.includes('.adm-pageheader__row') && stated.has('justify-content')
		);
		const spreadOf = (row: Element | null) =>
			spreads
				.filter(({ selector }) => row?.matches(selector))
				.at(-1)
				?.stated.get('justify-content');

		const titleless = render(PageHeader, { standfirst: 'Which sites your forms go on' });
		expect(spreadOf(titleless.querySelector('.adm-pageheader__row'))).toBe('space-between');
		expect(titleBlock(titleless).firstElementChild?.className).toBe('adm-standfirst');

		const withAction = render(PageHeader, {
			standfirst: 'Which sites your forms go on',
			pageAction: <button type="button">Add a site</button>
		});
		expect(spreadOf(withAction.querySelector('.adm-pageheader__row'))).toBe('space-between');

		// the shape the far end is for: a row holding what acts on the page, named by the strip.
		const actionsOnly = render(PageHeader, {
			pageAction: <button type="button">New form</button>
		});
		expect(spreadOf(actionsOnly.querySelector('.adm-pageheader__row'))).toBe('end');
	});

	it('drops the word beside a title where no title was stated', () => {
		// `beside` qualifies the name, so a word beside a name that is not there qualifies nothing.
		const root = render(PageHeader, { beside: <span>Draft</span>, standfirst: 'A sentence.' });

		expect(root.textContent).not.toContain('Draft');
	});

	it('draws the crumbs above the row, as the header’s first block', () => {
		// the trail names the pages above this one and the heading names this one, so the trail is
		// read first. inside the row it would be spaced apart from the title like anything else there.
		const root = render(PageHeader, {
			title: 'Sites',
			crumbs: <nav aria-label="Breadcrumb" />
		});
		const header = root.querySelector('.adm-pageheader');

		expect([...(header?.children ?? [])].map((child) => child.tagName)).toEqual(['NAV', 'DIV']);
		expect(header?.lastElementChild?.className).toBe('adm-pageheader__row');
	});
});

describe('the page header’s slots', () => {
	// the word beside the title and the action at the end of the row are two slots and neither is
	// called `action`, the name of the route export react router strips from the browser build.
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
