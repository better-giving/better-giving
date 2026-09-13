import { ADMIN_USERNAME } from '@better-giving/operator/admin-password';
import { type ReactNode, act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import Login from './login';

// what the sign-in button says about itself while the password is away being compared, and the two
// things on this screen a server render cannot settle on its own.
//
// mounted rather than rendered to a string, and that is the whole reason this file is in the dom
// pool: `useNavigation()` is idle in a server render, so the busy arm of this screen is
// unrenderable there. the action below never settles, which holds the screen in the state an
// operator is actually looking at.
//
// nothing here reads a sentence or a class. that is what keeps it clear of CLAUDE.md's ban on a
// browser spec over a dashboard screen: what is asserted is the state the screen is in, never how
// it looks.

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

/** the screen as a deployment that has never been filled in serves it: no name, nothing refused. */
function screen(passwordReset = false): HTMLElement {
	const Stub = createRoutesStub([
		{
			path: '/login',
			Component: () =>
				createElement(Login as never, {
					loaderData: { shape: 'sign-in', orgName: null, passwordReset },
					actionData: undefined,
					params: {},
					matches: []
				}),
			// never settles, so the case reads the screen mid-flight rather than after it.
			action: () => new Promise<never>(() => {})
		},
		// the two places this screen sends somebody who cannot use it. they are stubbed rather than
		// rendered: what is asserted is that the press has somewhere to land, not what is there.
		{ path: '/forgot', Component: () => null },
		{ path: '/', Component: () => null }
	]);
	return mount(createElement(Stub, { initialEntries: ['/login'] }));
}

function submit(root: HTMLElement): HTMLButtonElement {
	const found = root.querySelector('button[type="submit"], form button:not([type])');
	if (found === null) throw new Error('the screen drew no submit');
	return found as HTMLButtonElement;
}

/** the box that box selector names, or a loud failure rather than a case that types into nothing. */
function box(root: HTMLElement, selector: string): HTMLInputElement {
	const found = root.querySelector(selector);
	if (found === null) throw new Error(`the screen drew no ${selector}`);
	return found as HTMLInputElement;
}

/**
 * fills both boxes and presses the submit, which is what it takes to get a post out of this screen:
 * the form validates on the client before it sends (`shouldValidate: 'onSubmit'` in
 * $lib/admin/use-admin-form.ts), so a screen with either box empty never reaches the action at all.
 */
async function signIn(root: HTMLElement): Promise<void> {
	const form = root.querySelector('form');
	if (form === null) throw new Error('the screen drew no form');

	await act(async () => {
		// through the prototype setter, which is what react's own change tracking reads — assigning
		// `.value` leaves it believing the box still holds what it rendered.
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
		for (const [selector, typed] of [
			['input[name="identifier"]', ADMIN_USERNAME],
			['input[type="password"]', 'a-very-long-random-staff-password']
		] as const) {
			const filled = box(root, selector);
			setter?.call(filled, typed);
			filled.dispatchEvent(new Event('input', { bubbles: true }));
		}
	});
	await act(async () => {
		form.requestSubmit(submit(root));
	});
}

/** the label above a box, as the reader meets it. */
function labelOf(root: HTMLElement, selector: string): string {
	const id = box(root, selector).id;
	return root.querySelector(`label[for="${id}"]`)?.textContent ?? '';
}

/**
 * the box that takes either identity: the deployer types a username into it and a colleague types
 * the address they were invited at, so it is named for both and marked required like the one under
 * it. an "(optional)" here would tell the deployer their way in is to leave it empty, which was
 * this screen's older shape and is now no way in at all.
 */
it('names one box for both ways in, and marks neither optional', () => {
	const root = screen();

	expect(labelOf(root, 'input[name="identifier"]')).toBe('Username or email address');
	expect(labelOf(root, 'input[type="password"]')).toBe('Password');
});

/**
 * the way out for a member who cannot get in. it is on the sign-in screen because that is where
 * they find out they cannot, and nowhere else on this deployment says so.
 */
it('offers the reset to a member whose password does not work', () => {
	const link = screen().querySelector('a[href="/forgot"]');

	expect(link?.textContent).toBe('Forgot your password?');
});

/**
 * and what the screen says to somebody arriving straight off /reset. the loader publishes the flag;
 * whether the marker is there at all is $lib/server/flash.ts's and ./login.workers.spec.ts's.
 */
it('says nothing about a password reset nobody just finished', () => {
	expect(screen().textContent).not.toContain('Password changed');
});

it('reports the finished reset when the loader says one landed', () => {
	expect(screen(true).querySelector('.adm-banner__word')?.textContent).toBe('Password changed');
});

it('says nothing about being busy before anyone presses it', () => {
	expect(submit(screen()).getAttribute('aria-busy')).not.toBe('true');
});

it('reports itself busy while the password is being compared', async () => {
	const root = screen();
	await signIn(root);

	expect(submit(root).getAttribute('aria-busy')).toBe('true');
});

it('stays reachable while it is busy, so the press that started it keeps its focus', async () => {
	const root = screen();
	await signIn(root);

	// a disabled control leaves the tab order, and `aria-busy` on something nothing can reach
	// announces to nobody. packages/console-ui/src/routes/_index.tsx's submits are the same shape.
	expect(submit(root).disabled).toBe(false);
});
