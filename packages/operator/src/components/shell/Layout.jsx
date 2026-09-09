/**
 * @import { ReactNode } from 'react'
 */

/**
 * @typedef {object} ColumnProps
 * @property {boolean | undefined} [wide] the measure a table plane takes, and nothing else.
 * @property {boolean | undefined} [stack]
 * @property {ReactNode} [children]
 *
 * @typedef {object} StackProps
 * @property {boolean | undefined} [tight]
 * @property {ReactNode} [children]
 *
 * @typedef {object} SectionProps
 * @property {boolean | undefined} [card] the division drawn as a box of its own rather than as a
 *   band of the page. which frame a division takes is the screen's answer and not the division's.
 * @property {ReactNode} [children]
 *
 * @typedef {object} ListProps
 * @property {ReactNode} [children]
 *
 * @typedef {object} StepsProps
 * @property {boolean | undefined} [tight] the closer run a list of one-line steps takes, which is
 *   the same step a tight `Stack` sets. a step whose body is a block of its own carries its own
 *   spacing and takes none.
 * @property {ReactNode} [children]
 *
 * @typedef {object} GroupProps
 * @property {ReactNode} [label] what the band names. a block with nothing to write there is a `Stack`.
 * @property {'h2' | 'h3' | 'h4' | 'h5' | 'h6'} labelAs the element the band's name is drawn as,
 *   stated by every caller and defaulted by none. the level a band belongs at is a fact about what
 *   it is drawn under rather than about the band — a group inside a screen's own section takes one
 *   level and the same group inside a panel folded under a heading takes another — so a component
 *   that picked one would be right on the first surface to use it and wrong on the next, which is
 *   the reason `StatusLine`'s own `labelAs` gives. `h2` is the ceiling because a screen's
 *   `PageHeader` draws its `h1`. every level is a heading and `span` is not among them, where
 *   `StatusLine` offers it: a band names the block, which is what a `Group` has and a `Stack` does
 *   not.
 * @property {ReactNode} [children]
 */

/* the six arrangements every operator screen is built out of, and the answer to a layout an
   inline grid would otherwise invent. packages/operator/src/styles/adm.css draws all of them, so
   a screen composed from these moves when that sheet moves and a hand-gridded one does not. */

/* the measured column a screen stands in, gapping its own blocks — one element, because
   `<div class="adm-column adm-stack">` is what the screens write. the narrow measure is the
   default and holds prose, forms and ledgers; `wide` is for a table plane and nothing else. */
/** @param {ColumnProps} props */
export function Column({ wide = false, stack = true, children }) {
	return (
		<div
			className={['adm-column', wide ? 'adm-column--wide' : '', stack ? 'adm-stack' : '']
				.filter(Boolean)
				.join(' ')}
		>
			{children}
		</div>
	);
}

/* the step between one block and the next. `tight` is the closer run — a run of rows, a control
   and the sentence under it — and is never the default: a screen stacked tight throughout reads
   as one block with no shape to it. */
/** @param {StackProps} props */
export function Stack({ tight = false, children }) {
	return (
		<div className={['adm-stack', tight ? 'adm-stack--tight' : ''].filter(Boolean).join(' ')}>
			{children}
		</div>
	);
}

/* a division of a screen. two adjacent sections take a rule between them from the sheet, so the
   divider is never written: the second section is what draws it, and one added by hand is a
   single boundary drawn twice. `card` is the same division drawn as a box instead, and which of the
   two a division wears is chosen by the screen mounting it — `.adm-card` in
   packages/operator/src/styles/adm.css argues the choice. */
/** @param {SectionProps} props */
export function Section({ card = false, children }) {
	return <section className={card ? 'adm-card' : 'adm-section'}>{children}</section>;
}

/* a run of records. */
/** @param {ListProps} props */
export function List({ children }) {
	return <div className="adm-list">{children}</div>;
}

/* a sequence a reader follows in order, numbered. it is the one list an operator screen draws markers
   are drawn: packages/operator/src/styles/base.css takes `list-style` off every list in the
   document, and `.adm-steps` in packages/operator/src/styles/adm.css is what puts them back — so
   an `ol` written without this reads as an unordered run of sentences, which is what the steps it
   holds are not. the gap is the stack vocabulary rather than a step of this list's own. */
/** @param {StepsProps} props */
export function Steps({ tight = false, children }) {
	return (
		<ol
			className={['adm-steps', tight ? 'adm-stack adm-stack--tight' : ''].filter(Boolean).join(' ')}
		>
			{children}
		</ol>
	);
}

/* a block that names itself: a hairline box with its heading in a band, and the band and the
   hairline are one device and never half of one. the box is what a block wears when it has a
   name — never a divider, and never reached for to make something look important. a block with
   nothing to write in the band is a `Stack`, and what separates it from the block beside it is
   the space. */
/** @param {GroupProps} props */
export function Group({ label = 'Payment notifications', labelAs: Label, children }) {
	return (
		<div className="adm-group">
			<Label className="adm-group__label">{label}</Label>
			<div className="adm-group__body adm-stack">{children}</div>
		</div>
	);
}
