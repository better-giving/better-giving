import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, Link, useLoaderData } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import ProtectedLayout, { ErrorBoundary } from './_app';

// what the layout frames: the shell each viewer gets, the line over a move, the way out, and the
// state a failed screen is drawn as inside the frame. a screen's own heading and trail are the
// screen's (each route's `PageHeading`), so the layout draws neither.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
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

/** what the layout's loader answers, for the deployer or a member, with the rail as the cookie left it. */
const drawnFor = (deployer: boolean, railCollapsed = false, orgLogo: string | null = null) => ({
	orgName: 'Riverbank Trust',
	orgLogo,
	staff: { name: 'Nadia Hart', email: 'nadia@riverbanktrust.org' },
	deployer,
	viewerZone: null,
	railCollapsed
});

/** the layout as the app routes it, its loader answering `drawn`, over `children`. */
function layoutRoute(drawn: ReturnType<typeof drawnFor>, children: object[]) {
	return {
		id: 'routes/_app',
		loader: () => drawn,
		HydrateFallback: () => null,
		Component: () =>
			createElement(ProtectedLayout as never, {
				loaderData: useLoaderData(),
				params: {},
				matches: []
			}),
		ErrorBoundary,
		children
	};
}

/** the layout, set up and named, over a list screen and a screen under it. */
function frameAt(at: string, deployer = true): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		layoutRoute(drawnFor(deployer), [
			{ path: '/admin/forms', Component: () => <p>the list</p> },
			{ path: '/admin/members/password', Component: () => <h1>Your password</h1> },
			{ path: '/admin/donation-page', Component: () => <p>the Donation page</p> },
			{
				path: '/admin/forms/:id',
				loader: ({ params }: { params: { id?: string } }) => {
					if (params.id === 'gone') throw data('No form here.', { status: 404 });
					if (params.id === 'broken') throw new Error('the read did not land');
					if (params.id === 'refused') throw data('Not yours to open.', { status: 403 });
					return null;
				},
				Component: () => <p>the form</p>
			}
		]) as never
	]);
	return mount(<Stub initialEntries={[at]} />);
}

it('adds no heading and no trail of its own over a screen', async () => {
	const root = await frameAt('/admin/members/password');

	expect([...root.querySelectorAll('h1')].map((h1) => h1.textContent)).toEqual(['Your password']);
	expect(root.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
});

it('draws the screen inside the shell’s main region, under the organisation’s name', async () => {
	const root = await frameAt('/admin/donation-page');

	expect(root.querySelector('main')?.textContent).toBe('the Donation page');
	expect(root.querySelector('.ds-topbar-title')?.textContent).toBe('Riverbank Trust');
});

it('names who is signed in at the foot of the rail', async () => {
	const root = await frameAt('/admin/forms');

	expect(root.querySelector('.ds-shell-sidebar .ds-shell-account-name')?.textContent).toBe(
		'Nadia Hart'
	);
});

// the rail as the loader read it from the `bg_operator_rail` cookie, on the shell's first render.
it.each([
	['collapsed', true, ''],
	['open', false, null]
])('draws the rail %s on the first render as the loader read it', async (_, collapsed, marked) => {
	const Stub = createRoutesStub([
		layoutRoute(drawnFor(true, collapsed), [
			{ path: '/admin/forms', Component: () => <p>the list</p> }
		]) as never
	]);
	const root = await mount(<Stub initialEntries={['/admin/forms']} />);

	expect(root.querySelector('.ds-shell')?.getAttribute('data-collapsed')).toBe(marked);
});

// / is public, so the link to it is every operator's and not one of the deployer's
// destinations ($lib/admin/destinations.ts).
it.each([
	['the deployer', true],
	['a member', false]
])('gives %s the top bar link to the published donation page', async (_, deployer) => {
	const root = await frameAt('/admin/forms', deployer);
	const links = [...root.querySelectorAll('.ds-topbar-secondary a')];

	expect(links.map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
		['/', 'Open donation page']
	]);
});

// the rail's deployer rows: every page behind them answers a member with not-found, and
// ./_app.admin.integrations.api.db.spec.ts and ./_app.admin.integrations.zapier.db.spec.ts hold
// the loaders' half.

