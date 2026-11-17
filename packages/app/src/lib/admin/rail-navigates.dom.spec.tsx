import { Shell } from '@better-giving/operator/components/shell/Shell';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { DESTINATION_GROUPS } from './destinations';
import { RouterLink } from './router-link';

// what a press on the rail has to do: hand the navigation to the router.
//
// the same argument as ./button-navigates.dom.spec.tsx, one seam along. the shell and its rows are
// packages/operator's and take the link as a prop; the dashboard is the surface that hands one
// in, and a shell mounted without it draws plain anchors that carry every attribute the router's
// link does. so the difference is only ever visible in what happens on a press, and a rail that
// quietly went back to full document loads would pass every other gate in the repository.

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

const [first] = DESTINATION_GROUPS[0].destinations;
const [second] = DESTINATION_GROUPS[1].destinations;

/** the frame ../../routes/_app.tsx draws, standing at the first destination. */
function stub() {
	const Stub = createRoutesStub([
		{
			path: first.href,
			Component: () => (
				<Shell
					orgName="Riverside Shelter"
					home={{ href: '/admin', label: 'Dashboard' }}
					groups={DESTINATION_GROUPS}
					current={{ label: first.label, kind: 'page' }}
					staff={{ name: 'Nadia Hart', email: 'nadia@riverside.example' }}
					donationPage="/donate"
					editDonationPage="/admin/donation-page"
					onSignOut={() => {}}
					link={RouterLink}
				>
					<p>the screen</p>
				</Shell>
			)
		},
		{ path: second.href, Component: () => <p>arrived</p> }
	]);
	return mount(<Stub initialEntries={[first.href]} />);
}

/** the press a browser sends on the sidebar row reading `label`, and the flush the router does. */
async function press(root: HTMLElement, label: string): Promise<boolean> {
	const row = [...root.querySelectorAll('.ds-shell-sidebar a.ds-nav-link')].find(
		(a) => a.querySelector('.ds-nav-label')?.textContent === label
	);
	if (!row) throw new Error(`the rail drew no row reading ${label}`);
	let claimed = false;
	await act(async () => {
		claimed = !row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	});
	return claimed;
}

it('takes the press itself rather than letting the document navigate', async () => {
	// `dispatchEvent` answers false when a listener called `preventDefault`, which is the router
	// claiming the press. a plain anchor leaves it alone and the browser reloads the whole surface.
	expect(await press(stub(), second.label)).toBe(true);
});

it('arrives at the destination the row names', async () => {
	const root = stub();
	await press(root, second.label);

	expect(root.textContent).toBe('arrived');
});
