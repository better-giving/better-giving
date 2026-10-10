import { act, type ReactNode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { MoneyField } from './money-field';

// what a money box draws and what it hands on: the digits grouped as they are typed and pasted,
// the caret among the digits it was typed between, and the text with the separators taken out
// handed to the caller or posted with the form. the boxes that mount it say what they do with that
// text in their own specs.

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

/** a box the caller holds, reporting each text it is handed. */
function Held({ onText }: { onText: (text: string) => void }) {
	const [text, setText] = useState('');
	return (
		<MoneyField
			id="gift"
			label="A typical gift"
			affix="$"
			affixAt="start"
			currency="USD"
			value={text}
			onValueChange={(next) => {
				setText(next);
				onText(next);
			}}
		/>
	);
}

function boxIn(root: HTMLElement): HTMLInputElement {
	const box = root.querySelector<HTMLInputElement>('input:not([type="hidden"])');
	if (box === null) throw new Error('no money box');
	return box;
}

/**
 * the box as the platform leaves it after a keystroke or a paste: `text` in it, the caret at
 * `caret`, and an input event saying how it got there.
 */
function edit(box: HTMLInputElement, text: string, caret = text.length, inputType = 'insertText') {
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, text);
		box.setSelectionRange(caret, caret);
		box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
	});
}

describe('a money box', () => {
	it('groups the thousands as they are typed, and hands on the figure without them', () => {
		const onText = vi.fn();
		const box = boxIn(mount(<Held onText={onText} />));

		edit(box, '1000');
		expect(box.value).toBe('1,000');
		edit(box, '1,0000');
		expect(box.value).toBe('10,000');
		edit(box, '10,000.5');

		expect(box.value).toBe('10,000.5');
		expect(onText.mock.calls.map(([text]) => text)).toEqual(['1000', '10000', '10000.5']);
	});

	it('keeps the caret after the digit typed when a separator moves in front of it', () => {
		const box = boxIn(mount(<Held onText={() => {}} />));
		edit(box, '100000');
		expect(box.value).toBe('100,000');

		// a 2 typed after the 1: the box as typed reads `1200,000`, the caret after the 2.
		edit(box, '1200,000', 2);

		expect(box.value).toBe('1,200,000');
		expect([box.selectionStart, box.selectionEnd]).toEqual([3, 3]);
	});

	it('keeps the caret after the digit before it when a separator in front of it goes', () => {
		const box = boxIn(mount(<Held onText={() => {}} />));
		edit(box, '1234');
		expect(box.value).toBe('1,234');

		// the 2 deleted: the box as typed reads `1,34`, the caret after the comma.
		edit(box, '1,34', 2, 'deleteContentBackward');

		expect(box.value).toBe('134');
		expect(box.selectionStart).toBe(1);
	});

	it('groups a paste, the caret after the last digit pasted', () => {
		const onText = vi.fn();
		const box = boxIn(mount(<Held onText={onText} />));
		edit(box, '100');

		// `2345` pasted after the 1.
		edit(box, '1234500', 5, 'insertFromPaste');

		expect(box.value).toBe('1,234,500');
		expect(box.selectionStart).toBe(7);
		expect(onText).toHaveBeenLastCalledWith('1234500');
	});

	it('takes a paste already grouped as the figure it groups', () => {
		const onText = vi.fn();
		const box = boxIn(mount(<Held onText={onText} />));

		edit(box, '1,500.50', 8, 'insertFromPaste');

		expect(box.value).toBe('1,500.50');
		expect(onText).toHaveBeenLastCalledWith('1500.50');
	});

	it('draws and hands on text that is not a figure as typed', () => {
		const onText = vi.fn();
		const box = boxIn(mount(<Held onText={onText} />));

		edit(box, 'about 5,000');

		expect(box.value).toBe('about 5,000');
		expect(onText).toHaveBeenLastCalledWith('about 5,000');
	});

	it('posts the figure without separators under its name, and the drawn box posts nothing', () => {
		const root = mount(
			<form>
				<MoneyField
					id="tier"
					name="tier_amount[0]"
					defaultValue="2500"
					label="Amount"
					affix="USD"
					affixAt="end"
					currency="USD"
				/>
			</form>
		);
		const form = root.querySelector('form');
		if (form === null) throw new Error('no form');
		const box = boxIn(root);
		expect(box.value).toBe('2,500');
		expect([...new FormData(form)]).toEqual([['tier_amount[0]', '2500']]);

		edit(box, '12,5000');

		expect(box.value).toBe('125,000');
		expect([...new FormData(form)]).toEqual([['tier_amount[0]', '125000']]);
	});
});
