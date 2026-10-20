import { createElement, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { createRoutesStub } from 'react-router';
import { expect, it } from 'vitest';
import QuickbooksCallback from './quickbooks.callback';
import QuickbooksConnect from './quickbooks.connect';

// the pages the QuickBooks round trip ends on, drawn: the start's two refusals and every arm the
// callback answers with. the round trip begins on the dashboard's Books screen, so every one of
// them is a way back there and none names a console.

/** what one page draws, rendered as a document would serve it. */
function page<T>(Page: ComponentType<never>, loaderData: T): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/quickbooks/page',
			Component: () => createElement(Page, { loaderData, params: {}, matches: [] } as never)
		}
	]);
	const held = document.createElement('div');
	held.innerHTML = renderToString(createElement(Stub, { initialEntries: ['/quickbooks/page'] }));
	return held;
}

/** the way back to Books a page draws, by its words. */
function backToBooks(held: HTMLElement): HTMLAnchorElement | undefined {
	return [...held.querySelectorAll('a')].find((a) => a.textContent === 'Back to Books');
}

it.each([
	['connected', { outcome: 'connected', companyName: 'Riverbank Trust' }],
	['switched', { outcome: 'switched', previousCompanyName: 'Old Books', companyName: 'New Books' }],
	['refused: state', { outcome: 'refused', refusal: 'state' }],
	['refused: cancelled', { outcome: 'refused', refusal: 'cancelled' }],
	['refused: unavailable', { outcome: 'refused', refusal: 'unavailable' }],
	['refused: request', { outcome: 'refused', refusal: 'request' }],
	['refused: exchange', { outcome: 'refused', refusal: 'exchange' }]
])('ends the callback’s %s page with the way back to Books, and names no console', (_, data) => {
	const held = page(QuickbooksCallback as ComponentType<never>, data);

	expect(backToBooks(held)?.getAttribute('href')).toBe('/admin/books#quickbooks');
	expect(held.textContent).not.toContain('console');
});

it.each([['link'], ['setup']])(
	'ends the start’s %s refusal with the way back to Books, and names no console',
	(refusal) => {
		const held = page(QuickbooksConnect as ComponentType<never>, { refusal });

		expect(backToBooks(held)?.getAttribute('href')).toBe('/admin/books#quickbooks');
		expect(held.textContent).not.toContain('console');
	}
);

it('tells a deployment short of Intuit’s keys what whoever runs the server does', () => {
	const held = page(QuickbooksConnect as ComponentType<never>, { refusal: 'setup' });

	expect(held.textContent).toContain('For whoever runs the server');
	expect(held.textContent).toContain('docker compose up -d --force-recreate app');
});
