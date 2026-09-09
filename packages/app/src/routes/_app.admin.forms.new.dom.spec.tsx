import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRoutesStub } from 'react-router';
import { expect, it, onTestFinished } from 'vitest';
import NewDonationForm from './_app.admin.forms.new';

// the amount row editor and the submit, pressed.
//
// what it covers: adding and removing a suggested-amount row on the screen that makes a donation
// form. the rows used to be three actions with their own workers cases behind them; they are now
// form state — `form.insert` and `form.remove` over `fields.suggested_amounts.getFieldList()` —
// which reaches no action and so is invisible to every workers spec in the tree. a row editor that
// stopped inserting, or that dropped the row after the one pressed, would ship with the suite
// green.
//
// and what the submit does to itself while its own write is in flight, which is invisible to a
// workers spec for the same reason: the payload is unchanged either way, and what a native
// `disabled` costs is the focus of the operator standing on the button.
//
// mounted rather than rendered to a string, and that is why this file is in the dom pool: the
// intents are handled by conform inside a submit event, so a row is added by a press and by
// nothing else. a `renderToStaticMarkup` can read the attributes the controls carry and never what
// pressing one does, which is the whole of the behaviour.
//
// it is not the browser spec CLAUDE.md bans over a dashboard screen. nothing here reads a computed
// style, a class or a sentence: what is asserted is which boxes exist, what each is named and what
// each holds — the form state the submitted body is built out of.
//
// the action never settles, so a press that does reach it leaves the screen mid-flight rather than
// re-rendering over the evidence — which is what the pending-state cases read. an intent submission
// is not one of those presses: it is `formNoValidate` and conform stops it before react router sees
// it, so an added row that reached the network would be a different defect from the one this file
// is here for, and a case of its own holds that it does not.

// react refuses to flush work inside `act` without this, and says so rather than hanging.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * mounts `tree` into a document that lives as long as the case, and hands back its root element.
 *
 * `appendChild` rather than `append`: worker-configuration.d.ts declares HTMLRewriter's `Element`,
 * which merges into the DOM's and brings an `append(content, options)` that wins here.
 */
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

/**
 * the boxes with nothing typed and one blank amount row.
 *
 * not the seed `NEW_FORM` publishes, which fills the bounds and opens three amount rows: the row
 * editor is what this file reads, and it is read from one row so that adding and removing are
 * counted against a group whose starting size is not itself under test.
 */
const EMPTY_FORM = {
	name: '',
	status: 'draft',
	program_mode: 'none',
	program_id: '',
	min_minor: '',
	max_minor: '',
	suggested_amounts: [''],
	allowed_origins: []
} as const;

/**
 * the same boxes filled in the way an operator would leave them.
 *
 * every rule in `FORM_INPUT_FORM` passes on these, which is what a case about the pending state
 * needs: conform validates in the browser before react router sees the submit, so a seed with a
 * blank box would be refused on the press and no navigation would ever start.
 */
const FILLED_FORM = {
	...EMPTY_FORM,
	name: 'Spring appeal',
	min_minor: '5',
	max_minor: '100',
	suggested_amounts: ['25']
} as const;

/**
 * the screen as a deployment that is ready to make a form serves it, opened on `values`.
 *
 * one site, which is the least that leaves the submit pressable: no site only switches it off.
 * nothing here is a blocker, so the form is drawn rather than replaced by the disabled button.
 */
function screen(values: Record<string, unknown> = EMPTY_FORM): {
	root: HTMLElement;
	posted: string[];
} {
	const posted: string[] = [];
	const Stub = createRoutesStub([
		{
			path: '/admin/forms/new',
			Component: () =>
				createElement(NewDonationForm as never, {
					loaderData: {
						readiness: null,
						sites: ['https://example.org'],
						programs: [],
						values,
						currency: 'USD'
					},
					actionData: undefined,
					params: {},
					matches: []
				}),
			action: () => {
				posted.push('post');
				// never settles, so a press that did reach the action leaves the screen mid-flight
				// rather than re-rendering over the evidence.
				return new Promise<never>(() => {});
			}
		}
	]);
	return { root: mount(createElement(Stub, { initialEntries: ['/admin/forms/new'] })), posted };
}

/** every amount box, in the order the screen draws them. */
function amountBoxes(root: HTMLElement): HTMLInputElement[] {
	return [...root.querySelectorAll('input[name^="suggested_amounts"]')] as HTMLInputElement[];
}

/** the amount box at `index`, which is what a case types into. */
function amountBox(root: HTMLElement, index: number): HTMLInputElement {
	const box = amountBoxes(root)[index];
	if (box === undefined) throw new Error(`the screen drew no amount box at position ${index}`);
	return box;
}

/** the control that adds a row. found by its accessible name, the way an operator finds it. */
function addControl(root: HTMLElement): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === 'Add an amount'
	);
	if (found === undefined) throw new Error('the screen drew no control that adds an amount');
	return found as HTMLButtonElement;
}

