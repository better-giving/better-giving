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

/** the page as the server drew it; the account stated as on the Paid plan unless `loaderData` says. */
function screen(loaderData: object): HTMLElement {
	const drawn = { freePlanPace: null, ...loaderData };
	const Stub = createRoutesStub([
		{
			path: '/admin/integrations/webhooks',
			Component: () =>
				createElement(Webhooks as never, { loaderData: drawn, params: {}, matches: [] })
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

	// the add link is under the rows and not one of them, so the rows are the two destinations the
	// caption counts.
	expect(rows(root)).toEqual([
		['https://hooks.riverbanktrust.org/giving', '5 events', ''],
		['https://crm.example.net/hooks', 'All events', 'Paused']
	]);
	expect(root.querySelector('a[href="/admin/integrations/webhooks/new"]')?.textContent).toBe(
		'Add destination'
	);
	const link = root.querySelector<HTMLAnchorElement>(
		'tbody a[href="/admin/integrations/webhooks/d2"]'
	);
	expect(link?.textContent).toBe('https://crm.example.net/hooks');
	expect(root.textContent).toContain('2 destinations.');
});

it('says there are none yet, and still offers to add one', () => {
	const root = screen({ destinations: [], deleted: null });

	expect(rows(root)).toEqual([['No destinations yet']]);
	expect(root.querySelector('a[href="/admin/integrations/webhooks/new"]')?.textContent).toBe(
		'Add destination'
	);
});

it('says which destination a delete took, in the status line, once the line is drawn', async () => {
	const root = screen({ destinations: [], deleted: 'https://crm.example.net/hooks' });
	const said = root.querySelector('[role="status"]');

	expect(said?.textContent).toBe('');
	await act(
		() => new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn)))
	);

	expect(said?.textContent).toBe('Deleted https://crm.example.net/hooks.');
});

it('says the pace deliveries go out at on the Free plan, and nothing of it once Paid is stated', () => {
	const free = screen({ destinations: [], deleted: null, freePlanPace: 4 });
	expect(free.textContent).toContain(
		'On the Cloudflare Free plan, webhook deliveries go out 4 a minute, so a busy day can take hours to reach every destination. If this account is on the Workers Paid plan, say so on the console’s Cloudflare plan page.'
	);
	act(() => free.remove());

	const paid = screen({ destinations: [], deleted: null });
	expect(paid.textContent).not.toContain('Free plan');
});
