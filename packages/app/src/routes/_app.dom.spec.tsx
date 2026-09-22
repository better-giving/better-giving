import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, Link } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import ProtectedLayout, { clientMiddleware } from './_app';
import { handle as formHandle } from './_app.admin.forms.$id';

// what the panel's top strip holds over each screen the layout frames.
//
// the strip is the layout's, and it is drawn only for a trail: the deepest matched route's `handle`
// ($lib/admin/crumbs.tsx). a screen standing under a section names the trail; every other screen is
// named by its tab title and the marked rail cell, and draws no strip.

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
				{ path: '/admin/members/password', Component: () => <h1>Your password</h1> },
				{ path: '/admin/elsewhere', Component: () => <p>nowhere</p> }
			]
		}
	]);
	return mount(<Stub initialEntries={[at]} />);
}

function strip(root: HTMLElement): Element | null {
	return root.querySelector('.adm-headstrip');
}

it('draws no strip over a screen that is its own page', async () => {
	const root = await frameAt('/admin/forms');

	expect(strip(root)).toBeNull();
});

it('draws no strip over a screen under a section with no trail', async () => {
	const root = await frameAt('/admin/members/password');

	expect(strip(root)).toBeNull();
	expect([...root.querySelectorAll('h1')].map((h1) => h1.textContent)).toEqual(['Your password']);
});

it('carries the trail over a screen standing under a section', async () => {
	const root = await frameAt('/admin/forms/1');
	const items = [...(strip(root)?.querySelectorAll('nav[aria-label="Breadcrumb"] li') ?? [])];

	expect(items.map((li) => li.textContent)).toEqual(['Donation forms', 'Spring appeal']);
});

it('draws no strip under no destination', async () => {
	const root = await frameAt('/admin/elsewhere');

	expect(strip(root)).toBeNull();
});

// the bar over a move, drawn by the layout while the router reads the next page. the stub's loaders
// never settle for `?wait`, so the navigation a press starts stays pending for the whole case.

/** the layout at the list, with a link on it to `to` whose reading never lands. */
function frameWithLinkTo(to: string): Promise<HTMLElement> {
	const waits = ({ request }: { request: Request }) =>
		new URL(request.url).searchParams.has('wait') ? new Promise<never>(() => {}) : null;
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
				{
					path: '/admin/forms',
					loader: waits,
					Component: () => <Link to={to}>go</Link>
				},
				{ path: '/admin/donors', loader: waits, Component: () => <p>donors</p> }
			]
		}
	]);
	return mount(<Stub initialEntries={['/admin/forms']} />);
}

async function follow(root: HTMLElement, text: string): Promise<void> {
	const link = [...root.querySelectorAll('a')].find((a) => a.textContent === text);
	if (!link) throw new Error(`no link reading ${text}`);
	await act(async () => {
		link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
	});
}

const bar = (root: HTMLElement) => root.querySelector('.adm-navigation-bar');

it('draws no bar at rest', async () => {
	const root = await frameWithLinkTo('/admin/donors?wait');

	expect(bar(root)).toBeNull();
});

it('draws the bar while a move to another page is read', async () => {
	const root = await frameWithLinkTo('/admin/donors?wait');
	await follow(root, 'go');

	expect(bar(root)).not.toBeNull();
});

it('keeps the page being left until the bar has been seen full', async () => {
	// packages/operator/src/progress-bar.ts keeps the drawn page in module state across cases, so
	// this one moves to a pathname no other case draws.
	const Stub = createRoutesStub([
		{
			id: 'app',
			middleware: clientMiddleware as never,
			Component: () =>
				createElement(ProtectedLayout as never, {
					loaderData: { shape: 'ready', orgName: 'Riverbank Trust' },
					params: {},
					matches: []
				}),
			children: [
				{ path: '/admin/forms', Component: () => <Link to="/admin/recurring">go</Link> },
				{ path: '/admin/recurring', Component: () => <p>arrived</p> }
			]
		}
	]);
	const root = await mount(<Stub initialEntries={['/admin/forms']} />);
	await follow(root, 'go');

	expect(root.textContent).not.toContain('arrived');

	// the dwell's end is what ProgressBar.jsx reads as the bar having been seen full.
	const dwellEnded = Object.assign(new Event('animationend'), { animationName: 'adm-dwell' });
	await act(async () => {
		root.querySelector('.adm-navigation-bar__line')?.dispatchEvent(dwellEnded);
	});

	expect(root.textContent).toContain('arrived');
});

it('enters from a page outside the layout without holding for a bar nobody drew', async () => {
	// the sign-in screen's redirect into /admin is this move: no layout is on the screen, so no bar
	// is either, and a hold would wait out the bar's whole cap before the dashboard appeared.
	const Stub = createRoutesStub([
		{ path: '/login', Component: () => <Link to="/admin/donors">in</Link> },
		{
			id: 'app',
			middleware: clientMiddleware as never,
			Component: () =>
				createElement(ProtectedLayout as never, {
					loaderData: { shape: 'ready', orgName: 'Riverbank Trust' },
					params: {},
					matches: []
				}),
			children: [{ path: '/admin/donors', Component: () => <p>donors</p> }]
		}
	]);
	const root = await mount(<Stub initialEntries={['/login']} />);
	await follow(root, 'in');

	expect(root.textContent).toContain('donors');
});

it('draws no bar over a reading of the page already drawn', async () => {
	const root = await frameWithLinkTo('/admin/forms?wait');
	await follow(root, 'go');

	expect(bar(root)).toBeNull();
});
