import { type DefaultValue, useForm } from '@conform-to/react';
import { parseWithZod, type SubmissionResult } from '@conform-to/zod/v4';
import { type MouseEventHandler, useEffect, useRef } from 'react';
import type { z } from 'zod';
import { type FormRejection, type StatedForm, WHICH_FORM } from '$lib/forms/definition';

// the browser half of the form seam: the one way an /admin screen mounts a form it stated.
//
// `$lib/server/conform.ts`'s header is the canonical statement of every rule this layer keeps and
// the mechanism behind each; nothing is restated here. what this module is, is where three of them
// stop being a screen's to remember:
//
// the id is matched before a result is fed to a form, so a screen carrying more than one — the
// three groups on /admin/forms/[id] — cannot show one form's errors under another's boxes; the
// action's result is plucked out of whatever else that screen's action returns, which is a
// different union per screen and the same pluck every time; and the validator, the timing and the
// id all come off the one `defineForm` statement the action reads too, so there is no second
// literal to keep in step with the first.
//
// two more belong to a screen carrying several forms and are here for the same reason: `whichForm`
// is the box a body names its own form in, so the one `action` a route has can tell four
// submissions apart — and that box, counted, would be every group on such a screen reading as
// changed forever, so what a group holds to save is conform's own `dirty` over the boxes the form
// states and the seed it was mounted on, which `useAdminForm` settles below for every screen at
// once.
//
// ---------------------------------------------------------------------------
// **which of the two things computing an `aria-describedby` owns the box: the library's `Field`,
// never conform.** it is decided here because it is decided once, and `./boxProps` below is the
// whole of how a screen binds a box.
//
// both compute one. `Field` composes its own from the `id` it was handed — `${id}-err` is the
// message it draws — and renders every element it names. conform's `getInputProps` composes one
// too, out of its `errorId`, and names an element it expects the *screen* to have rendered; no
// screen in this app renders one. spread conform's props onto `Field` and conform's wins through
// that component's `...rest`, so the control points at an id nothing on the page answers to. it
// renders, it hydrates, it looks right, and a reader following the description finds nothing.
//
// so conform's aria attributes never reach a control. what a screen loses with them is nothing it
// had: `aria-invalid` is `Field`'s off the same message, the value is `boxProps`' below, and the
// constraint attributes (`maxLength` and its siblings) are deliberately not passed on — a box that
// silently stops accepting characters at the cap is a box whose "must be at most 200 characters"
// can never be read.
//
// **the focus move survives that, because it was never in the spread.** on a result carrying
// errors conform's form controller walks `formElement.elements` and focuses the first field
// element whose `name` is a key in the error map (`report` in @conform-to/dom's form.js), having
// found the form by `document.forms.namedItem(formId)`. so the move needs a `name` on the box and
// `getFormProps`' id on the `<form>`, and nothing else — which is why a nineteen-box form binding
// its boxes through here still puts the reader in the first one that failed rather than leaving
// them at the button with the messages off screen above them. ./use-admin-form.spec.ts renders the
// real pair and runs that same walk over the markup, and holds the dropped description as a
// defect rather than as an intention.
// ---------------------------------------------------------------------------
//
// **nothing here may import from `$lib/server/**`, and neither may a screen that calls it.** nothing
// at build time refuses that import: everything this hook is handed is evaluated in the browser, so
// a schema reached for from the server tree would put D1, the stripe client and this deployment's
// secrets into the bundle a visitor downloads. what holds it is
// the module graph rather than a call's own text — ./use-admin-form.spec.ts over this module and
// `../../routes.spec.ts` over every route — with the source-text rules in
// `packages/app/form-rules.ts` beside them, and this module existing is what makes it one boundary
// rather than one per screen.

/**
 * what a screen's action may answer with, as the component is handed it.
 *
 * every arm of every screen's action either carries a rejection under `form` or carries none —
 * a redirect leaves nothing at all, and a save that reports in place answers with whatever else
 * that screen needs beside it. it is one type here so that no screen writes the narrowing.
 *
 * the index signature is what admits the second kind, and it is load-bearing rather than loose:
 * `{ form?: … }` alone is a *weak* type, so an arm carrying none of its properties — a press that
 * reports what it did and has no rejection to carry — is refused at every call site with
 * "no properties in common". what those arms carry is the screen's and is narrowed at the screen;
 * what this type owes is only that `form` is read the same way wherever there is one.
 */
