import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { DestructiveConfirm } from './DestructiveConfirm.jsx';

// what a confirmation has to be able to be, which is settled by the screen around it rather than
// here: on a screen that archives, the confirming control is a form's submit and the way out is a
// navigation. two bare buttons drawing labels are neither, which is why every screen that has
// needed this panel so far has written the markup itself
// (packages/app/src/routes/_app.admin.forms.$id.tsx's `ArchiveSection`).
//
// what is not asserted here is the pairing: the way out stays the bare secondary rank beside the
// danger control, one coloured control in an actions row and it is the destructive one.
//
// the register is the screen's too, and for the same reason: a panel that settles its own tone is
// not mountable by a screen whose archive section speaks in another one.
//
// a component spec is `.tsx` and both pools collect either extension — ../forms/Field.dom.spec.tsx
// says why.

/** the banner the panel stated its refusal in. */
function banner(root: HTMLElement): Element {
	const found = root.querySelector('.adm-banner');
	if (found === null) throw new Error('the panel drew no banner');
	return found;
}

/**
 * the two controls the panel's actions row drew, in the order it drew them.
 *
 * a panel that drew neither would answer every read below with `undefined`, which is a control
 * carrying nothing rather than a control that is not there.
 */
function controls(root: HTMLElement): readonly [Element, Element] {
	const row = root.querySelector('.adm-actions');
	if (row === null) throw new Error('the panel drew no actions row');
	const [confirm, cancel] = row.children;
	if (confirm === undefined || cancel === undefined) {
		throw new Error('the panel drew fewer than two controls');
	}
	return [confirm, cancel];
}

describe('a destructive confirmation mounted into a document', () => {
	it('lets the confirming control be a submit inside the form it sends', () => {
		function InForm() {
			return (
				<form action="/archive" method="post">
					<DestructiveConfirm
						word="Archive this form?"
						confirm="Yes, archive it"
						confirmProps={{ type: 'submit', name: 'intent', value: 'archive' }}
					>
						This cannot be undone from here.
					</DestructiveConfirm>
				</form>
			);
		}
		const root = render(InForm, {});
		const [confirm] = controls(root);

		expect(confirm.getAttribute('type')).toBe('submit');
		expect(confirm.getAttribute('name')).toBe('intent');
		// the owner form is read back by what it is rather than by identity: `closest` in this pool
		// hands back an element that is not the same object `querySelector` does for the same node,
		// so `toBe` against the form compares two wrappers and fails on a tree that is correct.
		const owner = confirm.closest('form');
		expect(owner?.getAttribute('method')).toBe('post');
		expect(owner?.getAttribute('action')).toBe('/archive');
	});

	it('lets the way out be a link, which is what leaving the panel is', () => {
		const root = render(DestructiveConfirm, {
			word: 'Archive this form?',
			confirm: 'Yes, archive it',
			cancel: 'Cancel',
			cancelProps: { as: 'a', href: '/admin/forms/1' }
		});
		const [, cancel] = controls(root);

		expect(cancel.tagName).toBe('A');
		expect(cancel.getAttribute('href')).toBe('/admin/forms/1');
		expect(cancel.textContent).toBe('Cancel');
	});

	it('keeps the danger rank on the confirming control and no rank on the way out', () => {
		const root = render(DestructiveConfirm, {
			word: 'Archive this form?',
			confirm: 'Yes, archive it',
			cancelProps: { as: 'a', href: '/admin/forms/1' }
		});
		const [confirm, cancel] = controls(root);

		expect(confirm.className).toContain('adm-btn--danger');
		expect(cancel.className).toBe('adm-btn');
	});

	it('states a refusal as a blocker where the screen says nothing', () => {
		const root = render(DestructiveConfirm, { word: 'Archive this form?', confirm: 'Archive' });

		expect(banner(root).className).toContain('adm-banner--blocker');
		expect(banner(root).getAttribute('role')).toBe('alert');
	});

	it('speaks in the register the screen around it states', () => {
		// the register is the screen's and not this component's: an archive section a reader
		// navigated to is not an interruption, and ../status/Banner.jsx makes it `role="status"`
		// for that reason.
		const root = render(DestructiveConfirm, {
			tone: 'attention',
			word: 'Archive this form?',
			confirm: 'Archive'
		});

		expect(banner(root).className).toContain('adm-banner--attention');
		expect(banner(root).getAttribute('role')).toBe('status');
	});

	it('draws two plain buttons where a caller hands neither control anything', () => {
		// the component's own default with nothing supplied for either control: no caller in this
		// repository leaves both `confirmProps` and `cancelProps` unset today, but a prop with a
		// fallback should still draw one that works.
		const root = render(DestructiveConfirm, { word: 'Archive this form?', confirm: 'Archive' });

		expect(controls(root).map((control) => control.tagName)).toEqual(['BUTTON', 'BUTTON']);
		expect(controls(root)[1].textContent).toBe('Keep it');
	});
});
