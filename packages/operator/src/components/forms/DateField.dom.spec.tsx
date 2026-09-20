import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '../render.testing';
import { DateField } from './DateField.jsx';

// the box whose label stands inside it. what is asserted here is everything about it that is not
// appearance: which element the label names, when the label is floated, what a chunk will take and
// — the whole reason the component exists in the shape it does — that what the browser would
// submit is `YYYY-MM-DD` and never what is standing in the chunks.
//
// nothing here reads a measurement or a computed style. no stylesheet is loaded in this pool and
// nothing lays out in it (../render.testing.tsx), so the float is read off the attribute the sheet
// itself reads — `data-floated` on the box — rather than off where the label ended up.
//
// a component spec is `.tsx` for ./Field.dom.spec.tsx's reason: a part's props are react nodes, and
// jsx is not legal in a `.ts` file.

/**
 * the chunks a day is written into, as the group holding them.
 *
 * found by the machine's own part rather than by "the input that is not hidden", because the box
 * carrying the value is a real text box too — it is off the screen by class and not by type, so
 * that a refusal can focus it.
 */
function box(root: HTMLElement): HTMLElement {
	const group = root.querySelector<HTMLElement>('[data-part="segment-group"]');
	if (group === null) throw new Error('the field drew no chunks');
	return group;
}

/** the chunks a caret can land in, in the order they are drawn: the separators are not among them. */
function chunks(root: HTMLElement): HTMLElement[] {
	return [...box(root).querySelectorAll<HTMLElement>('[data-part="segment"][tabindex]')];
}

/** what each chunk of the box is showing, separators included, as one string. */
const written = (root: HTMLElement) =>
	[...box(root).querySelectorAll('[data-part="segment"]')]
		.map((chunk) => chunk.textContent)
		.join('');

/** the control the browser submits under `name`, which is never a chunk above. */
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

/**
 * moves the caret into an element, or out of it, with the redraw finished.
 *
 * awaited for `flushed`'s reason: the machine reports the box gained or lost the caret a tick after
 * the platform moved it, and the float is drawn from that report.
 */
async function caret(element: HTMLElement, into: boolean): Promise<void> {
	await act(async () => {
		if (into) element.focus();
		else element.blur();
	});
	await flushed();
}

/**
 * lets the machines finish, with the redraw that follows finished too.
 *
 * the parts they draw out of a state change do not all land on the turn the press was made on —
 * opening the calendar and stepping the caret on to the next chunk both finish a tick later — so a
 * case that read the markup on the next line would be reading the state before the one it is
 * about.
 */
const flushed = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

/**
 * lets the frame the picker hands focus back on run.
 *
 * `focusTriggerElement` in @zag-js/date-picker's machine defers into a `raf`, so the element holding
 * the caret on the turn a calendar closes is still the one that was in it.
 */
const painted = () =>
	act(async () => {
		await new Promise((resolve) => {
			requestAnimationFrame(() => resolve(undefined));
		});
	});

/**
 * one keystroke into whichever chunk holds the caret, as the browser delivers one.
 *
 * a chunk is a `contenteditable` span and what it reads is the text the platform is about to insert
 * into it, which react hands a component as `onBeforeInput` and dispatches from `textInput`
 * (`BeforeInputEventPlugin` in react-dom). the machine is what decides whether the character
 * belongs in the chunk at all, so a case types a letter the same way it types a digit.
 */
async function key(text: string): Promise<void> {
	const at = document.activeElement;
	if (at === null) throw new Error('nothing is holding the caret');
	await act(async () => {
		at.dispatchEvent(
			new InputEvent('textInput', {
				data: text,
				inputType: 'insertText',
				bubbles: true,
				cancelable: true
			})
		);
	});
	await flushed();
}

/** writes a run of characters from the chunk the caret is in, one keystroke at a time. */
async function type(text: string): Promise<void> {
	for (const character of text) await key(character);
}

