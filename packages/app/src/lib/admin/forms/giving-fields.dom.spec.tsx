import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, onTestFinished } from 'vitest';
import { boxErrorId } from '../use-admin-form';
import { FormGivingFields } from './giving-fields';

// which box a refused amount is said under, in the two shapes a refusal comes in: one keyed to the
// row that carries the figure, and the count cap keyed to the group.
//
// what it covers is that a row is refused by its own message alone. the schema keys an issue to
// `suggested_amounts[1]` (`suggestedAmountsRule` in `$lib/forms/input-schema.ts`), and a group that
// marked every box from one group-wide message would send an operator editing three fine figures to
// find the one that is wrong.
//
// in the dom pool because what is asserted is which element carries a sentence and which control is
// marked: the id an `aria-describedby` names and the box an `aria-invalid` sits on are relationships
// in the tree rather than text on the screen.
//
// nothing here reads a class or asks how any of it looks, which is what keeps it clear of
// CLAUDE.md's ban on a browser spec over a dashboard screen.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(tree: ReactNode): HTMLElement {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	return root;
}

const GROUP = 'form-edit-giving-suggested_amounts';
const HINT = `${GROUP}-hint`;

/** one amount row as the form hands it over, at the position it sits in. */
function row(index: number, errors?: string[]) {
	return {
		id: `${GROUP}[${index}]`,
		name: `suggested_amounts[${index}]`,
		key: `row-${index}`,
		defaultValue: '25',
		...(errors === undefined ? {} : { errors })
	};
}

/** the one intent shape both controls are handed as, which this group states none of itself. */
const intent = {
	name: 'intent',
	value: 'insert',
	form: 'form-edit-giving',
	formNoValidate: true
};

/** the group as a form screen mounts it, with two bound boxes nothing was refused about. */
function group(amounts: {
	rows: ReturnType<typeof row>[];
	errors?: string[] | undefined;
}): HTMLElement {
	return mount(
		createElement(FormGivingFields, {
			boxes: {
				min_minor: { id: 'form-edit-giving-min_minor', name: 'min_minor', defaultValue: '5' },
				max_minor: { id: 'form-edit-giving-max_minor', name: 'max_minor', defaultValue: '500' }
			},
			amounts: {
				id: GROUP,
				rows: amounts.rows,
				...(amounts.errors === undefined ? {} : { errors: amounts.errors }),
				add: intent,
				remove: () => intent
			},
			currency: 'USD'
		})
	);
}

function input(root: HTMLElement, index: number): HTMLInputElement {
	const box = root.querySelector(`[id="${GROUP}[${index}]"]`);
	if (!(box instanceof HTMLInputElement)) throw new Error(`no box for row ${index}`);
	return box;
}

const BELOW = 'must be more than smallest gift of $5';
const CAP = 'at most 12';

it('says a refused amount under the row that holds it, and marks no other row', () => {
	const root = group({ rows: [row(0), row(1, [BELOW])] });

	const said = root.querySelector(`[id="${boxErrorId(`${GROUP}[1]`)}"]`);
	expect(said?.textContent).toBe(BELOW);
	expect(input(root, 1).getAttribute('aria-invalid')).toBe('true');

	// and the row nobody was refused about reads as fine: no mark, and no message element of its
	// own for the description to name.
	expect(input(root, 0).getAttribute('aria-invalid')).toBeNull();
	expect(root.querySelector(`[id="${boxErrorId(`${GROUP}[0]`)}"]`)).toBeNull();
});

it('says the count cap once, under the group, and marks no row', () => {
	const root = group({ rows: [row(0), row(1)], errors: [CAP] });

	const said = root.querySelector(`[id="${boxErrorId(GROUP)}"]`);
	expect(said?.textContent).toBe(CAP);
	// the fieldset is what the sentence describes, because holding too many is a fact about no one
	// row.
	expect(root.querySelector('fieldset[aria-describedby]')?.getAttribute('aria-describedby')).toBe(
		boxErrorId(GROUP)
	);
	expect(input(root, 0).getAttribute('aria-invalid')).toBeNull();
	expect(input(root, 1).getAttribute('aria-invalid')).toBeNull();
});

