import { useId } from 'react';
import { Mark } from '../status/Mark.jsx';
import { StatusWord } from '../status/StatusWord.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { MarkName } from '../status/Mark.jsx'
 * @import { StatusRegister } from '../status/StatusWord.jsx'
 * @import { Tone } from '../closed-sets.js'
 */

/**
 * what a record's name may be drawn as. a record is always a heading — it is the thing a reader
 * jumps between — and which level it takes is the screen's to say: a level this part picked would
 * be right on one screen and wrong on the next, with nothing on either saying so.
 *
 * @typedef {'h2' | 'h3' | 'h4' | 'h5' | 'h6'} RecordTitleLevel
 */

/**
 * `state` is the word the record's own status carries, not an interaction state.
 *
 * @typedef {object} RecordCardBaseProps
 * @property {ReactNode} [title]
 * @property {RecordTitleLevel} titleAs the element the name is drawn as, stated by the screen and
 *   never defaulted here.
 * @property {string | undefined} [href]
 * @property {MarkName | undefined} [mark] the glyph at the leading edge of the head, for a list
 *   whose records are all one kind of thing and say so. absent is the head every other screen
 *   draws, on a baseline and with nothing in front of the name.
 * @property {ReactNode} [state]
 * @property {StatusRegister | undefined} [register] the register the status word is spoken in.
 * @property {boolean | undefined} [secondary] the quieter of two words, for the one a reader
 *   scanning a list is not looking for.
 * @property {Tone | undefined} [tone] where the record stands on its own lifecycle ladder, handed
 *   straight to the status word. a screen passes this or `secondary` and never both.
 * @property {ReactNode} [children]
 */

/**
 * the origins named and read, which is what a record says about itself.
 *
 * @typedef {object} OriginsRead
 * @property {readonly string[] | undefined} [origins]
 * @property {ReactNode} originsLabel what the origins are called on this screen, stated rather than
 *   defaulted: it is the whole of what names the list, and a run of identifiers with no name over it
 *   is the one fact a list of records is scanned for arriving unannounced.
 * @property {ReactNode} emptyOrigins what stands where the list is empty, stated rather than
 *   defaulted for the reason the comment on that branch below gives: a blank value beside a label
 *   reads as a screen that failed to load one rather than as a record no site may use yet.
 * @property {undefined} [foot]
 */

/**
 * the same origins taken rather than read: each one a press at the foot of the card, in ./Press.jsx.
 * there is no label and no sentence for the empty case, and neither is a thing left out — a run of
 * presses is what a reader acts on rather than a fact they scan for, and a card with nothing to
 * press simply has no foot.
 *
 * @typedef {object} OriginsPressed
 * @property {ReactNode} foot the presses, each one a `<li>` ./Press.jsx draws.
 * @property {undefined} [origins]
 * @property {undefined} [originsLabel]
 * @property {undefined} [emptyOrigins]
 */

/**
 * the two readings, and a screen picks one: what tells them apart is not a flag but which props
 * the screen has to hand, so passing a label alongside a foot is a type error rather than a branch
 * this part has to choose between at runtime.
 *
 * @typedef {RecordCardBaseProps & (OriginsRead | OriginsPressed)} RecordCardProps
 */

/** @param {RecordCardProps} props */
export function RecordCard({
	title,
	titleAs,
	href = '#',
	mark,
	state,
	register,
	secondary = false,
	tone,
	origins = [],
	originsLabel,
	emptyOrigins,
	foot,
	children
}) {
	// stated from `useId` rather than written down, because a screen draws one card per record and
	// two lists sharing an id would name the wrong one.
	const labelId = `${useId()}-origins-label`;
	const Title = titleAs;

	return (
		<article className="adm-record">
			{/* the marked head is a second class and not a rule of its own: a head with a mark in it
			    has three tracks, and one without has two ends held apart. both keep the baseline,
			    which is what a heading and the word beside it are read on. ../../styles/adm.css
			    argues both. */}
			<div className={mark ? 'adm-record__head adm-record__head--marked' : 'adm-record__head'}>
				{/* out of the accessibility tree: every record in a list whose records carry one carries
				    the same glyph, so a reader told it on each of twenty is told nothing twenty times.
				    what names the record is the name. */}
				{mark ? (
					<span className="adm-record__mark">
						<Mark name={mark} />
					</span>
				) : null}
				{/* the name is a plain link and takes the title's own type role, rather than arriving at
				    a button's and being pushed back out of it. how loud the words are is
				    `.adm-record__title`'s to say. */}
				<Title className="adm-record__title">
					<a href={href}>{title}</a>
				</Title>
				<StatusWord register={register} secondary={secondary} tone={tone}>
					{state}
				</StatusWord>
			</div>
			{/* the two readings of the same origins: named and read, or taken. which one a card draws
			    is settled by the props the screen had to hand rather than by a flag — the typedefs
			    above are what make passing both a type error. */}
			{foot ? (
				// the foot keeps the list the labelled reading draws and drops the `<dl>` around it:
				// what is at the foot of the card is a run of presses rather than a value the record
				// states, so there is nothing for a label to name. the role is stated for the two
				// reasons the other reading states it for: no marker and a flex row, either of which
				// stops a browser reporting this as a list. removing the attribute re-opens the defect.
				// biome-ignore lint/a11y/noRedundantRoles: no marker and a flex row, as above.
				<ul role="list" className="adm-record__origins adm-record__foot">
					{foot}
				</ul>
			) : (
				// the origins as a labelled value and not a run: what they are is the one fact a list of
				// records is scanned for, and a row of identifiers under a title says nothing about
				// which of the record's facts it is. ../../styles/adm.css drops the row's rule inside a
				// card, so the card's own border is the only line.
				<dl>
					<div className="adm-setting">
						<dt className="adm-setting__label" id={labelId}>
							{originsLabel}
						</dt>
						{origins.length ? (
							// a list and never the joined text, however few there are: an origin is an
							// identifier, and a comma between two of them reads as part of one.
							//
							// the role is stated because nothing about this element is left reading as a
							// list: packages/operator/src/styles/base.css takes `list-style` off every list
							// in the document, and `.adm-record__origins` lays the items out as a flex row —
							// either on its own is enough for a browser to stop reporting how many there are
							// and where one ends.
							<dd className="adm-setting__value">
								{/* biome-ignore lint/a11y/noRedundantRoles: not redundant here, for the two
							    reasons above — no marker and a flex row, either of which stops a browser
							    reporting this as a list. removing the attribute re-opens the defect. */}
								<ul role="list" aria-labelledby={labelId} className="adm-record__origins">
									{origins.map((o) => (
										<li key={o}>
											<code className="adm-chip">{o}</code>
										</li>
									))}
								</ul>
							</dd>
						) : (
							// the value can be empty, and it says so in words: a blank value beside a label
							// reads as a screen that failed to load one rather than as a record no site may
							// use yet. it is a caption because it states what the record is rather than
							// something to act on.
							<dd className="adm-setting__value adm-caption">{emptyOrigins}</dd>
						)}
					</div>
				</dl>
			)}
			{children}
		</article>
	);
}
