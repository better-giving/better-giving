import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Form, createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import { getFormProps } from '@conform-to/react';
import { MAX_SUGGESTED_AMOUNTS } from '$lib/forms/amounts';
import { defineForm } from '$lib/forms/definition';
import { FORM_GIVING_INPUT } from '$lib/forms/input-schema';
import { boxErrorId, insertWhenValid, useAdminForm } from '../use-admin-form';
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
const CAP = `at most ${MAX_SUGGESTED_AMOUNTS}`;

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

// these mount the group under the real form layer, because what is under test is what a press and
// a save do to the rows and to focus, and both are conform's as much as the group's.

const GIVING = defineForm({ id: 'form-edit-giving', schema: FORM_GIVING_INPUT });

/** distinct figures inside the $5–$500 bounds, one per row. */
const figures = (count: number) => Array.from({ length: count }, (_, i) => String(10 + i));

function Giving({ rows, min = '5' }: { readonly rows: string[]; readonly min?: string }) {
	const [form, fields] = useAdminForm(GIVING, undefined, {
		defaultValue: { min_minor: min, max_minor: '500', suggested_amounts: rows }
	});
	return (
		<form {...getFormProps(form)}>
			<FormGivingFields
				boxes={{ min_minor: fields.min_minor, max_minor: fields.max_minor }}
				amounts={{
					id: fields.suggested_amounts.id,
					errors: fields.suggested_amounts.errors,
					rows: fields.suggested_amounts.getFieldList(),
					add: insertWhenValid(form, GIVING, fields.suggested_amounts.name),
					remove: (index) =>
						form.remove.getButtonProps({ name: fields.suggested_amounts.name, index })
				}}
				currency="USD"
				footer={<button type="submit">Save</button>}
			/>
		</form>
	);
}

function giving(rows: string[], min?: string) {
	const root = mount(createElement(Giving, min === undefined ? { rows } : { rows, min }));
	const button = (label: string) => {
		const found = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
		if (!found) throw new Error(`no ${label} button`);
		return found;
	};
	return {
		root,
		rows: () => root.querySelectorAll('input[name^="suggested_amounts["]').length,
		add: () => button('Add an amount'),
		save: () => button('Save'),
		/**
		 * a press as a browser makes one: focus on the control, then the click — and the task after
		 * it, which is when a refused save has settled where focus goes.
		 */
		press: (control: HTMLButtonElement) =>
			act(async () => {
				control.focus();
				control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
				await new Promise((settled) => setTimeout(settled, 0));
			}),
		/** the text of every element the control's `aria-describedby` names. */
		description: (control: HTMLElement) =>
			(control.getAttribute('aria-describedby') ?? '')
				.split(' ')
				.filter(Boolean)
				.map((id) => document.getElementById(id)?.textContent)
	};
}

it('adds a row while the group is under the cap', async () => {
	const group = giving(figures(MAX_SUGGESTED_AMOUNTS - 1));

	await group.press(group.add());

	expect(group.rows()).toBe(MAX_SUGGESTED_AMOUNTS);
});

it('holds Add at the cap, and says why on Add', async () => {
	const group = giving(figures(MAX_SUGGESTED_AMOUNTS));

	await group.press(group.add());

	expect(group.rows()).toBe(MAX_SUGGESTED_AMOUNTS);
	expect(group.description(group.add())).toContain(CAP);
	// the press is answered where it was made: focus stays on Add.
	expect(document.activeElement).toBe(group.add());
});

it('moves focus to Add when a save is refused by the cap alone', async () => {
	const group = giving(figures(MAX_SUGGESTED_AMOUNTS + 1));

	await group.press(group.save());

	expect(document.activeElement).toBe(group.add());
	expect(group.description(group.add())).toContain(CAP);
});

it('leaves focus on a bound the same save refused, which is where conform put it', async () => {
	// the bounds the wrong way round are refused under the largest gift's own box, alongside the
	// cap: the walk focuses that box, and it is the first thing on the group to fix.
	const group = giving(figures(MAX_SUGGESTED_AMOUNTS + 1), '600');

	await group.press(group.save());

	expect(document.activeElement?.getAttribute('name')).toBe('max_minor');
	expect(group.description(group.add())).toContain(CAP);
});

