import { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../render.testing';
import { Sheet } from './Sheet.jsx';

// the sheet, and what it writes rather than what `showModal()` already does: the element and its
// label, the two ways out handed to the caller, and the focus handed back to the control that
// opened it. the tab ring kept inside and the page made inert are the top layer's, and happy-dom has
// no top layer to watch them in — ../../behaviour/Dialog.dom.spec.tsx says the same of the card.

/** the element the sheet put on the page. */
function sheetIn(root: HTMLElement): HTMLDialogElement {
	const found = root.querySelector('dialog');
	if (found === null) throw new Error('no sheet on the page');
	return found;
}

/** the X in the sheet's head. */
function closeIn(root: HTMLElement): HTMLButtonElement {
	const found = sheetIn(root).querySelector<HTMLButtonElement>('.adm-sheet__head button');
	if (found === null) throw new Error('the sheet drew no way out');
	return found;
}

describe('the sheet', () => {
	it('is a dialog shown modally and labelled by its heading', () => {
		const root = render(Sheet, { title: 'Goal', onDismiss: () => {} });
		const sheet = sheetIn(root);
		const heading = sheet.querySelector('h2');

		expect(sheet.open).toBe(true);
		expect(sheet.className).toBe('adm-sheet');
		expect(heading?.textContent).toBe('Goal');
		expect(sheet.getAttribute('aria-labelledby')).toBe(heading?.id);
		// the sheet, and not the X, is where the reader lands.
		expect(document.activeElement).toBe(sheet);
	});

	it('draws a foot only where one is handed', () => {
		expect(
			render(Sheet, { title: 'More', onDismiss: () => {} }).querySelector('.adm-sheet__foot')
		).toBeNull();

		const root = render(Sheet, {
			title: 'Goal',
			foot: <button type="button">Done</button>,
			onDismiss: () => {}
		});
		expect(root.querySelector('.adm-sheet__foot')?.textContent).toBe('Done');
	});

	it('wears each arrangement a caller states', () => {
		const root = render(Sheet, { title: 'Name', stacked: true, wide: true, onDismiss: () => {} });

		expect(sheetIn(root).className).toBe('adm-sheet adm-sheet--wide adm-sheet--stacked');
	});

	it('hands Escape to the caller and leaves the element open', () => {
		const onDismiss = vi.fn();
		const root = render(Sheet, { title: 'Goal', onDismiss });
		const sheet = sheetIn(root);

		// what the browser sends a shown modal on Escape; happy-dom does not turn the key into it.
		const cancel = new Event('cancel', { cancelable: true });
		sheet.dispatchEvent(cancel);

		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(cancel.defaultPrevented).toBe(true);
		expect(sheet.open).toBe(true);
	});

	it('hands the X to the caller under its own name', () => {
		const onDismiss = vi.fn();
		const root = render(Sheet, { title: 'Goal', onDismiss });
		const close = closeIn(root);

		expect(close.getAttribute('aria-label')).toBe('Close');
		close.click();
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	/** a sheet a control on the page puts up, taken away again by either way out. */
	function Opening() {
		const [up, setUp] = useState(false);
		return (
			<>
				<button type="button" onClick={() => setUp(true)}>
					Settings
				</button>
				{up ? <Sheet title="Settings" onDismiss={() => setUp(false)} /> : null}
			</>
		);
	}

	function opened(root: HTMLElement): HTMLButtonElement {
		const opener = root.querySelector('button');
		if (opener === null) throw new Error('no control to open the sheet with');
		opener.focus();
		act(() => opener.click());
		expect(document.activeElement).toBe(sheetIn(root));
		return opener;
	}

	it('puts the focus back on the control that opened it when Escape dismisses it', () => {
		const root = render(Opening, {});
		const opener = opened(root);

		act(() => sheetIn(root).dispatchEvent(new Event('cancel', { cancelable: true })));

		expect(root.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(opener);
	});

	it('puts the focus back on the control that opened it when the X is pressed', () => {
		const root = render(Opening, {});
		const opener = opened(root);

		act(() => closeIn(root).click());

		expect(root.querySelector('dialog')).toBeNull();
		expect(document.activeElement).toBe(opener);
	});
});
