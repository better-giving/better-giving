import { BackLink } from '@better-giving/operator/components/controls/BackLink';
import { type ReactNode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { RouterLink } from './router-link';

// what a press on the way back has to do: hand the navigation to the router.
//
// the same argument as ./rail-navigates.dom.spec.tsx, one part along. `BackLink` is
// packages/operator's and takes what it is drawn as as a prop; a screen that mounts it without one
// draws a plain anchor carrying the same address, and every press back then throws away the
// running application and fetches the section off the network again. nothing in the markup tells
// the two apart, so the press is the only thing a case can hold.

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

/** a child screen standing under a section, with the way back the four of them draw. */
function stub() {
	const Stub = createRoutesStub([
		{
			path: '/admin/forms/:id',
			Component: () => (
				<BackLink href="/admin/forms" link={RouterLink}>
					Donation forms
				</BackLink>
			)
		},
		{ path: '/admin/forms', Component: () => <p>arrived</p> }
	]);
	return mount(<Stub initialEntries={['/admin/forms/1']} />);
}

/** the press a browser sends on the way back, and the flush react router does for it. */
async function press(root: HTMLElement): Promise<boolean> {
	const back = root.querySelector('.adm-back');
	if (!back) throw new Error('the screen drew no back link');
	let claimed = false;
	await act(async () => {
		claimed = !back.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	});
	return claimed;
}

it('takes the press itself rather than letting the document navigate', async () => {
	// `dispatchEvent` answers false when a listener called `preventDefault`, which is the router
	// claiming the press. a plain anchor leaves it alone and the browser reloads the whole surface.
	expect(await press(stub())).toBe(true);
});

it('arrives at the section the link names', async () => {
	const root = stub();
	await press(root);

	expect(root.textContent).toBe('arrived');
});
