import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NonprofitMatch } from '../api/types';
import {
	BY_HAND,
	FindOrgCard,
	NOT_DEDUCTIBLE_BADGE,
	NOT_NOW,
	NO_MATCHES,
	REVOKED_BADGE,
	SEARCH_UNANSWERED
} from './find-org-dialog';
import type { SearchState } from './org-search';

// the find dialog as drawn in each state a search can be in. ../../vite.config.ts pins `node` and
// there is no dom, so the card is read as markup; when a search is sent is ./org-search.spec.ts's,
// and what a pick fills is ./ein-lookup.spec.ts's.

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
	}),
	match({
		ein: '951112223',
		name: 'Friends of Riverside Food Bank',
		deductible: false,
		revokedOn: '2023-05-15'
	})
];

/** the card's markup, with the apostrophes react escapes put back so the copy reads as written. */
const drawn = (state: SearchState): string =>
	renderToStaticMarkup(
		createElement(FindOrgCard, { state, onQuery: () => {}, onPick: () => {}, onClose: () => {} })
	).replaceAll('&#x27;', "'");

/** the by-hand way out, as drawn. */
const byHandPress = (markup: string): string | undefined =>
	markup.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${BY_HAND}`, 's'))?.[0];

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

describe('the find dialog', () => {
	it('is a dialog named for what it asks, with one box labelled for what it takes', () => {
		const markup = drawn({ kind: 'idle' });

		expect(markup).toContain('Find your organisation</h2>');
		expect(markup).toMatch(/<label[^>]*>Name or EIN<\/label>/);
		expect(markup).toContain('role="combobox"');
	});

	it('offers both ways out to the plain form', () => {
		const markup = drawn({ kind: 'idle' });

		expect(markup).toContain(BY_HAND);
		expect(markup).toContain(NOT_NOW);
	});

	it('says nothing and lists nothing before three characters are typed', () => {
		const markup = drawn({ kind: 'idle' });

		expect(said(markup)).toBe('');
		expect(markup).not.toContain('role="option"');
	});

	it('says it is searching while it is', () => {
		expect(said(drawn({ kind: 'searching' }))).toBe('Searching…');
	});

	it('lists each match with its city and state under its name and its EIN in a column of its own', () => {
		const row = option(
			drawn({ kind: 'matches', matches: MATCHES }),
			'Riverside Community Food Bank'
		);

		expect(row).toContain('<span class="adm-findrow__place">Riverside, CA</span>');
		expect(row).toMatch(
			/<span class="adm-findrow__ein"><span class="adm-findrow__einlabel">EIN<\/span><span class="adm-num">12-3456789<\/span><\/span>/
		);
		expect(row).not.toContain('adm-state');
	});

	it('says how many matches arrived, so a reader knows the list changed', () => {
		expect(said(drawn({ kind: 'matches', matches: MATCHES }))).toBe('3 matches.');
		expect(said(drawn({ kind: 'matches', matches: [match({})] }))).toBe('1 match.');
	});

	it('holds no more characters in its box than the binary takes in a query', () => {
		expect(drawn({ kind: 'idle' })).toMatch(/<input[^>]*role="combobox"[^>]*maxLength="200"/);
	});

	it('badges a match not listed as tax-deductible', () => {
		const row = option(drawn({ kind: 'matches', matches: MATCHES }), 'Riverside Food Network');

		expect(row).toContain(NOT_DEDUCTIBLE_BADGE);
		expect(row).toContain('adm-state--attention');
	});

	it('badges a revoked match as revoked and nothing else', () => {
		const row = option(drawn({ kind: 'matches', matches: MATCHES }), 'Friends of Riverside');

		expect(row).toContain(REVOKED_BADGE);
		expect(row).not.toContain(NOT_DEDUCTIBLE_BADGE);
	});

	it('says when nothing matched', () => {
		const markup = drawn({ kind: 'none' });

		expect(said(markup)).toBe(NO_MATCHES);
		expect(NO_MATCHES).toBe('No matches.');
	});

	it('says the list could not be searched, and makes the by-hand way the next press', () => {
		const markup = drawn({ kind: 'unavailable' });
		const byHand = byHandPress(markup);

		expect(said(markup)).toBe(SEARCH_UNANSWERED);
		expect(SEARCH_UNANSWERED).toBe("Couldn't search the IRS list. Type the details yourself.");
		expect(byHand).toContain('adm-btn--primary');
	});

	it('draws the by-hand way quietly while there is something to pick', () => {
		const markup = drawn({ kind: 'matches', matches: MATCHES });
		const byHand = byHandPress(markup);

		expect(byHand).toContain('adm-btn--quiet');
	});
});
