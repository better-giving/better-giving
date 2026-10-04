import { useRef, useState } from 'react';
import { Mark } from '../status/Mark.jsx';
import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 */

/**
 * one chip. what it submits is the platform's own `value` under the group's `name`, and whether it
 * starts taken is `defaultChecked` — the group is native radios or checkboxes and holds no value of
 * its own, so a form reads it the way it reads any other box.
 *
 * @typedef {object} ChoiceChip
 * @property {string} value
 * @property {ReactNode} label
 * @property {ReactNode} [description] the line under the label on a card (`cards` on the group),
 *   saying what the choice is for. it describes the control rather than naming it, for
 *   ./CheckboxGroup.jsx's reason: a name that is a sentence is one a voice user cannot say.
 * @property {boolean | undefined} [defaultChecked]
 * @property {PointerState | undefined} [state] the state pinned on the chip without a pointer, which
 *   is what a specimen wants and no screen does. `focus` lands on the control inside the chip and
 *   the chip draws the ring off it, as a boxed row in ./CheckboxGroup.jsx does.
 */

/**
 * the last chip, whose words are the operator's own: taking it reveals a short box beside the
 * group, and letting it go takes the box and what was typed in it away, so a box the form no longer
 * submits is never left holding words.
 *
 * @typedef {object} ChoiceOther
 * @property {string} name what the box's words are submitted under. the chip itself submits under
 *   the group's `name` like every other chip, with `value`.
 * @property {string | undefined} [value] what the chip submits — empty unless stated, which no
 *   option's value may also be, so a reader of the form tells the chip from an option by it.
 * @property {string | undefined} [label] the chip's words, `Other` unless stated. the box is named
 *   by them too.
 * @property {string | undefined} [placeholder]
 * @property {boolean | undefined} [defaultChecked]
 * @property {string | undefined} [defaultValue] the box's words when it first opens.
 */

/**
 * `id` carries no default, for ./Field.jsx's reason: the hint and the Other box are named from it.
 *
 * @typedef {object} ChoiceChipsProps
 * @property {string} id
 * @property {string} name the name every chip submits under.
 * @property {'radio' | 'checkbox' | undefined} [type] one of the chips, or any of them. a checkbox
 *   chip draws a tick box before its words, empty until it is taken, so a question taking several
 *   answers reads as one before anything is pressed; a radio chip draws none. the browser submits
 *   and the keyboard walks the two differently — arrows move between radios, Tab between
 *   checkboxes.
 * @property {ReactNode} legend the question the chips answer.
 * @property {ReactNode} [hint]
 * @property {ReactNode} [error] the group's refusal, never a single chip's.
 * @property {boolean | undefined} [cards] each choice drawn as a card in a grid, its label over its
 *   `description`, rather than as a chip in a wrapping row. what earns it is a choice whose words
 *   alone do not say what it is for.
 * @property {readonly ChoiceChip[]} options
 * @property {ChoiceOther | undefined} [other] opts the group into the Other chip and its box.
 */

/* a question answered by pressing one of a few short words: a fieldset of native radios or
   checkboxes, each held out of sight inside its chip (`.adm-vh` in ../../styles/base.css), so the
   chip is the whole of what a pointer presses and the platform's own keyboard and form behaviour
   is the whole of what the keyboard and a form get. the taken chip holds the accent and the focused
   one takes the ring off its control (`.adm-choicechip` in ../../styles/adm.css).

   the hint describes each control rather than the fieldset, for ./CheckboxGroup.jsx's reason: a
   fieldset's own description is read on entering the group and again on the control landed on.
   the refusal is the group's and so is every control's, for that file's reason too: any chip fixes
   it, and none of them is the wrong one.

   the Other box opens on the render the chip is taken in and the focus stays on the chip: the
   arrow keys walking a radio group would otherwise be pulled out of it on passing Other. Tab is
   the next step into the box, which stands straight after the chips. */
/** @param {ChoiceChipsProps} props */
export function ChoiceChips({
	id,
	name,
	type = 'radio',
	legend,
	hint,
	error,
	cards = false,
	options,
	other
}) {
	const otherChip = useRef(/** @type {HTMLInputElement | null} */ (null));
	const [otherOpen, setOtherOpen] = useState(other?.defaultChecked ?? false);
	const hintId = hint ? `${id}-hint` : undefined;
	const errorId = error ? `${id}-err` : undefined;
	const groupLines = [hintId, errorId].filter(Boolean).join(' ') || undefined;
	const otherText = `${id}-other-text`;
	const tick = type === 'checkbox' ? <Mark name="check" className="adm-choicechip__tick" /> : null;

	return (
		<fieldset
			className="adm-fieldset"
			onChange={() => setOtherOpen(otherChip.current?.checked ?? false)}
		>
			<legend className="adm-fieldset__legend">{legend}</legend>
			{hint ? (
				<p className="adm-hint" id={hintId}>
					{hint}
				</p>
			) : null}
			<div className={cards ? 'adm-choicechips adm-choicechips--cards' : 'adm-choicechips'}>
				{options.map(({ value, label, description, defaultChecked, state }, at) => {
					const words = `${id}-${at}`;
					const line = description ? `${words}-desc` : undefined;
					return (
						<label key={value} className={`adm-choicechip${state === 'hover' ? ' is-hover' : ''}`}>
							<input
								type={type}
								name={name}
								value={value}
								defaultChecked={defaultChecked}
								className={state === 'focus' ? 'adm-vh is-focus' : 'adm-vh'}
								aria-invalid={errorId ? 'true' : undefined}
								aria-labelledby={line ? words : undefined}
								aria-describedby={[groupLines, line].filter(Boolean).join(' ') || undefined}
							/>
							{tick}
							<span className="adm-choicechip__label" id={line ? words : undefined}>
								{label}
							</span>
							{description ? (
								<span className="adm-choicechip__desc" id={line}>
									{description}
								</span>
							) : null}
						</label>
					);
				})}
				{other ? (
					<label className="adm-choicechip">
						<input
							ref={otherChip}
							type={type}
							name={name}
							value={other.value ?? ''}
							defaultChecked={other.defaultChecked}
							className="adm-vh"
							aria-invalid={errorId ? 'true' : undefined}
							aria-describedby={groupLines}
						/>
						{tick}
						<span id={otherText}>{other.label ?? 'Other'}</span>
					</label>
				) : null}
			</div>
			{other && otherOpen ? (
				<input
					type="text"
					name={other.name}
					className="adm-input adm-choicechips__other"
					aria-labelledby={otherText}
					placeholder={other.placeholder}
					defaultValue={other.defaultValue}
					autoComplete="off"
				/>
			) : null}
			{error ? <FieldMessage id={errorId}>{error}</FieldMessage> : null}
		</fieldset>
	);
}
