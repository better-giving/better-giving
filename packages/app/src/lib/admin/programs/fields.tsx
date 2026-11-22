import { Field } from '@better-giving/operator/components/forms/Field';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { Section } from '@better-giving/operator/components/shell/Layout';
import type { ReactNode } from 'react';
import { type Box, boxProps } from '../use-admin-form';

// what a program is called and what it is for.
//
// the whole of a program, which is why it is one group and not several: a cause is a name and a
// sentence, and everything else a screen shows about one — the gifts recorded against it, whether
// it is still offered — is read rather than typed. it takes its own boxes rather than a form for
// the reason `../forms/name-fields.tsx` states, and the screen that makes a program and the screen
// that edits one both mount this one.
//
// the name is the donor-facing word. it is on a donation form's list wherever a form offers one
// (`$lib/forms/program-modes.ts`), so the box that carries it is not a staff label with a public
// twin somewhere — there is one string, and it heads the program's public page too.
//
// every element here is the library's, and each names its own describing blocks from the id it is
// handed, so this file composes no `aria-describedby` of its own. what is left is the arrangement,
// which packages/operator/src/styles/adm.css draws and this file names rather than restates.

type ProgramFieldsProps = {
	/** the two boxes this group is, as conform's metadata describes them. */
	readonly boxes: {
		readonly name: Box;
		readonly description: Box;
	};
	/** the program's photo, beside the name: ./photo-control.tsx, where the screen offers one. */
	readonly photo?: ReactNode;
	/** the group's own submit, at the foot of the group it saves. */
	readonly footer?: ReactNode;
	/**
	 * drawn inside a division the caller already draws — the editor's Details card — so the group
	 * draws none of its own, and its boxes and submit stand in one stack.
	 */
	readonly bare?: boolean;
};

export function ProgramFields({ boxes, photo, footer, bare = false }: ProgramFieldsProps) {
	const actions = footer ? <div className="adm-actions">{footer}</div> : null;
	if (bare) {
		return (
			<div className="adm-stack">
				<Boxes boxes={boxes} photo={photo} />
				{actions}
			</div>
		);
	}
	return (
		<Section>
			<div className="adm-stack">
				<Boxes boxes={boxes} photo={photo} />
			</div>
			{actions}
		</Section>
	);
}

function Boxes({ boxes, photo }: Pick<ProgramFieldsProps, 'boxes' | 'photo'>) {
	return (
		<>
			{/* the message is handed over as a node rather than as the string, so a sentence that
			    marks a value with backticks is drawn as code rather than shown with the marks in
			    it (`@better-giving/operator/code-spans`). `Field` hands whatever it is given to
			    `@better-giving/operator/components/forms/FieldMessage`, which wraps it whole. */}
			<Field
				label="Name"
				required
				{...boxProps(boxes.name)}
				error={
					boxes.name.errors?.[0] === undefined ? undefined : (
						<MarkedText text={boxes.name.errors[0]} />
					)
				}
			/>

			{photo}

			{/* a multi-line box, because what goes in it is a sentence and a single line hides
			    every word but the last few typed.

			    the hint is the one thing neither the label nor the box can carry: that donors read
			    it, under the name on the program's public page (`$lib/donate/program-page.tsx`). */}
			<Field
				as="textarea"
				label="Description"
				optional
				hint="Shown on the program’s page, under its name. Donors see it, so write it for them."
				{...boxProps(boxes.description)}
				error={
					boxes.description.errors?.[0] === undefined ? undefined : (
						<MarkedText text={boxes.description.errors[0]} />
					)
				}
			/>
		</>
	);
}
