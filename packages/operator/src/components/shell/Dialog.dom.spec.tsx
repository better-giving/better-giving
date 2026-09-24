import { describe, expect, it, vi } from 'vitest';
import { render } from '../render.testing';
import { Dialog } from './Dialog.jsx';

// the dialog the server sends, with no script having run over it.
//
// what is asserted here is the half that does not need a browser: the element is a `dialog` the
// markup already carries `open`, it is labelled by the heading a reader can see, each of the three
// controls hands its press to whoever passed it, and the actions row is the pairing and the shapes
// a destructive confirmation needs of it — one coloured control and it is the destructive one, a
// way out that can be a link, and a confirm that is a submit belonging to the form the card stands
// in. ../../behaviour/Dialog.dom.spec.tsx is the other half.

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

	it('is described by its body, so opening it reads the costs with the question', () => {
		const root = render(Dialog, {
			title: 'Disconnect Riverbank Trust Inc.?',
			children: (
				<ul>
					<li>Gifts stop syncing to Riverbank Trust Inc.</li>
				</ul>
			)
		});
		const dialog = root.querySelector('dialog');
		const said = dialog?.getAttribute('aria-describedby');

		expect(said).toBeTruthy();
		expect(root.querySelector(`#${CSS.escape(said ?? '')}`)?.textContent).toBe(
			'Gifts stop syncing to Riverbank Trust Inc.'
		);
	});

	it('is described by nothing where it has no body', () => {
		const root = render(Dialog, { title: 'Rotate the signing secret?' });

		expect(root.querySelector('dialog')?.hasAttribute('aria-describedby')).toBe(false);
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

	it('keeps the danger rank on the destructive control and no rank on the way out', () => {
		// the other half of that pairing, which the order above does not read: the way out is the
		// bare secondary rank and states no `variant` of its own to get it.
		const root = render(Dialog, {
			title: 'Archive this form?',
			danger: 'Yes, archive this form',
			cancel: 'Cancel',
			cancelProps: { as: 'a', href: '/admin/forms/1' }
		});
		const [confirm, cancel] = [...root.querySelectorAll('.adm-dialog__actions > *')];

		expect(confirm?.className).toContain('adm-btn--danger');
		expect(cancel?.className).toBe('adm-btn');
	});

	it('lets the way out be a link, which is what leaving a card opened by an address is', () => {
		const root = render(Dialog, {
			title: 'Archive this form?',
			danger: 'Yes, archive this form',
			cancel: 'Cancel',
			cancelProps: { as: 'a', href: '/admin/forms/1' }
		});
		const cancel = root.querySelector('.adm-dialog__actions a');

		expect(cancel?.getAttribute('href')).toBe('/admin/forms/1');
		expect(cancel?.textContent).toBe('Cancel');
	});

	it('lets the destructive control be a submit inside the form the card stands in', () => {
		// the actions-row rule above, read back off a tree: the `form` encloses the whole card and
		// the submit inside it belongs to that form. a `form` put between the row and this control
		// would pass an assertion about the button and break the row it sits in.
		function InForm() {
			return (
				<form action="/archive" method="post">
					<Dialog
						title="Archive this form?"
						danger="Yes, archive this form"
						dangerProps={{ type: 'submit', name: 'intent', value: 'archive' }}
					/>
				</form>
			);
		}
		const confirm = render(InForm, {}).querySelector('.adm-dialog__actions button');

		expect(confirm?.getAttribute('type')).toBe('submit');
		expect(confirm?.getAttribute('name')).toBe('intent');
		// the owner form is read back by what it is rather than by identity: `closest` in this pool
		// hands back an element that is not the same object `querySelector` does for the same node,
		// so `toBe` against the form compares two wrappers and fails on a tree that is correct.
		const owner = confirm?.closest('form');
		expect(owner?.getAttribute('method')).toBe('post');
		expect(owner?.getAttribute('action')).toBe('/archive');
	});
});
