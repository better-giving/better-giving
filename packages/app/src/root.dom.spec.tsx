import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data, Form } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { ErrorBoundary } from './root';

// the faces of the app's one error page, chosen by what reached it: a missing address, a request
// the app refused, and everything else.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * the root's boundary over a screen whose read throws `thrown`, mounted into a document that lives
 * as long as the case.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
async function boundaryOver(thrown: unknown): Promise<HTMLElement> {
	const Stub = createRoutesStub([
		{
			id: 'root',
			path: '/admin/forms',
			Component: () => <p>the screen</p>,
			ErrorBoundary: ErrorBoundary as never,
			loader: () => {
				throw thrown;
			}
		}
	]);
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	const tree: ReactNode = <Stub initialEntries={['/admin/forms']} />;
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

/** a 5xx response is the deployment failing whatever it carries, and has no way out. */
it('draws a 5xx response as the deployment failing, with its sentence', async () => {
	const root = await boundaryOver(data('`BETTER_AUTH_URL` is not set.', { status: 503 }));

	expect(root.querySelector('h1')?.textContent).toBe('This deployment could not answer');
	expect(root.textContent).toContain('BETTER_AUTH_URL is not set.');
	expect(root.querySelectorAll('a, button')).toHaveLength(0);
});
