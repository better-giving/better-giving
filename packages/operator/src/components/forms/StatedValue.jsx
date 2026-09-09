/**
 * @import { ReactNode } from 'react'
 *
 * @typedef {object} StatedValueContent
 * @property {ReactNode} [label] absent where the value is already named by where it sits — a
 *   section's heading above it. no label row is drawn then: the block is a grid, and an empty row
 *   in it is a gap the reader is left to account for.
 * @property {ReactNode} [value]
 * @property {ReactNode} [children]
 * @property {boolean | undefined} [num] the figures stand on one stem, which is
 *   ../../styles/base.css's `.adm-num`. every value that is a number takes it, so a figure that
 *   changes under the reader's eye does not shift the ones beside it and a column of them lines up
 *   on the decimal. a value that is a word or a literal leaves it off: tabular figures inside prose
 *   set the digits wider than the letters around them.
 *
 * @typedef {object} StatedFigure the reading rung, which is every value but the one figure a screen
 *   is read for.
 * @property {boolean | undefined} [code] the value in the mono chip, for a stored literal rather
 *   than a figure.
 * @property {false | undefined} [display]
 *
 * @typedef {object} StatedDisplay the display rung, asked for by name: the one figure the screen is
 *   read for, at the top of the type scale.
 * @property {true} display
 * @property {never} [code] a value is a figure or a literal and never both, so the two rungs are
 *   never worn together — a literal set at the display rung is a key nobody can read across, and a
 *   chip is the shape that says a value was typed rather than counted.
 *
 * @typedef {StatedValueContent & (StatedFigure | StatedDisplay)} StatedValueProps
 */

/* explicitly not a disabled input. currency and payment rails are stated, never chosen, and a
   greyed-out control would read as something the operator failed to reach.

   the value carries every one of its variations as a class on the one span rather than as a node of
   its own, so ../../styles/adm.css and ../../styles/base.css draw the differences and this part
   states none of them. */
/** @param {StatedValueProps} props */
export function StatedValue({ label, value, children, code, num, display }) {
	return (
		<div className="adm-stated">
			{label ? <span className="adm-stated__label">{label}</span> : null}
			{/* the display rung stands in the reading rung's place rather than over it: one class or
			    the other, so neither rule has to outrank anything. the chip is the value's whole cell
			    and no sentence runs up against it. */}
			<span
				className={`${display ? 'adm-headline__value' : 'adm-stated__value'}${code ? ' adm-chip' : ''}${num ? ' adm-num' : ''}`}
			>
				{value}
			</span>
			{children ? <p className="adm-hint">{children}</p> : null}
		</div>
	);
}
