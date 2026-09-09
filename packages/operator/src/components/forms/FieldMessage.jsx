import { Mark } from '../status/Mark.jsx';

/**
 * @import { ReactNode } from 'react'
 */

/**
 * which of the two rows this is. `error` is what a press answered with; `needed` is a standing
 * condition something elsewhere on the page put on the box, with the operator having done nothing
 * wrong yet.
 *
 * the set stays on this component rather than joining ../closed-sets.js, whose header says what
 * earns a place there: a set a second component already needs. nothing else takes this one.
 *
 * @typedef {'error' | 'needed'} FieldMessageTone
 */

/**
 * @typedef {object} FieldMessageProps
 * @property {ReactNode} children the sentence, handed over whole. it may be a node rather than a
 *   string — a value marked with backticks is drawn as code by ../../marked-text.react.tsx, and a
 *   way out of a state is often a link.
 * @property {FieldMessageTone | undefined} [tone]
 * @property {string | undefined} [id] set where a box points at this row through
 *   `aria-describedby`. a row a press draws at a control has nothing pointing at it and carries
 *   none.
 */

/* the one row a message under a box is drawn as, in both tones packages/operator/src/styles/adm.css
   gives it.

   the sentence is wrapped in a single child, and that is the whole reason this is a component. the
   standing row is a flex line, and its gap is what stands between the mark and the words — so a
   message arriving as more than one node takes that gap between every part of itself, and a
   sentence holding a link or a marked value comes apart across the row. a caller handing over a
   plain string cannot see that it matters, which is why no caller wraps its own, and the refusal
   takes the same wrapper so that the two rows are one shape to a reader of either.

   the error row is a live region and the standing row is not. a refusal is the only thing about a
   field that is an event: the operator pressed a button and the box came back. a standing condition
   announcing itself at the same time leaves a reader unable to tell which of the two answered the
   press.

   the `<p>` is returned with nothing around it. adm.css places `.adm-field > .adm-field__error` and
   `.adm-field > .adm-field__needed` in the field's own grid rows, and a wrapper between the field
   and the row loses both placements.

   two shapes rather than one element with the class, the mark and the role written as expressions:
   what separates the tones is every part of the row. the refusal draws no mark — its ink, its
   weight and the box it stands under already say what it is, and a glyph beside every refused box
   is a row of glyphs on a card that came back with several.

   whether there is a message at all stays with the caller — `{error ? <FieldMessage>{error}</FieldMessage> : null}`
   — so the condition that draws the row is the same one that names it in `aria-describedby`. */
/** @param {FieldMessageProps} props */
export function FieldMessage({ children, tone = 'error', id }) {
	if (tone === 'needed')
		return (
			<p className="adm-field__needed" id={id}>
				<Mark name="triangle-alert" />
				<span>{children}</span>
			</p>
		);
	return (
		<p className="adm-field__error" id={id} role="alert">
			<span>{children}</span>
		</p>
	);
}
