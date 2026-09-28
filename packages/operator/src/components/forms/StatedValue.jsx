import { useId } from 'react';

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
 * @property {boolean | undefined} [flush] no block padding, for a value standing as one item of a
 *   run that spaces its own items — ../../styles/adm.css's `.adm-stated--flush` says which.
 *
 * @typedef {object} StatedFigure the reading rung, which is every value but the one figure a screen
 *   is read for.
 * @property {boolean | undefined} [code] the value in the mono chip, for a stored literal rather
 *   than a figure.
 * @property {false | undefined} [display]
 * @property {never} [block]
 *
 * @typedef {object} StatedDisplay the display rung, asked for by name: the one figure the screen is
 *   read for, at the top of the type scale.
 * @property {true} display
 * @property {never} [code] a value is a figure or a literal and never both, so the two rungs are
 *   never worn together — a literal set at the display rung is a key nobody can read across, and a
 *   chip is the shape that says a value was typed rather than counted.
 * @property {never} [block]
 *
 * @typedef {object} StatedBlock the value as a block of its own rather than a line of text — the
 *   one-line copyable CodeSlab a deployment's address is drawn in. a block is not a phrase, so it
 *   stands in the grid as it is instead of inside the value's span, and nothing in the value's
 *   rungs applies to it.
 * @property {ReactNode} block
 * @property {ReactNode} label required here: the block form is a named group, and the label is its
 *   name.
 * @property {never} [value]
 * @property {never} [num]
 * @property {never} [code]
 * @property {never} [display]
 *
 * @typedef {StatedValueContent & (StatedFigure | StatedDisplay | StatedBlock)} StatedValueProps
 */

/* explicitly not a disabled input. currency and payment rails are stated, never chosen, and a
   greyed-out control would read as something the operator failed to reach.

   the value carries every one of its variations as a class on the one span rather than as a node of
   its own, so ../../styles/adm.css and ../../styles/base.css draw the differences and this part
   states none of them.

   the block form is the one place the label is more than the row above: a block holds controls of
   its own (a slab's copy button), and a reader tabbing onto one lands inside it without having read
   down past the label. the wrapper is a group named by that label, so the name is announced on the
   way in. */
/** @param {StatedValueProps} props */
export function StatedValue({ label, value, children, code, num, display, flush, block }) {
	const labelId = `${useId()}-stated-label`;
	const hint = children ? <p className="adm-hint">{children}</p> : null;
	if (block !== undefined) {
		return (
			// the class list is spelled at each element rather than held in a variable: a name written
			// anywhere but a `className` is one packages/app/src/lib/admin/styles/conformance.spec.ts
			// cannot see worn.
			//
			/* biome-ignore lint/a11y/useSemanticElements: a `<fieldset>` groups a form's own controls,
			   and this is a value the operator is not asked to set — a fieldset here would read as a
			   question with no answer to give. */
			<div
				className={flush ? 'adm-stated adm-stated--flush' : 'adm-stated'}
				role="group"
				aria-labelledby={labelId}
			>
				<span className="adm-stated__label" id={labelId}>
					{label}
				</span>
				{block}
				{hint}
			</div>
		);
	}
	return (
		<div className={flush ? 'adm-stated adm-stated--flush' : 'adm-stated'}>
			{label ? <span className="adm-stated__label">{label}</span> : null}
			{/* the display rung stands in the reading rung's place rather than over it: one class or
			    the other, so neither rule has to outrank anything. the chip is the value's whole cell
			    and no sentence runs up against it. */}
			<span
				className={`${display ? 'adm-headline__value' : 'adm-stated__value'}${code ? ' adm-chip' : ''}${num ? ' adm-num' : ''}`}
			>
				{value}
			</span>
			{hint}
		</div>
	);
}