export type AdminActionData =
	| { readonly form?: FormRejection; readonly [answered: string]: unknown }
	| null
	| undefined;

/**
 * the result belonging to this form, or nothing where the last action was not about it.
 *
 * separate from the hook and exported for the reason the match is worth having at all: this is the
 * step a screen with two forms gets wrong, and it is decidable without a dom.
 */
export function resultFor(
	form: { readonly id: string },
	actionData: AdminActionData
): SubmissionResult | undefined {
	const rejection = actionData?.form;
	if (!rejection || rejection.id !== form.id) return undefined;
	return rejection.result;
}

/**
 * the hidden box that names which of a screen's forms a body was submitted from.
 *
 * one per `<form>` on a screen with more than one, carrying the id that form already states. what
 * it is for and why it is a box rather than a query on the address is `$lib/forms/definition.ts`;
 * what reads it is `submittedForm` in `$lib/server/conform.ts`.
 *
 * `type` is stated here rather than left to the screen, because a control the operator can see is
 * the one way this goes wrong and it goes wrong silently: the value renders as a text box holding
 * `form-edit-name`, and every other thing about the form still works.
 */
export function whichForm(id: string): {
	readonly type: 'hidden';
	readonly name: string;
	readonly value: string;
} {
	return { type: 'hidden', name: WHICH_FORM, value: id };
}

/** what a screen may say about a form beyond the statement the action reads too. */
type Options<S extends z.ZodObject> = {
	/**
	 * the record this form is seeded from, where there is one.
	 *
	 * a form seeded from a record still reports no error until it is submitted — the seeding is
	 * values and the marking is `lastResult`, and conform keeps the two apart.
	 *
	 * it is also the side the save button is armed against, so it holds a key for every box the form
	 * states: one it has no key for is a group that reads as changed the moment anything is in that
	 * box, and a form seeded from nothing is armed by holding anything at all — which is the reading
	 * a group of empty boxes wants.
	 */
	readonly defaultValue?: DefaultValue<z.input<S>>;
};

/**
 * mount a form the screen stated: conform's own metadata and fieldset, ready to bind.
 *
 * the timing is the dashboard's ladder and is set here rather than per screen, in conform's two
 * settings. nothing is marked until a submit runs the pass, because before it the screen has no
 * evidence anybody is finished — an address is invalid for every keystroke but the last, and a blur
 * fires on a box somebody meant to come back to. after it that inverts: they have been told what is
 * wrong and are fixing it, so a box already marked re-checks on every change and clears the moment
 * its value is good, rather than making them press the button again to learn whether the fix took.
 */
export function useAdminForm<S extends z.ZodObject>(
	form: StatedForm<S>,
	actionData: AdminActionData,
	options: Options<S> = {}
) {
	const mounted = useForm<z.input<S>, z.output<S>>({
		id: form.id,
		lastResult: resultFor(form, actionData),
		// spread rather than written as a key: `exactOptionalPropertyTypes` is on, and conform's
		// option is absent-or-a-value rather than nullable.
		...(options.defaultValue === undefined ? {} : { defaultValue: options.defaultValue }),
		shouldValidate: 'onSubmit',
		shouldRevalidate: 'onInput',
		/* the boxes this form states and no other control on it, which is what `dirty` is read over.
		   a screen carrying more than one group gives each of them `whichForm`'s box and no seed has
		   a key for it — counted, every group on that screen reads as changed forever and no save
		   button on it ever rests. */
		shouldDirtyConsider: (name) => Object.hasOwn(form.schema.shape, name),
		onValidate: ({ formData }) => parseWithZod(formData, { schema: form.schema })
	});

	/* the form put back on a seed that changed under it, which is what a landed write leaves behind.
	   conform reads its seed at the mount and at a reset and at no other moment — `onUpdate` in
	   @conform-to/dom keeps a changed `defaultValue` and rebuilds nothing from it — so a group saved
	   and answered with a redirect would go on reading as changed against the record it replaced:
	   the tick never draws, and the button goes on offering a press with nothing behind it.

	   the element's own reset is what conform listens for, and react has written the new seed onto
	   each box's attribute by the time this runs, so the boxes and the metadata counting them go
	   back together. it is the seed that says when and not the marker a landing published: a second
	   save into the same group leaves that marker exactly where it was, and a group whose record
	   did not move has nothing to put back — which is what leaves the three groups beside a saved
	   one holding whatever is typed in them. */
	const seed = JSON.stringify(options.defaultValue ?? null);
	const seeded = useRef(seed);
	useEffect(() => {
		if (seeded.current === seed) return;
		seeded.current = seed;
		document.forms.namedItem(form.id)?.reset();
	}, [seed, form.id]);

	return mounted;
}

