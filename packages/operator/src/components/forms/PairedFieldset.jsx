import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { ReactNode } from 'react'
 */

/**
 * `id` carries no default, for ./Field.jsx's reason: the pair's message is named from it, and a
 * message with no name is one neither box can be pointed at.
 *
 * @typedef {object} PairedFieldsetProps
 * @property {string} id
 * @property {ReactNode} [legend] absent where the pair is already named by where it sits. no
 *   legend is rendered then, because an empty one is a name a reader is read out as nothing.
 * @property {ReactNode} [hint]
 * @property {ReactNode} [error] the pair's, and it sits after both boxes.
 * @property {boolean | undefined} [side]
 * @property {ReactNode} [children]
 */

/* two boxes that are one decision. the error belongs to the pair and sits AFTER both boxes, with
   both marked — never under one of them.

   the message is named `${id}-err` the way ./Field.jsx names its own, because that is the name each
   box has to point at: a box marked refused from out here draws the border and says nothing, and
   the sentence it is refused by is the one down here. */
/** @param {PairedFieldsetProps} props */
export function PairedFieldset({ id, legend, hint, error, side = false, children }) {
	return (
		<fieldset className="adm-fieldset">
			{legend ? <legend className="adm-fieldset__legend">{legend}</legend> : null}
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<div className={`adm-pair${side ? ' adm-pair--side' : ''}`}>{children}</div>
			{/* the one live region on the pair, for ./FieldMessage.jsx's reason: a refusal is what a
			    press answered with. */}
			{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
		</fieldset>
	);
}