/** the control that drops the row at `index`, which says which row it is and nothing else does. */
function removeControl(root: HTMLElement, index: number): HTMLButtonElement {
	const label = `Remove suggested amount ${index + 1}`;
	const found = root.querySelector(`button[aria-label="${label}"]`);
	if (found === null) throw new Error(`the screen drew no control labelled "${label}"`);
	return found as HTMLButtonElement;
}

/**
 * the control that writes the form, found by the name it carries at rest.
 *
 * the same node keeps the label swap, so a case holds the reference across the press it made.
 */
function submitControl(root: HTMLElement): HTMLButtonElement {
	const found = [...root.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === 'Add donation form'
	);
	if (found === undefined) throw new Error('the screen drew no control that adds a donation form');
	return found;
}

/**
 * types into a box the way a keystroke does.
 *
 * through the prototype setter, which is what react's own change tracking reads — assigning
 * `box.value` leaves it believing the box still holds what it rendered.
 */
function type(box: HTMLInputElement, value: string): void {
	act(() => {
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
		setter?.call(box, value);
		box.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

/** presses a control and lets the form settle, which is what carries the intent to conform. */
function press(button: HTMLButtonElement): void {
	act(() => {
		button.click();
	});
}

it('draws one empty amount box with nothing to remove', () => {
	const { root } = screen();

	// the one row the fixture holds, and a lone row draws no Remove: dropping it would leave the
	// group with nothing to type into, which is a state the editor has no shape for.
	expect(amountBoxes(root).map((b) => b.name)).toEqual(['suggested_amounts[0]']);
	expect(root.querySelector('button[aria-label^="Remove suggested amount"]')).toBeNull();
});

it('adds an amount box, indexed after the boxes already there', () => {
	const { root } = screen();

	press(addControl(root));

	// the index is the whole of it: two boxes sharing a name is one value in the submitted body,
	// and a second box that reused index 0 would silently overwrite the first amount.
	expect(amountBoxes(root).map((b) => b.name)).toEqual([
		'suggested_amounts[0]',
		'suggested_amounts[1]'
	]);
});

it('keeps what is already typed when a box is added', () => {
	const { root } = screen();

	type(amountBox(root, 0), '25');
	press(addControl(root));

	const boxes = amountBoxes(root);
	// the press is a submit event, and a submit that re-seeded the boxes from the loader would hand
	// an operator back an empty group every time they added a row.
	expect(boxes.map((b) => b.value)).toEqual(['25', '']);
});

it('draws a Remove on every row the moment there are two', () => {
	const { root } = screen();

	press(addControl(root));

	expect(
		[...root.querySelectorAll('button[aria-label^="Remove suggested amount"]')].map((b) =>
			b.getAttribute('aria-label')
		)
	).toEqual(['Remove suggested amount 1', 'Remove suggested amount 2']);
});

it('removes the row whose own control was pressed', () => {
	const { root } = screen();

	press(addControl(root));
	press(addControl(root));
	type(amountBox(root, 0), '10');
	type(amountBox(root, 1), '25');
	type(amountBox(root, 2), '50');

	press(removeControl(root, 1));

	// the case the whole file is for. an off-by-one in the index the control carries drops a
	// neighbour, and every remaining figure still looks like a figure an operator typed — so the
	// values are what is read, never the count.
	const left = amountBoxes(root);
	expect(left.map((b) => b.value)).toEqual(['10', '50']);
	// and the survivors renumber, because the index is the position in the submitted body rather
	// than an identity the row keeps.
	expect(left.map((b) => b.name)).toEqual(['suggested_amounts[0]', 'suggested_amounts[1]']);
});

it('drops back to one box with no Remove when the second is removed', () => {
	const { root } = screen();

	press(addControl(root));
	press(removeControl(root, 1));

	expect(amountBoxes(root)).toHaveLength(1);
	expect(root.querySelector('button[aria-label^="Remove suggested amount"]')).toBeNull();
});

it('adds and removes without posting anything', () => {
	const { root, posted } = screen();

	press(addControl(root));
	press(removeControl(root, 1));
	press(addControl(root));

	// adding a row is form state, not a write: CLAUDE.md bans a client-side mutation path in /admin,
	// and these two controls are only allowed to be the form's own because they reach no action.
	expect(posted).toEqual([]);
});

it('keeps the pressed submit focusable and focused while the write is in flight', () => {
	const { root, posted } = screen(FILLED_FORM);

	const submit = submitControl(root);
	submit.focus();
	press(submit);

	expect(posted).toEqual(['post']);
	// the native attribute is what takes focus off a control, so the pending state may not reach it:
	// an operator standing on the button they just pressed has to still be standing on it when the
	// dots arrive over the label to say the press was heard.
	expect(submit.disabled).toBe(false);
	expect(submit.getAttribute('aria-busy')).toBe('true');
	expect(document.activeElement).toBe(submit);
	expect(submit.textContent?.trim()).toBe('Add donation form');
});

it('ignores a second press while the write is in flight', () => {
	const { root, posted } = screen(FILLED_FORM);

	const submit = submitControl(root);
	press(submit);
	press(submit);

	// `aria-disabled` is advisory and stops nothing, so the press is closed in the handler: one
	// operator intent that reached the action twice is two donation forms made.
	expect(posted).toEqual(['post']);
});