it('moves focus to Add again when a second save is refused the same way', async () => {
	// the second refusal changes no error, so the form layer draws nothing new for it.
	const group = giving(figures(MAX_SUGGESTED_AMOUNTS + 1));
	await group.press(group.save());

	await group.press(group.save());

	expect(document.activeElement).toBe(group.add());
});

it('moves focus to Add once the bound a first save was refused by is fixed', async () => {
	const group = giving(figures(MAX_SUGGESTED_AMOUNTS + 1), '600');
	await group.press(group.save());
	const max = group.root.querySelector('input[name="max_minor"]');
	if (!(max instanceof HTMLInputElement)) throw new Error('no largest gift box');

	await type(max, '700');
	await group.press(group.save());

	expect(document.activeElement).toBe(group.add());
});

// both real screens mount the group in react-router's `<Form>` (`_app.admin.forms.$id.tsx`), which
// cancels every submit once hydrated and hands the request to the router. so the submit event
// reaches the group's listener already `defaultPrevented`, win or lose, and a refusal has to be
// told from a save the router is about to post by what the form layer holds, not by that flag.

/** the group under `<Form>` in a data router whose action keeps what it was posted. */
function routed(rows: string[], min = '5') {
	const posted: FormData[] = [];
	function Screen() {
		const [form, fields] = useAdminForm(GIVING, undefined, {
			defaultValue: { min_minor: min, max_minor: '500', suggested_amounts: rows }
		});
		return (
			<Form method="post" {...getFormProps(form)}>
				<FormGivingFields
					boxes={{ min_minor: fields.min_minor, max_minor: fields.max_minor }}
					amounts={{
						id: fields.suggested_amounts.id,
						errors: fields.suggested_amounts.errors,
						rows: fields.suggested_amounts.getFieldList(),
						add: insertWhenValid(form, GIVING, fields.suggested_amounts.name),
						remove: (index) =>
							form.remove.getButtonProps({ name: fields.suggested_amounts.name, index })
					}}
					currency="USD"
					footer={<button type="submit">Save</button>}
				/>
			</Form>
		);
	}
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: Screen,
			action: async ({ request }) => {
				posted.push(await request.formData());
				return null;
			}
		}
	]);
	const root = mount(<Stub initialEntries={['/']} />);
	const button = (label: string) => {
		const found = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
		if (!found) throw new Error(`no ${label} button`);
		return found;
	};
	return {
		root,
		posted,
		add: () => button('Add an amount'),
		save: () => button('Save'),
		/** a press as a browser makes one, and the tasks after it, which is when a save has settled. */
		press: (control: HTMLButtonElement) =>
			act(async () => {
				control.focus();
				control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
				await new Promise((settled) => setTimeout(settled, 20));
			})
	};
}

it('under the router form, moves focus to Add when a save is refused by the cap alone', async () => {
	const group = routed(figures(MAX_SUGGESTED_AMOUNTS + 1));

	await group.press(group.save());

	expect(group.posted).toHaveLength(0);
	expect(document.activeElement).toBe(group.add());
});

it('under the router form, leaves focus on Save for a valid save that holds one blank box over the cap', async () => {
	// the blank box is dropped by the schema, so what is posted is at the cap and is no refusal:
	// pulling focus to Add would be an operator's save answered as if it failed.
	const group = routed([...figures(MAX_SUGGESTED_AMOUNTS), '']);

	await group.press(group.save());

	expect(group.posted).toHaveLength(1);
	expect(document.activeElement).toBe(group.save());
});

it('under the router form, leaves focus on a bound the same save refused', async () => {
	const group = routed(figures(MAX_SUGGESTED_AMOUNTS + 1), '600');

	await group.press(group.save());

	expect(group.posted).toHaveLength(0);
	expect(document.activeElement?.getAttribute('name')).toBe('max_minor');
});