/** the key a chunk is sent, as the browser sends one. */
async function pressKey(element: HTMLElement, name: string): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
		);
	});
	await flushed();
}

describe('a date field mounted into a document', () => {
	it('names the box the operator types in, with a real label', () => {
		// the whole point of a floating label: it is a label that moved, not a placeholder that
		// stayed. so it is an element with a `for`, and what it points at is the control this field
		// submits through — which is the one element of the two a `for` can name, and the one that
		// hands the caret straight on to the chunks. the chunks themselves are named by it too,
		// through the group they stand in.
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });
		const label = root.querySelector('label');

		expect(label?.getAttribute('for')).toBe('range-from');
		expect(carrier(root, 'from').id).toBe('range-from');
		expect(box(root).getAttribute('aria-labelledby')).toBe(label?.id);
		expect(label?.textContent).toBe('From');
	});

	it('draws the day in the chunks the pinned locale orders, and in no other order', async () => {
		// the locale is what decides which chunk comes first, and `en-CA` is pinned for that: the
		// chunks read in the order the day is submitted in, so nobody has to work out whether the
		// first box is the month or the day.
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });

		expect(written(root)).toBe('yyyy-mm-dd');
		expect(chunks(root).map((chunk) => chunk.getAttribute('data-type'))).toEqual([
			'year',
			'month',
			'day'
		]);

		await caret(chunks(root)[0] as HTMLElement, true);
		await type('20260115');
		expect(written(root)).toBe('2026-01-15');
	});

	it('takes a digit in a chunk and refuses anything else', async () => {
		// the whole of what the chunks are for: a day that is not a day cannot be written, so nobody
		// finds out on a press that what they typed was never read.
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });

		await caret(chunks(root)[0] as HTMLElement, true);
		await type('abc/');
		expect(written(root)).toBe('yyyy-mm-dd');

		await type('2026');
		expect(written(root)).toBe('2026-mm-dd');
	});

	it('moves the caret between the chunks and steps the day inside one', async () => {
		// two movements and they are different things: left and right change which chunk the caret
		// is in, and up and down change what is in it.
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });
		const [year, month, day] = chunks(root) as [HTMLElement, HTMLElement, HTMLElement];

		await caret(year, true);
		await pressKey(year, 'ArrowRight');
		expect(document.activeElement).toBe(month);

		await pressKey(month, 'ArrowUp');
		expect(written(root)).not.toBe('yyyy-mm-dd');

		await pressKey(month, 'ArrowRight');
		expect(document.activeElement).toBe(day);
		await pressKey(day, 'ArrowLeft');
		expect(document.activeElement).toBe(month);
	});

	it('steps the caret on to the next chunk as one fills, and back on a rubbed-out one', async () => {
		// a day is eight keystrokes and no separators: the caret goes where the next digit belongs
		// rather than waiting to be moved, which is what makes the chunks quicker than the run of
		// text they replaced.
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });
		const [year, month, day] = chunks(root) as [HTMLElement, HTMLElement, HTMLElement];

		await caret(year, true);
		await type('2026');
		expect(document.activeElement).toBe(month);
		await type('01');
		expect(document.activeElement).toBe(day);

		await pressKey(day, 'Backspace');
		expect(written(root)).toBe('2026-01-dd');
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
		expect(written(root)).toBe('2026-01-15');
	});

	it('rests the label on an empty box and floats it only while the caret is in it', async () => {
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });

		expect(floated(root)).toBe(false);

		await caret(chunks(root)[0] as HTMLElement, true);
		expect(floated(root)).toBe(true);

		await caret(chunks(root)[0] as HTMLElement, false);
		expect(floated(root)).toBe(false);
	});

	it('keeps the label out of the way while the caret walks from one chunk to the next', async () => {
		// the caret leaving the year for the month never leaves the box, so the label rising and
		// falling between the two would be a word flickering while somebody writes a date.
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });
		const [year, month] = chunks(root) as [HTMLElement, HTMLElement];

		await caret(year, true);
		await pressKey(year, 'ArrowRight');

		expect(document.activeElement).toBe(month);
		expect(floated(root)).toBe(true);
	});

	it('submits the day as YYYY-MM-DD and never the text in the box', async () => {
		// the two readers outside this package compare that text: `reversedRangeRule` in
		// packages/app/src/routes/_app.admin.donations.export.tsx orders a range lexically, and
		// `readJournalRange` in packages/app/src/lib/ledger/journal-range.ts reads it off an address.
		const root = render(DateField, { id: 'range-from', name: 'from', label: 'From' });

		await caret(chunks(root)[0] as HTMLElement, true);
		await type('202601');
		// nothing is submitted while a chunk is still unwritten: half a date is not a day, and the
		// box holding one carries nothing at all.
		expect(written(root)).toBe('2026-01-dd');
		expect(submitted(root, 'from')).toBe('');

		await type('15');
		expect(submitted(root, 'from')).toBe('2026-01-15');
	});

	it('hands a refusal’s focus from the control carrying the name to the box that is typed in', async () => {
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

		await act(async () => {
			carrier(root, 'from').focus();
		});
		await flushed();

		// the first chunk a day is written into, which is where somebody correcting it starts.
		expect(document.activeElement).toBe(chunks(root)[0]);
		// and the field says so, because the caret really is in the box now.
		expect(floated(root)).toBe(true);
	});

	it('keeps the control carrying the name out of the tab order and out of the tree', () => {
		// one stop per chunk and one control per date box: the carrier is off the screen by class
		// rather than by type, which is what makes it focusable at all, so these two are the whole of
		// what stops it being a second box on the form.
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
		for (const chunk of chunks(root)) expect(chunk.getAttribute('name')).toBeNull();
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

		act(() => (document.activeElement as HTMLElement | null)?.blur());
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

		// the day picked on the grid is the day standing in the chunks: one value, two machines.
		expect(submitted(root, 'from')).toBe('2026-01-22');
		expect(written(root)).toBe('2026-01-22');
	});

	it('hands the caret back to the press when Escape dismisses the calendar', async () => {
		// the panel's open state is the machine's here rather than this component's, which is what
		// makes the escape branch that reaches a press the one that runs: ./DateRangeField.jsx holds
		// its own open state for two ends over one calendar and takes the branch that does not, so
		// this case is what says the two compositions differ and the single box needs nothing.
		const root = render(DateField, {
			id: 'given',
			name: 'given',
			label: 'Given',
			defaultValue: '2026-01-15'
		});

		press(opener(root));
		await flushed();

		await act(async () => {
			document.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
			);
		});
		await flushed();
		await painted();

		expect(root.querySelector('[data-part="content"]')?.getAttribute('data-state')).toBe('closed');
		expect(document.activeElement).toBe(opener(root));
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
		// no chunk is a tab stop, which is what a box that cannot be written in is: the machine
		// withholds the stop rather than the component drawing a second kind of chunk.
		expect(chunks(root)).toHaveLength(0);
		expect(root.querySelector('.adm-datebox')?.hasAttribute('data-disabled')).toBe(true);
		expect(box(root).hasAttribute('data-disabled')).toBe(true);
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
		expect(written(root)).toBe('yyyy-mm-dd');
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

	it('pins the ring and the chunk under it together, for a specimen that cannot hold a caret', () => {
		// packages/gallery draws every state nobody opens, and focus is one no page can put on an
		// element. the box's pinned state reaches the chunk the caret would really be in, so the
		// specimen shows the ring and the highlight together rather than half of the state.
		const root = render(DateField, {
			id: 'range-from',
			name: 'from',
			label: 'From',
			state: 'focus'
		});

		expect(root.querySelector('.adm-datebox')?.classList.contains('is-focus')).toBe(true);
		expect(chunks(root).map((chunk) => chunk.classList.contains('is-focus'))).toEqual([
			true,
			false,
			false
		]);
	});
});
