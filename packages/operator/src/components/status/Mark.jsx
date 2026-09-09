import { GLYPHS } from './glyphs.js';

/**
 * @import { CSSProperties } from 'react'
 */

/**
 * every mark an operator screen draws — the keys ./glyphs.js exports.
 *
 * @typedef {keyof typeof GLYPHS} MarkName
 */

/**
 * `lg` is the banner's mark, and the only mark the sheets draw at a second size.
 *
 * @typedef {'md' | 'lg'} MarkSize
 */

/**
 * @typedef {object} MarkProps
 * @property {MarkName} name
 * @property {MarkSize | undefined} [size]
 * @property {string | undefined} [label] the accessible name. without one the mark is out of the tree.
 * @property {CSSProperties | undefined} [style]
 * @property {string | undefined} [className]
 */

/* the operator surfaces' only icon component, and the one place a mark is drawn.
   ./glyphs.js hands it lucide's own component for the name, which renders an inline <svg> stroked
   with `currentColor` — so a mark takes its tone from the text it stands with exactly as text does,
   and every rule that tones one only sets `color`.

   no size is passed down. lucide takes a `size` number and it would be a length written into a
   component, which is the one thing packages/operator/src/styles/raw-values.ts refuses: the box is
   `.adm-mark` in ../../styles/base.css and the class is the whole of how a mark is sized.

   two shapes of markup and not one with everything conditional: a mark with a label is an image
   carrying that name, and a mark without one is out of the accessibility tree entirely. written as
   one element the role would be an expression, `aria-label` would stand beside it unconditionally,
   and what a reader — and `useAriaPropsSupportedByRole` — meets is a bare element carrying a
   property no role of its supports. */
/** @param {MarkProps} props */
export function Mark({ name, size = 'md', label, style, className = '' }) {
	const Glyph = GLYPHS[name];
	// the class list is spelled at each element rather than lifted above them: a name assembled into
	// a variable is a name packages/app/src/lib/admin/styles/conformance.spec.ts cannot see, and
	// `.adm-mark` then reads there as a rule the sheets draw and nothing wears. lucide forwards
	// `className` and every unknown prop onto the <svg> it renders, so the name lands on the element
	// the sheet draws and there is no wrapper between them.
	if (label)
		return (
			<Glyph
				className={`adm-mark${size === 'lg' ? ' adm-mark--lg' : ''} ${className}`}
				role="img"
				aria-label={label}
				style={style}
			/>
		);
	return (
		<Glyph
			className={`adm-mark${size === 'lg' ? ' adm-mark--lg' : ''} ${className}`}
			aria-hidden="true"
			style={style}
		/>
	);
}

export const MARK_NAMES = /** @type {readonly MarkName[]} */ (Object.keys(GLYPHS));
