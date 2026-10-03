import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cloudflareAccount } from './cloudflare-account';

// the account as the rail's foot and the band draw it, as markup. this package pins one node pool
// and no dom (../../vite.config.ts), so a face is held as what it draws.

/** `node` drawn, with react's marks between adjacent text nodes taken out: the reader sees one run of words. */
const drawn = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
	renderToStaticMarkup(node).replaceAll('<!-- -->', '');

const faces = () =>
	cloudflareAccount({
		name: 'Riverside Shelter’s Account',
		closeControl: createElement('button', { type: 'button' }, 'Close console')
	});

/** every open tag in `page` that a reader could press or tab to. */
const controls = (page: string): string[] =>
	page.match(/<(?:a|button)\b[^>]*>|<[^>]*\b(?:href|tabindex)=[^>]*>/g) ?? [];

describe('the account row', () => {
	it('draws the logo, labelled whose account it is, and the account’s name', () => {
		const page = drawn(faces().row);
		expect(page).toMatch(
			/<span class="adm-brand adm-brand--cloudflare[^"]*" role="img" aria-label="Cloudflare account"><\/span><\/span> <span class="adm-footaccount__name">Riverside Shelter’s Account<\/span>/
		);
		expect(page).not.toContain('title=');
	});

	it('opens nothing, and its one press is the close it was handed', () => {
		const page = drawn(faces().row);
		expect(controls(page)).toEqual(['<button type="button">']);
		expect(page).toContain('<button type="button">Close console</button>');
	});
});

describe('the account in the band', () => {
	it('is the logo alone, named by the account, and opens nothing', () => {
		const page = drawn(faces().band);
		expect(page).toContain('aria-label="Cloudflare account Riverside Shelter’s Account"');
		expect(page).toContain('adm-brand--cloudflare');
		expect(controls(page)).toEqual([]);
		expect(page).not.toContain('title=');
	});
});
