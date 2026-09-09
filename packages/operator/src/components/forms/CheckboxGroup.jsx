import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { InputHTMLAttributes, ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 */

/**
 * `id` carries no default: it names the box's own lines, so an item without one has a second line
 * the box points at nothing for.
 *
 * @typedef {object} CheckboxItemOwnProps
 * @property {string} id
 * @property {ReactNode} label
 * @property {ReactNode} [note] the attention-toned second line — something that has to be read
 *   before the box is ticked, such as why an option the deployment cannot charge keeps its place.
 * @property {ReactNode} [sub] the neutral second line — the choice's own identifier, such as an
 *   account id under an account name. packages/operator/src/styles/adm.css draws both lines and
 *   its comment there is what says which of the two a line is.
 * @property {PointerState | undefined} [state] the state pinned on the row without a pointer,
 *   which is what a specimen wants and no screen does. `focus` lands on the control rather than
 *   on the row: a boxed row takes its ring off the control inside it, so a row pinned focused at
 *   its own edge would draw the ring the sheet gives the box and not the one the keyboard does.
 *   `hover` reaches a boxed row and no other — packages/operator/src/styles/adm.css draws the twin
 *   on `.adm-check--boxed`, and a bare row has no hover of its own to pin.
 */

/**
 * the rest reaches the box.
 *
 * what an item submits is the platform's own `value`, and whether it starts ticked is
 * `defaultChecked` — or `checked` with a handler beside it, which this group has no opinion about
 * either way. neither is a prop of this group's, for the reason ./Field.jsx gives about its own
 * starting value: a group that took one of them as a prop of its own would be a group that maps a
 * caller's word onto a different attribute than the one they wrote.
 *
 * @typedef {CheckboxItemOwnProps
 *   & Omit<InputHTMLAttributes<HTMLInputElement>, keyof CheckboxItemOwnProps>} CheckboxItem
 */

/**
 * `id` carries no default, for ./Field.jsx's reason: the group's own two lines are named from it
 * and every box points at them, so a group without one is refused with a sentence no box reaches.
 *
 * @typedef {object} CheckboxGroupProps
 * @property {string} id
 * @property {string | undefined} [name] the name every box submits under, which is what makes the
 *   ticked ones arrive as one value repeated. an item naming itself beats it.
 * @property {'checkbox' | 'radio' | undefined} [type] a set of choices where only one may be taken
 *   is radios. the sheet draws the box the same either way — what changes is what the browser
 *   submits and what the keyboard does inside the group.
 * @property {ReactNode} [legend] absent where the group is already named by where it sits — a
 *   picker inside a section, or inside a fieldset the screen draws around more than this group. no
 *   fieldset is rendered then, because a group nested in a group tells a reader there are two.
 * @property {boolean | undefined} [legendHidden] the legend is in the tree and not on the screen
 *   (`.adm-vh` in ../../styles/base.css). what earns it is a group already named by a heading the
 *   reader can see, where a legend would draw that same word a second time on the line beneath it —
 *   the console's account picker is the case. it is not a group without a name: a reader who cannot
 *   see the heading still meets one, which is why the legend is hidden rather than dropped.
 *   ../../styles/adm.css takes the step off what follows a legend nobody sees.
 * @property {ReactNode} [hint]
 * @property {ReactNode} [error] the group's, never a single box's.
 * @property {boolean | undefined} [boxed] each choice drawn as a bordered row, with the taken one
 *   holding the accent. what earns it is a second line that is an identifier rather than a
 *   description: two long ids under two similar names leave a bare list with nothing saying where
 *   one choice ends and the next begins.
 * @property {readonly CheckboxItem[] | undefined} [items]
 */

/* errors are the group's, never a single box's, and every box is drawn refused by one: either box
   fixes the group and none of them is the wrong one.

   the description is on the boxes rather than on the fieldset. a fieldset's own description is
   read out as a reader enters the group and again on the box they land in, which is one sentence
   twice; a box's is read where the operator is about to act. */
/** @param {CheckboxGroupProps} props */
export function CheckboxGroup({
	id,
	name,
	type = 'checkbox',
	legend,
	legendHidden = false,
	hint,
	error,
	boxed = false,
	items = []
}) {
	const group = (
		<>
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<div className="adm-checkgroup">
				{items.map(({ id: box, label, note, sub, state, className, ...rest }) => {
					// a second line is a description of the choice and never part of its name: wrapped
					// in the label, the accessible name would be the choice followed by a sentence
					// about it, and a voice user cannot say a control whose name is a sentence. so the
					// box names the text alone and points at the line beneath instead.
					const lines = [note ? `${box}-note` : null, sub ? `${box}-sub` : null].filter(Boolean);
					const describedBy =
						[hint ? `${id}-hint` : null, error ? `${id}-err` : null, ...lines]
							.filter(Boolean)
							.join(' ') || undefined;
					// the class list is spelled at the element rather than assembled above it, for the
					// reason ../status/Mark.jsx gives: a name that only exists in a variable is a name
					// packages/app/src/lib/admin/styles/conformance.spec.ts cannot see.
					return (
						<label
							className={`adm-check${boxed ? ' adm-check--boxed' : ''}${
								state && state !== 'focus' ? ` is-${state}` : ''
							}`}
							key={box}
						>
							<input
								type={type}
								name={name}
								className={
									[state === 'focus' ? 'is-focus' : '', className].filter(Boolean).join(' ') ||
									undefined
								}
								aria-invalid={error ? 'true' : undefined}
								aria-labelledby={lines.length ? `${box}-text` : undefined}
								aria-describedby={describedBy}
								{...rest}
							/>
							<span className="adm-check__text" id={lines.length ? `${box}-text` : undefined}>
								{label}
							</span>
							{note ? (
								<span className="adm-check__note" id={`${box}-note`}>
									{note}
								</span>
							) : null}
							{sub ? (
								<span className="adm-check__sub" id={`${box}-sub`}>
									{sub}
								</span>
							) : null}
						</label>
					);
				})}
			</div>
			{/* the refusal is the group's live region, for ./FieldMessage.jsx's reason: it is what a
			    press answered with, and the hint above is a standing condition that stays a plain
			    paragraph. */}
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
		</>
	);
	return legend ? (
		<fieldset className="adm-fieldset">
			<legend className={legendHidden ? 'adm-vh' : 'adm-fieldset__legend'}>{legend}</legend>
			{group}
		</fieldset>
	) : (
		group
	);
}
