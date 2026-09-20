import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { DateField } from './DateField.jsx';

// the box whose label stands inside it. what is asserted here is everything about it that is not
// appearance: which element the label names, when the label is floated, and — the whole reason the
// component exists in the shape it does — that what the browser would submit is `YYYY-MM-DD` and
// never the text in the box the operator types in.
//
// nothing here reads a measurement or a computed style. no stylesheet is loaded in this pool and
// nothing lays out in it (../render.testing.tsx), so the float is read off the attribute the sheet
// itself reads — `data-floated` on the box — rather than off where the label ended up.
//
// a component spec is `.tsx` for ./Field.dom.spec.tsx's reason: a part's props are react nodes, and
// jsx is not legal in a `.ts` file.

/**
 * the box the operator types in: the machine's own input, which is the one the label names.
 *
 * found by the machine's own part rather than by "the input that is not hidden", because the box
 * carrying the value is a real text box too — it is off the screen by class and not by type, so
 * that a refusal can focus it. a case reading the first input would be reading whichever of the two
 * happens to be drawn first.
 */
function box(root: HTMLElement): HTMLInputElement {
	const input = root.querySelector<HTMLInputElement>('input[data-part="input"]');
	if (input === null) throw new Error('the field drew no box');
	return input;
}

/** the control the browser submits under `name`, which is never the box above. */
function carrier(root: HTMLElement, name: string): HTMLInputElement {
	const found = root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
	if (found === null) throw new Error(`nothing on the field carries the name ${name}`);
	return found;
}

/** what the browser would submit under `name`. */
const submitted = (root: HTMLElement, name: string) => carrier(root, name).value;

/** whether the label is standing over the box rather than resting on its line. */
const floated = (root: HTMLElement) =>
	root.querySelector('.adm-datebox')?.hasAttribute('data-floated') ?? false;

/** the ids the box's description names, in the order it names them. */
function describedBy(root: HTMLElement): string[] {
	const tokens = box(root).getAttribute('aria-describedby');
	return tokens === null || tokens === '' ? [] : tokens.split(' ');
}

/** the press that opens the calendar, found by what it is about rather than by its position. */
function opener(root: HTMLElement): HTMLButtonElement {
	const button = root.querySelector<HTMLButtonElement>('[data-part="trigger"]');
	if (button === null) throw new Error('the field drew no calendar press');
	return button;
}

/** clicks, with the redraw finished by the time the call returns. */
function press(element: Element): void {
	act(() => {
		(element as HTMLElement).click();
	});
}

/** moves the caret into the box, or out of it, with the redraw finished. */
function caret(input: HTMLInputElement, into: boolean): void {
	act(() => {
		if (into) input.focus();
		else input.blur();
	});
}

/**
 * lets the machine finish, with the redraw that follows it finished too.
 *
 * the parts the machine draws out of a state change do not all land on the turn the press was made
 * on — opening the calendar and settling what was typed into a day both finish a tick later — so a
 * case that read the markup on the next line would be reading the state before the one it is
 * about. it is awaited only by the cases that move the machine; the float and the describing blocks
 * above are this component's own state and are drawn on the press.
 */
const flushed = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

