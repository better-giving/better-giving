import { SelectWithNote } from '@better-giving/operator/components/forms/SelectWithNote';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { type ReactNode, useState } from 'react';
import {
	PROGRAM_MODE_LABELS,
	PROGRAM_MODE_NOTES,
	PROGRAM_MODES,
	type ProgramMode
} from '$lib/forms/program-modes';
import type { Box } from '../use-admin-form';

// which cause a form's gifts are recorded against: the mode, and the one program a pinned form
// names.
//
// a group component like the three in ./name-fields.tsx, ./giving-fields.tsx and
// ./origins-fields.tsx, taking its own boxes rather than a form for the reason ./name-fields.tsx
// states — the create and edit screens hold different statements and a group typed against either
// is a group the other has to copy.
//
// the two boxes are one decision and the schema says so: `form_program_pinned_check` in
// `$lib/server/db/schema.ts` holds `program_id is not null` and `program_mode = 'pinned'` to the
// same answer, so a screen that saved one of them without the other would be saving half a rule.
// that is why they are a fieldset rather than two boxes in a run, and why the legend names the
// pair rather than either one.
//
// the heading and the legend are two names, and neither may go: the heading is what puts the
// group in the screen's outline beside its siblings, and the legend is what ties the two boxes
// together for a reader met with them out of that outline's order. a legend is not a heading and
// packages/operator/src/styles/adm.css says so at `.adm-fieldset__legend`. the legend asks the
// group's one question under the heading's word, and it is a different line from the heading the
// way every sibling's is (./giving-fields.tsx holds a phrase over a short name; this group holds a
// word over a question): the same word on both lines is the group naming itself twice, one line
// under the other.
//
// the program box is not a third name under those two: a control named the same word as the group
// holding it is announced twice over and the label has told a reader nothing the legend had not.
// it asks which one instead.
//
// **the program box stays in the tree in every mode, hidden.** every box a form states must arrive
// (`$lib/server/conform.ts`'s header), so a select rendered only while the mode is `pinned` is a
// body missing a key the parser stated — and the mode this form is saved in is the one the
// operator has chosen here, not the one the record was loaded with. `hidden` is the platform's
// own: packages/operator/src/styles/base.css draws `[hidden]` as `display: none`, which takes the
// box out of the tab order and out of the accessibility tree while the browser still submits it.
//
// the mode is held here because nothing else can hold it. the boxes are uncontrolled and conform
// is told nothing until a submit (../use-admin-form.ts), so which mode is chosen right now is a
// fact about the dom and this is the one component reading it — the description over the box and
// whether the program box is drawn are both that same fact.

/** one line of the program list: the id a gift is recorded against, and the name a fundraiser gave it. */
type ProgramOption = {
	readonly value: string;
	readonly label: string;
};

type FormProgramFieldsProps = {
	/** the two boxes this group is, as conform's metadata describes them. */
	readonly boxes: {
		readonly program_mode: Box;
		readonly program_id: Box;
	};
	/** every active program, in the order the screen read them. empty is an ordinary state. */
	readonly programs: readonly ProgramOption[];
	/**
	 * the archived program this form is still pinned to, where it is pinned to one.
	 *
	 * it is not in `programs` and may not be added to it: a retired cause is not offered to a form
	 * that is not already on it. the select appends it as the choice it holds until another is
	 * made, and says so.
	 */
	readonly retired?: ProgramOption | null;
	/**
	 * the group's own submit, at the foot of the group it saves.
	 *
	 * absent on the create screen, which has one submit for every group.
	 */
	readonly footer?: ReactNode;
};

/** the chosen mode, from a box that carries whatever a body last put in it. */
function asMode(value: string | undefined): ProgramMode {
	return PROGRAM_MODES.find((mode) => mode === value) ?? 'none';
}

const MODE_OPTIONS: readonly ProgramOption[] = PROGRAM_MODES.map((mode) => ({
	value: mode,
	label: PROGRAM_MODE_LABELS[mode]
}));

/** the first line of the program list, which is the choice a pinned form has not made yet. */
const CHOOSE = 'Choose a program';

/** said when a mode change puts the program box on the screen, and nothing otherwise. */
const REVEALED = 'Choose which program below.';

export function FormProgramFields({ boxes, programs, retired, footer }: FormProgramFieldsProps) {
	const [mode, setMode] = useState<ProgramMode>(() => asMode(boxes.program_mode.defaultValue));
	// a second state rather than the mode read again: a form loaded already pinned opens with the
	// program box on the screen, so nothing appeared and a reader is told nothing on arrival.
	const [revealed, setRevealed] = useState('');

	const modeError = boxes.program_mode.errors?.[0];
	const programError = boxes.program_id.errors?.[0];

	return (
		<>
			<h2>Program</h2>

			<fieldset className="adm-fieldset">
				<legend className="adm-fieldset__legend">Where a gift goes</legend>

				{/* the description is what the three labels cannot carry: they name how many causes the
				    form asks about and the sentence names what that does to a gift. it is a `hint` and
				    not a `note` — the quiet register over the box, the same one the program box below
				    uses. the standing row draws a triangle beside its words
				    (`@better-giving/operator/components/forms/FieldMessage`), and every mode here has a
				    description, so a note would put a warning against `No program` too.

				    the refusal goes over as a node rather than as the string, so a sentence marking a
				    value with backticks is drawn as code rather than shown with the marks in it
				    (`@better-giving/operator/code-spans`). */}
				<SelectWithNote
					id={boxes.program_mode.id}
					name={boxes.program_mode.name}
					label="Mode"
					defaultValue={boxes.program_mode.defaultValue}
					options={MODE_OPTIONS}
					hint={PROGRAM_MODE_NOTES[mode]}
					onChange={(event) => {
						const chosen = asMode(event.currentTarget.value);
						setMode(chosen);
						setRevealed(chosen === 'pinned' ? REVEALED : '');
					}}
					error={modeError === undefined ? undefined : <MarkedText text={modeError} />}
				/>

				<div hidden={mode !== 'pinned'}>
					{/* the blank line is the first one and carries a word rather than nothing: an empty
					    option reads as a program with no name. it is not a mode of its own — a form
					    that names no cause is `No program` above, and this is the pinned form that has
					    not picked one yet.

					    with no active program the list is that line alone, and the hint says where a
					    program is made. it is the errand and not a refusal: nothing has been pressed
					    yet, and a deployment with no causes is an ordinary state to be in. */}
					<SelectWithNote
						id={boxes.program_id.id}
						name={boxes.program_id.name}
						label="Which program"
						defaultValue={boxes.program_id.defaultValue}
						options={[{ value: '', label: CHOOSE }, ...programs]}
						retired={retired ?? undefined}
						hint={programs.length === 0 ? 'Add a program under Programs first.' : undefined}
						error={programError === undefined ? undefined : <MarkedText text={programError} />}
					/>
				</div>

				{/* the box above arrives by a change to another box, which a reader who cannot see it
				    is told about by nothing else: it is described by `aria-describedby` on the box
				    already focused, and that is read on the box a reader moves to next rather than
				    when the mode changed.

				    it stays mounted through every mode, because a region that arrives carrying its own
				    text is one insertion rather than a change and is announced by nobody.

				    last in the group and `.adm-vh` from packages/operator/src/styles/base.css: out of
				    the flow, and packages/operator/src/styles/adm.css zeroes the step above whatever
				    follows a `.adm-vh` child of a fieldset. */}
				<span className="adm-vh" aria-live="polite">
					{revealed}
				</span>
			</fieldset>

			{footer ? <div className="adm-actions">{footer}</div> : null}
		</>
	);
}