// the head of the rail opens the home page, for the logo and for the organisation's initials alike,
// as a document load: / is a donor's page and outside this shell ($lib/admin/destinations.ts).
it.each([
	['the logo', '/logo.png'],
	['the initials', null]
])('opens / from the rail head drawing %s, named for the home page', async (_, logo) => {
	const orgLogo = logo as string | null;
	const Stub = createRoutesStub([
		layoutRoute(drawnFor(true, false, orgLogo), [
			{ path: '/admin/forms', Component: () => <p>the list</p> }
		]) as never
	]);
	const root = await mount(<Stub initialEntries={['/admin/forms']} />);
	const links = ['.ds-shell-mark > a', '.ds-shell-mark-rail > a'].map((selector) =>
		root.querySelector(selector)
	);

	for (const link of links) {
		expect(link?.getAttribute('href')).toBe('/');
		expect(link?.getAttribute('aria-label')).toBe('Open home page');
	}
	expect(links[0]?.querySelector('.ds-avatar') !== null).toBe(orgLogo === null);
	// a document load, not the router's own move: a press here is the browser's to follow.
	expect(links[0]?.getAttribute('data-discover')).toBeNull();
});

it.each([
	['the deployer', true],
	['a member', false]
])(
	'draws Home page directly above Campaigns for %s, current on the editor',
	async (_, deployer) => {
		const atEditor = await frameAt('/admin/donation-page', deployer);
		const rows = [...atEditor.querySelectorAll('.ds-shell-sidebar .ds-nav-link')];
		const labels = rows.map((row) => row.textContent);
		const home = rows.find((row) => row.textContent === 'Home page');

		expect(labels.indexOf('Campaigns')).toBe(labels.indexOf('Home page') + 1);
		expect(home?.getAttribute('href')).toBe('/admin/donation-page');
		expect(home?.getAttribute('aria-current')).toBe('page');
		expect(home?.querySelector('svg')).not.toBeNull();

		const elsewhere = await frameAt('/admin/forms', deployer);
		const homeElsewhere = [...elsewhere.querySelectorAll('.ds-shell-sidebar .ds-nav-link')].find(
			(row) => row.textContent === 'Home page'
		);
		expect(homeElsewhere?.hasAttribute('aria-current')).toBe(false);
	}
);

/** the sidebar's group titles and top-level rows, in the order it draws them. */
function rail(root: HTMLElement): string[] {
	return [
		...root.querySelectorAll(
			'.ds-shell-sidebar .ds-nav-title, .ds-shell-sidebar a.ds-nav-link:not(.ds-nav-sublink):not(.ds-shell-rail-parent) .ds-nav-label'
		)
	].map((node) => node.textContent ?? '');
}

it('draws the deployer Settings and Payments beside Members, and the Integrations group, headed, before Books', async () => {
	const root = await frameAt('/admin/forms');
	const drawn = rail(root);

	expect(drawn.slice(drawn.indexOf('Members'))).toEqual([
		'Members',
		'Settings',
		'Payments',
		'Integrations',
		'Zapier',
		'API',
		'Webhooks',
		'AI',
		'Books'
	]);
	// the one row marked with a company's own image rather than a glyph.
	expect(
		root.querySelector('.ds-shell-sidebar a[href="/admin/integrations/zapier"] img')
	).not.toBeNull();
});

it('draws Settings’ three sections under it for the deployer', async () => {
	const root = await frameAt('/admin/forms');
	const sections = [...root.querySelectorAll('.ds-shell-sidebar .ds-nav-sub a.ds-nav-sublink')].map(
		(a) => [a.getAttribute('href'), a.textContent]
	);

	expect(sections).toEqual([
		['/admin/settings/organisation', 'Organisation details'],
		['/admin/settings/notifications', 'Notifications'],
		['/admin/settings/mail', 'Mail']
	]);
});

it('draws a member no Settings or Payments row and no Integrations group, and the rest of the rail as it is', async () => {
	const root = await frameAt('/admin/forms', false);
	const drawn = rail(root);

	expect(drawn).not.toContain('Settings');
	expect(drawn).not.toContain('Payments');
	expect(drawn).not.toContain('Integrations');
	expect(drawn).not.toContain('Zapier');
	expect(drawn.slice(drawn.indexOf('Members'))).toEqual(['Members', 'Books']);
	expect(root.querySelector('.ds-nav-sublink')).toBeNull();
});

// a screen that fails is drawn inside the frame, so the rail stays.