describe('a date field mounted into a document', () => {
	it('names the box the operator types in, with a real label', () => {
		// the whole point of a floating label: it is a label that moved, not a placeholder that
		// stayed. so it is an element with a `for`, and what it points at is the box the caret goes
		// into — never the wrapper around it and never the hidden box carrying the value.
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });
		const label = root.querySelector('label');

		expect(label?.getAttribute('for')).toBe('range-from');
		expect(box(root).getAttribute('id')).toBe('range-from');
		expect(label?.textContent).toBe('From');
	});

	it('floats the label at the first render of a box that came seeded', () => {
		// a box holding a day has that day where the resting label would be, so the label is already
		// out of the way on the paint the operator first sees. nothing animates on arrival: a
		// transition runs on a change and this is the initial value.
		const root = render(DateField, {
			id: 'range-from',
			name: 'from',
			label: 'From',
			defaultValue: '2026-01-15'
		});

		expect(floated(root)).toBe(true);
	});

	it('rests the label on an empty box and floats it only while the caret is in it', () => {
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });

		expect(floated(root)).toBe(false);

		caret(box(root), true);
		expect(floated(root)).toBe(true);

		caret(box(root), false);
		expect(floated(root)).toBe(false);
	});

	it('submits the day as YYYY-MM-DD and never the text in the box', async () => {
		// the two readers outside this package compare that text: `reversedRangeRule` in
		// packages/app/src/routes/_app.admin.donations.export.tsx orders a range lexically, and
		// `readJournalRange` in packages/app/src/lib/ledger/journal-range.ts reads it off an address.
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });
		const input = box(root);

		caret(input, true);
		act(() => {
			input.value = '2026-01-15';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await flushed();
		// nothing is submitted while a date is half typed: the value is settled as the caret leaves.
		expect(submitted(root, 'from')).toBe('');

		caret(input, false);
		await flushed();
		expect(submitted(root, 'from')).toBe('2026-01-15');
	});

	it('hands a refusal’s focus from the control carrying the name to the box that is typed in', () => {
		// how conform reports: it walks `form.elements` for the name it holds an error for and calls
		// `focus()` on what it finds (`report` in @conform-to/dom's form.js). what it finds here is
		// the control carrying the value, and a `type="hidden"` one cannot take focus — so the caret
		// would stay at the press and nobody would be told which box was refused.
		const root = render(DateField, {
			id: 'range-from',
			name: 'from',
			label: 'From',
			error: 'That day is before the books begin.'
		});

		act(() => {
			carrier(root, 'from').focus();
		});

		expect(document.activeElement).toBe(box(root));
		// and the field says so, because the caret really is in the box now.
		expect(floated(root)).toBe(true);
	});

	it('keeps the control carrying the name out of the tab order and out of the tree', () => {
		// one stop and one control per date box: the carrier is off the screen by class rather than
		// by type, which is what makes it focusable at all, so these two are the whole of what stops
		// it being a second box on the form.
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });

		expect(carrier(root, 'from').getAttribute('tabindex')).toBe('-1');
		expect(carrier(root, 'from').getAttribute('aria-hidden')).toBe('true');
		expect(carrier(root, 'from').className).toBe('adm-vh');
		expect(carrier(root, 'from').readOnly).toBe(true);
	});

	it('carries the name on exactly one control, and it is not the box that is typed in', () => {
		// `elements.namedItem(name)` has to find one control, so the body carries one value — and a
		// browser submits what is in a box at the moment of the press, which halfway through typing
		// is half a date.
		const root = render(DateField, {
			id: 'range-from',
			name: 'from',
			label: 'From',
			defaultValue: '2026-01-15'
		});

		expect(root.querySelectorAll('[name="from"]')).toHaveLength(1);
		expect(box(root).getAttribute('name')).toBeNull();
	});

	it('announces the refusal, marks the box and names the message it is refused by', () => {
		const root = render(DateField, {
			id: 'range-from',
			name: 'from',
			label: 'From',
			error: 'Give a day this deployment has books for.'
		});

		expect(root.querySelector('#range-from-err')?.getAttribute('role')).toBe('alert');
		expect(box(root).getAttribute('aria-invalid')).toBe('true');
		expect(describedBy(root)).toContain('range-from-err');
		expect(root.querySelector('.adm-datebox')?.hasAttribute('data-invalid')).toBe(true);
	});

	it('draws a box refused from outside itself as refused, with no message of its own', () => {
		// the paired case: a rule about two boxes belongs to neither, so the fieldset draws the one
		// message and marks both boxes from out here.
		const root = render(DateField, {
			id: 'range-to',
			name: 'to',
			label: 'To',
			'aria-invalid': 'true'
		});

		expect(box(root).getAttribute('aria-invalid')).toBe('true');
		expect(root.querySelector('.adm-datebox')?.hasAttribute('data-invalid')).toBe(true);
		expect(root.querySelector('.adm-field__error')).toBeNull();
	});

	it('names the hint and the standing sentence in the order ./Field.jsx joins them', () => {
		const root = render(DateField, {
			id: 'range-from',
			name: 'from',
			label: 'From',
			hint: 'The first day the export covers.',
			needed: 'A journal cannot be downloaded until both ends are set.'
		});

		expect(describedBy(root)).toEqual(['range-from-hint', 'range-from-need']);
		expect(root.querySelector('#range-from-hint')?.textContent).toBe(
			'The first day the export covers.'
		);
		expect(root.querySelector('#range-from-need')?.textContent).toBe(
			'A journal cannot be downloaded until both ends are set.'
		);
	});

	it('opens the calendar from a press the keyboard can reach, and a day chosen is submitted', async () => {
		// the press is a real `<button>` in the tab order, which is the whole of what makes Enter
		// and Space open the calendar — the product does that for a button and nothing here has to.
		// what this pool cannot do is dispatch the key itself, so what is asserted is the element
		// the product would act on and the outcome of activating it.
		const root = render(DateField, {
			id: 'range-from',
			name: 'from',
			label: 'From',
			defaultValue: '2026-01-15'
		});

		expect(opener(root).tagName).toBe('BUTTON');
		expect(opener(root).getAttribute('type')).toBe('button');
		expect(opener(root).getAttribute('tabindex')).toBeNull();

		press(opener(root));
		await flushed();
		expect(root.querySelector('[data-part="content"]')?.getAttribute('data-state')).toBe('open');

		const day = root.querySelector('[data-part="table-cell-trigger"][data-value="2026-01-22"]');
		if (day === null) throw new Error('the open calendar drew no 22nd of January');
		press(day);
		await flushed();

		expect(submitted(root, 'from')).toBe('2026-01-22');
	});

	it('exposes no operable calendar press on a box that cannot be answered', () => {
		// a box an operator cannot answer sends nothing, and the press beside it promises a choice
		// that would go nowhere.
		const root = render(DateField, {
			id: 'range-from',
			name: 'from',
			label: 'From',
			disabled: true,
			defaultValue: '2026-01-15'
		});

		expect(opener(root).disabled).toBe(true);
		expect(box(root).disabled).toBe(true);
		expect(root.querySelector<HTMLInputElement>('input[name="from"]')?.disabled).toBe(true);
	});

	it('opens empty on a seed that names no day, rather than holding something it cannot draw', () => {
		// the seed reaches this component off an address an operator can edit, so a string that is
		// not a day is a real arrival. the refusal the screen came back with says what was wrong;
		// the box is empty and ready to be typed into.
		const root = render(DateField, {
			id: 'range-from',
			name: 'from',
			label: 'From',
			defaultValue: 'last tuesday'
		});

		expect(submitted(root, 'from')).toBe('');
		expect(floated(root)).toBe(false);
	});

	it('adds a caller’s class to the box’s own rather than standing in for them', () => {
		const root = render(DateField, {
			id: 'range-from',
			name: 'from',
			label: 'From',
			className: 'adm-num'
		});
		const classes = (root.querySelector('.adm-datebox')?.getAttribute('class') ?? '').split(' ');

		expect(classes).toContain('adm-num');
		expect(classes).toContain('adm-datebox');
	});
});
