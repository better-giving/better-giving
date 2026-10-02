import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, data } from 'react-router';
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

function code(root: HTMLElement): string | null | undefined {
	return root.querySelector('.adm-num')?.textContent;
}

it('draws a refused request with its own status and the reason it was refused', async () => {
	const root = await boundaryOver(data('`amount` is not a number.', { status: 400 }));

	expect(code(root)).toBe('400');
	expect(root.querySelector('h1')?.textContent).toBe('This request was refused');
	expect(root.textContent).toContain('amount is not a number.');
	expect(root.querySelectorAll('a, button')).toHaveLength(0);
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
	expect(root.textContent).toContain('Nothing more is known about why.');
});
