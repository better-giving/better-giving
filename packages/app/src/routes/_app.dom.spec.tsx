import { opening } from '@better-giving/operator/progress-bar';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub, Link } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import ProtectedLayout from './_app';

// what the frame says out loud over a move to another screen.
//
// the words are `MoveStatus`'s (packages/operator/src/components/status/ProgressBar.jsx), whose own
// spec holds that one region keeps its node while its words change. what only this layout can get
// wrong is the mount: that the region stands before the move, that the line drawn over the move
// brings no second one, and that the label it reads is the one the pressed link carried. so the
// layout is mounted under a stub whose destination's reading has not landed, which is the move in
// flight rather than a stand-in for it.
//
// in the dom pool because a navigation in flight is unrenderable to a string (../../vitest.config.ts).

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

/** the frame standing on the dashboard's first screen, with a link to a screen still being read. */
function frame() {
	let land: (value: null) => void = () => {};
	const reading = new Promise<null>((resolve) => {
		land = resolve;
	});
	const Stub = createRoutesStub([
		{
			id: 'routes/_app',
			Component: () =>
				createElement(ProtectedLayout as never, {
					loaderData: { shape: 'ready', orgName: 'Riverbank Trust', deployer: true },
					params: {},
					matches: []
				}),
			children: [
				{
					path: '/admin',
					Component: () => (
						<Link to="/admin/donations" state={opening('Opening Donations')}>
							to donations
						</Link>
					)
				},
				{ path: '/admin/donations', loader: () => reading, Component: () => <p>arrived</p> }
			]
		}
	]);
	return { root: mount(<Stub initialEntries={['/admin']} />), land: () => land(null) };
}

function regions(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('[role="status"]')];
}

it('says the opening label on one region over a move, and empties it when the move ends', async () => {
	const { root, land } = frame();
	const [standing, ...others] = regions(root);
	expect(others).toHaveLength(0);
	expect(standing?.textContent).toBe('');

	const link = [...root.querySelectorAll('a')].find((a) => a.textContent === 'to donations');
	if (link === undefined) throw new Error('the screen drew no link to donations');
	await act(async () => {
		link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	});

	// the line over the move is drawn, and it brings no region of its own.
	expect(root.querySelector('.adm-navigation-bar')).not.toBe(null);
	expect(regions(root)).toEqual([standing]);
	expect(standing?.textContent).toBe('Opening Donations');

	await act(async () => {
		land();
	});

	expect(root.textContent).toContain('arrived');
	expect(root.querySelector('.adm-navigation-bar')).toBe(null);
	expect(regions(root)).toEqual([standing]);
	expect(standing?.textContent).toBe('');
});
