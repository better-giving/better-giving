import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { mount, render } from '../render.testing';
import { DateRangeField } from './DateRangeField.jsx';

// the two ends of one range over one calendar. what is asserted here is what two independent
// pickers could not do and what the one root must not lose: each end still names its own box, still
// submits under its own name, and still carries its own refusal — while the days themselves come
// out of a single pair of machines.
//
// nothing here reads a measurement or a computed style, for ./DateField.dom.spec.tsx's reason: no
// stylesheet is loaded in this pool and nothing lays out in it, so the float is read off
// `data-floated` on the box rather than off where the label ended up.

/** what the two ends are called on the wire, which is what packages/app/src/lib/ledger/journal-range.ts spells. */
const NEAR = 0;
const FAR = 1;

const ends = {
	from: { id: 'range-from', name: 'from', label: 'From' },
	to: { id: 'range-to', name: 'to', label: 'To' }
};

/** the chunks one end is written into, as the group holding them. */
function box(root: HTMLElement, index: number): HTMLElement {
	const group = root.querySelectorAll<HTMLElement>('[data-part="segment-group"]')[index];
	if (group === undefined) throw new Error(`the range drew no chunks at index ${index}`);
	return group;
}

/** the chunks of one end a caret can land in: the separators are not among them. */
function chunks(root: HTMLElement, index: number): HTMLElement[] {
	return [...box(root, index).querySelectorAll<HTMLElement>('[data-part="segment"][tabindex]')];
}

/** what one end's chunks are showing, separators included, as one string. */
const written = (root: HTMLElement, index: number) =>
	[...box(root, index).querySelectorAll('[data-part="segment"]')]
		.map((chunk) => chunk.textContent)
		.join('');

/** the control the browser submits under `name`, which is never a chunk above. */
function carrier(root: HTMLElement, name: string): HTMLInputElement {
	const found = root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
	if (found === null) throw new Error(`nothing on the range carries the name ${name}`);
	return found;
}

/** what the browser would submit under `name`. */
const submitted = (root: HTMLElement, name: string) => carrier(root, name).value;

/** whether one end's label is standing over its box rather than resting on its line. */
const floated = (root: HTMLElement, index: number) =>
	root.querySelectorAll('.adm-datebox')[index]?.hasAttribute('data-floated') ?? false;

/** the ids one end's box names in its description, in the order it names them. */
function describedBy(root: HTMLElement, index: number): string[] {
	const tokens = box(root, index).getAttribute('aria-describedby');
	return tokens === null || tokens === '' ? [] : tokens.split(' ');
}

/** the press at the end of one box, found by the machine's own part rather than by position. */
function opener(root: HTMLElement, index: number): HTMLButtonElement {
	const buttons = root.querySelectorAll<HTMLButtonElement>('[data-part="trigger"]');
	const button = buttons[index];
	if (button === undefined) throw new Error(`the range drew no calendar press at index ${index}`);
	return button;
}

/** the open calendar's cell for one day, or nothing where the visible month does not hold it. */
function cell(root: HTMLElement, value: string): Element {
	const found = root.querySelector(`[data-part="table-cell-trigger"][data-value="${value}"]`);
	if (found === null) throw new Error(`the open calendar drew no ${value}`);
	return found;
}

/** clicks, with the redraw finished by the time the call returns. */
function press(element: Element): void {
	act(() => {
		(element as HTMLElement).click();
	});
}

/**
 * lets the machines finish, with the redraw that follows them finished too.
 *
 * ./DateField.dom.spec.tsx's `flushed` argues it: the parts the machines draw out of a state change
 * do not all land on the turn the press was made on.
 */
const flushed = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

/**
 * lets the frame the picker hands focus back on run.
 *
 * `focusTriggerElement` in @zag-js/date-picker's machine defers into a `raf`, so the element
 * holding the caret on the turn a calendar closes is still the one that was in it.
 */
const painted = () =>
	act(async () => {
		await new Promise((resolve) => {
			requestAnimationFrame(() => resolve(undefined));
		});
	});

