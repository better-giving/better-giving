import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import Webhooks from './_app.admin.integrations.webhooks._index';

// what the Webhooks list draws from its loader's answer: each destination by address as a link to
// its page, a paused one said to be, the empty list, and the way to add one. the server half is
// ./_app.admin.integrations.webhooks._index.workers.spec.ts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function screen(loaderData: object): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/integrations/webhooks',
			Component: () => createElement(Webhooks as never, { loaderData, params: {}, matches: [] })
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/integrations/webhooks'] }));
}

const rows = (root: HTMLElement) =>
	[...root.querySelectorAll('tbody tr')].map((row) =>
		[...row.children].map((cell) => cell.textContent)
	);

it('lists each destination by its address, linked to its page, with its events and whether it is paused', () => {
	const root = screen({
		destinations: [
			{
				id: 'd1',
				url: 'https://hooks.riverbanktrust.org/giving',
				events: '5 events',
				paused: false
			},
			{ id: 'd2', url: 'https://crm.example.net/hooks', events: 'All events', paused: true }
		],
		deleted: null
	});

	expect(rows(root)).toEqual([
		['https://hooks.riverbanktrust.org/giving', '5 events', ''],
		['https://crm.example.net/hooks', 'All events', 'Paused'],
		['Add destination']
	]);
	const link = root.querySelector<HTMLAnchorElement>(
		'tbody a[href="/admin/integrations/webhooks/d2"]'
	);
	expect(link?.textContent).toBe('https://crm.example.net/hooks');
	expect(root.textContent).toContain('2 destinations.');
});

it('says there are none yet, and still offers to add one', () => {
	const root = screen({ destinations: [], deleted: null });

	expect(rows(root)).toEqual([['No destinations yet'], ['Add destination']]);
	expect(root.querySelector('a[href="/admin/integrations/webhooks/new"]')?.textContent).toBe(
		'Add destination'
	);
});

it('says which destination a delete took, in the status line', () => {
	const root = screen({ destinations: [], deleted: 'https://crm.example.net/hooks' });

	expect(root.querySelector('[role="status"]')?.textContent).toBe(
		'Deleted https://crm.example.net/hooks.'
	);
});
