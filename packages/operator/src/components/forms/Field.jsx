import { useState } from 'react';
import { Button } from '../controls/Button.jsx';
import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { HTMLInputTypeAttribute, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 */

/**
 * `id` carries no default: every describing block on the field is named from it, so a field
 * without one hands the browser a description nothing points at.
 *
 * @typedef {object} FieldOwnProps
 * @property {string} id
 * @property {ReactNode} [label] absent where the box is named some other way — a row in a repeating
 *   editor carries an `aria-label` and the group's legend is the name on the screen. no label is
 *   rendered then, because an empty one is a labelling relationship the browser reads as no name.
 * @property {boolean | undefined} [optional]
 * @property {ReactNode} [hint]
 * @property {ReactNode} [error]
 * @property {ReactNode} [needed] what marks the field as wanted by something elsewhere on the page.
 * @property {ReactNode} [beside] a control that acts on what is in the box, put on the box's own
 *   row rather than under it — one destination and one send, instead of a press below a column of
 *   boxes. the row is `.adm-actions`, which is what makes the box take the line's remainder and the
 *   pair wrap at the 375px floor rather than shrink.
 * @property {boolean | undefined} [masked] the box holds its value as dots until a press inside it
 *   swaps it to the value, and back. it is for a box seeded with a credential the deployment is
 *   already holding: a stored password standing legible on the screen is one anybody beside the
 *   operator or watching the call can read, and the operator still has to be able to check it
 *   character for character, so the value is one press away rather than withheld.
 *
 *   the press stands at the end of the box rather than on the row {@link beside} uses, so a masked
 *   box is the width of every plain box in the same fold. the state is this field's own and starts
 *   hidden at every mount.
 *
 *   an input's alone: a textarea takes no type, so a masked one holds nothing back and draws no
 *   press at all.
 * @property {boolean | undefined} [code]
 * @property {string | undefined} [placeholder]
 * @property {HTMLInputTypeAttribute | undefined} [type]
 * @property {'input' | 'textarea' | undefined} [as]
 * @property {PointerState | undefined} [state] the state pinned by class rather than reached,
 *   which is what a specimen wants and no screen does. unavailable is not one of them:
 *   packages/operator/src/styles/adm.css draws `.adm-input:disabled` with no twin beside it, so
 *   a box that cannot be used takes the platform's own `disabled` through the rest.
 */

/**
 * the rest reaches whichever box `as` names.
 *
 * three of a caller's own arrive as the platform's attributes rather than as props of this field's,
 * and each is taken in rather than replaced: `className` is added to the class list this field
 * composes, `aria-invalid` marks the box refused alongside whatever message it holds, and the
 * starting value is `defaultValue` — or `value` with a handler beside it, which this field has no
 * opinion about either way.
 *
 * @typedef {FieldOwnProps
 *   & Omit<InputHTMLAttributes<HTMLInputElement>, keyof FieldOwnProps>
 *   & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, keyof FieldOwnProps>} FieldProps
 */

/* label above the box, always. optional markers appear only on boxes that may legitimately be
   blank. four states, and the fourth is the one a design tool will not infer:
   "needed" — something elsewhere on the page has marked this field as required for a thing to
   work, without the field itself being in error. the operator has not done anything wrong yet. */
/** @param {FieldProps} props */
export function Field({
	id,
	label,
	optional,
	hint,
	error,
	needed,
	beside,
	masked,
	code,
	placeholder,
	type = 'text',
	as = 'input',
	state,
	className,
	'aria-invalid': stated,
	...rest
}) {
	const Tag = as === 'textarea' ? 'textarea' : 'input';
	/* what the box is holding, and it starts hidden at every mount: a press is what puts a stored
	   credential on the screen, so a box that came back revealed because something above it drew
	   again is one nobody asked to see. */
	const [shown, setShown] = useState(false);
	const hidden = masked && !shown;
	/* the press that swaps the two. it stands inside the box rather than on the row `beside` uses —
	   `.adm-maskwrap` in packages/operator/src/styles/adm.css, which argues why.
	   what it says is what the press does and it changes with what the press did; the mark carries
	   no name of its own (../status/Mark.jsx draws an unlabelled one out of the tree), so the button
	   is what a reader is told, and `aria-controls` is what says which box it is about.
	   it closes with the box: a live press inside a box shut for a write in flight reads as a
	   control that missed the state its own field is in.

	   and it is drawn for an input alone. a textarea takes no `type`, so there is nothing to swap:
	   the press would stand in a box already legible, promising a change it cannot make. */
	const reveal =
		masked && as !== 'textarea' ? (
			<Button
				type="button"
				variant="quiet"
				size="sm"
				mark={hidden ? 'eye' : 'eye-off'}
				aria-controls={id}
				aria-label={hidden ? 'Show the value' : 'Hide the value'}
				disabled={rest.disabled}
				onClick={() => setShown((was) => !was)}
			/>
		) : null;
	/* the box with its own press inside it: `.adm-maskwrap` in packages/operator/src/styles/adm.css
	   is what places the press and reserves the room for it. a box with no press draws no wrapper. */
	const inBox = (/** @type {ReactNode} */ box) =>
		reveal === null ? (
			box
		) : (
			<div className="adm-maskwrap">
				{box}
				{reveal}
			</div>
		);
	/* the box, alone on its row or sharing it. what shares it is wrapped rather than placed beside
	   the box, because the row a pair needs is `.adm-actions` and this field's own rows are what
	   everything below the box is placed in: packages/operator/src/styles/adm.css puts the wrapper
	   in the box's row, so the refusal and the standing sentence keep the rows they name whether or
	   not there is a control up there. a field with nothing beside its box draws no wrapper — a flex
	   line around one element answers nothing.

	   a masked box stands on that row as its wrapper, as a select does: what is on the row is what
	   the box is inside of. */
	const withBox = (/** @type {ReactNode} */ box) =>
		beside ? (
			<div className="adm-actions">
				{box}
				{beside}
			</div>
		) : (
			box
		);
	// refused by the message this field holds, or by a rule that belongs to something larger than
	// one box: a fieldset draws a pair's message once and marks both boxes from out here, since
	// either box fixes the pair and neither one is the wrong one.
	const refused = error ? true : stated === true || stated === 'true';
	const describedBy =
		[hint ? `${id}-hint` : null, error ? `${id}-err` : null, needed ? `${id}-need` : null]
			.filter(Boolean)
			.join(' ') || undefined;
	const cls = [
		as === 'textarea' ? 'adm-textarea' : 'adm-input',
		refused ? (as === 'textarea' ? 'adm-textarea--invalid' : 'adm-input--invalid') : '',
		!refused && needed ? 'adm-input--needed' : '',
		code ? 'adm-input--code' : '',
		state ? `is-${state}` : '',
		className
	]
		.filter(Boolean)
		.join(' ');
	return (
		<div className="adm-field">
			{label ? (
				<label className="adm-field__label" htmlFor={id}>
					{label}
					{optional ? <span className="adm-field__optional"> (optional)</span> : null}
				</label>
			) : null}
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			{withBox(
				inBox(
					<Tag
						id={id}
						className={cls}
						type={as === 'textarea' ? undefined : hidden ? 'password' : type}
						placeholder={placeholder}
						aria-invalid={refused ? 'true' : undefined}
						aria-describedby={describedBy}
						{...rest}
					/>
				)
			)}
			{/* both rows are ./FieldMessage.jsx's, and the sentence is wrapped there: which of the two
			    announces itself, and why a message is never handed to the row unwrapped, are argued in
			    that file. */}
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
			{/* drawn beside a message rather than instead of one. the two are reachable together —
			    a test send marks a blank box as wanted, and a save refused afterwards leaves the
			    field holding both — and the one that would disappear is the one saying what the box
			    is for. */}
			{needed ? (
				<FieldMessage tone="needed" id={`${id}-need`}>
					{needed}
				</FieldMessage>
			) : null}
		</div>
	);
}
