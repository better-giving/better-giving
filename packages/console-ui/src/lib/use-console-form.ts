import { type DefaultValue, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import {
	type SavedFormInputs,
	useSavedFormState
} from '@better-giving/operator/saved-form-state.react';
import { type FormEvent, type RefObject, useCallback, useEffect, useState } from 'react';
import type { FormProps } from 'react-router';
import type { z } from 'zod';

// the one way a console fold mounts a form: conform's own pass over what the boxes hold, the
// button's rung underneath it, and the deployment's own answer standing beside both.
//
// packages/app/src/lib/admin/use-admin-form.ts is the same seam for /admin and this is not a copy
// of it. what carried:
//
//   - **`useForm` with `parseWithZod` as the one validator**, and the timing set here rather than
//     per fold. nothing is marked until a submit runs the pass, because before it the screen has no
//     evidence anybody is finished — a form seeded from what the deployment holds would otherwise
//     report a refusal nobody asked for. after it that inverts: the operator has been told what is
//     wrong and is fixing it, so a box already marked re-checks on every change and clears the
//     moment its value is good, rather than making them press again to learn whether the fix took.
//   - **the form states its own id.** conform's default is a `useId()`, and this page carries six
//     forms at once: an id off the fold's own statement is what makes a box's id the same string
//     every render and what conform finds the form element by when it moves focus.
//   - **conform's `getInputProps` reaches no control**, argued below.
//
// what did not:
//
//   - **`lastResult`, because there is nothing to feed it.** this console has no server half: a
//     press goes through ../routes/_index.tsx's one `clientAction` to the binary and comes back as
//     the binary's own json (../api/types.ts), not as a submission conform built. the seam is where
//     that stops being a fold's problem, and the answer is below.
//   - **matching a result to a form.** /admin's screens carry several forms under one action and
//     have to pluck the right result out of it; here each fold is handed its own answer as a prop
//     by the page, already narrowed, so there is nothing left to match.
//   - **a box naming which form was submitted.** the console's presses are told apart by the
//     `intent` each fold already posts, which ../routes/_index.tsx's `clientAction` branches on.
//   - **a comparison of its own.** whether a form holds anything to save is conform's `dirty`,
//     argued below.
//
// ---------------------------------------------------------------------------
// **a fold holding a list of rows adds and drops them here rather than at the far end**
// ({@link ConsoleForm.list}). both presses are conform's own intents: the browser applies them to
// the payload and nothing leaves this machine, so a row costs no round trip and takes nothing out
// of the boxes beside it. what a fold hands its row editor is therefore the two sets of attributes
// this composes, and never a control it minted — a press submitting a position would be an errand
// the far end has to answer and a redraw the operator waits for.
//
// **whether a form holds anything to save is conform's own `dirty`, and no fold answers it.** it is
// the values conform holds against the values it was seeded with, derived rather than sampled — so
// a row added or dropped moves it with no keystroke to read at, which is the one case a reading
// taken off the boxes at every input cannot see. the seed is `defaultValue` below, which every fold
// on this console states because every one of them opens on what the deployment holds; a form
// seeded from nothing is changed by holding anything at all, which is the same reading.
//
// **only the boxes the form states count toward it** (`shouldDirtyConsider`). a fold carries
// controls the schema names nothing about — the eight profile boxes the notifications fold posts
// hidden at what is stored, and the `intent` its own submit carries — and the comparison is against
// a seed that has no key for either, so a payload counted whole would read as changed forever and
// every button on the page would rest armed over boxes nobody had touched.
// ---------------------------------------------------------------------------
//
// ---------------------------------------------------------------------------
// **a refusal from the far end is kept beside conform's pass and is never fed to it as a result.**
//
// it could be, and it would draw: conform takes a `SubmissionResult`, one can be built out of the
// binary's json by hand, and a submission carrying no intent leaves `handleIntent` in
// @conform-to/dom's form.js marking every name in the error map validated — which is what a
// sentence has to be to survive the filter under it.
//
// what decides it is when they go, and conform would own that. with `shouldRevalidate: 'onInput'`
// the first keystroke anywhere on the form re-runs the pass over the whole form and replaces the
// error map with what that pass found — and the client pass cannot re-derive a sentence only the
// deployment knows. so an operator fixing the first of three refused boxes would watch the other
// two sentences disappear while they were still true, and press again to be told the same thing.
//
// so the deployment's own answer is this module's, keyed by the name of the box at fault, and it
// goes one box at a time: **a sentence about a box is about what that box was holding**, so the box
// being typed in is what ends it — {@link ConsoleForm.box} hangs that on the box itself rather than
// on the form, which is what keeps it to the one box the operator actually edited. the same reading
// holds a press back: a box still holding exactly what was turned down is a press whose outcome is
// already on the screen, so nothing starts, the button never draws `Saving` over it, and focus goes
// to the first box named.
//
// what a fold draws under a box is therefore {@link ConsoleForm.box}'s composition and never the
// answer itself: the deployment's word wins where there is one, because it is about the value that
// was actually sent, and conform's is about a box that never went.
// ---------------------------------------------------------------------------
//
// **conform's own props helper never reaches a control, and the field part is why.**
// `packages/operator/src/components/forms/Field.jsx` composes its own `aria-describedby` from the
// `id` it was handed — `${id}-err` is the message it draws — and renders every element it names.
// `getInputProps` composes one too, out of conform's `errorId`, and names an element it expects the
// *screen* to have rendered; no screen here renders one. spread its props onto that field and
// conform's wins through the component's `...rest`, so the control points at an id nothing on the
// page answers to: it renders, it hydrates, it looks right, and a reader following the description
// finds nothing.
//
// what a fold loses with them is nothing it had. `aria-invalid` is the field's own off the message
// it holds, the value is {@link ConsoleForm.box}'s below, and the constraint attributes
// (`maxLength` and its siblings) are deliberately left off — a box that silently stops accepting
// characters at the cap is a box whose "this is over the limit" can never be read.
//
// `getFormProps` is left off for a smaller reason: `mount` below has to compose conform's submit
// with the one that holds a press back, so the props are written out rather than spread and
// overwritten. what it would add beyond them is an `aria-describedby` for a sentence about the form
// as a whole, which no console form has — the schemas here are flat and every rule is about one box
// (CLAUDE.md). a form that states one is where that id, and the element it names, get composed.
//
// **the focus move survives that, because it was never in the spread.** on a pass that fails,
// conform walks `formElement.elements` and focuses the first whose `name` it holds an error for,
// having found the form by `document.forms.namedItem(formId)` — so it needs a `name` on the box and
// the id below on the `<form>`, and nothing else.

/** no box named, as one value: a new empty array every render would be a new state every render. */
const NONE: readonly string[] = [];

/** what a fold states about its form, once, for the seam and for nothing else to restate. */
export type StatedForm<S extends z.ZodObject> = {
	readonly id: string;
	readonly schema: S;
};

/**
 * one box of a form, as conform's own metadata describes it.
 *
 * a structural type rather than conform's `FieldMetadata`, so that a fold may bind a control the
 * field part has no component for by naming the same four things.
 */
export type Box = {
	readonly name: string;
	readonly defaultValue?: string | undefined;
	readonly errors?: string[] | undefined;
};

/** a box as `packages/operator/src/components/forms/Field.jsx` takes it. */
export type BoxProps = {
	readonly id: string;
	readonly name: string;
	readonly defaultValue: string | undefined;
	readonly error: string | undefined;
	readonly onInput?: () => void;
};

/**
 * what a fold hands its `<Form>`, whole.
 *
 * every one of them is stated, and `NonNullable` is what says so: react's own props carry an
 * explicit `| undefined` that `Required` leaves behind, and a fold composing its own handler over
 * {@link MountProps.onSubmit} would have to reach for `?.` — which is conform's pass silently not
 * running rather than a compile error.
 */
export type MountProps = {
	readonly [K in 'id' | 'noValidate' | 'onSubmit' | 'onInput']-?: NonNullable<FormProps[K]>;
} & {
	readonly ref: RefObject<HTMLFormElement | null>;
};

type Options<S extends z.ZodObject> = Omit<SavedFormInputs, 'press' | 'changed'> & {
	/**
	 * what the boxes are seeded with, where the fold has something to seed them from.
	 *
	 * a form seeded from what the deployment holds still reports no error until it is submitted —
	 * the seeding is values and the marking is the pass, and conform keeps the two apart.
	 *
	 * it is also what the button is armed against: the seed is the one side of conform's `dirty`,
	 * so a fold that draws a box the seed has no key for is a fold whose button never rests.
	 */
	readonly defaultValue?: DefaultValue<z.input<S>>;
	/**
	 * the deployment's or the binary's own refusal of the last press, keyed by the name of the box
	 * at fault, or `null` where the last press was not refused.
	 *
	 * the fold's to cut down first: a key for a box this form does not draw would send focus into a
	 * panel nobody has open, which is a press answered by nothing moving.
	 */
	readonly refused?: Record<string, string> | null;
};

/**
 * the four attributes conform writes onto a control that changes the boxes rather than the record.
 *
 * stated rather than imported: conform's own `ControlButtonProps` is exported from
 * `@conform-to/dom`, which this package does not declare — it arrives under the two conform
 * packages in ./package.json, and a type import from it would be a dependency nothing pins.
 */
type IntentProps = {
	readonly name: string;
	readonly value: string;
	readonly form: string;
	readonly formNoValidate: boolean;
};

/** the two presses a group of repeating rows is added to and dropped from. */
export type ListControls = {
	/** the press that puts an empty row at the end. */
	readonly add: IntentProps;
	/** the press that drops the row at one position. */
	readonly remove: (index: number) => IntentProps;
};

/** what a fold gets back: one `<Form>`'s props, its boxes, its button's rung, and what stands. */
export type ConsoleForm = {
	readonly mount: MountProps;
	/** how the button at the foot of this form is drawn. */
	readonly state: 'pending' | 'done' | 'disabled' | 'idle';
	/**
	 * the far end's sentences cut down to the boxes nobody has typed in since they arrived.
	 *
	 * drawn by {@link ConsoleForm.box} already; exported beside it for a fold that says something
	 * about the answer as a whole — how many boxes it named, or that it named one this fold does not
	 * draw.
	 */
	readonly standing: Record<string, string> | null;
	/** one box bound: the id, the name, what was typed, and the one message under it. */
	readonly box: (field: Box) => BoxProps;
	/**
	 * the two presses that add and drop a row of one field's list, as conform states them.
	 *
	 * a list is the one shape whose boxes are not fixed at the mount, and both presses are conform's
	 * own intents: the browser applies them to the payload and nothing leaves this machine, which is
	 * what keeps every other box's typed value across the change. the fold hands them to whatever
	 * draws the rows rather than minting a control of its own — a press that submitted a position
	 * would be an errand the far end has to answer.
	 *
	 * `name` is the list field's own — `fields.x.name` — and not a row's.
	 */
	readonly list: (name: string) => ListControls;
	/**
	 * the press taken by a control that does not submit — the button that opens a confirm card,
	 * whose submit is inside it. `false` is the press held back, with the boxes marked and the
	 * operator already in the first of them, so a fold answers it by doing nothing more.
	 */
	readonly press: () => boolean;
	/** the emptying a landed write does, for a fold that has its own reason to do it. */
	readonly reset: () => void;
};

export function useConsoleForm<S extends z.ZodObject>(
	stated: StatedForm<S>,
	options: Options<S>
): ConsoleForm & { readonly fields: ReturnType<typeof useForm<z.input<S>, z.output<S>>>[1] } {
	const [conform, fields] = useForm<z.input<S>, z.output<S>>({
		id: stated.id,
		// spread rather than written as a key: `exactOptionalPropertyTypes` is on, and conform's
		// option is absent-or-a-value rather than nullable.
		...(options.defaultValue === undefined ? {} : { defaultValue: options.defaultValue }),
		shouldValidate: 'onSubmit',
		shouldRevalidate: 'onInput',
		/* the boxes this form states and no other control on it, which is what the button is armed
		   off. the schema's own shape is that list — a name it does not state is a box the seed has
		   no key for, so counted it is a form that never rests. */
		shouldDirtyConsider: (name) => Object.hasOwn(stated.schema.shape, name),
		onValidate: ({ formData }) => parseWithZod(formData, { schema: stated.schema })
	});

	/* the id one box carries, composed here and nowhere else. every describing block the field part
	   draws is named from it, and the answer's key is what a box is found by when focus moves — so a
	   second derivation anywhere would be a sentence drawn under one box and focus moved to
	   another. */
	const boxId = useCallback((name: string) => `${stated.id}-${name}`, [stated.id]);

	const refused = options.refused ?? null;
	/* the boxes the answer named, as one value rather than the object it is read off. `refused` is
	   built at every render, so an effect keyed on it re-runs on renders that carry no new answer at
	   all — a press going into flight, a keystroke in another box — and each of those runs pulls
	   focus back out of wherever the operator had moved it to. the names are box names and hold no
	   spaces. */
	const named = refused === null ? '' : Object.keys(refused).join(' ');
	const names = named === '' ? NONE : named.split(' ');

	/* which of those boxes the operator has since typed in. state rather than a ref, because the
	   sentence under a box is drawn from it.

	   it is the boxes put right rather than the boxes left, so a form that has just been answered
	   holds none of them and every sentence the answer carries is standing. */
	const [fixed, setFixed] = useState<readonly string[]>(NONE);
	const unfixed = fixed.length === 0 ? names : names.filter((name) => !fixed.includes(name));
	const standing: Record<string, string> | null =
		refused === null || unfixed.length === 0
			? null
			: Object.fromEntries(unfixed.map((name) => [name, refused[name] ?? '']));

	/* a press that came back refused leaves the operator at the first box it named, which is where
	   the sentence about it is. the boxes still hold what was typed, so there is something to fix.

	   the answer is a dependency beside the names, so that a second refusal naming the same box
	   moves focus again: the press before it put focus on the button, and an effect keyed on the
	   names alone would leave it there with the sentence somewhere else on the screen. */
	const report = options.report;
	useEffect(() => {
		setFixed(NONE);
		const first = named === '' ? undefined : named.split(' ')[0];
		if (first !== undefined) document.getElementById(boxId(first))?.focus();
	}, [report, named, boxId]);

	const press = (): boolean => {
		const first = unfixed[0];
		if (first === undefined) return true;
		document.getElementById(boxId(first))?.focus();
		return false;
	};

	/* conform's own reading against the seed, and the button's rung underneath it. it is read here
	   at every render rather than sampled at an event, which is what makes a row added or dropped an
	   edit the button is armed over: those presses are the form's own intents and fire nothing to
	   sample at. */
	const save = useSavedFormState({ ...options, changed: conform.dirty, press });

	return {
		fields,
		mount: {
			id: conform.id,
			ref: save.form,
			noValidate: conform.noValidate,
			/* conform's pass first, and the press held back only where it let the submit through.
			   conform's own handler does not read `defaultPrevented` — it validates, reports and
			   prevents for itself — so a stop written before it would be a stop it walks past, and
			   its focus move would then land on top of the one the answer already made. */
			onSubmit: (event: FormEvent<HTMLFormElement>) => {
				conform.onSubmit(event);
				if (event.defaultPrevented) return;
				save.onSubmit(event);
			},
			onInput: save.onInput
		},
		state: save.state,
		standing,
		box: (field) => {
			const said = standing?.[field.name];
			/* the deployment's word where there is one. the two are only ever both true of a box
			   nobody has typed in since the answer, which is a box they are both about. */
			const error = said ?? field.errors?.[0];
			return {
				id: boxId(field.name),
				name: field.name,
				/* the submitted value, so a refusal re-renders the boxes holding what was typed rather
				   than clearing them. it is handed over as the platform's own `defaultValue`: these
				   boxes are uncontrolled, and a `value` with no handler beside it is a box nobody can
				   type in. */
				defaultValue: field.defaultValue,
				/* one message and not the list. two rules can fail on one value at once and there is
				   room for one thing to fix per box; the schemas state their rules in the order they
				   can be answered, so the first is the one an operator can act on. */
				error,
				/* hung on the box rather than on the form, which is the whole of what keeps the lift to
				   the one box that was edited. left off where the box has nothing standing under it, so
				   a form nobody has been refused over sets no state at any keystroke. */
				...(said === undefined
					? {}
					: {
							onInput: () =>
								setFixed((was) => (was.includes(field.name) ? was : [...was, field.name]))
						})
			};
		},
		list: (name) => ({
			add: conform.insert.getButtonProps({ name }),
			remove: (index) => conform.remove.getButtonProps({ name, index })
		}),
		press,
		reset: save.reset
	};
}
