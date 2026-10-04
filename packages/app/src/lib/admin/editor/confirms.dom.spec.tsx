import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { FirstPublishConfirm } from './confirms';

// the editor's questions as the card draws them: what a campaign's first Publish says of an address
// it did not get. what the presses post is ./publish-wiring.dom.spec.tsx's.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function card(root: HTMLElement): HTMLDialogElement {
	const found = root.querySelector('dialog');
	if (found === null) throw new Error('no card was put up');
	return found;
}

describe('a campaign’s first Publish', () => {
	const confirm = (asked?: string) =>
		mount(
			<FirstPublishConfirm
				name="Winter coat drive"
				programs={[{ value: 'none', label: 'No program' }]}
				program="none"
				address="/winter-coat-drive-2"
				asked={asked}
				publishing={false}
				onPublish={() => {}}
				onCancel={() => {}}
			/>
		);
	const taken = /is taken, so this campaign takes the next free one/;

	it('states the next free address it takes, and that the one asked for is taken', () => {
		const text = card(confirm('/winter-coat-drive')).textContent;
		expect(text).toContain('/winter-coat-drive-2');
		expect(text).toContain(
			'The address /winter-coat-drive is taken, so this campaign takes the next free one.'
		);
	});

	it('says nothing is taken when it is handed no address asked for', () => {
		const text = card(confirm()).textContent;
		expect(text).toContain('/winter-coat-drive-2');
		expect(text).not.toMatch(taken);
	});
});
