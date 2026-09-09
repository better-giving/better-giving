import { getFormProps } from '@conform-to/react';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, onTestFinished } from 'vitest';
import { z } from 'zod';
import { defineForm } from '$lib/forms/definition';
import { insertWhenValid, useAdminForm, whichForm } from './use-admin-form';

// the two things about a group that cannot be decided without a document: whether its Add goes
// through, and whether it holds anything to save.
//
// conform applies an insert to the payload before it resolves the schema, and the client applies it
// whether or not errors came back — so nothing a schema says can stop a row appearing over rows
// nobody has been told are wrong. the guard is on the press, and a press is an event with a form
// element under it, which is why this is in the dom pool rather than beside the rest of the seam in
// ./use-admin-form.spec.ts.
//
// the second is the reading the save button is drawn from, and it is conform's own `dirty` — the
// values the form layer holds against the ones it was seeded with. what makes it a document's
// question is the case a comparison of the boxes cannot answer: a row added or dropped by the
// group's own controls is a list intent, which changes the payload and fires no input event at all.
//
// the form below is a fixture and not one of the screens: what is under test is the seam, and a
// screen would bring its own boxes and its own design into it. it carries a box outside the list on
// purpose — the create screen states one schema for the whole form, so the pass reads every box on
// it and the guard has to look at this list's keys alone — and the hidden box naming which form was
// submitted, which every screen with more than one group draws and no seed has a key for.
//
// nothing here reads a class or asks how any of it looks, which is what keeps it clear of
// CLAUDE.md's ban on a browser spec over a dashboard screen.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(tree: ReactNode): { root: HTMLElement; redraw: (next: ReactNode) => void } {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const mounted = createRoot(root);
	act(() => mounted.render(tree));
	onTestFinished(() => {
		act(() => mounted.unmount());
		root.remove();
	});
	// the same component drawn again, which is what a screen does when its loader answers with a
	// record that moved.
	return { root, redraw: (next) => act(() => mounted.render(next)) };
}

/**
 * a row editor whose rows have a rule of their own, keyed per row.
 *
 * the shape `suggested_amounts` is in (`$lib/forms/input-schema.ts`): a blank row is the spare box
 * Add leaves behind and is not a value, and an issue pushed from the field's own check carries the
 * row's index — which conform spells `tiles[1]`, the name that row's input is drawn with.
 */
const TILES = defineForm({
	id: 'tiles',
	schema: z.object({
		name: z.string({ error: 'required' }).min(1, { error: 'required' }).prefault(''),
		tiles: z
			.array(z.string().default(''))
			.check((ctx) => {
				ctx.value.forEach((row, index) => {
					if (row.trim().length > 0 && !/^\d+$/.test(row)) {
						ctx.issues.push({ code: 'custom', input: row, path: [index], message: 'digits only' });
					}
				});
			})
			.prefault([])
	})
});

/** whether the group last rendered holds anything to save, as its save button would be drawn. */
let armed = false;

/** the fixture as a screen would mount it: a box outside the list, the rows, and the group's Add. */
function Editor({
	rows,
	name = ''
}: {
	readonly rows: string[];
	readonly name?: string | undefined;
}) {
	const [form, fields] = useAdminForm(TILES, undefined, {
		defaultValue: { name, tiles: rows }
	});
	// read during the render, which is what subscribes this component to it: conform's metadata is a
	// proxy that notifies only over the properties a render actually read.
	armed = form.dirty;
	return (
		<form {...getFormProps(form)}>
			<input {...whichForm(TILES.id)} />
			<input id="name" name={fields.name.name} defaultValue={fields.name.initialValue} />
			{fields.tiles.getFieldList().map((row, index) => (
				<span key={row.key}>
					<input id={row.name} name={row.name} defaultValue={row.initialValue} />
					<button type="submit" {...form.remove.getButtonProps({ name: fields.tiles.name, index })}>
						Remove
					</button>
				</span>
			))}
			<button type="submit" {...insertWhenValid(form, TILES, fields.tiles.name)}>
				Add
			</button>
		</form>
	);
}

