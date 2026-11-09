import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ComponentProps, act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { stripComments } from '../../styles/raw-values';
import { rulesIn, sheet } from '../../styles/sheet-rule.testing';
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

		// the registry's field-css draws the refused edge off this selector and nothing else.
		expect(root.querySelector('input')?.matches(".ds-field-input[aria-invalid='true']")).toBe(true);
	});

	it('draws a box refused by its own message as refused, with nothing said from outside', () => {
		const root = render(Field, {
			id: 'org-name',
			label: 'Registered name',
			error: 'Give it a name.'
		});

		expect(root.querySelector('input')?.matches(".ds-field-input[aria-invalid='true']")).toBe(true);
	});

	it('adds a caller’s class to its own rather than standing in for them', () => {
		const root = render(Field, {
			id: 'tax-id',
			label: 'EIN',
			className: 'adm-num'
		});

		expect(boxClasses(root)).toContain('adm-num');
		expect(boxClasses(root)).toContain('ds-field-input');
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
		// the whole of the reveal: the value is in the box either way — a box may be seeded with what
		// the deployment is holding — and what the press changes is whether it is legible to
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
			'ds-field-input adm-field__box adm-field__box--code'
		);
		expect(masked.querySelector('.adm-field')?.children[1]?.className).toBe('adm-maskwrap');
		expect(masked.querySelector('.adm-maskwrap > input')?.className).toBe(
			'ds-field-input adm-field__box adm-field__box--code'
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
				<button type="button" className="ds-btn ds-btn-secondary adm-btn">
					Send test email
				</button>
			)
		});
		const row = root.querySelector('.adm-actions');
		const items = [...(row?.children ?? [])];
		const column = [...(items[0]?.children ?? [])];

		expect(items.map((item) => item.className)).toEqual([
			'adm-field__boxcol',
			'ds-btn ds-btn-secondary adm-btn'
		]);
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
				<button type="submit" className="ds-btn ds-btn-primary adm-btn">
					Make key
				</button>
			)
		});
		const row = root.querySelector('.adm-field > .adm-actions');
		const column = row?.querySelector(':scope > .adm-field__boxcol');

		expect([...(row?.children ?? [])].at(-1)?.textContent).toBe('Make key');
		expect(
			[...(column?.children ?? [])].map((item) => `${item.tagName}.${item.className}`)
		).toEqual([
			'INPUT.ds-field-input adm-field__box',
			'P.ds-field-err adm-field__error',
			'P.adm-field__needed'
		]);
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

describe('what a box is described by', () => {
	it('takes in the blocks a caller draws after its own, in the order each is drawn', () => {
		// a pair's refusal is drawn by the group, once, and the box still has its own hint and its own
		// refusal to be read beside it: a caller's ids standing in for the field's would drop both.
		const root = render(Field, {
			id: 'min-minor',
			label: 'Smallest gift',
			hint: 'In dollars.',
			error: 'Write a number.',
			needed: 'The form shows this first.',
			'aria-describedby': 'pair-err pair-note'
		});

		expect(describedBy(root)).toEqual([
			'min-minor-hint',
			'min-minor-err',
			'min-minor-need',
			'pair-err',
			'pair-note'
		]);
	});

	it('names an id once, where it first stands', () => {
		const root = render(Field, {
			id: 'min-minor',
			label: 'Smallest gift',
			error: 'Write a number.',
			'aria-describedby': 'min-minor-err pair-err'
		});

		expect(describedBy(root)).toEqual(['min-minor-err', 'pair-err']);
	});

	it('reads a caller’s explicit undefined as nothing said, and keeps its own', () => {
		// a caller composing a list that came out empty hands `undefined` with the key present; the
		// field's own blocks still describe the box.
		const root = render(Field, {
			id: 'org-name',
			label: 'Registered name',
			hint: 'As the IRS has it.',
			'aria-describedby': undefined
		});

		expect(describedBy(root)).toEqual(['org-name-hint']);
	});

	it('describes the box by its lead’s words first, drawn once, inside the mark out of the tree', () => {
		const root = render(Field, {
			id: 'link-0',
			'aria-label': 'Link 1',
			hint: 'An address on the network.',
			lead: { mark: <img className="led" alt="" />, said: 'Riverbank' },
			'aria-describedby': 'links-err'
		});
		const slot = root.querySelector('.adm-leadwrap > .adm-leadwrap__lead');
		const words = root.querySelector('#link-0-lead');

		expect(describedBy(root)).toEqual(['link-0-lead', 'link-0-hint', 'links-err']);
		expect(words?.textContent).toBe('Riverbank');
		// inside the hidden mark, so browse mode does not read it as loose text before the box reads
		// it again; a description still reads hidden words it names directly
		// (https://www.w3.org/TR/accname-1.2/, step 2A).
		expect(slot?.getAttribute('aria-hidden')).toBe('true');
		expect(slot?.contains(words)).toBe(true);
		expect(words instanceof HTMLElement && words.hidden).toBe(true);
	});

	it('names no words for a lead that states none', () => {
		const root = render(Field, {
			id: 'link-0',
			'aria-label': 'Link 1',
			lead: { mark: <img className="led" alt="" /> }
		});

		expect(root.querySelector('img.led')).not.toBeNull();
		expect(root.querySelector('#link-0-lead')).toBeNull();
		expect(describedBy(root)).toEqual([]);
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
		expect(boxClasses(root)).not.toContain('adm-field__box--needed');
	});
});

