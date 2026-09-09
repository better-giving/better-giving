import { Button } from '../controls/Button.jsx';
import { Field } from './Field.jsx';
import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { MouseEventHandler, ReactNode } from 'react'
 * @import { FieldProps } from './Field.jsx'
 */

/**
 * one control that changes the boxes rather than the record: the four attributes a form layer's own
 * list intent is carried by, plus the press it may withhold on.
 *
 * stated structurally rather than as a button's attributes, for the reason
 * packages/app/src/lib/admin/forms/giving-fields.tsx states it: ./controls/Button.jsx takes the
 * union of a button's attributes and an anchor's, so the whole of one of those two is not
 * assignable to it — and what a caller actually has to hand over is these.
 *
 * @typedef {object} RowControl
 * @property {string} name
 * @property {string} value
 * @property {string} [form]
 * @property {boolean} [formNoValidate]
 * @property {MouseEventHandler<HTMLButtonElement>} [onClick]
 */

/**
 * `id` names the box, so a message about the group is reachable from every one of them.
 *
 * `key` is the row's own identity and `id` is not: a list whose rows are named by position spells
 * the second box `x[1]`, which is whichever row is second right now — so a removed row leaves react
 * re-using the box below it for the row that took its place, and the box is uncontrolled, so it
 * goes on showing and posting the figure already typed into it.
 * packages/app/src/lib/admin/forms/giving-fields.tsx's `AmountRow` is the same trap, and
 * packages/operator/src/components/data/DataTable.jsx argues the case for a table's rows.
 *
 * `remove` is the control that drops this row, absent where nothing may drop it — a list that has
 * to keep one row is a rule its caller holds and this component does not.
 *
 * `error` is this row's own sentence, drawn under this row's own box. the group's is a different
 * thing and is {@link RepeatingRowsProps.error}.
 *
 * @typedef {object} RepeatingRowOwnProps
 * @property {string} id
 * @property {string | undefined} [key]
 * @property {ReactNode} [error]
 * @property {RowControl | undefined} [remove]
 */

/**
 * the rest is ./Field.jsx's, because a row is one: what a row holds is the platform's own
 * `defaultValue` — or `value` with a handler beside it — and a row naming itself beats the group's
 * `name`. that file's header says why a starting value is never a prop of the component's own.
 *
 * three of a field's are not a row's. the label and the standing note belong to the group, and a
 * box that is a paragraph is not a row in a list of one-line values.
 *
 * @typedef {RepeatingRowOwnProps
 *   & Omit<FieldProps, keyof RepeatingRowOwnProps | 'label' | 'needed' | 'as'>} RepeatingRow
 */

/**
 * a row the group holds and the operator can neither type in nor drop, drawn in front of the rows
 * they can. it is for a list carrying one entry that was never theirs to edit, and it is a row of
 * this group so that it stands in the list's own geometry.
 *
 * **it carries no `name` and posts nothing, and the missing name is the whole of that guarantee.**
 * the rows are what a press stores and a list is stored whole, so a locked row that submitted would
 * be written back as one of them — and a box with no name is in no submission and is found by no
 * read of the form's own boxes by name, whatever else it wears.
 *
 * **the box is `readOnly`, so it is reachable.** it takes focus, scrolls and selects, which is what
 * lets a row holding a long address be read to its end at 375px, and it takes no keystroke —
 * uneditable, which is what it is.
 *
 * **no sheet in packages/operator/src/styles draws a read-only box**, so the row stands in the
 * ordinary field ground and refuses a keystroke with nothing on the screen having said it would.
 * none is authored here: the look belongs in packages/operator/src/styles/adm.css, off the three
 * disabled control tokens, and until it is there this is what the row draws as.
 *
 * @typedef {object} FixedRow
 * @property {string} id names the box, as a row's own does.
 * @property {string} label the whole of the row's accessible name, stated rather than built from
 *   the legend and a position. the positions are the editable rows', so a locked row numbered
 *   among them would be a second row called `Site 1`.
 * @property {string} value what the row holds, which is the whole of what it says.
 * @property {ReactNode} [aside] what stands where every other row's Remove does. a row nobody may
 *   drop has no control to put there, and the trailing track left empty draws a first row whose
 *   box is wider than the ones under it. it is a mark and then a word, in that order, and it is
 *   handed over bare: the group stands them in `.adm-rows__aside`
 *   (packages/operator/src/styles/adm.css), which is what spaces the two by the step a button
 *   spaces its own mark from its own label by and sets the word at the rank the presses beside it
 *   are read at. a screen wrapping them in a box of its own gets one item where the group draws
 *   two, and the word carries whatever that box was set at.
 */