/** the fixture mounted, with the two presses and the keystroke a case makes on it. */
function editor(rows: string[], name?: string) {
	const { root, redraw } = mount(<Editor rows={rows} name={name} />);
	const press = (control: HTMLButtonElement) => {
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		act(() => {
			control.dispatchEvent(click);
		});
	};
	return {
		redraw,
		type: (id: string, value: string) =>
			act(() => {
				const box = root.querySelector(`#${CSS.escape(id)}`) as HTMLInputElement;
				box.value = value;
				box.dispatchEvent(new Event('input', { bubbles: true }));
			}),
		held: (id: string) => (root.querySelector(`#${CSS.escape(id)}`) as HTMLInputElement).value,
		rows: () => root.querySelectorAll('span').length,
		add: () => press([...root.querySelectorAll('button')].at(-1) as HTMLButtonElement),
		remove: (index: number) =>
			press(root.querySelectorAll('span')[index]?.querySelector('button') as HTMLButtonElement)
	};
}

/** the press, as a control the operator clicked — and whether the form withheld the intent. */
function pressAdd(root: HTMLElement): boolean {
	// the last control on the form: every row before it draws a Remove of its own.
	const button = [...root.querySelectorAll('button')].at(-1);
	if (button === undefined) throw new Error('the editor drew no Add');
	const press = new MouseEvent('click', { bubbles: true, cancelable: true });
	act(() => {
		button.dispatchEvent(press);
	});
	return press.defaultPrevented;
}

it('withholds the row while one of the rows already there is refused', () => {
	// the whole reason the guard is on the press: a fresh empty box stacked under a box nobody has
	// been told is wrong is a group an operator keeps adding to and cannot save.
	const { root } = mount(<Editor rows={['lots']} />);
	expect(pressAdd(root)).toBe(true);
});

it('adds the row when every row already there is fine', () => {
	// the other half, and the one that would go unnoticed: a guard refusing every press would leave a
	// working group with no way to grow.
	const { root } = mount(<Editor rows={['25']} />);
	expect(pressAdd(root)).toBe(false);
});

it('reads this list alone, so a box outside it does not withhold the row', () => {
	// `name` is blank in every case here and refused by the schema in all of them. a guard that read
	// the whole error map would leave the create screen unable to add a row until the form was
	// finished, which is the opposite way round from how anybody fills one in.
	const { root } = mount(<Editor rows={[]} />);
	expect(pressAdd(root)).toBe(false);
});

describe('whether a group holds anything to save', () => {
	it('opens with nothing to save on a group seeded from a record', () => {
		// every box arrives holding what is stored, so a reading taken against emptiness would offer
		// to save the record back to itself the moment the screen drew.
		editor(['25', '50'], 'Winter appeal');
		expect(armed).toBe(false);
	});

	it('is armed by a box typed into and rests again when it is typed back', () => {
		const group = editor(['25', '50'], 'Winter appeal');

		group.type('name', 'Winter appeal 2026');
		expect(armed).toBe(true);

		// and back to the stored value in a box that is not empty, which is the reading a comparison
		// against emptiness cannot make. the hidden box naming the form is in the payload from the
		// first keystroke on and in no seed at all — counted, this group would never rest again.
		group.type('name', 'Winter appeal');
		expect(armed).toBe(false);
	});

	it('is armed by a row the group’s own Add put there, with nothing typed', () => {
		// the case the whole reading is for: an intent changes the payload in the browser, fires no
		// input event and submits nothing, so there is no keystroke for a reading off the boxes to be
		// taken at — and the operator is left with a row they cannot save.
		const group = editor(['25']);
		group.add();

		expect(group.rows()).toBe(2);
		expect(armed).toBe(true);
	});

	it('is armed by a row the group’s own Remove took away', () => {
		// the half an operator actually meets: a tile they have just dropped, over a button that
		// would otherwise be switched off with the removal unsaved.
		const group = editor(['25', '50']);
		group.remove(1);

		expect(group.rows()).toBe(1);
		expect(armed).toBe(true);
	});

	it('rests again when the record it was seeded from catches up with the boxes', () => {
		// what a landed save leaves behind: the write commits, the loader answers with the record it
		// wrote, and the seam puts the form back on it. without that the group goes on reading as
		// changed against the record it replaced — the tick never draws and the button offers a press
		// with nothing behind it.
		const group = editor(['25']);
		group.type('tiles[0]', '50');
		expect(armed).toBe(true);

		group.redraw(<Editor rows={['50']} />);
		expect(armed).toBe(false);
		expect(group.held('tiles[0]')).toBe('50');
	});
});
