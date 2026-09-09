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
