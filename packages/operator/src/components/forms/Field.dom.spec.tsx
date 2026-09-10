import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { Field } from './Field.jsx';

// the first case over a part rendered rather than read, and it is here to prove the harness as much
// as the field: ../render.testing.tsx returning an element nothing was mounted into would satisfy
// every assertion written against what it hands back, so the claim below is about markup that only
// exists if the part really ran.
//
// a component spec is `.tsx` rather than `.ts`: a part's props are react nodes, and jsx is not
// legal in a `.ts` file. both pools collect either extension (../../../vitest.config.ts) so that a
// spec is never written into neither.

/** the ids a box's description names, in the order it names them. */
function describedBy(root: HTMLElement): string[] {
	const tokens = root.querySelector('input, textarea')?.getAttribute('aria-describedby');
	return tokens === null || tokens === undefined || tokens === '' ? [] : tokens.split(' ');
}

/** the classes the box carries, as a set a case can ask about one at a time. */
function boxClasses(root: HTMLElement): string[] {
	return (root.querySelector('input, textarea')?.getAttribute('class') ?? '').split(' ');
}

/**
 * the press that shows a masked box, found by the box it says it is about rather than by its
 * position in the row: a caller's own control stands on that row too, and a case reading the first
 * button would be reading whichever of the two happens to be drawn first.
 */
function reveal(root: HTMLElement): HTMLButtonElement {
	const button = root.querySelector<HTMLButtonElement>('button[aria-controls]');
	if (button === null) throw new Error('the field drew no reveal');
	return button;
}

/** presses it, with the redraw finished by the time the call returns. */
function press(button: HTMLButtonElement): void {
	act(() => {
		button.click();
	});
}