it('describes every row by the standing hint, refused or not', () => {
	const root = group({ rows: [row(0), row(1, [BELOW])] });

	expect(root.querySelector(`[id="${HINT}"]`)).not.toBeNull();
	expect(input(root, 0).getAttribute('aria-describedby')).toBe(HINT);
	// and the refused row keeps it beside its own message rather than instead of it.
	expect(input(root, 1).getAttribute('aria-describedby')).toBe(
		`${boxErrorId(`${GROUP}[1]`)} ${HINT}`
	);
});

// the bounds slider and the two boxes it stands over. the boxes are the fields and the slider only
// ever moves in step with them, so every case reads a box's value or a thumb's announced stop.

const MIN_BOX = 'form-edit-giving-min_minor';
const MAX_BOX = 'form-edit-giving-max_minor';

function bounds(root: HTMLElement) {
	const fieldset = root.querySelector('fieldset');
	const [lower, upper] = [...(fieldset?.querySelectorAll<HTMLElement>('[role="slider"]') ?? [])];
	const min = root.querySelector(`[id="${MIN_BOX}"]`);
	const max = root.querySelector(`[id="${MAX_BOX}"]`);
	if (!fieldset || !lower || !upper) throw new Error('no bounds slider');
	if (!(min instanceof HTMLInputElement) || !(max instanceof HTMLInputElement)) {
		throw new Error('no bound boxes');
	}
	return { fieldset, lower, upper, min, max };
}

/** text put in a box the way a keystroke puts it there. */
async function type(box: HTMLInputElement, text: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, text);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

it('seeds each thumb at the stop nearest its box', () => {
	const { lower, upper } = bounds(group({ rows: [row(0)] }));

	expect(lower.getAttribute('aria-label')).toBe('Smallest gift');
	expect(lower.getAttribute('aria-valuetext')).toBe('$5');
	expect(upper.getAttribute('aria-label')).toBe('Largest gift');
	expect(upper.getAttribute('aria-valuetext')).toBe('$500');
});

it('writes the stop a thumb moves to into its own box, as a keystroke would', async () => {
	const { fieldset, lower, min, max } = bounds(group({ rows: [row(0)] }));
	const heard: string[] = [];
	// the form's listeners sit above the box, so the event has to bubble to reach them.
	fieldset.addEventListener('input', (event) => {
		if (event.target instanceof HTMLInputElement) heard.push(event.target.name);
	});

	// the machine takes each event on a microtask after react's handler, so the act is awaited.
	await act(async () => lower.focus());
	await act(async () => {
		lower.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	});

	expect(min.value).toBe('10');
	expect(heard).toEqual(['min_minor']);
	// the other box keeps what it held.
	expect(max.value).toBe('500');
	expect(lower.getAttribute('aria-valuetext')).toBe('$10');
});

// where a thumb stands on the ladder: $1 is position 0 and $10,000 is 15.
const AT_25 = '5';
const AT_500 = '10';
const AT_END = '15';

it('moves a thumb to the nearest stop as its box is typed in, and reads it as the box', async () => {
	const { upper, max } = bounds(group({ rows: [row(0)] }));

	await type(max, '30');
	expect(upper.getAttribute('aria-valuenow')).toBe(AT_25);
	// the thumb and the box share one name, so the thumb reads the figure typed rather than the
	// stop it only approximates.
	expect(upper.getAttribute('aria-valuetext')).toBe('$30');
	// and the box keeps the figure typed, which is between two stops.
	expect(max.value).toBe('30');
});

it('puts a thumb at the end of the scale for a figure past the last stop', async () => {
	const { upper, max } = bounds(group({ rows: [row(0)] }));

	await type(max, '20000');
	expect(upper.getAttribute('aria-valuenow')).toBe(AT_END);
	expect(upper.getAttribute('aria-valuetext')).toBe('$20,000');
});

