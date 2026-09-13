import { Button } from '@better-giving/operator/components/controls/Button';
import { type ReactNode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';

// what a link dressed as a button has to do: hand the press to the router.
//
// the part lives in packages/operator, which declares no router and must not. so the element type
// arrives from the caller, and the only place that seam can be put in front of a router is a
// surface that has one. this is one of the two; packages/console-ui/src/routes/_index.tsx is the
// other.
//
// what is asserted is the press, not the markup. a bare `<a href>` renders the same attributes and
// reads the same to anyone diffing the output — the difference is only ever visible in what
// happens when it is clicked, and a plain anchor takes the whole document with it.

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

/** the button as a router link, at `/here`, with somewhere to arrive. */
function stub() {
	const Stub = createRoutesStub([
		{
			path: '/here',
			Component: () => (
				<Button as={Link} to="/there" variant="primary">
					Go
				</Button>
			)
		},
		{ path: '/there', Component: () => <p>arrived</p> }
	]);
	return mount(<Stub initialEntries={['/here']} />);
}

/** the press a browser sends, and the flush react router does in answer to it. */
async function press(root: HTMLElement): Promise<boolean> {
	const link = root.querySelector('a');
	if (!link) throw new Error('the button rendered no anchor');
	let claimed = false;
	await act(async () => {
		claimed = !link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	});
	return claimed;
}

it('takes the press itself rather than letting the document navigate', async () => {
	// `dispatchEvent` answers false when a listener called `preventDefault`, which is the router
	// claiming the press. a plain anchor leaves it alone and the browser leaves the page.
	expect(await press(stub())).toBe(true);
});

it('arrives at the destination it names', async () => {
	const root = stub();
	await press(root);

	expect(root.textContent).toBe('arrived');
});
