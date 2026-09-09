import { Field } from '@better-giving/operator/components/forms/Field';
import { SelectWithNote } from '@better-giving/operator/components/forms/SelectWithNote';
import type { ReactNode } from 'react';
import { FORM_FIELD_LABELS } from '$lib/forms/fields';
import { EDITABLE_FORM_STATUSES, FORM_STATUS_LABELS } from '$lib/forms/statuses';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { type Box, boxProps } from '../use-admin-form';

// what a donation form is called and whether it is published.
//
// one of the four group components the screen that makes a form and the screen that edits one both
// mount. they sit under `$lib/admin/forms/` rather than beside either route because every file
// directly under `src/routes/` is an address to `flatRoutes`, and they hold no state and reach no
// server: what each renders and what it writes both live in the boxes it is handed, and the `<form>`
// around it is what submits them.
//
// four components rather than one, and the split is the editor's: that screen saves a group at a
// time, so each group is its own `<form>` with its own action and its own submit at its own foot,
// while the create screen wraps all four in one. a single component rendering four groups could
// not be wrapped either way round.
//
// **the frame is the mounting screen's and never the group's.** each renders its heading, its boxes
// and its footer and nothing around them, so the screen that mounts it is what decides whether the
// group stands in a box or in a band of the page —
// packages/operator/src/components/shell/Layout.jsx's `Section` is either one.
//
// **each takes its own boxes and never a form.** the two screens hold different statements — one
// whole-form `defineForm` on the create, four group statements on the editor — so a group typed
// against either one of those is a group the other screen has to copy. a box is `Box` in
// `../use-admin-form.ts`, which is what `boxProps` already takes, so conform's own metadata
// satisfies it from either statement with no cast and no generic.
//
// every label comes out of `FORM_FIELD_LABELS`, not out of the markup. the read-only record an
// archived form renders is the same list read the other way, and a label written here would be one
// of two spellings of a column.
//
// every element here is one of the library's — a box is `Field` and a list of choices is
// `SelectWithNote` — and each names its own describing blocks from the id it is handed, so this
// file composes no `aria-describedby` of its own. what is left for it to carry is the arrangement —
// the run of boxes and the row the submit stands in — which packages/operator/src/styles/adm.css
// draws and this file names rather than restates: a field fills the column it stands in, so there
// is no width for this group to state.

type FormNameFieldsProps = {
	/** the two boxes this group is, as conform's metadata describes them. */
	readonly boxes: {
		readonly name: Box;
		readonly status: Box;
	};
	/**
	 * whether Live may be chosen at all.
	 *
	 * `false` while a blocker stands, in which case the select offers Draft alone and says why. a
	 * filtered `<option>` list is not a control — the action behind this re-checks the same
	 * condition against the deployment as it stands when the button is pressed.
	 */
	readonly liveOffered?: boolean;
	/**
	 * the group's own submit, at the foot of the group it saves.
	 *
	 * absent on the create screen, which has one submit for all four groups.
	 */
	readonly footer?: ReactNode;
};

export function FormNameFields({ boxes, liveOffered = true, footer }: FormNameFieldsProps) {
	const statusError = boxes.status.errors?.[0];

	// the two statuses this select offers. `EDITABLE_FORM_STATUSES` is the pair an operator may
	// choose between; while a blocker stands, publishing would produce a form that serves nothing,
	// so Live comes off the list and a note under the box says why.
	const statuses = (
		liveOffered ? EDITABLE_FORM_STATUSES : EDITABLE_FORM_STATUSES.filter((it) => it !== 'live')
	).map((status) => ({ value: status, label: FORM_STATUS_LABELS[status] }));

	return (
		<>
			<h2>Name and status</h2>

			<div className="adm-stack">
				{/* only your team sees it: this is the name on the forms list, never on a donor's
				    card. */}
				{/* the message is handed over as a node rather than as the string, so a sentence that
				    marks a value with backticks is drawn as code rather than shown with the marks in it
				    (`@better-giving/operator/code-spans`). `Field` hands whatever it is given to
				    `@better-giving/operator/components/forms/FieldMessage`, which wraps it whole. */}
				<Field
					label={FORM_FIELD_LABELS.name}
					required
					{...boxProps(boxes.name)}
					error={
						boxes.name.errors?.[0] === undefined ? undefined : (
							<MarkedText text={boxes.name.errors[0]} />
						)
					}
				/>

				{/* archiving is a section of its own on the screen that edits a form, and it is not in
				    this list on purpose: the status and the date it happened are two halves of one
				    fact, and a box that wrote only the first would leave a form that reads archived and
				    behaves live.

				    the note is what says why Live is not among the options while a blocker stands. it
				    is a standing consequence rather than a complaint about this submission, so it takes
				    the library's note register and the error register is left to whatever the last save
				    refused — both are reachable from the box at once. */}
				<SelectWithNote
					id={boxes.status.id}
					name={boxes.status.name}
					label={FORM_FIELD_LABELS.status}
					defaultValue={boxes.status.defaultValue}
					options={statuses}
					note={liveOffered ? undefined : 'Live is not offered while a blocker stands.'}
					error={statusError === undefined ? undefined : <MarkedText text={statusError} />}
				/>
			</div>

			{footer ? <div className="adm-actions">{footer}</div> : null}
		</>
	);
}
