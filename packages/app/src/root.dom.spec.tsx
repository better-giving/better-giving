import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, Form, Outlet } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { ErrorBoundary } from './root';

// the faces of the app's one error page, chosen by what reached it: a missing address, a request
// the app refused, and everything else.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** a screen under the root, by the id react router gives its module and an address it answers. */
type Screen = { id: string; path: string; at: string };

const DASHBOARD: Screen = {
	id: 'routes/_app.admin.forms',
	path: '/admin/forms',
	at: '/admin/forms'
};
const DONOR_PAGE: Screen = { id: 'routes/$formId', path: '/:formId', at: '/f_0001' };

/**
 * the root's boundary over a screen whose read throws `thrown`, mounted into a document that lives
 * as long as the case.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
async function boundaryOver(thrown: unknown, screen: Screen = DASHBOARD): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{
			id: 'root',
			Component: Outlet,
			ErrorBoundary: ErrorBoundary as never,
			children: [
				{
					id: screen.id,
					path: screen.path,
					Component: () => <p>the screen</p>,
					loader: () => {
						throw thrown;
					}
				}
			]
		}
	]);
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	const tree: ReactNode = <Stub initialEntries={[screen.at]} />;
	// async, because the stub runs the loader before it renders the boundary.
	await act(async () => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

/**
 * the root's boundary over a screen whose action throws `thrown`, after its one button is pressed —
 * the path a refusal from the form layer takes ($lib/server/conform.ts throws from an action).
 */
async function boundaryOverAction(thrown: unknown): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{
			id: 'root',
			path: '/admin/forms',
			Component: () => (
				<Form method="post">
					<button type="submit">Save</button>
				</Form>
			),
			ErrorBoundary: ErrorBoundary as never,
			action: () => {
				throw thrown;
			}
		}
	]);
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	await act(async () => mounted.render(<Stub initialEntries={['/admin/forms']} />));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	await act(async () => root.querySelector('button')?.click());
	return root;
}

function code(root: HTMLElement): string | null | undefined {
	return root.querySelector('.adm-num')?.textContent;
}

it('draws a refused request with its own status and the reason it was refused', async () => {
	const root = await boundaryOver(data('`amount` is not a number.', { status: 400 }));

	expect(code(root)).toBe('400');
	expect(root.querySelector('h1')?.textContent).toBe('This request was refused');
	expect(root.textContent).toContain('amount is not a number.');
});

/** the deployment is answering, so a refusal has the same way out a missing address has. */
it('offers a refused request the way out to forms', async () => {
	const root = await boundaryOver(data('`amount` is not a number.', { status: 400 }));

	const ways = root.querySelectorAll('a, button');
	expect(ways).toHaveLength(1);
	expect(ways[0]?.textContent).toBe('Go to forms');
	expect(ways[0]?.getAttribute('href')).toBe('/admin/forms');
});

/** an action's thrown `Response` is read as text, which is how the form layer's sentence arrives. */
it('draws the sentence a refused submission was thrown with', async () => {
	const sentence = '`__form` names no form on this screen.';
	const root = await boundaryOverAction(new Response(sentence, { status: 400 }));

	expect(code(root)).toBe('400');
	expect(root.querySelector('h1')?.textContent).toBe('This request was refused');
	expect(root.textContent).toContain('__form names no form on this screen.');
	expect(root.querySelector('a')?.getAttribute('href')).toBe('/admin/forms');
});

it('draws a missing address as before, with its way out', async () => {
	const root = await boundaryOver(data(null, { status: 404 }));

	expect(code(root)).toBe('404');
	expect(root.querySelector('h1')?.textContent).toBe('No such page');
	expect(root.querySelector('a')?.getAttribute('href')).toBe('/admin/forms');
});

