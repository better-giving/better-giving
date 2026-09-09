import { describe, expect, it, vi } from 'vitest';
import { render } from '../render.testing';
import { Dialog } from './Dialog.jsx';

// the dialog the server sends, with no script having run over it.
//
// what is asserted here is the half that does not need a browser: the element is a `dialog` the
// markup already carries `open`, it is labelled by the heading a reader can see, and each of the
// three controls hands its press to whoever passed it. ../../behaviour/Dialog.dom.spec.tsx is the
// other half.

describe('the dialog the server renders', () => {
	it('is an open dialog element drawn as a column in the page', () => {
		const root = render(Dialog, { title: 'Rotate the signing secret?' });
		const dialog = root.querySelector('dialog');

		expect(dialog).not.toBeNull();
		expect(dialog?.hasAttribute('open')).toBe(true);
		// the presentation the sheet draws for an element no script has lifted yet.
		expect(dialog?.className).toBe('adm-dialog adm-dialog--inline');
	});

	it('is labelled by the heading a reader can see', () => {
		const root = render(Dialog, { title: 'Rotate the signing secret?' });
		const dialog = root.querySelector('dialog');
		const heading = root.querySelector('h2');

		// minted rather than stated, and the two halves have to meet: a label pointing at an id
		// nothing carries is a dialog with no name at all.
		expect(heading?.id).toBeTruthy();
		expect(dialog?.getAttribute('aria-labelledby')).toBe(heading?.id);
		expect(heading?.textContent).toBe('Rotate the signing secret?');
	});

	it('takes the heading id a caller states', () => {
		const root = render(Dialog, { title: 'Confirm', titleId: 'stated-title' });

		expect(root.querySelector('h2')?.id).toBe('stated-title');
		expect(root.querySelector('dialog')?.getAttribute('aria-labelledby')).toBe('stated-title');
	});

	it('hands the destructive press to the caller', () => {
		const pressed = vi.fn();
		const root = render(Dialog, {
			title: 'Rotate the signing secret?',
			danger: 'Rotate it',
			dangerProps: { onClick: pressed }
		});
		const button = [...root.querySelectorAll('button')].find(
			(node) => node.textContent === 'Rotate it'
		);

		button?.click();
		expect(pressed).toHaveBeenCalledTimes(1);
	});

	it('hands the way out to the caller', () => {
		const pressed = vi.fn();
		const root = render(Dialog, {
			title: 'Rotate the signing secret?',
			danger: 'Rotate it',
			cancel: 'Keep it',
			cancelProps: { onClick: pressed }
		});
		const button = [...root.querySelectorAll('button')].find(
			(node) => node.textContent === 'Keep it'
		);

		button?.click();
		expect(pressed).toHaveBeenCalledTimes(1);
	});

	it('hands the one way out of the once arrangement to the caller', () => {
		const pressed = vi.fn();
		const root = render(Dialog, {
			title: 'Your signing secret',
			exit: 'Done',
			exitProps: { onClick: pressed }
		});
		const button = [...root.querySelectorAll('button')].find((node) => node.textContent === 'Done');

		button?.click();
		expect(pressed).toHaveBeenCalledTimes(1);
	});

	it('draws no way out beside a destructive control', () => {
		// the pairing adm.css draws: one coloured control in an actions row, and it is the
		// destructive one. a primary exit beside it would be two controls asking to be pressed.
		const root = render(Dialog, {
			title: 'Rotate the signing secret?',
			danger: 'Rotate it',
			cancel: 'Keep it'
		});

		expect(
			[...root.querySelectorAll('.adm-dialog__actions button')].map((n) => n.textContent)
		).toEqual(['Rotate it', 'Keep it']);
	});
});
