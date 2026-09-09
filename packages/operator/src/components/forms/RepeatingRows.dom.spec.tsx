import { describe, expect, it } from 'vitest';
import { mount, render } from '../render.testing';
import { type RepeatingRow, type RowControl, RepeatingRows } from './RepeatingRows.jsx';

// zero or more boxes holding one kind of value. what a case here is about is that a form can submit
// them: a name, a value per row, a sentence under the row it is about, one about the list itself,
// and the two controls the caller minted for adding and dropping a row.
//
// **the two presses are the caller's, so what is asserted about them is that they are carried
// through untouched.** a form layer's list intent is a name and a value it composed, and a group
// that wrote either of them would submit a position the form never asked about — which is the whole
// of why they arrive as props.
//
// a component spec is `.tsx` and both pools collect either extension — ./Field.dom.spec.tsx says
// why.

/** the intent a form layer mints for the control that puts an empty row at the end. */
const ADD: RowControl = { name: '__intent__', value: 'insert', formNoValidate: true };

/** the intent a form layer mints for the control that drops one row, per row. */
const drop = (key: string): RowControl => ({
	name: '__intent__',
	value: `remove:${key}`,
	formNoValidate: true
});

/** two sites, each carrying the identity its screen would key it by. */
const SITES: readonly RepeatingRow[] = [
	{ id: 'origins-0', key: 'riverbank', defaultValue: 'riverbank.org', remove: drop('riverbank') },
	{ id: 'origins-1', key: 'shop', defaultValue: 'shop.riverbank.org', remove: drop('shop') }
];

/** the group inside a form, which is the only place the names and values it submits are readable. */
function Bound(props: { rows: readonly RepeatingRow[]; error?: string }) {
	return (
		<form>
			<RepeatingRows
				id="origins"
				name="allowed_origins"
				legend="Allowed origins"
				add={ADD}
				rows={props.rows}
				error={props.error}
			/>
		</form>
	);
}

/** the same group with its name drawn to a reader and not on the screen. */
function Stated(props: { rows: readonly RepeatingRow[] }) {
	return (
		<form>
			<RepeatingRows
				id="origins"
				name="allowed_origins"
				legend="Allowed origins"
				legendHidden
				add={ADD}
				rows={props.rows}
			/>
		</form>
	);
}

/**
 * the rows as a list named by position draws them: the box's id is its place in the list and the
 * identity that keys it is the row's own.
 *
 * the site list on the operator console is one — a row may be blank and two rows may hold the same
 * text while an operator is mid-edit, so nothing in a row's *value* names it. what the form layer
 * mints per row is what does.
 */
function byPosition(rows: readonly string[]): RepeatingRow[] {
	return rows.map((key, at) => ({ id: `origins-${at}`, key, remove: drop(key) }));
}

/** the group carrying one row the operator may neither type in nor drop. */
function Locked(props: { rows: readonly RepeatingRow[]; disabled?: boolean }) {
	return (
		<form>
			<RepeatingRows
				id="origins"
				name="allowed_origins"
				legend="Allowed origins"
				add={ADD}
				disabled={props.disabled}
				fixed={{
					id: 'origins-locked',
					label: 'The origin this list is served on',
					value: 'https://fixed.example',
					aside: <span className="aside">default</span>
				}}
				rows={props.rows}
			/>
		</form>
	);
}

/** the boxes the group drew, as elements a case can keep hold of across a re-render. */
function inputs(root: HTMLElement): HTMLInputElement[] {
	return [...root.querySelectorAll<HTMLInputElement>('.adm-rows__row input')];
}

/** the box at one position, holding what an operator has typed into it. */
function typeInto(root: HTMLElement, at: number, text: string): void {
	const box = inputs(root)[at];
	if (box === undefined) throw new Error('the case drew no box at that position');
	box.value = text;
}

/** what the browser would send, as `name=value` pairs in the order the rows are drawn. */
function submitted(root: HTMLElement): string[] {
	const form = root.querySelector('form');
	if (form === null) throw new Error('the case drew no form to read');
	return [...new FormData(form)].map(([name, value]) => `${name}=${String(value)}`);
}

