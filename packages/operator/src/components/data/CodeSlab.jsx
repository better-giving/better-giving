import { useId } from 'react';
import { CopyControl } from '../controls/CopyControl.jsx';

/**
 * @import { ReactNode } from 'react'
 *
 * @typedef {object} SlabContent
 * @property {string} content the text itself, rendered verbatim and copied verbatim.
 * @property {boolean | undefined} [copyable] whether to offer a copy control. off by default: not
 *   every slab is something to take.
 * @property {string | undefined} [record] the record this slab hands its content over for, in the
 *   words the screen already prints for it.
 *
 *   it settles the two things a repeated slab otherwise gets wrong: the box stops being a landmark
 *   — twenty regions all called `snippet` is a list somebody has to walk to reach the one record
 *   they came for — and the copy control is named for the record it takes rather than being one of
 *   twenty called Copy. a slab a page draws once leaves it unset.
 *
 * @typedef {object} SlabCaptioned the block form, which is every slab that is not one line.
 * @property {false | undefined} [oneline]
 * @property {string | undefined} [label] the short caption on the slab's own top line, naming what
 *   is in it — `snippet`. it is a caption and not a heading: a page that needs a heading over a slab
 *   writes one above.
 *
 * @typedef {object} SlabOneLine the one-line form, asked for by name.
 * @property {true} oneline the value drawn as one band: the code runs the width of the box and
 *   scrolls sideways, and the copy control stands over its trailing end rather than over a head of
 *   its own.
 *
 *   it is for a value that is one unbroken literal nobody reads and somebody copies — an address, a
 *   key, an id. a value with newlines in it never takes it: the form draws one line, so every line
 *   after the first would be hidden rather than shortened, and a snippet is the case that proves it.
 * @property {never} [label] no caption: there is no head in this form to put one in, and the
 *   sentence above the box is what names the value.
 *
 * @typedef {SlabContent & (SlabCaptioned | SlabOneLine)} CodeSlabProps
 *
 * @typedef {object} InlineCodeProps
 * @property {ReactNode} [children]
 *
 * @typedef {object} CodeChipProps
 * @property {ReactNode} [children]
 */

/* a block of text a person copies rather than reads — an embed snippet — and the control that puts
   it on the clipboard. it carries operator-typed strings, so it may not assume a length.

   the caption and the control share a head above the block rather than sitting over the code: the
   block scrolls sideways, and anything laid on top of it is over a moving surface. the scrolling
   element is that block and never the box around it — a box that scrolled took its head with it,
   and a copy control hundreds of pixels past the visible edge is one nobody goes looking for.

   the one-line form is the exception to the head and to nothing else. it is asked for by name, by
   a screen holding a value that is one unbroken literal — an address, a key, an id — where a head
   would be a second row over a box a line high, and where nobody reads the value at all. there the
   control stands over the trailing end of the line, and the fade
   ../../styles/adm.css draws under it is what keeps the moving surface from reaching the control.
   a value with newlines in it stays the block form whatever it is: one line of a snippet is the
   snippet with everything after `<script>` taken away.

   it owns the `<pre>` newline trap, which is the main reason it is a component. html drops a single
   newline immediately after the opening `<pre>` and nothing else, so writing the tag and its
   content on separate lines is invisible in some places and a leading blank line in others — and a
   snippet copied with a blank line at the top is the kind of thing nobody notices until it is
   pasted somewhere that cares. the content expression sits hard against the tags below and must
   stay there.

   the slab is the only dark surface an operator screen has and one rule draws it: `.adm-slab`. */
/** @param {CodeSlabProps} props */
export function CodeSlab({ content, label, copyable = false, record, oneline = false }) {
	// stated from `useId` rather than written down, because a page draws one slab per record and two
	// elements sharing an id would name the wrong box.
	const labelId = `${useId()}-slabhead-label`;

	// the control is written once and stands in one of two places: in the head, or over the trailing
	// end of the line. it is the same control either way — what changes is which side of the block
	// it is drawn on, and in the one-line form that is what puts it over the code in paint order.
	const control = copyable ? (
		<CopyControl
			text={content}
			{...(record && label ? { label: `Copy the ${label} for ${record}` } : {})}
		/>
	) : null;

	return (
		// the role follows the label and the record. an unnamed `region` is exposed as nothing at
		// all, so a slab with no caption is a `group`; a slab standing in a record is a `group` as
		// well, whatever its caption says, because a `region` is a landmark and a landmark is a
		// section of the page.
		//
		/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the rule cannot evaluate a role written
		   as an expression, so it reads this as a bare `div` — which supports no `aria-labelledby`.
		   both roles it resolves to take a label, and the attribute is only drawn when there is one
		   to point at. */
		<div
			className={`adm-slab${oneline ? ' adm-slab--oneline' : ''}`}
			role={label && !record ? 'region' : 'group'}
			aria-labelledby={label ? labelId : undefined}
		>
			{/* the head is laid out with `space-between`, which lays a lone child at the leading edge
			    — where every other slab on the page puts its caption. a head holding only the control
			    says so and ../../styles/adm.css turns it round, rather than the caption slot being
			    held open by an empty element nobody can name.

			    the one-line form draws no head at all: it carries no caption, which is what its type
			    refuses, and its control stands after the block instead. */}
			{oneline ? null : (
				<div className={`adm-slabhead${label ? '' : ' adm-slabhead--uncaptioned'}`}>
					{label ? (
						<span className="adm-slabhead__label" id={labelId}>
							{label}
						</span>
					) : null}
					{control}
				</div>
			)}

			{/* the block scrolls sideways — a snippet is one long line more often than not — so it is
			    the block that takes focus and a keyboard can reach the end of what is in it
			    (WCAG 2.1.1). the ring is the one packages/operator/src/styles/base.css puts on
			    everything focusable on an operator screen, and it lands on the code rather than on
			    the box because the code is what the keyboard reached. the role and the name stay on
			    the box above, which is the section a reader navigates to and holds the control as
			    well as the code.

			    the content expression is flush against both tags on purpose; see the note above. */}
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: the rule reads the tag and not the
			    overflow. a box a keyboard scrolls is operable, and one that cannot be reached holds
			    everything past its right edge away from a reader who has no pointer. */}
			<pre tabIndex={0}>{content}</pre>

			{/* the one-line form's control, and it is drawn after the block for two reasons that are
			    one decision: the two share a cell, so document order is what lays this over the code
			    rather than under it, and a control reached after the thing it acts on is the order a
			    keyboard meets them in. */}
			{oneline ? control : null}
		</div>
	);
}

/* a literal standing inside a sentence. the class it writes takes no inline padding, because what
   follows one in prose is a comma or an apostrophe and room around the tint reads as a typed space
   — the case is made in full at `.adm-code` in ../../styles/base.css.

   a literal drawn on its own is `CodeChip` below and never this: the two roles are one class each,
   so which a call site is asking for is what it writes. */
/** @param {InlineCodeProps} props */
export function InlineCode({ children }) {
	return <code className="adm-code">{children}</code>;
}

/* a literal drawn as a thing rather than said in a sentence: the whole of a value cell, a row in a
   list of identifiers, the name on a tick box. nothing abuts it, so it takes the inline padding
   that makes it a box — `.adm-chip` in ../../styles/adm.css. */
/** @param {CodeChipProps} props */
export function CodeChip({ children }) {
	return <code className="adm-chip">{children}</code>;
}
