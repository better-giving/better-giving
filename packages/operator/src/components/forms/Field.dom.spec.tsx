import { type ComponentProps, act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { closedRungOf } from '../closed-look.testing';
import { mount, render } from '../render.testing';
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

	it('names the press for the value it shows where the screen says which one', () => {
		// a screen holding two credentials names each press for its own, or a reader tabbing through
		// hears the same `Show the value` twice and cannot tell which box either one opens.
		const root = render(Field, {
			id: 'webhook-secret',
			label: 'Signing secret',
			masked: true,
			revealLabel: 'Show signing secret',
			hideLabel: 'Hide signing secret',
			defaultValue: 'whsec_abc'
		});

		expect(reveal(root).getAttribute('aria-label')).toBe('Show signing secret');

		press(reveal(root));
		expect(reveal(root).getAttribute('aria-label')).toBe('Hide signing secret');

		press(reveal(root));
		expect(reveal(root).getAttribute('aria-label')).toBe('Show signing secret');
	});

	it('cannot be handed one of the press’s two names without the other', () => {
		// one name alone would leave the press named for one value and renamed for another. `pnpm run
		// check` is what runs this case; the render asserts the default the other name falls back to.
		// @ts-expect-error — `hideLabel` is required beside `revealLabel`.
		const root = render(Field, {
			id: 'webhook-secret',
			label: 'Signing secret',
			masked: true,
			revealLabel: 'Show signing secret',
			defaultValue: 'whsec_abc'
		});

		expect(reveal(root).getAttribute('aria-label')).toBe('Show signing secret');
	});

	it('does not submit the form it stands in', () => {
		// it stands inside the form whose boxes it is about, and a press that submitted would post a
		// credential the operator only wanted to look at.
		const root = render(Field, { id: 'set-STRIPE_SECRET_KEY', label: 'Secret key', masked: true });

		expect(reveal(root).getAttribute('type')).toBe('button');
	});

	it('holds a copy control inside the box beside the reveal, named and copying the value', () => {
		// one trailing cluster inside the box, copy first so the reveal keeps the end it has on every
		// other masked box; the control copies the value the box was handed, hidden or not.
		const root = render(Field, {
			id: 'zapier-key',
			label: 'Your authentication key',
			masked: true,
			copyable: true,
			copyLabel: 'Copy key',
			readOnly: true,
			value: 'bgz_key'
		});
		const cluster = root.querySelector('.adm-maskwrap > .adm-maskwrap__presses');

		expect(
			[...(cluster?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label'))
		).toEqual(['Copy key', 'Show the value']);
		expect(root.querySelector('input')?.getAttribute('type')).toBe('password');
	});

	it('closes both presses in the box the one way, and neither drops the focus standing on it', () => {
		// a write in flight closes the box; the copy control keeps its focus by closing with
		// `aria-disabled` and turning the press away itself, and a reveal closed natively beside it
		// would drop a reader on `<body>` and draw a second closed look in the same cluster.
		const root = render(Field, {
			id: 'zapier-key',
			label: 'Your authentication key',
			masked: true,
			copyable: true,
			copyLabel: 'Copy key',
			readOnly: true,
			disabled: true,
			value: 'bgz_key'
		});
		const [copy, eye] = [
			...root.querySelectorAll<HTMLButtonElement>('.adm-maskwrap__presses button')
		];
		if (copy === undefined || eye === undefined) throw new Error('the box drew no two presses');

		for (const control of [copy, eye]) {
			expect(control.getAttribute('aria-disabled')).toBe('true');
			expect(control.hasAttribute('disabled')).toBe(false);
		}
		expect(closedRungOf(eye)).not.toBeNull();
		expect(closedRungOf(copy)).toBe(closedRungOf(eye));

		eye.focus();
		press(eye);
		expect(root.querySelector('input')?.getAttribute('type')).toBe('password');
		expect(document.activeElement).toBe(eye);
	});

	it('shows the value when the clipboard refuses it, so it can be taken by hand', async () => {
		// a refused copy over dots is a dead end: nothing on the screen can be selected until the
		// value is shown, and the operator came to take it.
		const writeText = vi.fn(() => Promise.reject(new Error('permission refused')));
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const root = render(Field, {
			id: 'zapier-key',
			label: 'Your authentication key',
			masked: true,
			copyable: true,
			copyLabel: 'Copy key',
			readOnly: true,
			value: 'bgz_key'
		});
		const copy = root.querySelector<HTMLButtonElement>('.adm-maskwrap__presses button');
		if (copy === null) throw new Error('the box drew no copy control');

		await act(async () => {
			copy.click();
			for (let tick = 0; tick < 10; tick++) await Promise.resolve();
		});

		expect(root.querySelector('input')?.getAttribute('type')).toBe('text');
		expect(reveal(root).getAttribute('aria-label')).toBe('Hide the value');
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
		const column = [...(items[0]?.children ?? [])];

		expect(items.map((item) => item.className)).toEqual(['adm-field__boxcol', 'adm-btn']);
		expect(column.map((item) => item.className)).toEqual(['adm-maskwrap']);
		expect(column[0]?.contains(reveal(root))).toBe(true);
		expect(column[0]?.querySelector('input')).not.toBeNull();
	});

	it('puts the refusal directly under the box where a press shares its row', () => {
		// the row wraps at the floor, so a message after the whole row lands under the press once it
		// has. the box's own column is what keeps the two together at every width; nothing lays out
		// in this pool, so what is read is the order the column holds, which is the order it draws.
		const root = render(Field, {
			id: 'api-key-make-name',
			label: 'Name',
			error: 'required',
			needed: 'wanted by the Zapier page',
			beside: (
				<button type="submit" className="adm-btn adm-btn--primary">
					Make key
				</button>
			)
		});
		const row = root.querySelector('.adm-field > .adm-actions');
		const column = row?.querySelector(':scope > .adm-field__boxcol');

		expect([...(row?.children ?? [])].at(-1)?.textContent).toBe('Make key');
		expect(
			[...(column?.children ?? [])].map((item) => `${item.tagName}.${item.className}`)
		).toEqual(['INPUT.adm-input adm-input--invalid', 'P.adm-field__error', 'P.adm-field__needed']);
		expect(root.querySelector('input')?.getAttribute('aria-describedby')).toBe(
			'api-key-make-name-err api-key-make-name-need'
		);
	});

	it('keeps the box in the same place when its refusal arrives, so it is not remounted', () => {
		// the box is focused by the press that was refused; a box that moved into a new parent with
		// its message would be a new element, with the value and the focus gone.
		const field = mount<ComponentProps<typeof Field>>(Field, {
			id: 'api-key-make-name',
			label: 'Name',
			beside: <button type="submit">Make key</button>
		});
		const before = field.root.querySelector('input');

		field.again({
			id: 'api-key-make-name',
			label: 'Name',
			error: 'required',
			beside: <button type="submit">Make key</button>
		});

		expect(field.root.querySelector('input')).toBe(before);
	});
});

describe('a field that reports what was found about its value', () => {
	it('stands its status region under the box before it has anything to say', () => {
		// a region that arrives holding its words is an insertion rather than a change, and a reader
		// may be told nothing — so it is there, empty, before the lookup answers.
		const root = render(Field, { id: 'org-tax_id', label: 'EIN', status: '' });
		const region = root.querySelector('[role="status"]');

		expect(region?.textContent).toBe('');
		expect(describedBy(root)).toEqual([]);
	});

	it('says the fact in that same region and points the box at it', () => {
		const root = render(Field, {
			id: 'org-tax_id',
			label: 'EIN',
			status: 'Not on the IRS list.'
		});

		expect(root.querySelector('[role="status"]')?.textContent).toBe('Not on the IRS list.');
		expect(describedBy(root)).toEqual(['org-tax_id-status']);
	});

	it('tells a reader alone what the caller says beside the fact, in the same region', () => {
		// a lookup that filled other boxes: news to someone whose cursor never moved, and a sentence
		// the screen does not draw.
		const root = render(Field, {
			id: 'org-tax_id',
			label: 'EIN',
			status: 'Not on the IRS list.',
			statusSaid: 'Filled from the IRS list.'
		});
		const region = root.querySelector('[role="status"]');

		expect(region?.textContent).toBe('Filled from the IRS list.Not on the IRS list.');
		expect(region?.querySelector('.adm-vh')?.textContent).toBe('Filled from the IRS list.');
	});

	it('draws no mark where the region holds only what a reader is told', () => {
		const root = render(Field, {
			id: 'org-tax_id',
			label: 'EIN',
			status: '',
			statusSaid: 'Filled from the IRS list.'
		});
		const region = root.querySelector('[role="status"]');

		expect(region?.textContent).toBe('Filled from the IRS list.');
		expect(region?.querySelector('svg')).toBeNull();
	});

	it('draws no region where the caller has nothing to report', () => {
		const root = render(Field, { id: 'org-legal_name', label: 'Registered name' });

		expect(root.querySelector('[role="status"]')).toBeNull();
	});

	it('leaves the box unmarked, since a fact about the value is not a refusal of it', () => {
		const root = render(Field, { id: 'org-tax_id', label: 'EIN', status: 'Not on the IRS list.' });

		expect(root.querySelector('input')?.getAttribute('aria-invalid')).toBeNull();
		expect(boxClasses(root)).not.toContain('adm-input--needed');
	});
});
