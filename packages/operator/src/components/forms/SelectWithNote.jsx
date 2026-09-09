import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { ReactNode, SelectHTMLAttributes } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 */

/**
 * one line of the list. the value is what the browser submits and the label is what an operator
 * reads, and they are two things: a fund is chosen by name and recorded by id.
 *
 * @typedef {object} Option
 * @property {string} value
 * @property {ReactNode} label
 */

/**
 * `id` carries no default, for ./Field.jsx's reason: every describing block on this control is
 * named from it, so one without an id hands the browser a description nothing points at.
 *
 * @typedef {object} SelectWithNoteOwnProps
 * @property {string} id
 * @property {ReactNode} [label]
 * @property {ReactNode} [hint] the sentence read before choosing, drawn where ./Field.jsx draws
 *   its own: over the box, in the quiet register. it is what helps a choice be made, never what a
 *   press answered with and never why an option is missing.
 * @property {ReactNode} [note] the standing sentence — an option that should be here is missing and
 *   this says why. it is not a refusal and takes the same register ./Field.jsx's `needed` does.
 * @property {ReactNode} [error] what the last press answered with.
 * @property {readonly Option[] | undefined} [options]
 * @property {Option | undefined} [retired] an option no longer offered, kept until another is chosen.
 * @property {PointerState | undefined} [state] the state pinned by class rather than reached,
 *   for ./Field.jsx's reason, and unavailable is not one of them for its reason either: the
 *   sheet draws `.adm-select:disabled` with no twin beside it, so a control that cannot be used
 *   takes the platform's own `disabled` through the rest.
 */

/**
 * the rest reaches the select.
 *
 * the starting choice is `defaultValue` — or `value` with a handler beside it, which this control
 * has no opinion about either way — and the name it submits under is the platform's own `name`.
 * neither is a prop of this control's: a caller's `value` mapped onto `defaultValue` is a control
 * that ignores every change the caller then makes to it, which is the defect ./Field.jsx carried
 * until it took the attributes as written.
 *
 * `aria-invalid` marks the control refused by a rule that belongs to something larger than this
 * one box, alongside whatever message that larger thing holds.
 *
 * @typedef {SelectWithNoteOwnProps
 *   & Omit<SelectHTMLAttributes<HTMLSelectElement>, keyof SelectWithNoteOwnProps>} SelectWithNoteProps
 */

/* two real situations: an option that should be here is missing and the note says why; and an
   appended no-longer-offered option that stays selected until another is chosen. */
/** @param {SelectWithNoteProps} props */
export function SelectWithNote({
	id,
	label,
	hint,
	note,
	error,
	options = [],
	retired,
	state,
	className,
	'aria-invalid': stated,
	...rest
}) {
	const refused = error ? true : stated === true || stated === 'true';
	const describedBy =
		[hint ? `${id}-hint` : null, error ? `${id}-err` : null, note ? `${id}-note` : null]
			.filter(Boolean)
			.join(' ') || undefined;
	const cls = [
		'adm-select',
		refused ? 'adm-select--invalid' : '',
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
				</label>
			) : null}
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<div className="adm-selectwrap">
				<select
					id={id}
					className={cls}
					aria-invalid={refused ? 'true' : undefined}
					aria-describedby={describedBy}
					{...rest}
				>
					{options.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
					{/* the marker leads and the name follows: a select shows one line at whatever width it
					    has, so a marker appended after an unbounded name is the half that truncates
					    away, leaving the option reading as an ordinary choice. */}
					{retired ? (
						<option value={retired.value}>No longer offered: {retired.label}</option>
					) : null}
				</select>
			</div>
			{/* both rows are ./FieldMessage.jsx's, which is where the refusal being the one live region
			    on the control is argued: it is what a press answered with, and the standing sentence
			    below it is a condition rather than an event. */}
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
			{note ? (
				<FieldMessage tone="needed" id={`${id}-note`}>
					{note}
				</FieldMessage>
			) : null}
		</div>
	);
}