/** the sentence one box points at, read off the element it names. */
function described(root: HTMLElement, box: HTMLInputElement): string[] {
	const named = box.getAttribute('aria-describedby');
	if (named === null) return [];
	return named
		.split(' ')
		.map((id) => root.ownerDocument.getElementById(id)?.textContent ?? `<no ${id}>`);
}

describe('repeating rows mounted into a document', () => {
	it('submits a name and the value each row holds', () => {
		const root = render(Bound, { rows: SITES });

		expect(submitted(root)).toEqual([
			'allowed_origins=riverbank.org',
			'allowed_origins=shop.riverbank.org'
		]);
	});

	/**
	 * a box is the platform's own, so a node react keeps goes on showing and posting what is in it
	 * however the value it was drawn with changes — and the id of a row named by position is
	 * whichever row is in that place right now. keyed by that id, a row appended at the end would be
	 * fine and a row dropped would not, which is the case under this one.
	 */
	it('keeps every box an operator has typed into when a row is added at the end', () => {
		const editor = mount(Bound, { rows: byPosition(['a', 'b']) });
		const before = inputs(editor.root);
		typeInto(editor.root, 0, 'https://aaa.example');
		typeInto(editor.root, 1, 'https://bbb.example');

		editor.again({ rows: byPosition(['a', 'b', 'c']) });

		expect(inputs(editor.root).slice(0, 2)).toEqual(before);
		expect(submitted(editor.root)).toEqual([
			'allowed_origins=https://aaa.example',
			'allowed_origins=https://bbb.example',
			'allowed_origins='
		]);
	});

	/**
	 * the defect the row's own key exists to stop. under names the group has already drawn, dropping
	 * the middle row hands its box to the row that took its place: react keeps the node, the node
	 * keeps what was typed into it, and on the screen and in the body Remove deleted the wrong one.
	 */
	it('drops the row that was removed and leaves every box below holding its own value', () => {
		const editor = mount(Bound, { rows: byPosition(['a', 'b', 'c']) });
		const [first, , third] = inputs(editor.root);
		typeInto(editor.root, 0, 'https://aaa.example');
		typeInto(editor.root, 1, 'https://bbb.example');
		typeInto(editor.root, 2, 'https://ccc.example');

		editor.again({ rows: byPosition(['a', 'c']) });

		expect(inputs(editor.root)).toEqual([first, third]);
		expect(submitted(editor.root)).toEqual([
			'allowed_origins=https://aaa.example',
			'allowed_origins=https://ccc.example'
		]);
	});

	it('carries the caller’s own intent through both presses and writes no position of its own', () => {
		// the group mints neither control: what a Remove submits is what the form layer composed for
		// that row, and a name or a value written here would be a press the form never asked about.
		const root = render(Bound, { rows: SITES });
		const presses = [...root.querySelectorAll<HTMLButtonElement>('button')];

		expect(
			presses.map((button) => `${button.getAttribute('name')}=${button.getAttribute('value')}`)
		).toEqual(['__intent__=remove:riverbank', '__intent__=remove:shop', '__intent__=insert']);
		expect(presses.every((button) => button.formNoValidate)).toBe(true);
	});

	it('draws no control beside a row the caller offers no way to drop', () => {
		// a list that has to keep one row is the caller's rule and not this group's: it states no
		// control for that row, and the trailing track is left empty rather than holding a press that
		// would take the last box away.
		const root = render(Bound, {
			rows: [{ id: 'origins-0', key: 'only', defaultValue: 'riverbank.org' }]
		});

		expect(root.querySelectorAll('.adm-rows__row button')).toHaveLength(0);
		expect(root.querySelectorAll('.adm-rows button')).toHaveLength(1);
	});

	it('draws a row’s own sentence under that row’s box and marks no other', () => {
		const root = render(Bound, {
			rows: [
				{ id: 'origins-0', key: 'good', defaultValue: 'https://good.example' },
				{ id: 'origins-1', key: 'bad', defaultValue: 'acme.org', error: 'Write `https://` first.' }
			]
		});
		const [good, bad] = inputs(root);

		expect(good?.getAttribute('aria-invalid')).toBeNull();
		expect(described(root, good as HTMLInputElement)).toEqual([]);
		expect(bad?.getAttribute('aria-invalid')).toBe('true');
		expect(described(root, bad as HTMLInputElement)).toEqual(['Write `https://` first.']);
	});

	it('draws a row refused by the group’s message only where it carries none of its own', () => {
		// what is true of the list is true of every row that has nothing else said about it, because
		// either of them fixes it — and a row already carrying a sentence has one thing to fix rather
		// than two.
		const root = render(Bound, {
			rows: [
				{ id: 'origins-0', key: 'a', defaultValue: 'https://a.example' },
				{ id: 'origins-1', key: 'b', defaultValue: 'acme.org', error: 'Write `https://` first.' }
			],
			error: 'That is more sites than may be stored.'
		});
		const [plain, said] = inputs(root);

		expect(described(root, plain as HTMLInputElement)).toEqual([
			'That is more sites than may be stored.'
		]);
		expect(described(root, said as HTMLInputElement)).toEqual(['Write `https://` first.']);
	});

	/**
	 * a group whose name is already the heading a step above it draws that name to a reader and not
	 * on the screen. dropping `legend` instead is the defect this covers: it takes the name off
	 * every box and every Remove with it, and nothing about the screen shows that it did.
	 */
	it('keeps every row named when the legend is drawn to a reader only', () => {
		const root = render(Stated, { rows: SITES });

		expect(root.querySelector('legend')?.className).toBe('adm-vh');
		expect(inputs(root).map((box) => box.getAttribute('aria-label'))).toEqual([
			'Allowed origins 1',
			'Allowed origins 2'
		]);
		expect(
			[...root.querySelectorAll('.adm-rows__row button')].map((button) =>
				button.getAttribute('aria-label')
			)
		).toEqual(['Remove Allowed origins 1', 'Remove Allowed origins 2']);
	});

	/**
	 * the guarantee a locked row rests on, and it is the missing name alone: a box with no name is
	 * in no submission and in no reading of the form's own boxes by name, which is what feeds both
	 * the press and the guard in front of it. the row is open to be read on top of that — read-only
	 * and not disabled, which ./RepeatingRows.jsx's `FixedRow` header argues.
	 */
	it('keeps a fixed row out of the submission and open to be read', () => {
		const root = render(Locked, { rows: SITES });
		const locked = inputs(root)[0];

		expect(locked?.value).toBe('https://fixed.example');
		expect(locked?.readOnly).toBe(true);
		expect(locked?.disabled).toBe(false);
		// focusable, which is what lets a value wider than the box be scrolled and selected.
		expect(locked?.tabIndex).not.toBe(-1);
		locked?.focus();
		expect(document.activeElement).toBe(locked);
		expect(locked?.hasAttribute('name')).toBe(false);
		expect(submitted(root)).toEqual([
			'allowed_origins=riverbank.org',
			'allowed_origins=shop.riverbank.org'
		]);
	});

	/**
	 * the group's `disabled` closes every row and the locked one is a row: left open under a save it
	 * is the one box on the group still taking focus while the press that would answer it is closed.
	 */
	it('closes the fixed row with the group', () => {
		const root = render(Locked, { rows: SITES, disabled: true });

		expect(inputs(root)[0]?.disabled).toBe(true);
	});

	/**
	 * the positions are the editable rows' and the locked row is in none of them: numbered among
	 * them it would be a second box called `Allowed origins 1`, and the Remove it has no business
	 * offering would be the one drop the list cannot take.
	 */
	it('names a fixed row for what it is and offers no control that drops it', () => {
		const root = render(Locked, { rows: SITES });

		expect(inputs(root).map((box) => box.getAttribute('aria-label'))).toEqual([
			'The origin this list is served on',
			'Allowed origins 1',
			'Allowed origins 2'
		]);
		const rows = [...root.querySelectorAll('.adm-rows__row')];
		expect(rows[0]?.querySelector('button')).toBe(null);
		expect(rows[0]?.querySelector('.aside')?.textContent).toBe('default');
		expect(
			[...root.querySelectorAll('.adm-rows__row button')].map((button) =>
				button.getAttribute('aria-label')
			)
		).toEqual(['Remove Allowed origins 1', 'Remove Allowed origins 2']);
	});
});