/**
 * `legend` is a string rather than a node: each row's own accessible name is built from it.
 *
 * `id` carries no default, for ./Field.jsx's reason: the group's two lines are named from it and
 * every row points at them.
 *
 * @typedef {object} RepeatingRowsProps
 * @property {string} id
 * @property {string | undefined} [name] the name every row submits under. a form that names its
 *   rows one at a time — an array's boxes are `x[0]`, `x[1]` — states it on the row instead.
 * @property {string} legend what the group is, stated rather than defaulted: both of a row's
 *   accessible names are built from it — the box's own and its Remove's — so a group without one is
 *   a run of unnamed boxes over a column of controls all called Remove, and the screen looks exactly
 *   the same either way. `legendHidden` below is how a group draws no mark and keeps the names.
 * @property {boolean | undefined} [legendHidden] whether the legend is drawn to a reader and not on
 *   the screen (`.adm-vh` in packages/operator/src/styles/base.css). for the group whose name is
 *   already stated a step above it, where the mark would be a third naming of one thing. the names
 *   are unaffected: `legend` is stated whether or not it is drawn.
 * @property {ReactNode} [hint]
 * @property {ReactNode} [error] what is true of the list rather than of any one row — a cap on how
 *   many rows there may be, or a refusal the far end keyed to none of them. a row's own sentence is
 *   the row's ({@link RepeatingRowOwnProps.error}), and a row carrying one is described by it rather
 *   than by this: two sentences under one box is two things to fix where there is one.
 * @property {readonly RepeatingRow[] | undefined} [rows]
 * @property {FixedRow | undefined} [fixed] one row the operator can neither edit nor remove, drawn
 *   in front of the rest and submitting nothing at all ({@link FixedRow}).
 * @property {ReactNode} [addLabel]
 * @property {RowControl} add the control that puts an empty row at the end, as the form holding
 *   these rows states it. stated rather than minted here, and it is what makes this group a
 *   component rather than a round trip: adding a row is that form's own business — a list intent
 *   applied in the browser, a submit, a press this group has no way to know the shape of — and a
 *   control this file minted would submit a position no caller asked for.
 * @property {string | undefined} [placeholder]
 * @property {boolean | undefined} [code] whether a row holds a stored literal — an origin, a key —
 *   rather than a figure or a sentence.
 * @property {ReactNode} [emptyNote]
 * @property {boolean | undefined} [disabled] whether the group is closed. it reaches every row and
 *   both of the presses, because adding and dropping a row are the same form's business as the
 *   save — a group whose boxes are closed and whose Remove is not offers a press that changes the
 *   list the closed boxes are showing. a row states its own where one of them is closed alone.
 */

/* zero or more rows, a standing hint, a sentence under any row that has one, and one about the list
   itself.

   the two presses are the caller's and this group only places them: what adding and dropping a row
   do is the form layer's, and the row a Remove drops is named by the control the caller minted for
   that position rather than by anything this file writes into it.

   a row carrying no sentence of its own under a group that has one is drawn refused by it, because
   either row fixes the group and none of them is the wrong one — the same rule ./Field.jsx states
   about a pair of boxes marked from outside. */
/** @param {RepeatingRowsProps} props */
export function RepeatingRows({
	id,
	name,
	legend,
	legendHidden,
	hint,
	error,
	rows = [],
	fixed,
	addLabel = 'Add another',
	add,
	placeholder,
	code,
	emptyNote,
	disabled
}) {
	const hintId = hint ? `${id}-hint` : null;
	const groupErrorId = error ? `${id}-err` : null;
	return (
		<fieldset className="adm-fieldset">
			<legend className={legendHidden ? 'adm-vh' : 'adm-fieldset__legend'}>{legend}</legend>
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<div className="adm-rows">
				{rows.length === 0 && emptyNote ? <p className="adm-empty">{emptyNote}</p> : null}
				{fixed ? (
					<div className="adm-rows__row">
						{/* the group's error is never this row's: a locked row is not in what was posted, so
						    it cannot be the row that was got wrong. it is described by nothing for the same
						    reason — what stands beside it says why it is closed. */}
						<Field
							id={fixed.id}
							code={code}
							value={fixed.value}
							readOnly
							disabled={disabled}
							aria-label={fixed.label}
						/>
						{/* the status stands in one element of the group's own, which is what makes the
						    mark and the word one item in the trailing track: handed in as two children
						    of the row they are placed one track apart, and the word lands past the
						    width of every Remove under it. */}
						{fixed.aside === undefined ? null : (
							<span className="adm-rows__aside">{fixed.aside}</span>
						)}
					</div>
				) : null}
				{rows.map(({ id: row, key, error: said, remove, ...rest }, i) => (
					// keyed by the identity the caller minted for the row rather than by the box's id:
					// under a list named by position the id is whichever row is in that place right now
					// ({@link RepeatingRowOwnProps}). the id is the fallback, which is only ever reached
					// by a caller whose rows carry no identity of their own.
					<div className="adm-rows__row" key={key ?? row}>
						{/* no label on the row: the legend above names the group and the box says which
						    row it is to a reader, so a label element here would be an empty one.

						    the description is composed here rather than left to the field, because the
						    group draws two of the blocks it would name: the standing hint is the group's
						    and reaches every row, and the group's own sentence reaches only a row that
						    has none of its own. the row's own message is the field's and is named the way
						    the field names it. */}
						<Field
							id={row}
							name={name}
							code={code}
							placeholder={placeholder}
							disabled={disabled}
							error={said}
							aria-label={`${legend} ${i + 1}`}
							aria-invalid={error && said === undefined ? 'true' : undefined}
							aria-describedby={
								[hintId, said === undefined ? groupErrorId : `${row}-err`]
									.filter(Boolean)
									.join(' ') || undefined
							}
							{...rest}
						/>
						{/* the visible word is the same on every row, which is right beside the box it
						    acts on and useless in a list of controls read out of context — so each says
						    which row it drops to a reader and nothing extra on the screen. */}
						{remove === undefined ? null : (
							<Button
								variant="quiet"
								size="sm"
								mark="trash-2"
								type="submit"
								disabled={disabled}
								aria-label={`Remove ${legend} ${i + 1}`}
								{...remove}
							>
								Remove
							</Button>
						)}
					</div>
				))}
				<div>
					<Button size="sm" mark="plus" type="submit" disabled={disabled} {...add}>
						{addLabel}
					</Button>
				</div>
			</div>
			{/* the one live region on the group, for ./FieldMessage.jsx's reason: a refusal is what a
			    press answered with. */}
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
		</fieldset>
	);
}