/** moves the caret into an element, or out of it, with the redraw and the report finished. */
async function caret(element: HTMLElement, into: boolean): Promise<void> {
	await act(async () => {
		if (into) element.focus();
		else element.blur();
	});
	await flushed();
}

/**
 * writes a day into one end, a keystroke at a time from its first chunk.
 *
 * the keystroke is the text the platform is about to insert into a `contenteditable` chunk, which
 * react hands a component as `onBeforeInput` — ./DateField.dom.spec.tsx's `key` argues it. the
 * caret steps on to the next chunk as each one fills, so eight digits fill three chunks.
 */
async function type(root: HTMLElement, index: number, text: string): Promise<void> {
	const first = chunks(root, index)[0];
	if (first === undefined) throw new Error(`the range drew no chunk to write in at index ${index}`);
	await caret(first, true);
	for (const character of text.replace(/-/g, '')) {
		const at = document.activeElement;
		if (at === null) throw new Error('nothing is holding the caret');
		await act(async () => {
			at.dispatchEvent(
				new InputEvent('textInput', {
					data: character,
					inputType: 'insertText',
					bubbles: true,
					cancelable: true
				})
			);
		});
		await flushed();
	}
}

describe('a date range mounted into a document', () => {
	it('draws two boxes, each named by a real label pointing at its own', () => {
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });
		const labels = root.querySelectorAll('label');

		expect(labels).toHaveLength(2);
		// the label points at the control that end submits through — the one element of the two a
		// `for` can name — and the chunks it stands over are named by it through their own group.
		expect(labels[0]?.getAttribute('for')).toBe('range-from');
		expect(labels[1]?.getAttribute('for')).toBe('range-to');
		expect(carrier(root, 'from').id).toBe('range-from');
		expect(carrier(root, 'to').id).toBe('range-to');
		expect(box(root, NEAR).getAttribute('aria-labelledby')).toBe(labels[0]?.id);
		expect(box(root, FAR).getAttribute('aria-labelledby')).toBe(labels[1]?.id);
		expect(labels[0]?.textContent).toBe('From');
		expect(labels[1]?.textContent).toBe('To');
	});

	it('carries each end’s name on exactly one control, and it is not a box that is typed in', () => {
		// `elements.namedItem(name)` has to find one control per end, so the body carries two values
		// — and a browser submits what is in a box at the moment of the press, which halfway through
		// typing is half a date.
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });

		expect(root.querySelectorAll('[name="from"]')).toHaveLength(1);
		expect(root.querySelectorAll('[name="to"]')).toHaveLength(1);
		for (const index of [NEAR, FAR])
			for (const chunk of chunks(root, index)) expect(chunk.getAttribute('name')).toBeNull();
	});

	it('draws each end’s day in the chunks the pinned locale orders', () => {
		// two boxes of three chunks each, in the order the day is submitted in, so nobody has to work
		// out whether the first chunk of an end is its month or its day.
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });

		expect(root.querySelectorAll('[data-part="segment-group"]')).toHaveLength(2);
		for (const index of [NEAR, FAR]) {
			expect(written(root, index)).toBe('yyyy-mm-dd');
			expect(chunks(root, index).map((chunk) => chunk.getAttribute('data-type'))).toEqual([
				'year',
				'month',
				'day'
			]);
		}
	});

	it('rests each label on its own empty box and floats it while that box holds the caret', async () => {
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });

		expect(floated(root, NEAR)).toBe(false);
		expect(floated(root, FAR)).toBe(false);

		await caret(chunks(root, FAR)[0] as HTMLElement, true);
		expect(floated(root, FAR)).toBe(true);
		// the near end is a box of its own and nothing about the far end's caret reaches it.
		expect(floated(root, NEAR)).toBe(false);

		await caret(chunks(root, FAR)[0] as HTMLElement, false);
		expect(floated(root, FAR)).toBe(false);
	});

	it('keeps an end floated while the caret walks from one of its chunks to the next', async () => {
		// the caret leaving the year for the month never leaves the box, so the label rising and
		// falling between the two would be a word flickering while somebody writes a date.
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });
		const [year, month] = chunks(root, NEAR) as [HTMLElement, HTMLElement];

		await caret(year, true);
		await act(async () => {
			year.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
			);
		});
		await flushed();

		expect(document.activeElement).toBe(month);
		expect(floated(root, NEAR)).toBe(true);
	});

	it('sends a day typed into either end to that end’s own value', async () => {
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });

		// the far end first, with the near end still empty: the machines hold a range whose front is
		// missing rather than reading the one day as the near end.
		await type(root, FAR, '2026-04-05');
		expect(submitted(root, 'to')).toBe('2026-04-05');
		expect(submitted(root, 'from')).toBe('');

		await type(root, NEAR, '2025-04-06');
		expect(submitted(root, 'from')).toBe('2025-04-06');
		expect(submitted(root, 'to')).toBe('2026-04-05');
	});

	it('leaves a range typed backwards standing as it was typed', async () => {
		// the one refusal a range can be walked into is `RANGE_REVERSED` in
		// packages/app/src/lib/ledger/journal-range.ts, and it is only reachable because nothing here
		// quietly puts the two days back in order: a pair silently corrected is a refusal nobody
		// could act on, and a screen that draws one would be contradicting its own boxes.
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });

		await type(root, NEAR, '2026-03-31');
		await type(root, FAR, '2026-03-01');

		expect(submitted(root, 'from')).toBe('2026-03-31');
		expect(submitted(root, 'to')).toBe('2026-03-01');
		expect(written(root, NEAR)).toBe('2026-03-31');
		expect(written(root, FAR)).toBe('2026-03-01');
	});

	it('opens one calendar from the near end’s own press', async () => {
		// the press is a real `<button>` in the tab order, which is the whole of what makes Enter and
		// Space open the calendar — the product does that for a button and nothing here has to. what
		// this pool cannot do is dispatch the key itself, so what is asserted is the element the
		// product would act on and the outcome of activating it.
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });

		expect(opener(root, NEAR).tagName).toBe('BUTTON');
		expect(opener(root, NEAR).getAttribute('type')).toBe('button');
		expect(opener(root, NEAR).getAttribute('tabindex')).toBeNull();

		press(opener(root, NEAR));
		await flushed();

		// one calendar for two boxes, which is the whole of what this component is for.
		expect(root.querySelectorAll('[data-part="content"]')).toHaveLength(1);
		expect(root.querySelector('[data-part="content"]')?.getAttribute('data-state')).toBe('open');
	});

	it('opens the same one calendar from the far end’s own press', async () => {
		// neither box is the only way in: an operator setting the last day first reaches the calendar
		// from the box they are standing in.
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });

		expect(opener(root, FAR).tagName).toBe('BUTTON');
		expect(opener(root, FAR).getAttribute('type')).toBe('button');

		press(opener(root, FAR));
		await flushed();

		expect(root.querySelectorAll('[data-part="content"]')).toHaveLength(1);
		expect(root.querySelector('[data-part="content"]')?.getAttribute('data-state')).toBe('open');
	});

	it('fills each box from a day chosen in the calendar that box’s own press opened', async () => {
		// the press stands at the end of a named box, so the calendar it opens is that box's: a day
		// chosen in it lands in that box and the other end is left exactly as it stood. the seed is a
		// whole range, which is what puts January on the grid the days below are picked out of.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2026-01-15' },
			to: { ...ends.to, defaultValue: '2026-01-16' }
		});

		press(opener(root, FAR));
		await flushed();
		press(cell(root, '2026-01-20'));
		await flushed();

		expect(submitted(root, 'from')).toBe('2026-01-15');
		expect(submitted(root, 'to')).toBe('2026-01-20');
		expect(written(root, NEAR)).toBe('2026-01-15');
		expect(written(root, FAR)).toBe('2026-01-20');

		press(opener(root, NEAR));
		await flushed();
		press(cell(root, '2026-01-05'));
		await flushed();

		expect(submitted(root, 'from')).toBe('2026-01-05');
		expect(submitted(root, 'to')).toBe('2026-01-20');
		expect(written(root, NEAR)).toBe('2026-01-05');
		expect(written(root, FAR)).toBe('2026-01-20');
	});

	it('closes the calendar on the press that answers it', async () => {
		// one press per box and the box is written, so the calendar has been answered and stays open
		// for nothing — which is also what says the press was taken.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2026-01-15' },
			to: { ...ends.to, defaultValue: '2026-01-16' }
		});

		press(opener(root, FAR));
		await flushed();
		press(cell(root, '2026-01-20'));
		await flushed();

		expect(root.querySelector('[data-part="content"]')?.getAttribute('data-state')).toBe('closed');
	});

	it('hands focus back to the press that opened the calendar, each end in turn', async () => {
		// the machine names one trigger and this component draws two, so the press it hands focus
		// back to is the one it has been told is answering. an operator who opened the far end's
		// calendar is put back at the far end's press rather than one box to the left of the box
		// they just filled.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2026-01-15' },
			to: { ...ends.to, defaultValue: '2026-01-16' }
		});

		press(opener(root, FAR));
		await flushed();
		press(cell(root, '2026-01-20'));
		await flushed();
		await painted();

		expect(document.activeElement).toBe(opener(root, FAR));

		press(opener(root, NEAR));
		await flushed();
		press(cell(root, '2026-01-05'));
		await flushed();
		await painted();

		expect(document.activeElement).toBe(opener(root, NEAR));
	});

	it('hands the caret back to the press the calendar was opened from when a press outside closes it', async () => {
		// this one is the machine's own restoration rather than this component's, and it is made off
		// the single trigger id the picker is told to look a press up by: `CONTROLLED.CLOSE` in
		// @zag-js/date-picker's machine focuses that element a frame after the close has already been
		// drawn. so the id has to still name the press the panel was opened from at that point — an
		// index cleared on the way out would leave it standing on the near box, and an operator who
		// dismissed the far end's calendar would be returned to a press they never made.
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });

		press(opener(root, FAR));
		await flushed();

		await act(async () => {
			document.body.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true })
			);
		});
		await flushed();
		await painted();

		expect(root.querySelector('[data-part="content"]')?.getAttribute('data-state')).toBe('closed');
		expect(document.activeElement).toBe(opener(root, FAR));
	});

	it('hands the caret back to the press the calendar was opened from when Escape dismisses it', async () => {
		// a dismissal is not an answer, so there is no box to move the caret into and the press is
		// the only place it can go. the machine's own escape branch leaves it where it was on a
		// picker whose open state is held out here, and where it was is a cell inside a panel that
		// is no longer drawn — a caret on nothing, with the top of the page the only way back.
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });

		press(opener(root, FAR));
		await flushed();

		await act(async () => {
			document.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
			);
		});
		await flushed();
		await painted();

		expect(root.querySelector('[data-part="content"]')?.getAttribute('data-state')).toBe('closed');
		expect(document.activeElement).toBe(opener(root, FAR));
	});

	it('names each press by the end it opens, and marks only that end expanded', async () => {
		// one machine draws both presses, so left alone they carry one generic name and one
		// expanded state between them: a reader hears the same button twice with nothing saying
		// From or To, and the near press announces a panel the far press opened.
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });

		for (const [index, word] of [
			[NEAR, 'From'],
			[FAR, 'To']
		] as const) {
			const named = opener(root, index).getAttribute('aria-labelledby')?.split(' ') ?? [];
			expect(
				named.map((token) => root.querySelector(`#${token}`)?.textContent).join(' ')
			).toContain(word);
		}
		expect(opener(root, NEAR).getAttribute('aria-labelledby')).not.toBe(
			opener(root, FAR).getAttribute('aria-labelledby')
		);

		press(opener(root, FAR));
		await flushed();

		expect(opener(root, FAR).getAttribute('aria-expanded')).toBe('true');
		expect(opener(root, NEAR).getAttribute('aria-expanded')).toBe('false');
	});

	it('marks a refused end’s own chunks refused and leaves the other end’s unmarked', () => {
		// the chunk is where the caret lands, so a chunk saying nothing is the element a reader is
		// standing on while the box around it is refused. ./DateField.jsx hands its one machine
		// `invalid` for this; a range holds both ends in one machine, so each end's chunks are
		// marked on their own.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: ends.from,
			to: { ...ends.to, error: 'must not be before the first day of the range' }
		});

		for (const chunk of chunks(root, FAR)) expect(chunk.getAttribute('aria-invalid')).toBe('true');
		for (const chunk of chunks(root, NEAR)) expect(chunk.getAttribute('aria-invalid')).toBeNull();
	});

	it('keeps a day chosen for the far end out of the near box, backwards or not', async () => {
		// the machine puts the range it makes in calendar order, and the far end standing before the
		// near one is a range an operator can ask for: what they pressed has to land in the box they
		// pressed from, so that packages/app/src/lib/ledger/journal-range.ts's refusal is what answers
		// it rather than the near box quietly moving.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2026-01-15' },
			to: { ...ends.to, defaultValue: '2026-01-16' }
		});

		press(opener(root, FAR));
		await flushed();
		press(cell(root, '2026-01-05'));
		await flushed();

		expect(submitted(root, 'from')).toBe('2026-01-15');
		expect(submitted(root, 'to')).toBe('2026-01-05');
	});

	it('finishes a half-written range from one press in the far end’s calendar', async () => {
		// the range holds a near day and no far one: one press in the box that is empty finishes it,
		// and the near day the operator already wrote is kept.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2026-01-15' },
			to: ends.to
		});

		press(opener(root, FAR));
		await flushed();
		press(cell(root, '2026-01-20'));
		await flushed();

		expect(submitted(root, 'from')).toBe('2026-01-15');
		expect(submitted(root, 'to')).toBe('2026-01-20');
	});

	it('moves which box the next press writes when the other end’s press is made', async () => {
		// a calendar already showing is taken over by the other end's press rather than shut by it:
		// the operator changed their mind about which box they are filling, not about filling one.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2026-01-15' },
			to: { ...ends.to, defaultValue: '2026-01-16' }
		});

		press(opener(root, NEAR));
		await flushed();
		press(opener(root, FAR));
		await flushed();

		expect(root.querySelector('[data-part="content"]')?.getAttribute('data-state')).toBe('open');

		press(cell(root, '2026-01-20'));
		await flushed();

		expect(submitted(root, 'from')).toBe('2026-01-15');
		expect(submitted(root, 'to')).toBe('2026-01-20');
	});

	it('draws all three of the calendar’s grids while the range has only its far end', async () => {
		// the range's one lopsided state: its value is a list from index 0, and a range with only a
		// far end is that list with a hole at the front. every grid reads that list for a day that is
		// really there, so the climb out of the day grid is open in this state as in any other.
		const root = render(DateRangeField, { id: 'range', legend: 'Date range', ...ends });

		await type(root, FAR, '2026-04-05');
		press(opener(root, FAR));
		await flushed();

		expect(root.querySelectorAll('[data-part="view"]')).toHaveLength(3);

		const climb = root.querySelector('[data-part="view-trigger"]');
		if (climb === null) throw new Error('the open calendar drew no head');
		press(climb);
		await flushed();
		expect(
			root
				.querySelector('[data-part="view"]:not([hidden]) [data-part="table"]')
				?.getAttribute('data-view')
		).toBe('month');
	});

	it('draws all three of the calendar’s grids once the range has a first day', async () => {
		// the climb back: a day two years back is two presses of the head rather than twenty-four of
		// the step beside it, and that is what the two grids above the day grid are for.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2026-01-15' },
			to: ends.to
		});

		press(opener(root, NEAR));
		await flushed();

		expect(root.querySelectorAll('[data-part="view"]')).toHaveLength(3);

		const climb = root.querySelector('[data-part="view-trigger"]');
		if (climb === null) throw new Error('the open calendar drew no head');
		press(climb);
		await flushed();
		expect(
			root
				.querySelector('[data-part="view"]:not([hidden]) [data-part="table"]')
				?.getAttribute('data-view')
		).toBe('month');
	});

	it('opens both boxes holding the days they were seeded with', () => {
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2025-04-06' },
			to: { ...ends.to, defaultValue: '2026-04-05' }
		});

		expect(submitted(root, 'from')).toBe('2025-04-06');
		expect(submitted(root, 'to')).toBe('2026-04-05');
		expect(written(root, NEAR)).toBe('2025-04-06');
		expect(written(root, FAR)).toBe('2026-04-05');
		expect(floated(root, NEAR)).toBe(true);
		expect(floated(root, FAR)).toBe(true);
	});

	it('opens a seed written backwards standing as it was written', () => {
		// the far end standing before the near one is the one refusal a range has, and a seed put
		// back in calendar order would be that refusal arriving under a pair that no longer shows
		// it — `RANGE_REVERSED` in packages/app/src/lib/ledger/journal-range.ts is told to the far
		// box, which has to be the box holding the day it is about.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2026-04-05' },
			to: { ...ends.to, defaultValue: '2025-04-06' }
		});

		expect(submitted(root, 'from')).toBe('2026-04-05');
		expect(submitted(root, 'to')).toBe('2025-04-06');
		expect(written(root, NEAR)).toBe('2026-04-05');
		expect(written(root, FAR)).toBe('2025-04-06');
	});

	it('opens the far box alone on a seed naming the far end alone', () => {
		// the machines hold the pair as a list from index 0, so a lone far day is that list with a
		// hole at the front — the state an operator also reaches by writing the last day first.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: ends.from,
			to: { ...ends.to, defaultValue: '2026-04-05' }
		});

		expect(submitted(root, 'from')).toBe('');
		expect(submitted(root, 'to')).toBe('2026-04-05');
		expect(written(root, FAR)).toBe('2026-04-05');
		expect(floated(root, FAR)).toBe(true);
		expect(floated(root, NEAR)).toBe(false);
	});

	it('keeps a readable near end when the far end names no day', () => {
		// the seed reaches this component off an address an operator can edit, so a string that is
		// not a day is a real arrival — and the end beside it that does name a day is still the day
		// somebody asked for.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2025-04-06' },
			to: { ...ends.to, defaultValue: 'next tuesday' }
		});

		expect(submitted(root, 'from')).toBe('2025-04-06');
		expect(submitted(root, 'to')).toBe('');
	});

	it('keeps a readable far end when the near end names no day', () => {
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: 'last tuesday' },
			to: { ...ends.to, defaultValue: '2026-04-05' }
		});

		expect(submitted(root, 'from')).toBe('');
		expect(submitted(root, 'to')).toBe('2026-04-05');
	});

	it('opens empty on a seed where neither end names a day', () => {
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: 'last tuesday' },
			to: { ...ends.to, defaultValue: 'next tuesday' }
		});

		expect(submitted(root, 'from')).toBe('');
		expect(submitted(root, 'to')).toBe('');
	});

	it('draws both boxes unanswerable together, values included', () => {
		// half a range is not an answer, so neither end is offered without the other. a box an
		// operator cannot answer sends nothing, and the press beside it promises a choice that would
		// go nowhere.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			disabled: true,
			from: { ...ends.from, defaultValue: '2025-04-06' },
			to: { ...ends.to, defaultValue: '2026-04-05' }
		});

		// no chunk of either end is a tab stop, which is what a box that cannot be written in is.
		expect(chunks(root, NEAR)).toHaveLength(0);
		expect(chunks(root, FAR)).toHaveLength(0);
		expect(opener(root, NEAR).disabled).toBe(true);
		expect(opener(root, FAR).disabled).toBe(true);
		expect(carrier(root, 'from').disabled).toBe(true);
		expect(carrier(root, 'to').disabled).toBe(true);
		expect(root.querySelectorAll('.adm-datebox[data-disabled]')).toHaveLength(2);
	});

	it('draws a refusal under the end it is about and leaves the other end saying nothing', () => {
		// `RANGE_REVERSED` in packages/app/src/lib/ledger/journal-range.ts is put under the far end:
		// the box that is wrong is the one the operator changes, and the near end is not it.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: ends.from,
			to: { ...ends.to, error: 'must not be before the first day of the range' }
		});

		expect(root.querySelector('#range-to-err')?.getAttribute('role')).toBe('alert');
		expect(root.querySelector('#range-from-err')).toBeNull();
		expect(box(root, FAR).getAttribute('aria-invalid')).toBe('true');
		expect(box(root, NEAR).getAttribute('aria-invalid')).toBeNull();
		expect(describedBy(root, FAR)).toContain('range-to-err');
		expect(describedBy(root, NEAR)).not.toContain('range-to-err');
		expect(root.querySelectorAll('.adm-datebox[data-invalid]')).toHaveLength(1);
	});

	it('marks an end refused from outside itself, with no message of its own', () => {
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: ends.from,
			to: { ...ends.to, 'aria-invalid': 'true' }
		});

		expect(box(root, FAR).getAttribute('aria-invalid')).toBe('true');
		expect(root.querySelectorAll('.adm-datebox[data-invalid]')).toHaveLength(1);
		expect(root.querySelector('.adm-field__error')).toBeNull();
	});

	it('names the group’s hint and its standing sentence on both boxes', () => {
		// one sentence over two boxes, because the sentence is about the range: a hint drawn per end
		// would be the same words read twice.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			hint: 'The days the export covers.',
			needed: 'A journal cannot be downloaded until both ends are set.',
			...ends
		});

		expect(describedBy(root, NEAR)).toEqual(['range-hint', 'range-need']);
		expect(describedBy(root, FAR)).toEqual(['range-hint', 'range-need']);
		expect(root.querySelector('#range-hint')?.textContent).toBe('The days the export covers.');
		expect(root.querySelector('legend')?.textContent).toBe('Date range');
	});

	it('hands a refusal’s focus from the control carrying a name to that end’s own box', async () => {
		// how conform reports: it walks `form.elements` for the name it holds an error for and calls
		// `focus()` on what it finds (`report` in @conform-to/dom's form.js). what it finds is that
		// end's carrier, and a `type="hidden"` one could not take focus at all.
		const root = render(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: ends.from,
			to: { ...ends.to, error: 'must not be before the first day of the range' }
		});

		await act(async () => {
			carrier(root, 'to').focus();
		});
		await flushed();

		expect(document.activeElement).toBe(chunks(root, FAR)[0]);
		expect(floated(root, FAR)).toBe(true);
		expect(floated(root, NEAR)).toBe(false);
	});

	it('moves both boxes to a seed that arrived after they were drawn', () => {
		// a form redrawn from a new reading has to move to it rather than stand at whatever was
		// chosen against the reading before — a range reached by a link is that reading.
		const mounted = mount(DateRangeField, {
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2025-04-06' },
			to: { ...ends.to, defaultValue: '2026-04-05' }
		});

		expect(submitted(mounted.root, 'from')).toBe('2025-04-06');

		mounted.again({
			id: 'range',
			legend: 'Date range',
			from: { ...ends.from, defaultValue: '2024-04-06' },
			to: { ...ends.to, defaultValue: '2025-04-05' }
		});

		expect(submitted(mounted.root, 'from')).toBe('2024-04-06');
		expect(submitted(mounted.root, 'to')).toBe('2025-04-05');
		expect(written(mounted.root, NEAR)).toBe('2024-04-06');
		expect(written(mounted.root, FAR)).toBe('2025-04-05');
	});
});
