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
	/* the box, alone on its row or sharing it. what shares it is wrapped rather than placed beside
	   the box, because the row a pair needs is `.adm-actions` and this field's own rows are what
	   everything below the box is placed in: packages/operator/src/styles/adm.css puts the wrapper
	   in the box's row, so the refusal and the standing sentence keep the rows they name whether or
	   not there is a control up there. a field with nothing beside its box draws no wrapper — a flex
	   line around one element answers nothing. */
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
				<Tag
					id={id}
					className={cls}
					type={as === 'textarea' ? undefined : type}
					placeholder={placeholder}
					aria-invalid={refused ? 'true' : undefined}
					aria-describedby={describedBy}
					{...rest}
				/>
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
