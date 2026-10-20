import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import Dashboard from './_app.admin._index';

// the one line the dashboard says about a deployment with no donation form, and where it leads.
// whether there is one is the loader's (./_app.admin._index.db.spec.ts); this is what is drawn.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
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

/** the dashboard over a deployment that has taken nothing, holding a form or not. */
function dashboard(hasForms: boolean): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin',
			Component: () =>
				createElement(Dashboard as never, {
					loaderData: {
						month: 'October',
						raisedMonth: '$0.00',
						raisedAll: '$0.00',
						giftsMonth: 0,
						recurringActive: 0,
						series: { points: [], first: 'Nov 2025', last: 'Oct 2026' },
						donors: { total: 0, thisMonth: 0 },
						hasForms
					},
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin'] }));
}

/** the anchor that leads to the new-form screen, or `null` where none is drawn. */
const toNewForm = (root: HTMLElement) => root.querySelector('a[href="/admin/forms/new"]');

it('says there is no donation form yet and leads to making one', () => {
	const root = dashboard(false);
	const link = toNewForm(root);

	expect(link?.textContent).toBe('Create a donation form');
	expect(link?.parentElement?.textContent).toBe('No donation forms yet. Create a donation form');
});

it('says nothing about forms once the deployment holds one', () => {
	const root = dashboard(true);

	expect(toNewForm(root)).toBe(null);
	expect(root.textContent).not.toContain('No donation forms yet.');
});
