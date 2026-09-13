import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import ProtectedLayout from './_app';
import { handle as formHandle } from './_app.admin.forms.$id';

// what the panel's top strip holds over each screen the layout frames.
//
// the strip is the layout's, and what it carries is read off two places at once: the address, for
// the destination the reader is in, and the deepest matched route's `handle`, for a trail
// ($lib/admin/crumbs.tsx). a screen standing under a section names the trail; a screen that is its
// destination's own page names the destination. either reading alone passes on half of the screens.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
async function mount(tree: ReactNode): Promise<HTMLElement> {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	// async, because the stub runs the loaders before it renders the screen.
	await act(async () => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

/** the layout, set up and named, over a list screen and a detail screen beneath it. */
function frameAt(at: string): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{
			id: 'app',
			Component: () =>
				createElement(ProtectedLayout as never, {
					loaderData: { shape: 'ready', orgName: 'Riverbank Trust' },
					params: {},
					matches: []
				}),
			children: [
				{ path: '/admin/forms', Component: () => <p>the list</p> },
				{
					path: '/admin/forms/:id',
					handle: formHandle,
					loader: () => ({ name: 'Spring appeal' }),
					Component: () => <p>the form</p>
				},
				{ path: '/admin/elsewhere', Component: () => <p>nowhere</p> }
			]
		}
	]);
	return mount(<Stub initialEntries={[at]} />);
}

function strip(root: HTMLElement): Element | null {
	return root.querySelector('.adm-headstrip');
}

it('names the destination over a screen that is its own page', async () => {
	const root = await frameAt('/admin/forms');

	expect(strip(root)?.querySelector('.adm-headstrip__title')?.textContent).toBe('Donation forms');
	expect(strip(root)?.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
});

it('carries the trail over a screen standing under a section', async () => {
	const root = await frameAt('/admin/forms/1');
	const items = [...(strip(root)?.querySelectorAll('nav[aria-label="Breadcrumb"] li') ?? [])];

	expect(items.map((li) => li.textContent)).toEqual(['Donation forms', 'Spring appeal']);
	expect(strip(root)?.querySelector('.adm-headstrip__title')).toBeNull();
});

it('draws no strip under no destination', async () => {
	const root = await frameAt('/admin/elsewhere');

	expect(strip(root)).toBeNull();
});