describe('the registry field a box is drawn as', () => {
	const parts = (root: HTMLElement) =>
		[...(root.querySelector('.adm-field')?.children ?? [])].map(
			(part) => `${part.tagName}.${part.className}`
		);

	it('dresses the label, the sentence, the box and the refusal from field-css', () => {
		// ../../registry/styles/field-css.css draws each of these; the `adm-*` beside the sentence,
		// the box and the refusal is ../../styles/adm.css's row for it in the field's grid.
		const root = render(Field, {
			id: 'org-name',
			label: 'Registered name',
			hint: 'As it reads on your registration.',
			error: 'Give it a name.'
		});

		expect(parts(root)).toEqual([
			'LABEL.ds-label',
			'P.ds-field-hint adm-hint',
			'INPUT.ds-field-input adm-field__box',
			'P.ds-field-err adm-field__error'
		]);
	});

	it('keeps “(optional)” inside the label, where it is part of the name a reader is told', () => {
		const root = render(Field, { id: 'org-phone', label: 'Phone', optional: true });

		expect(root.querySelector('label')?.textContent).toBe('Phone (optional)');
	});

	it('marks a multi-line box and a needed box with the two finishes the registry has no rule for', () => {
		const textarea = render(Field, { id: 'thanks', label: 'Thank-you message', as: 'textarea' });
		const needed = render(Field, { id: 'to', label: 'To', needed: 'Type an address.' });

		expect([boxClasses(textarea), boxClasses(needed)]).toEqual([
			['ds-field-input', 'adm-field__box', 'adm-field__box--multiline'],
			['ds-field-input', 'adm-field__box', 'adm-field__box--needed']
		]);
	});

	it('draws a refused box as refused and not as needed, since the refusal is the louder', () => {
		const root = render(Field, {
			id: 'to',
			label: 'To',
			error: 'That is not an address.',
			needed: 'Type an address.'
		});

		expect(boxClasses(root)).toEqual(['ds-field-input', 'adm-field__box']);
	});
});

describe('a read-only box', () => {
	// every sheet a box in /admin is drawn by: this package's three and the registry's field, which
	// is where `pointer-events: none` on `[readonly]` lives. resolved through `fileURLToPath`, which
	// ../../styles/field-on-a-tight-stack.dom.spec.tsx argues.
	const registry = stripComments(
		readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), '../../registry/styles/field-css.css'),
			'utf8'
		)
	);
	const rules = [sheet('adm.css'), sheet('base.css'), sheet('tokens.css'), registry].flatMap(
		(css) => rulesIn(css)
	);

	/**
	 * every `pointer-events` a sheet states on the box or on anything around it — the property
	 * inherits, so a wrapper's `none` is the box's too. a member is matched with its pointer and
	 * focus states taken off, since a pointer is what arrives at the box; a member of a pseudo-element
	 * is not the box and is left out.
	 */
	const pointerEventsOn = (box: Element) => {
		const said: string[] = [];
		for (const { selector, stated } of rules) {
			const value = stated.get('pointer-events');
			if (value === undefined) continue;
			for (const member of selector.split(', ')) {
				if (member.includes('::') || member.startsWith('@')) continue;
				const resting = member.replace(/:(hover|active|focus-visible|focus-within|focus)\b/g, '');
				for (let at: Element | null = box; at !== null; at = at.parentElement) {
					if (at.matches(resting)) said.push(`${member} { pointer-events: ${value} }`);
				}
			}
		}
		return said;
	};

	const READ_ONLY: [string, ComponentProps<typeof Field>][] = [
		// the Zapier key and a locked row: a plain read-only box, the key in the mono face.
		[
			'a plain one',
			{ id: 'zapier-key', label: 'Zapier key', code: true, readOnly: true, value: 'zk_••••1234' }
		],
		// the webhook's signing secret: masked, with the copy and the reveal inside the box.
		[
			'a masked one with its presses',
			{
				id: 'signing-secret',
				label: 'Signing secret',
				code: true,
				masked: true,
				copyable: true,
				readOnly: true,
				value: 'whsec_riverbank'
			}
		],
		[
			'a refused one',
			{
				id: 'zapier-key',
				label: 'Zapier key',
				readOnly: true,
				value: '',
				error: 'Make a key first.'
			}
		]
	];

	it.each(READ_ONLY)('%s wears no registry box', (_, props) => {
		const classes = boxClasses(render(Field, props));

		expect(classes).toContain('adm-input');
		expect(classes.filter((name) => name.startsWith('ds-'))).toEqual([]);
	});

	it.each(READ_ONLY)(
		'%s takes a press, a drag and a finger: no sheet stops its pointer',
		(_, props) => {
			const box = render(Field, props).querySelector('input');
			if (box === null) throw new Error('the field drew no box');

			expect(box.readOnly).toBe(true);
			expect(pointerEventsOn(box).filter((said) => said.endsWith('none }'))).toEqual([]);
		}
	);

	it('is refused on its own box, off the message it holds', () => {
		const root = render(Field, {
			id: 'zapier-key',
			label: 'Zapier key',
			readOnly: true,
			value: '',
			error: 'Make a key first.'
		});

		expect(boxClasses(root)).toEqual(['adm-input', 'adm-input--invalid']);
	});

	// registry 2.2.0 dropped `pointer-events: none` from `.ds-field-input[readonly]` (the box now
	// keeps its text cursor and can be selected), so the registry's own box passes the same check
	// the boxes above do. a registry that put the rule back fails here and in the cases above.
	it('takes a press on the registry box too', () => {
		const box = render(Field, {
			id: 'zapier-key',
			label: 'Zapier key',
			readOnly: true
		}).querySelector('input');
		if (box === null) throw new Error('the field drew no box');
		box.classList.add('ds-field-input');

		expect(pointerEventsOn(box).filter((said) => said.endsWith('none }'))).toEqual([]);
	});
});