it('draws a record that is not there as the 404 inside the shell, with the way to the dashboard', async () => {
	const root = await frameAt('/admin/forms/gone');
	const state = root.querySelector('main .ds-page-state');

	expect(root.querySelector('.ds-shell-sidebar')).not.toBeNull();
	expect(state?.querySelector('.ds-page-state-code')?.textContent).toBe('404');
	expect(state?.querySelector('h1')?.textContent).toBe('No such page');
	expect(state?.textContent).toContain('It may have been deleted, or the address may be wrong.');
	const way = state?.querySelector('.ds-page-state-actions a');
	expect([way?.getAttribute('href'), way?.textContent]).toEqual(['/admin', 'Go to dashboard']);
});

it('draws a read that did not land as the 500 inside the shell, naming the log, with no retry', async () => {
	const root = await frameAt('/admin/forms/broken');
	const state = root.querySelector('main .ds-page-state-error');

	expect(root.querySelector('.ds-shell-sidebar')).not.toBeNull();
	expect(state?.querySelector('.ds-page-state-code')?.textContent).toBe('500');
	expect(state?.querySelector('h1')?.textContent).toBe('This deployment could not answer');
	expect(state?.querySelector('[role="alert"]')?.textContent).toContain(
		'Nothing more is known here. The app’s log has the cause:'
	);
	expect(state?.querySelector('code')?.textContent).toBe('docker compose logs app');
	expect(state?.querySelector('button, a')).toBeNull();
});

it('draws another refusal under its own status, with the answer’s sentence and no action', async () => {
	const root = await frameAt('/admin/forms/refused');
	const state = root.querySelector('main .ds-page-state-error');

	expect(state?.querySelector('.ds-page-state-code')?.textContent).toBe('403');
	expect(state?.querySelector('h1')?.textContent).toBe('This request was refused');
	expect(state?.querySelector('[role="alert"]')?.textContent).toContain('Not yours to open.');
	expect(state?.querySelector('button, a')).toBeNull();
});

// the line over a move, drawn by the layout while the router reads the next page. the stub's loaders
// never settle for `?wait`, so the navigation a press starts stays pending for the whole case.

/** the layout at the list, with a link on it to `to` whose reading never lands. */
function frameWithLinkTo(to: string): Promise<HTMLElement> {
	const waits = ({ request }: { request: Request }) =>
		new URL(request.url).searchParams.has('wait') ? new Promise<never>(() => {}) : null;
	const Stub = createRoutesStub([
		layoutRoute(drawnFor(true), [
			{ path: '/admin/forms', loader: waits, Component: () => <Link to={to}>go</Link> },
			{ path: '/admin/donors', loader: waits, Component: () => <p>donors</p> }
		]) as never
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

const line = (root: HTMLElement) => root.querySelector('.ds-route-progress');

it('draws no line at rest', async () => {
	const root = await frameWithLinkTo('/admin/donors?wait');

	expect(line(root)).toBeNull();
});

it('draws the line across the top bar while a move to another page is read', async () => {
	const root = await frameWithLinkTo('/admin/donors?wait');
	await follow(root, 'go');

	expect(line(root)?.closest('.ds-topbar')).not.toBeNull();
});

it('draws no line over a reading of the page already drawn', async () => {
	const root = await frameWithLinkTo('/admin/forms?wait');
	await follow(root, 'go');

	expect(line(root)).toBeNull();
});

// the way out, which is a form post to its own route (./_app.admin.sign-out.ts).

it('signs out through a post to the sign-out route', async () => {
	const posts: string[] = [];
	const Stub = createRoutesStub([
		layoutRoute(drawnFor(true), [
			{ path: '/admin/forms', Component: () => <p>the list</p> },
			{
				path: '/admin/sign-out',
				action: ({ request }: { request: Request }) => {
					posts.push(request.method);
					return null;
				}
			}
		]) as never
	]);
	const root = await mount(<Stub initialEntries={['/admin/forms']} />);
	const account = root.querySelector<HTMLButtonElement>('.ds-shell-sidebar .ds-shell-account-btn');
	// the keyboard's way through the menu, as packages/operator's Shell.dom.spec.tsx presses it:
	// open on the first row, to the last, which is Sign out, and choose it.
	act(() => account?.focus());
	for (const key of ['ArrowDown', 'End', 'Enter']) {
		await act(async () => {
			document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
		});
	}
	await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

	expect(posts).toEqual(['POST']);
});
