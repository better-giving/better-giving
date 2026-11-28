import { Shell } from '@better-giving/operator/components/shell/Shell';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, Outlet, useLocation } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { currentDestination, DESTINATION_GROUPS } from './destinations';
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
const second = DESTINATION_GROUPS[1].destinations[1];

/**
 * the frame ../../routes/_app.tsx draws, under a pathless layout as that route is, drawing the page
 * that is under it. `/` is the head's address and has no page of its own.
 */
function stub() {
	const Stub = createRoutesStub([
		{
			Component: () => {
				const { pathname } = useLocation();
				const here = currentDestination(pathname);
				return (
					<Shell
						orgName="Riverside Shelter"
						home={{ href: '/', label: 'Open home page' }}
						groups={DESTINATION_GROUPS}
						current={here}
						staff={{ name: 'Nadia Hart', email: 'nadia@riverside.example' }}
						onSignOut={() => {}}
						link={RouterLink}
					>
						<Outlet />
					</Shell>
				);
			},
			children: [
				{ path: '/admin', Component: () => <p>the screen</p> },
				{ path: '/admin/campaigns', Component: () => <p>arrived</p> },
				{ path: '/admin/supporter-pages', Component: () => <p>the supporters</p> },
				{ path: '/admin/donation-page', Component: () => <p>the editor</p> }
			]
		}
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

	expect(root.querySelector('main')?.textContent).toBe('arrived');
});

it('routes a press on the Home page row as a press on any row', async () => {
	// the Home page row is the editor's only way in from the rail, and arrives through the same
	// link as every other row: the router's, not a full document load.
	const root = stub();

	expect(await press(root, 'Home page')).toBe(true);
	expect(root.querySelector('main')?.textContent).toBe('the editor');
});
