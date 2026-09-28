import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { FirstPublishConfirm, MissionAsk } from './confirms';

// the editor's questions as the card draws them: what the mission ask hands back on each way out,
// and what a campaign's first Publish says of an address it did not get. what the presses post is
// ./publish-wiring.dom.spec.tsx's; what the route does with a mission is its own.

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

function button(root: Element, name: string): HTMLButtonElement {
	const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
		(one) => (one.getAttribute('aria-label') ?? one.textContent?.trim()) === name
	);
	if (found === undefined) throw new Error(`no button named ${name}`);
	return found;
}

describe('the mission ask', () => {
	function asked() {
		const onSave = vi.fn();
		const onSkip = vi.fn();
		const root = mount(<MissionAsk saving={false} onSave={onSave} onSkip={onSkip} />);
		return { root, onSave, onSkip };
	}

	it('saves the mission as typed, trimmed', () => {
		const { root, onSave, onSkip } = asked();
		const box = card(root).querySelector('textarea');
		if (box === null) throw new Error('no mission box');
		act(() => {
			Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
				box,
				'  Warm coats for every child in Eastside.\n'
			);
			box.dispatchEvent(new Event('input', { bubbles: true }));
		});

		act(() => button(card(root), 'Save').click());

		expect(onSave.mock.calls).toEqual([['Warm coats for every child in Eastside.']]);
		expect(onSkip).not.toHaveBeenCalled();
	});

	it('is skipped by Skip, saving nothing', () => {
		const { root, onSave, onSkip } = asked();
		act(() => button(card(root), 'Skip').click());
		expect(onSkip).toHaveBeenCalledOnce();
		expect(onSave).not.toHaveBeenCalled();
	});

	it('is skipped by Escape, saving nothing', () => {
		const { root, onSave, onSkip } = asked();
		act(() => card(root).dispatchEvent(new Event('cancel', { cancelable: true })));
		expect(onSkip).toHaveBeenCalledOnce();
		expect(onSave).not.toHaveBeenCalled();
	});
});

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
	const taken = /is taken, so this campaign takes the next free address/;

	it('states the next free address it takes, and that the one asked for is taken', () => {
		const text = card(confirm('/winter-coat-drive')).textContent;
		expect(text).toContain('/winter-coat-drive-2');
		expect(text).toContain(
			'/winter-coat-drive is taken, so this campaign takes the next free address.'
		);
	});

	it('says nothing is taken when it is handed no address asked for', () => {
		const text = card(confirm()).textContent;
		expect(text).toContain('/winter-coat-drive-2');
		expect(text).not.toMatch(taken);
	});
});