/**
 * the parts of a form a list guard reaches for: the intent it is guarding, and the pass it runs
 * first.
 *
 * stated structurally rather than as conform's `FormMetadata`, for the reason `resultFor` above
 * takes `{ id }`: what the guard needs is two calls, and a parameter naming the whole metadata type
 * would tie this module to the schema each screen's form is generic in.
 */
type ListForm = {
	readonly insert: {
		getButtonProps(payload: { name: string }): IntentProps;
	};
	readonly validate: (payload: { name: string }) => void;
};

/**
 * the four attributes conform writes onto a control that changes the boxes rather than the record.
 *
 * stated rather than imported: conform's own `ControlButtonProps` is exported from
 * `@conform-to/dom`, which this package does not declare — it arrives under the two conform
 * packages in packages/app/package.json, and a type import from it would be a dependency nothing
 * pins.
 */
type IntentProps = {
	readonly name: string;
	readonly value: string;
	readonly form: string;
	readonly formNoValidate: boolean;
};

/**
 * the Add button of a row editor, which does not add a row while the rows already there are
 * refused.
 *
 * conform applies an insert to the payload *before* it resolves the schema, and the client applies
 * it whether or not errors came back — so a guard written into the schema cannot stop the row from
 * appearing, and the operator gets a fresh empty box stacked under boxes nobody has been told are
 * wrong. the press is the only place the row can still be withheld, which is why this is an
 * `onClick` and not a rule.
 *
 * the pass is the form's own stated schema over the live form, so the guard refuses exactly what the
 * submit would: one statement, `$lib/forms/definition.ts`'s, read here and at the action.
 *
 * only this list's own keys stop the press. the schema covers the whole form on the create screen,
 * and a blank name is not a reason to withhold a row from a group that is fine — so the keys read
 * are this field's and the rows under it, which conform spells `suggested_amounts[1]`.
 *
 * `form.validate({ name })` is what makes the refusal visible: nothing is marked before a submit
 * (see `useAdminForm` above), so without it the press would do nothing at all and look broken.
 * conform then keeps an error whose name is the validated one or sits under it — `handleIntent` in
 * `@conform-to/dom`'s form.js — so validating the list marks every offending row and nothing else.
 */
export function insertWhenValid<S extends z.ZodObject>(
	form: ListForm,
	stated: StatedForm<S>,
	name: string
): IntentProps & { readonly onClick: MouseEventHandler<HTMLButtonElement> } {
	return {
		...form.insert.getButtonProps({ name }),
		onClick(event) {
			// the button's own form, rather than one looked up by id: the button is inside it, and
			// `event.currentTarget.form` is what the browser already resolved.
			const element = event.currentTarget.form;
			if (element === null) return;
			// no submitter, so the intent this button carries is not in the body — what is read is
			// the boxes as they stand.
			const submission = parseWithZod(new FormData(element), { schema: stated.schema });
			if (submission.status === 'success') return;
			const refused = Object.keys(submission.error ?? {}).some(
				(key) => key === name || key.startsWith(`${name}[`)
			);
			if (!refused) return;
			event.preventDefault();
			form.validate({ name });
		}
	};
}

/**
 * the element the library's `Field` draws a box's message into.
 *
 * `Field` names every describing block it renders from the `id` it was handed, and the id is the
 * caller's — so the derivation is the component's surface rather than a detail of it. it is stated
 * here so that a screen drawing a control the library has no component for names the same element
 * `Field` would have, and so that ./use-admin-form.spec.ts fails rather than the screen if the
 * library ever renames it.
 */
