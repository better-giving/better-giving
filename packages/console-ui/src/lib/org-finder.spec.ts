import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NonprofitMatch } from '../api/types';
import {
	EIN_ONLY,
	LOOKING_UP,
	NO_MATCHES,
	NOT_DEDUCTIBLE_BADGE,
	OrgFinderCard,
	type OrgFinderCardProps,
	SEARCH_UNANSWERED,
	SEARCHING,
	TOO_SHORT
} from './org-finder';
import { type FinderView, IDLE_VIEW } from './org-search';

// the finder as drawn in each view a press can leave it in. ../../vite.config.ts pins `node` and
// there is no dom, so the card is read as markup; what a press asks is ./org-search.spec.ts's, and
// what a number locked in fills is ./ein-lookup.spec.ts's.

const match = (over: Partial<NonprofitMatch>): NonprofitMatch => ({
	ein: '123456789',
	name: 'Riverside Community Food Bank',
	city: 'Riverside',
	state: 'CA',
	deductible: true,
	revokedOn: '',
	...over
});

const MATCHES = [
	match({}),
	match({
		ein: '317654321',
		name: 'Riverside Food Network',
		city: 'Dayton',
		state: 'OH',
		deductible: false
	})
];

const showing = (
	matches: readonly NonprofitMatch[],
	out: FinderView['out'] = null
): FinderView => ({ out, found: { kind: 'matches', matches }, refused: null });

/** the card's markup, with the apostrophes react escapes put back so the copy reads as written. */
const drawn = (view: FinderView, over: Partial<OrgFinderCardProps> = {}): string =>
	renderToStaticMarkup(
		createElement(OrgFinderCard, {
			view,
			lookups: true,
			listed: true,
			closed: false,
			typed: '',
			onType: () => {},
			onPress: () => {},
			onPick: () => {},
			...over
		})
	).replaceAll('&#x27;', "'");

/** the Search press, as drawn. */
const searchPress = (markup: string): string =>
	markup.match(/<button[^>]*>(?:(?!<\/button>).)*Search(?:(?!<\/button>).)*<\/button>/s)?.[0] ??
	'<no press>';

/** the box, as drawn: its own tag, whatever order its attributes come in. */
const box = (markup: string): string =>
	markup.match(/<input[^>]*role="combobox"[^>]*>/)?.[0] ?? '<no box>';

/** the opening tag of each option, which is where the machine writes its state. */
const options = (markup: string): string[] => markup.match(/<div[^>]*role="option"[^>]*>/g) ?? [];

/** the opening tag of the list. */
const listbox = (markup: string): string =>
	markup.match(/<div[^>]*role="listbox"[^>]*>/)?.[0] ?? '<no list>';

/** the markup of the one option naming `name`. */
const option = (markup: string, name: string): string => {
	const found = markup
		.split('role="option"')
		.slice(1)
		.find((part) => part.includes(name));
	expect(found).toBeDefined();
	return found as string;
};

/** the words the region under the box says. */
const said = (markup: string): string | undefined =>
	markup.match(/<p class="adm-hint adm-findorg__said" role="status">([^<]*)<\/p>/)?.[1];

