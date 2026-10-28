import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { DiscardConfirm, ResetConfirm } from './confirms';

// the edit screens' questions as the card draws them: what Reset and Discard say they replace.

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

/** the label of each row the card lists. */
const rows = (root: HTMLElement) =>
	[...card(root).querySelectorAll('.adm-setting__label')].map((label) => label.textContent);

describe('what Reset and Discard replace', () => {
	it('Reset lists the draft and the published page, and nothing else', () => {
		const root = mount(<ResetConfirm resetting={false} onReset={() => {}} onCancel={() => {}} />);
		expect(rows(root)).toEqual(['Your draft', 'The published page at /donate']);
		expect(card(root).textContent).not.toMatch(/chat/i);
	});

	it('Discard lists the draft, and nothing else', () => {
		const root = mount(
			<DiscardConfirm discarding={false} onDiscard={() => {}} onCancel={() => {}} />
		);
		expect(rows(root)).toEqual(['Your draft']);
		expect(card(root).textContent).not.toMatch(/chat/i);
	});
});
