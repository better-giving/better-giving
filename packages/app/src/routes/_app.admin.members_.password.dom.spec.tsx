import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import YourPassword from './_app.admin.members_.password';

// what the Change password press says about itself once a password has been changed.
//
// mounted rather than rendered to a string, and that is why this file is in the dom pool: the
// press is bound through `useSaveState`, whose confirmation is held by a hook's own state, so a
// server render answers for none of it.
//
// what it covers is the pairing rather than the library — that this screen hands the button the
// marker its loader published. `packages/operator/src/save-state.ts` owns the four seconds and the
// precedence between the rungs, and nothing here re-asserts either; the withdrawal over a refused
// request is the same reading ./_app.admin.members.dom.spec.tsx already holds.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style or a class. what is asserted is the words on the press.

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

/**
 * the screen as the member sees it when their change has just landed.
 *
 * inside a stub because the form posts to the address it stands on, which does not render without
 * a router.
 */
function screen(over: { changed: boolean }): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/members/password',
			Component: () =>
				createElement(YourPassword as never, {
					loaderData: { changed: over.changed },
					actionData: undefined,
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/members/password'] }));
}

it('reports the change at the press that made it, with nothing left to press', () => {
	const root = screen({ changed: true });

	const button = root.querySelector('form button[type="submit"], form button:not([type])');
	if (button === null) throw new Error('the screen drew no press');

	expect(button.textContent).toBe('Password changed');
	expect((button as HTMLButtonElement).disabled).toBe(true);
});
