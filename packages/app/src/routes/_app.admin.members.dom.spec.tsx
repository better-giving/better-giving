import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import Members from './_app.admin.members';

// what the Send invitation press says about itself once an invitation has gone.
//
// mounted rather than rendered to a string, and that is why this file is in the dom pool: the
// press is bound through `useSaveState`, whose confirmation is held by a hook's own state, so a
// server render answers for none of it.
//
// what it covers is the pairing rather than the library: that this screen hands the button a
// marker the loader published *and* withdraws it the moment the last request had something else to
// say. `packages/operator/src/save-state.ts` owns the four seconds and the precedence between the
// rungs, and nothing here re-asserts either.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen: nothing here reads a computed
// style or a class. what is asserted is the words on the press and whether it can be pressed.

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

/** the colleague every case below has already invited, as the loader hands the row over. */
const INVITED = { id: 'inv-1', email: 'sam@riverbanktrust.org', name: null, invited: true };

/**
 * the screen as the deployer sees it, over one pending invitation.
 *
 * inside a stub because this screen both submits and links: the invite posts to the address it
 * stands on and every row carries a Remove link, neither of which renders without a router.
 */
function screen(over: { sentTo: string | null; actionData?: object }): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/admin/members',
			Component: () =>
				createElement(Members as never, {
					loaderData: {
						mayManage: true,
						members: [INVITED],
						sentTo: over.sentTo,
						removing: null
					},
					actionData: over.actionData,
					params: {},
					matches: []
				})
		}
	]);
	return mount(createElement(Stub, { initialEntries: ['/admin/members'] }));
}

/** the invite's own press, which is the one submit this screen draws while nothing is being removed. */
function press(root: HTMLElement): HTMLButtonElement {
	const found = root.querySelector('form button[type="submit"], form button:not([type])');
	if (found === null) throw new Error('the screen drew no invite press');
	return found as HTMLButtonElement;
}

it('reports the invitation at the press that sent it, with nothing left to press', () => {
	const button = press(screen({ sentTo: 'sam@riverbanktrust.org' }));

	expect(button.textContent).toBe('Invitation sent');
	expect(button.disabled).toBe(true);
});

it('names no address on the press: the row it made is on the list below', () => {
	const button = press(screen({ sentTo: 'sam@riverbanktrust.org' }));

	expect(button.textContent).not.toContain('sam@riverbanktrust.org');
});

it('withdraws the confirmation where the last request was refused instead', () => {
	// any answer at all, because that is what the screen reads: a refusal anywhere on it means the
	// marker still on the page is reporting an older request than the one the operator just made.
	const button = press(screen({ sentTo: 'sam@riverbanktrust.org', actionData: {} }));

	expect(button.textContent).toBe('Send invitation');
});
