import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { rememberWebsite } from './found-organisation';
import { SitesFold } from './sites-fold';

// the website a found organisation lists, offered as the first site. ../../vite.config.ts pins
// `node` and there is no dom, so the offer is read as the press it is drawn as: conform's own insert
// of a row holding the host, which nothing sends anywhere until Save.

afterEach(() => {
	rememberWebsite('');
});

function drawn(sites: readonly string[]): string {
	const router = createMemoryRouter([
		{
			path: '/',
			Component: () =>
				createElement(SitesFold, {
					sites,
					donatePage: 'https://give.example.org/donate',
					list: null,
					busy: false,
					pending: null
				})
		}
	]);
	return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

const offer = (markup: string): string | undefined =>
	markup.match(/<button[^>]*>(?:(?!<\/button>).)*Add riversidefood\.org/s)?.[0];

describe('the website a found organisation lists', () => {
	it('is offered as the first site while the list is empty', () => {
		rememberWebsite('https://riversidefood.org');
		const press = offer(drawn([]));

		expect(press).toBeDefined();
	});

	it('is offered as a row added holding its host, which only Save stores', () => {
		rememberWebsite('https://riversidefood.org');
		const press = offer(drawn([])) ?? '';
		const intent = press.match(/value="([^"]*)"/)?.[1]?.replaceAll('&quot;', '"') ?? '';

		expect(JSON.parse(intent)).toEqual({
			type: 'insert',
			payload: { name: 'site', defaultValue: 'riversidefood.org' }
		});
		expect(press).toContain('formNoValidate');
	});

	it('is not offered once the deployment holds a site', () => {
		rememberWebsite('https://riversidefood.org');

		expect(offer(drawn(['https://example.org']))).toBeUndefined();
	});

	it('is not offered where no organisation with a website was found', () => {
		expect(drawn([])).not.toContain('Add riversidefood.org');
	});
});
