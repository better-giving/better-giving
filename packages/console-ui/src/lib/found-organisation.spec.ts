import { afterEach, describe, expect, it } from 'vitest';
import { foundSite, rememberWebsite } from './found-organisation';

afterEach(() => {
	rememberWebsite('');
});

describe('the website a found organisation lists', () => {
	it('is remembered as the host a site row takes', () => {
		rememberWebsite('https://www.riversidefood.org/about');

		expect(foundSite()).toBe('www.riversidefood.org');
	});

	it('is read the same way when the list wrote it with no scheme', () => {
		rememberWebsite('riversidefood.org');

		expect(foundSite()).toBe('riversidefood.org');
	});

	it('is forgotten by an organisation found with none', () => {
		rememberWebsite('riversidefood.org');
		rememberWebsite('');

		expect(foundSite()).toBe('');
	});

	it.each(['N/A', 'NONE', 'none', 'localhost', 'http://', 'not a website'])(
		'is not remembered where the filing wrote %j, which names no site',
		(written) => {
			rememberWebsite('riversidefood.org');
			rememberWebsite(written);

			expect(foundSite()).toBe('');
		}
	);

	it('is nothing until an organisation is found', () => {
		expect(foundSite()).toBe('');
	});
});
