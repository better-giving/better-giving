import { useRef, useState } from 'react';

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
 * @property {'radio' | 'checkbox' | undefined} [type] one of the chips, or any of them. drawn the
 *   same either way; what changes is what the browser submits and what the keyboard does inside
 *   the group — arrows move between radios, Tab between checkboxes.
 * @property {ReactNode} legend the question the chips answer.
 * @property {ReactNode} [hint]
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

   the Other box opens on the render the chip is taken in and the focus stays on the chip: the
   arrow keys walking a radio group would otherwise be pulled out of it on passing Other. Tab is
   the next step into the box, which stands straight after the chips. */
/** @param {ChoiceChipsProps} props */
export function ChoiceChips({ id, name, type = 'radio', legend, hint, options, other }) {
	const otherChip = useRef(/** @type {HTMLInputElement | null} */ (null));
	const [otherOpen, setOtherOpen] = useState(other?.defaultChecked ?? false);
	const hintId = hint ? `${id}-hint` : undefined;
	const otherText = `${id}-other-text`;

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
			<div className="adm-choicechips">
				{options.map(({ value, label, defaultChecked, state }) => (
					<label key={value} className={`adm-choicechip${state === 'hover' ? ' is-hover' : ''}`}>
						<input
							type={type}
							name={name}
							value={value}
							defaultChecked={defaultChecked}
							className={state === 'focus' ? 'adm-vh is-focus' : 'adm-vh'}
							aria-describedby={hintId}
						/>
						<span>{label}</span>
					</label>
				))}
				{other ? (
					<label className="adm-choicechip">
						<input
							ref={otherChip}
							type={type}
							name={name}
							value={other.value ?? ''}
							defaultChecked={other.defaultChecked}
							className="adm-vh"
							aria-describedby={hintId}
						/>
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
		</fieldset>
	);
}
