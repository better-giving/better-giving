import { opening } from '@better-giving/operator/progress-bar';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, Link } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import ProtectedLayout, { ErrorBoundary as AppErrorBoundary, clientMiddleware } from './_app';
import { handle as formHandle } from './_app.admin.forms.$id';

// what the layout frames: the panel's top strip over each screen, the rail each viewer gets, the
// bar over a move, and the words the frame says over one (the last, below).
//
// what the panel's top strip holds over each screen the layout frames.
//
// the strip is the layout's, and it is drawn only for a trail: the deepest matched route's `handle`
// ($lib/admin/crumbs.tsx). a screen standing under a section names the trail; every other screen is
// named by its tab title and the marked rail cell, and draws no strip. a destination's own page
// carries its name in a visually hidden `h1` instead.

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
function frameAt(at: string, deployer = true): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{
			id: 'app',
			Component: () =>
				createElement(ProtectedLayout as never, {
					loaderData: { orgName: 'Riverbank Trust', deployer },
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

it('names a screen that is its own page with a heading only a screen reader gets', async () => {
	const root = await frameAt('/admin/forms');
	const headings = [...root.querySelectorAll('h1')];

	expect(headings.map((h1) => h1.textContent)).toEqual(['Donation forms']);
	expect(headings[0]?.classList.contains('adm-vh')).toBe(true);
});

it('adds no heading over a screen that carries a trail', async () => {
	const root = await frameAt('/admin/forms/1');

	expect(root.querySelectorAll('h1')).toHaveLength(0);
});

it('draws no strip under no destination', async () => {
	const root = await frameAt('/admin/elsewhere');

	expect(strip(root)).toBeNull();
});

// the rail's Integrations group is the deployer's alone: every page in it answers a member with
// not-found, and ./_app.admin.integrations.api.workers.spec.ts and
// ./_app.admin.integrations.zapier.workers.spec.ts hold the loaders' half.

/** the column's headings and the destinations it offers, in the order it draws them. */
function rail(root: HTMLElement): string[] {
	return [...root.querySelectorAll('.adm-rail__heading, .adm-rail__cells a .adm-dest__full')].map(
		(node) => node.textContent ?? ''
	);
}

it('draws the deployer the Integrations group, headed, between Members and Books', async () => {
	const root = await frameAt('/admin/forms');
	const drawn = rail(root);

	expect(drawn.slice(drawn.indexOf('Members'))).toEqual([
		'Members',
		'Integrations',
		'Zapier',
		'API',
		'Webhooks',
		'Books'
	]);
	// the one cell marked with a company's own image rather than a glyph.
	expect(root.querySelector('a[href="/admin/integrations/zapier"] img')).not.toBeNull();
});

it('draws a member no Integrations group, and the rest of the rail as it is', async () => {
	const drawn = rail(await frameAt('/admin/forms', false));

	expect(drawn).not.toContain('Integrations');
	expect(drawn).not.toContain('Zapier');
	expect(drawn).not.toContain('API');
	expect(drawn.slice(drawn.indexOf('Members'))).toEqual(['Members', 'Books']);
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
					loaderData: { orgName: 'Riverbank Trust' },
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
					loaderData: { orgName: 'Riverbank Trust' },
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
					loaderData: { orgName: 'Riverbank Trust' },
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

// what the frame says out loud over a move to another screen.
//
// the words are `MoveStatus`'s (packages/operator/src/components/status/ProgressBar.jsx), whose own
// spec holds that one region keeps its node while its words change. what only this layout can get
// wrong is the mount: that the region stands before the move, that the line drawn over the move
// brings no second one, and that the label it reads is the one the pressed link carried. so the
// layout is mounted under a stub whose destination's reading has not landed, which is the move in
// flight rather than a stand-in for it.

/** the frame standing on the dashboard's first screen, with a link to a screen still being read. */
async function frameOverReading() {
	let land: (value: null) => void = () => {};
	const reading = new Promise<null>((resolve) => {
		land = resolve;
	});
	const Stub = createRoutesStub([
		{
			id: 'routes/_app',
			Component: () =>
				createElement(ProtectedLayout as never, {
					loaderData: { orgName: 'Riverbank Trust', deployer: true },
					params: {},
					matches: []
				}),
			children: [
				{
					path: '/admin',
					Component: () => (
						<Link to="/admin/donations" state={opening('Opening Donations')}>
							to donations
						</Link>
					)
				},
				{ path: '/admin/donations', loader: () => reading, Component: () => <p>arrived</p> }
			]
		}
	]);
	return { root: await mount(<Stub initialEntries={['/admin']} />), land: () => land(null) };
}

function regions(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('[role="status"]')];
}

it('says the opening label on one region over a move, and empties it when the move ends', async () => {
	const { root, land } = await frameOverReading();
	const [standing, ...others] = regions(root);
	expect(others).toHaveLength(0);
	expect(standing?.textContent).toBe('');

	await follow(root, 'to donations');

	// the line over the move is drawn, and it brings no region of its own.
	expect(bar(root)).not.toBe(null);
	expect(regions(root)).toEqual([standing]);
	expect(standing?.textContent).toBe('Opening Donations');

	await act(async () => {
		land();
	});

	expect(root.textContent).toContain('arrived');
	expect(bar(root)).toBe(null);
	expect(regions(root)).toEqual([standing]);
	expect(standing?.textContent).toBe('');
});

// the set-up gate is answered by the layout's middleware before any loader runs, so there is no
// loader data to draw a frame from: the layout's boundary draws the gate from the answer itself,
// and anything else thrown beneath the layout is drawn as the root's page.

/** the five as an unfinished deployment reads them, two still open. */
const OPEN_LINES = [
	{ id: 'password', label: 'Dashboard password', state: 'ready', word: 'Configured', note: null },
	{ id: 'organisation', label: 'Organisation', state: 'todo', word: 'Incomplete', note: null },
	{ id: 'payments', label: 'Payments', state: 'ready', word: 'Configured', note: null },
	{ id: 'smtp', label: 'Email delivery', state: 'ready', word: 'Configured', note: null },
	{ id: 'notifications', label: 'Notifications', state: 'todo', word: 'Incomplete', note: null }
];

/** the layout's boundary over a screen whose read throws `thrown`. */
function boundaryOver(thrown: unknown): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{
			id: 'app',
			Component: () => <p>the frame</p>,
			ErrorBoundary: AppErrorBoundary as never,
			loader: () => {
				throw thrown;
			},
			children: [{ path: '/admin/forms', Component: () => <p>the list</p> }]
		}
	]);
	return mount(<Stub initialEntries={['/admin/forms']} />);
}

it('draws the set-up gate in place of the frame when the layout answers with it', async () => {
	const root = await boundaryOver(data({ shape: 'setup', lines: OPEN_LINES }, { status: 503 }));

	expect(root.querySelector('h1')?.textContent).toBe('Finish setting up this deployment');
	expect(root.textContent).not.toContain('the frame');
});

it('titles the document after the set-up gate', async () => {
	await boundaryOver(data({ shape: 'setup', lines: OPEN_LINES }, { status: 503 }));

	expect(document.title).toBe('Finish setting up this deployment · Better Giving');
});

it('hands any other failure to the root page', async () => {
	const root = await boundaryOver(data('`BETTER_AUTH_URL` names no address.', { status: 500 }));

	expect(root.querySelector('h1')?.textContent).toBe('This deployment could not answer');
});