export function boxErrorId(id: string): string {
	return `${id}-err`;
}

/**
 * one box of a form, as conform's own metadata describes it.
 *
 * exported because the shared field groups under ./forms/ take boxes rather than a form: the two
 * screens that mount them hold different forms — one whole-form statement on the create, three
 * group statements on the editor — and a group typed against either one of those would be a group
 * the other screen has to copy.
 */
export type Box = {
	readonly id: string;
	readonly name: string;
	readonly defaultValue?: string | undefined;
	readonly errors?: string[] | undefined;
};

/** what a screen may say about a box beyond what the form already states. */
type BoxOptions = {
	/**
	 * an element describing this box that the field itself does not draw.
	 *
	 * one case, and it is a fieldset's: a message about a pair of boxes belongs to neither of them,
	 * so it is rendered once by the group and both boxes point at it. it is taken *in* rather than
	 * replacing — a box carrying a rule it broke and a pair rule it broke has two things said about
	 * it, and a description naming one of them is the other one lost.
	 *
	 * what it cannot see is a `hint` or a `needed` on the same field, which `Field` names from its
	 * own id and this composition would drop. no screen carries both; one that needs to is a
	 * widening of this option rather than an `aria-describedby` written at a screen.
	 */
	readonly describedBy?: string;
	/**
	 * whether this box is refused by something the field itself cannot see.
	 *
	 * the same fieldset case, and the same reason it is decided here: `Field` reads a box as
	 * refused from the message it was handed, and a box whose only failure belongs to the pair
	 * carries no message of its own — the group draws it, once, for both. it still has to read
	 * refused, because either box fixes the pair and neither one is the wrong one.
	 *
	 * it is handed over as the platform's own `aria-invalid`, which is what `Field` composes both
	 * the attribute and the invalid border from — its own message or a caller's mark, either one.
	 *
	 * `refused` and not `invalid`, because a screen that writes this also imports `invalid()` to
	 * reject with — and `src/routes.spec.ts` reads an object key by its name alone, so the two
	 * spelled alike make a component look like it reaches into the server tree.
	 */
	readonly refused?: boolean;
};

/** a box as the library's `Field` takes it. */
type BoxProps = {
	readonly id: string;
	readonly name: string;
	readonly defaultValue: string | undefined;
	readonly error: string | undefined;
	readonly 'aria-describedby'?: string;
	readonly 'aria-invalid'?: 'true';
};

/**
 * bind one box: the id, the name, what was typed, and the one message under it.
 *
 * four attributes and no fifth, which is the point — see this module's header for what conform's
 * own props helper would add and why none of it may reach a control.
 *
 * the value is the submitted one, so a rejection re-renders the boxes holding what was typed
 * rather than clearing them; a box the form withholds carries none, because the rejection was
 * built without one. it is handed over as the platform's own `defaultValue`: the boxes on these
 * screens are uncontrolled, and a `value` with no handler beside it is a box nobody can type in.
 *
 * one message and not the list. two rules can fail on one value at once and a screen has room for
 * one thing to fix per box; the schemas state their rules in the order they can be answered, so
 * the first is the one an operator can act on.
 */
export function boxProps(box: Box, options: BoxOptions = {}): BoxProps {
	const error = box.errors?.[0];
	const described = [error === undefined ? null : boxErrorId(box.id), options.describedBy]
		.filter((token): token is string => typeof token === 'string')
		.join(' ');

	return {
		id: box.id,
		name: box.name,
		defaultValue: box.defaultValue,
		error,
		// the key is left off rather than set to `undefined` where the screen points at nothing:
		// absent, `Field` composes its own and names the hint and the needed note it draws too.
		// `exactOptionalPropertyTypes` is why it is a spread rather than a key.
		...(options.describedBy === undefined ? {} : { 'aria-describedby': described }),
		// left off unless a screen says so, for the same reason: `Field` writes this one itself off
		// the message it holds, and a key present and `undefined` would still be the caller's.
		...(options.refused === true && error === undefined ? { 'aria-invalid': 'true' as const } : {})
	};
}