describe('the finder', () => {
	it('is a search with one box labelled for what it takes, and a press that submits it', () => {
		const markup = drawn(IDLE_VIEW);

		expect(markup).toMatch(/^<search[^>]*><form/);
		expect(markup).toMatch(/<label[^>]*>Name or EIN<\/label>/);
		expect(box(markup)).not.toBe('<no box>');
		expect(searchPress(markup)).toContain('type="submit"');
	});

	it('labels the box for an EIN alone on a console that cannot ask the list', () => {
		expect(drawn(IDLE_VIEW, { lookups: false })).toMatch(/<label[^>]*>EIN<\/label>/);
	});

	it('says nothing and lists nothing before a press', () => {
		const markup = drawn(IDLE_VIEW);

		expect(said(markup)).toBe('');
		expect(options(markup)).toEqual([]);
	});

	it('draws no prose beside the label, the press and the region', () => {
		const text = drawn(IDLE_VIEW)
			.replace(/<[^>]*>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		expect(text).toBe('Name or EIN Search');
	});

	it('says it is searching while a search is out, reads busy and holds the press, and keeps the box open', () => {
		const markup = drawn({ out: 'search', found: { kind: 'idle' }, refused: null });
		const press = searchPress(markup);

		expect(said(markup)).toBe(SEARCHING);
		expect(press).toContain('aria-busy="true"');
		expect(press).toContain('aria-disabled="true"');
		expect(press).not.toMatch(/\sdisabled=""/);
		expect(box(markup)).not.toMatch(/\sdisabled=""/);
	});

	it('says it is looking up while a lookup is out, with the list it was picked from closed', () => {
		const markup = drawn(showing(MATCHES, 'lookup'));

		expect(said(markup)).toBe(LOOKING_UP);
		expect(options(markup)).toHaveLength(2);
		for (const tag of options(markup)) expect(tag).toContain('aria-disabled="true"');
	});

	it('leaves the options open to a pick while nothing is out', () => {
		for (const tag of options(drawn(showing(MATCHES)))) expect(tag).not.toContain('aria-disabled');
	});

	it('is not busy before a press, and holds the press and the options while the page writes', () => {
		const writing = drawn(showing(MATCHES), { closed: true });

		expect(searchPress(drawn(IDLE_VIEW))).not.toContain('aria-busy');
		expect(searchPress(drawn(IDLE_VIEW))).not.toContain('aria-disabled');
		expect(searchPress(writing)).toContain('aria-disabled="true"');
		expect(searchPress(writing)).not.toContain('aria-busy');
		for (const tag of options(writing)) expect(tag).toContain('aria-disabled="true"');
	});

	it('says why a press asked nothing', () => {
		expect(said(drawn({ ...IDLE_VIEW, refused: 'short' }))).toBe(TOO_SHORT);
		expect(said(drawn({ ...IDLE_VIEW, refused: 'not-ein' }))).toBe(EIN_ONLY);
	});

	it('lists each match with its city and state under its name and its EIN in a column of its own', () => {
		const row = option(drawn(showing(MATCHES)), 'Riverside Community Food Bank');

		expect(row).toContain('<span class="adm-findrow__place">Riverside, CA</span>');
		expect(row).toMatch(
			/<span class="adm-findrow__ein"><span class="adm-findrow__einlabel">EIN<\/span><span class="adm-num">12-3456789<\/span><\/span>/
		);
		expect(row).not.toContain('adm-state');
	});

	it('says how many matches arrived, so a reader knows the list changed', () => {
		expect(said(drawn(showing(MATCHES)))).toBe('2 matches.');
		expect(said(drawn(showing([match({})])))).toBe('1 match.');
	});

	it('counts the matches without opening the list where focus has left the finder', () => {
		const away = drawn(showing(MATCHES), { listed: false });

		expect(said(away)).toBe('2 matches.');
		expect(listbox(away)).toMatch(/\shidden=""/);
		expect(listbox(drawn(showing(MATCHES)))).not.toMatch(/\shidden=""/);
	});

	it('holds no more characters in its box than the binary takes in a query', () => {
		expect(box(drawn(IDLE_VIEW))).toContain('maxLength="200"');
	});

	it('badges a match not listed as tax-deductible', () => {
		const row = option(drawn(showing(MATCHES)), 'Riverside Food Network');

		expect(row).toContain(NOT_DEDUCTIBLE_BADGE);
		expect(row).toContain('adm-state--attention');
	});

	it('says when nothing matched', () => {
		expect(said(drawn({ ...IDLE_VIEW, found: { kind: 'none' } }))).toBe(NO_MATCHES);
	});

	it('says the list could not be searched', () => {
		expect(said(drawn({ ...IDLE_VIEW, found: { kind: 'unavailable' } }))).toBe(SEARCH_UNANSWERED);
	});
});
