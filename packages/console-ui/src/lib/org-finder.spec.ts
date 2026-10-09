import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NonprofitMatch } from '../api/types';
import { NO_MATCHES, NOT_DEDUCTIBLE_BADGE, OrgFinderCard, SEARCH_UNANSWERED } from './org-finder';
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

const showing = (matches: readonly NonprofitMatch[]): FinderView => ({
	out: false,
	found: { kind: 'matches', matches }
});

/** the card's markup, with the apostrophes react escapes put back so the copy reads as written. */
const drawn = (view: FinderView, closed = false): string =>
	renderToStaticMarkup(
		createElement(OrgFinderCard, {
			view,
			closed,
			typed: '',
			onType: () => {},
			onPress: () => {},
			onPick: () => {}
		})
	).replaceAll('&#x27;', "'");

/** the Search press, as drawn. */
const searchPress = (markup: string): string =>
	markup.match(/<button[^>]*>(?:(?!<\/button>).)*Search(?:(?!<\/button>).)*<\/button>/s)?.[0] ??
	'<no press>';

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
		expect(markup).toContain('role="combobox"');
		expect(searchPress(markup)).toContain('type="submit"');
	});

	it('says nothing and lists nothing before a press', () => {
		const markup = drawn(IDLE_VIEW);

		expect(said(markup)).toBe('');
		expect(markup).not.toContain('role="option"');
	});

	it('draws no prose beside the label, the press and the region', () => {
		const text = drawn(IDLE_VIEW)
			.replace(/<[^>]*>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		expect(text).toBe('Name or EIN Search');
	});

	it('reads busy while a press is out, keeps the box open, and holds the press', () => {
		const markup = drawn({ out: true, found: { kind: 'idle' } });
		const press = searchPress(markup);

		expect(press).toContain('aria-busy="true"');
		expect(press).toContain('aria-disabled="true"');
		expect(press).not.toMatch(/\bdisabled=""/);
		expect(markup).not.toMatch(/<input[^>]*role="combobox"[^>]*disabled/);
	});

	it('is not busy before a press, and holds the press while the page writes', () => {
		expect(searchPress(drawn(IDLE_VIEW))).not.toContain('aria-busy');
		expect(searchPress(drawn(IDLE_VIEW))).not.toContain('aria-disabled');
		expect(searchPress(drawn(IDLE_VIEW, true))).toContain('aria-disabled="true"');
		expect(searchPress(drawn(IDLE_VIEW, true))).not.toContain('aria-busy');
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

	it('holds no more characters in its box than the binary takes in a query', () => {
		expect(drawn(IDLE_VIEW)).toMatch(/<input[^>]*role="combobox"[^>]*maxLength="200"/);
	});

	it('badges a match not listed as tax-deductible', () => {
		const row = option(drawn(showing(MATCHES)), 'Riverside Food Network');

		expect(row).toContain(NOT_DEDUCTIBLE_BADGE);
		expect(row).toContain('adm-state--attention');
	});

	it('badges no revocation, which a search does not carry', () => {
		const markup = drawn(showing([match({ revokedOn: '2023-05-15' })]));

		expect(option(markup, 'Riverside Community Food Bank')).not.toContain('adm-state');
		expect(markup).not.toContain('revoked');
	});

	it('says when nothing matched', () => {
		expect(said(drawn({ out: false, found: { kind: 'none' } }))).toBe(NO_MATCHES);
	});

	it('says the list could not be searched', () => {
		expect(said(drawn({ out: false, found: { kind: 'unavailable' } }))).toBe(SEARCH_UNANSWERED);
		expect(SEARCH_UNANSWERED).toBe("Couldn't search the IRS list. Search by EIN instead.");
	});
});
