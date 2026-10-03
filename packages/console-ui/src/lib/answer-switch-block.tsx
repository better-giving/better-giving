import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CheckboxGroup } from '@better-giving/operator/components/forms/CheckboxGroup';
import { useSavedFormState } from '@better-giving/operator/saved-form-state.react';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { Form } from 'react-router';
import type { ValuesRefusal, VarsWritten } from '../api/types';
import type { AnswerSwitch } from './answer-switch';
import type { HeldValues } from './held-values';
import { withheldAmong } from './held-values';
import { useReseeded } from './reseed';
import { refusalIn } from './secret-trouble';
import { FREE_INTENT, WithheldValues } from './withheld-values';

// one of ./answer-switch.ts's switches, drawn: one box, its own press and its own form, and the
// block that frees the value where it is withheld.
//
// **its own form**, because one `<form>` inside another is not a tree the parser keeps, so a switch
// stands beside the credentials it is not part of rather than inside them.
//
// **it draws no heading.** a screen that names the switch wraps it in one, and a page named for it
// draws none.

export type AnswerSwitchBlockProps = {
	/** which switch this is. */
	answer: AnswerSwitch;
	/** what the deployment is holding (./held-values.ts). */
	values: HeldValues;
	/** whether the deployment reads the held value as yes, which is the position the box is drawn in. */
	on: boolean;
	/** the question, answered as a statement the box ticks. */
	label: string;
	/** what ticking the box changes, drawn under the label and read with the box. */
	note: string;
	/** what the deployment does until a withheld value is saved again. */
	consequence: string;
	/** how the last press of the switch went, or `null`. */
	written: VarsWritten | null;
	/** how the last press that frees a withheld value went, drawn in the block that frees this one. */
	freed: VarsWritten | null;
	/** what a failed write says (./processor-screen.tsx's `keysTrouble`). */
	trouble: (written: ValuesRefusal) => ReactNode;
	/** something else on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
};

export function AnswerSwitchBlock({
	answer,
	values,
	on,
	label,
	note,
	consequence,
	written,
	freed,
	trouble,
	busy,
	pending
}: AnswerSwitchBlockProps): ReactNode {
	const box = `${useId()}-${answer.field}`;
	const sending = pending === answer.intent;
	const failure = written === null ? null : refusalIn(written);

	/* the switch goes back on the reading that lands after the write, and not on the answer that
	   arrives ahead of it, which would untick what the press just stored (./reseed.ts). one
	   derivation per reading is what lets `values` stand for it (./held-values.ts). */
	const landed = written?.kind === 'set';
	const spent = useReseeded({ landed, pending: sending, reading: values });
	const { form, state, onInput, onSubmit } = useSavedFormState({
		report: written,
		landed,
		spent,
		// the switch is read off the element at every press of it, which is the reading a block with
		// no form layer takes (`SavedFormInputs.changed` in
		// packages/operator/src/saved-form-state.react.ts).
		changed: (element) => {
			const control = element.elements.namedItem(answer.field);
			return (control instanceof HTMLInputElement ? control.checked : false) !== on;
		},
		busy,
		pending: sending
	});

	return (
		<Form
			className="adm-stack"
			method="post"
			preventScrollReset
			ref={form}
			onInput={onInput}
			onSubmit={onSubmit}
		>
			<CheckboxGroup
				id={box}
				items={[
					{
						id: box,
						name: answer.field,
						value: answer.word,
						label,
						note,
						defaultChecked: on,
						// closed while this press is in flight and while another press on the page
						// writes: the position is read once, at the press.
						disabled: busy || sending
					}
				]}
			/>

			{/* the name in this state has no box to be typed out of, and this press is the only one
			    that writes it — so the block that frees it stands here or nowhere. */}
			<WithheldValues
				names={withheldAmong(values, [answer.name])}
				all={values.withheld}
				consequence={consequence}
				written={freed}
				trouble={trouble}
				busy={busy}
				freeing={pending === FREE_INTENT}
			/>

			<div className="adm-actions">
				<SaveButton name="intent" value={answer.intent} state={state} />
			</div>

			{/* an outcome reports at the control that made it, and a press that landed is the
			    button's own tick — so what is left is the ways it did not happen. a press refused
			    over a name held as a credential is drawn at the block above, which is where the way
			    out of that state is (`refusalIn` in ./secret-trouble.tsx). */}
			{failure === null ? null : trouble(failure)}
		</Form>
	);
}