it('draws a thrown error that is no response as the deployment failing', async () => {
	const root = await boundaryOver(new Error('the database is not answering'));

	expect(code(root)).toBe('500');
	expect(root.querySelector('h1')?.textContent).toBe('This deployment could not answer');
	expect(root.textContent).not.toContain('the database is not answering');
	expect(root.querySelectorAll('a, button')).toHaveLength(0);
});

it('says nothing more is known when a refusal carries no sentence', async () => {
	const root = await boundaryOver(data({ field: 'amount' }, { status: 403 }));

	expect(code(root)).toBe('403');
	expect(root.querySelector('h1')?.textContent).toBe('This request was refused');
	expect(root.textContent).toContain(
		'Nothing more is known about why. Go back and try again, or go to forms.'
	);
	expect(root.querySelector('a')?.getAttribute('href')).toBe('/admin/forms');
});

/** the tab names the failure the panel draws, in the shape every other screen's tab title takes. */
it.each([
	['a missing address', data(null, { status: 404 }), 'No such page · Better Giving'],
	[
		'a refused request',
		data('`amount` is not a number.', { status: 400 }),
		'This request was refused · Better Giving'
	],
	[
		'a failure',
		new Error('the database is not answering'),
		'This deployment could not answer · Better Giving'
	]
])('titles the document after %s', async (_face, thrown, title) => {
	await boundaryOver(thrown);

	expect(document.title).toBe(title);
});

/** the donor's page is the organisation's, so its tab names what the reader came to do instead. */
it.each([
	['a missing address', data(null, { status: 404 }), 'No such page · Donate'],
	[
		'a refused request',
		data('`amount` is not a number.', { status: 400 }),
		'This request was refused · Donate'
	],
	[
		'a failure',
		new Error('the database is not answering'),
		'This donation page couldn’t load · Donate'
	]
])('titles the donor page after %s without the project name', async (_face, thrown, title) => {
	await boundaryOver(thrown, DONOR_PAGE);

	expect(document.title).toBe(title);
});

/** a donor holds no staff session, so a way out to the dashboard is a link they cannot use. */
it.each([
	['a missing address', data(null, { status: 404 })],
	['a refused request', data('`amount` is not a number.', { status: 400 })]
])('offers no way out to forms on the donor page after %s', async (_face, thrown) => {
	const root = await boundaryOver(thrown, DONOR_PAGE);

	expect(root.querySelector('a[href="/admin/forms"]')).toBeNull();
	expect(root.querySelectorAll('a, button')).toHaveLength(0);
});

/** the fallback sentence names no way out the donor page does not draw. */
it('tells a donor only to go back when a refusal carries no sentence', async () => {
	const root = await boundaryOver(data({ field: 'amount' }, { status: 403 }), DONOR_PAGE);

	expect(root.textContent).toContain('Nothing more is known about why. Go back and try again.');
	expect(root.textContent).not.toContain('go to forms');
});

/** a 5xx response is the deployment failing whatever it carries, and has no way out. */
it('draws a 5xx response as the deployment failing, with its sentence', async () => {
	const root = await boundaryOver(data('`BETTER_AUTH_URL` is not set.', { status: 503 }));

	expect(root.querySelector('h1')?.textContent).toBe('This deployment could not answer');
	expect(root.textContent).toContain('BETTER_AUTH_URL is not set.');
	expect(root.querySelectorAll('a, button')).toHaveLength(0);
});

/** a donor reads the page did not load and what to do, never the deployment's words or its logs. */
it('tells a donor the page could not load, with none of the sentence staff are told', async () => {
	const root = await boundaryOver(
		data('`BETTER_AUTH_URL` is not set.', { status: 503 }),
		DONOR_PAGE
	);

	expect(root.querySelector('h1')?.textContent).toBe('This donation page couldn’t load');
	expect(root.textContent).toContain('Please try again in a moment.');
	expect(root.textContent).not.toContain('BETTER_AUTH_URL');
	expect(root.textContent).not.toContain('deployment');
	expect(root.querySelectorAll('a, button')).toHaveLength(0);
});