it('leaves a thumb where it is while its box holds text that is not an amount', async () => {
	const { upper, max } = bounds(group({ rows: [row(0)] }));

	await type(max, '5,000');
	expect(upper.getAttribute('aria-valuenow')).toBe(AT_500);
	expect(upper.getAttribute('aria-valuetext')).toBe('$500');
});

/** a key pressed on a thumb. the machine takes each event on a microtask after react's handler. */
async function press(thumb: HTMLElement, key: string) {
	await act(async () => thumb.focus());
	await act(async () => {
		thumb.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	});
}

it('never writes a smallest gift above the largest one typed', async () => {
	// the largest gift is $23, which stands its thumb on the $25 stop. the smallest thumb run up to
	// meet it lands on that stop too, and what it writes is the largest gift itself, never $25.
	const { lower, min, max } = bounds(group({ rows: [row(0)] }));
	await type(max, '23');

	await press(lower, 'End');

	expect(min.value).toBe('23');
	expect(lower.getAttribute('aria-valuenow')).toBe(AT_25);
	expect(lower.getAttribute('aria-valuetext')).toBe('$23');
});

it('never writes a largest gift below the smallest one typed', async () => {
	const { upper, min, max } = bounds(group({ rows: [row(0)] }));
	await type(min, '27');

	await press(upper, 'Home');

	expect(max.value).toBe('27');
	expect(upper.getAttribute('aria-valuenow')).toBe(AT_25);
	expect(upper.getAttribute('aria-valuetext')).toBe('$27');
});

/** the group inside a form of its own, remountable with the bounds a new seed carries. */
function inForm(seed: { min: string; max: string }) {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	const draw = (next: { min: string; max: string }) =>
		act(() =>
			mounted.render(
				createElement(
					'form',
					null,
					createElement(FormGivingFields, {
						boxes: {
							min_minor: { id: MIN_BOX, name: 'min_minor', defaultValue: next.min },
							max_minor: { id: MAX_BOX, name: 'max_minor', defaultValue: next.max }
						},
						amounts: { id: GROUP, rows: [row(0)], add: intent, remove: () => intent },
						currency: 'USD'
					})
				)
			)
		);
	draw(seed);
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	const form = root.querySelector('form');
	if (!form) throw new Error('no form');
	return { root, form, draw };
}

/** the form put back, and the task after it, which is when the boxes hold what was put back. */
async function reset(form: HTMLFormElement) {
	await act(async () => {
		form.reset();
		await new Promise((settled) => setTimeout(settled, 0));
	});
}

it('puts the thumbs back with the boxes when the form is reset', async () => {
	const { root, form } = inForm({ min: '5', max: '500' });
	const { lower, upper, min, max } = bounds(root);
	await type(min, '20');
	await type(max, '2000');

	await reset(form);

	expect([min.value, max.value]).toEqual(['5', '500']);
	expect(lower.getAttribute('aria-valuetext')).toBe('$5');
	expect(upper.getAttribute('aria-valuenow')).toBe(AT_500);
	expect(upper.getAttribute('aria-valuetext')).toBe('$500');
});

it('moves the thumbs to a new seed when the form is reset onto it', async () => {
	// what ../use-admin-form.ts does when the record moves under a mounted group: the boxes take
	// the new seed as their default, and the form is reset onto it.
	const { root, form, draw } = inForm({ min: '5', max: '500' });
	const { lower, upper } = bounds(root);

	draw({ min: '30', max: '20000' });
	await reset(form);

	expect(lower.getAttribute('aria-valuenow')).toBe(AT_25);
	expect(lower.getAttribute('aria-valuetext')).toBe('$30');
	expect(upper.getAttribute('aria-valuenow')).toBe(AT_END);
	expect(upper.getAttribute('aria-valuetext')).toBe('$20,000');
});

it('gives the bounds no named field but the two boxes', () => {
	// the slider submits nothing: what the group posts for its bounds is the two boxes alone.
	const { fieldset } = bounds(group({ rows: [row(0)] }));

	expect(
		[...fieldset.querySelectorAll('[name]')].map((field) => field.getAttribute('name'))
	).toEqual(['min_minor', 'max_minor']);
});