describe('a field mounted into a document', () => {
	it('names the box its label labels', () => {
		const root = render(Field, { id: 'org-name', label: 'Registered name' });

		expect(root.querySelector('label')?.getAttribute('for')).toBe('org-name');
		expect(root.querySelector('input')?.getAttribute('id')).toBe('org-name');
	});

	it('announces the refusal rather than only drawing it', () => {
		// what a press answers with. the message is drawn wherever the box is, and on the screens
		// where conform does not move focus into the box — the sign-in, the settings save — a
		// paragraph that is not a live region is a refusal nobody using a reader is told about.
		const root = render(Field, {
			id: 'org-name',
			label: 'Registered name',
			error: 'Give it a name.'
		});

		expect(root.querySelector('.adm-field__error')?.getAttribute('role')).toBe('alert');
	});

	it('draws a box refused from outside itself as refused', () => {
		// a rule about a pair of boxes belongs to neither of them, so the group draws the one
		// message and each box is marked from out here. it still has to look refused: either box
		// fixes the pair and neither one is the wrong one.
		const root = render(Field, {
			id: 'min-minor',
			label: 'Smallest gift',
			'aria-invalid': 'true'
		});

		expect(root.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
		expect(boxClasses(root)).toContain('adm-input--invalid');
	});

	it('draws a box refused by its own message as refused, with nothing said from outside', () => {
		const root = render(Field, {
			id: 'org-name',
			label: 'Registered name',
			error: 'Give it a name.'
		});

		expect(root.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
		expect(boxClasses(root)).toContain('adm-input--invalid');
	});

	it('adds a caller’s class to its own rather than standing in for them', () => {
		const root = render(Field, {
			id: 'tax-id',
			label: 'EIN',
			className: 'adm-num'
		});

		expect(boxClasses(root)).toContain('adm-num');
		expect(boxClasses(root)).toContain('adm-input');
	});

	it('keeps the standing sentence while the box is refused, and names both', () => {
		// the two are different things and are reachable together: a test send marks a blank box as
		// wanted, and a save refused afterwards leaves the field holding both.
		const root = render(Field, {
			id: 'notification-email',
			label: 'Notification email',
			error: 'Write an address.',
			needed: 'A receipt carries a placeholder until this is saved.'
		});

		expect(describedBy(root).map((id) => root.querySelector(`#${id}`)?.textContent)).toEqual([
			'Write an address.',
			'A receipt carries a placeholder until this is saved.'
		]);
	});

	it('renders no label where the box is named some other way', () => {
		// a row in a repeating editor: the group's legend is the name on the screen and each box
		// says which row it is to a reader. an empty label element is a labelling relationship the
		// browser reads as the box having no name at all.
		const root = render(Field, { id: 'suggested-0', 'aria-label': 'Suggested amount 1' });

		expect(root.querySelector('label')).toBeNull();
	});

	it('holds a masked box as dots until the press shows it, and hides it again', () => {
		// the whole of the reveal: the value is in the box either way — a console box is seeded with
		// what the deployment is holding — and what the press changes is whether it is legible to
		// everybody else in the room.
		const root = render(Field, {
			id: 'set-ADMIN_PASSWORD',
			label: 'Dashboard password',
			masked: true,
			defaultValue: 'correct-horse-battery'
		});
		const box = root.querySelector('input');

		expect(box?.getAttribute('type')).toBe('password');
		expect(box?.value).toBe('correct-horse-battery');

		press(reveal(root));
		expect(root.querySelector('input')?.getAttribute('type')).toBe('text');

		press(reveal(root));
		expect(root.querySelector('input')?.getAttribute('type')).toBe('password');
	});

	it('names the press by what it does, and renames it by what it did', () => {
		// the mark carries no name of its own (../status/Mark.jsx draws an unlabelled one out of the
		// tree), so this is the whole of what a reader is told about the control — and a name that
		// stayed `Show` over a box already showing would be an instruction to do what has been done.
		const root = render(Field, {
			id: 'set-SMTP_PASSWORD',
			label: 'Password',
			masked: true,
			defaultValue: 're_abc'
		});

		expect(reveal(root).getAttribute('aria-label')).toBe('Show the value');
		expect(reveal(root).getAttribute('aria-controls')).toBe('set-SMTP_PASSWORD');

		press(reveal(root));
		expect(reveal(root).getAttribute('aria-label')).toBe('Hide the value');
	});

	it('does not submit the form it stands in', () => {
		// it stands inside the form whose boxes it is about, and a press that submitted would post a
		// credential the operator only wanted to look at.
		const root = render(Field, { id: 'set-STRIPE_SECRET_KEY', label: 'Secret key', masked: true });

		expect(reveal(root).getAttribute('type')).toBe('button');
	});

	it('draws no press on a textarea, whatever the caller asked to mask', () => {
		// a textarea takes no `type` and there is nothing to hide behind: a press drawn here would
		// stand beside a box every word of which is already on the screen, offering a swap it has no
		// way to make.
		const root = render(Field, {
			id: 'thank-you',
			as: 'textarea',
			label: 'Thank-you message',
			masked: true,
			defaultValue: 'Thank you. Your gift keeps the doors open tonight.'
		});

		expect(root.querySelector('button')).toBeNull();
		expect(root.querySelector('textarea')?.getAttribute('type')).toBeNull();
	});

	it('draws no press at all where nothing is masked', () => {
		// the field every other box on both surfaces is: no control, no row around the box, and the
		// type the caller asked for.
		const root = render(Field, { id: 'org-name', label: 'Registered name' });

		expect(root.querySelector('button')).toBeNull();
		expect(root.querySelector('.adm-actions')).toBeNull();
		expect(root.querySelector('input')?.getAttribute('type')).toBe('text');
	});

	it('puts a masked box in the field’s own row exactly as a plain box stands in it', () => {
		// what is asserted is the composition equal widths hang off — a wrapper the sheet gives
		// `inline-size: 100%` standing where the box itself would, and no `.adm-actions` anywhere,
		// which is the one thing in the sheet that takes a row's width off a box. the width itself is
		// not read: nothing lays out in this pool and no stylesheet is loaded in it, so a case reading
		// a measurement back would be reading zero off both fields and passing on it.
		const plain = render(Field, { id: 'set-SMTP_HOST', label: 'Mail host', code: true });
		const masked = render(Field, {
			id: 'set-SMTP_PASSWORD',
			label: 'Password',
			code: true,
			masked: true
		});

		expect(plain.querySelector('.adm-field')?.children[1]?.className).toBe(
			'adm-input adm-input--code'
		);
		expect(masked.querySelector('.adm-field')?.children[1]?.className).toBe('adm-maskwrap');
		expect(masked.querySelector('.adm-maskwrap > input')?.className).toBe(
			'adm-input adm-input--code'
		);
		expect(masked.querySelector('.adm-actions')).toBeNull();
	});

	it('stands on the row as its wrapper where a caller also put a control there', () => {
		// the row is `.adm-actions` and what it hands the line's remainder to is whatever the box is
		// inside of, so the wrapper is the item on the row and the press stays in the box with its
		// own value. the caller's control is the second item, which is the row it was always drawn in.
		const root = render(Field, {
			id: 'set-SMTP_PASSWORD',
			label: 'Password',
			masked: true,
			beside: (
				<button type="button" className="adm-btn">
					Send test email
				</button>
			)
		});
		const row = root.querySelector('.adm-actions');
		const items = [...(row?.children ?? [])];

		expect(items.map((item) => item.className)).toEqual(['adm-maskwrap', 'adm-btn']);
		expect(items[0]?.contains(reveal(root))).toBe(true);
		expect(items[0]?.querySelector('input')).not.toBeNull();
	});
});
