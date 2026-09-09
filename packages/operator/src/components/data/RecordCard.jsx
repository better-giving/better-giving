import { useId } from 'react';
import { StatusWord } from '../status/StatusWord.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { StatusRegister } from '../status/StatusWord.jsx'
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
 * @typedef {object} RecordCardProps
 * @property {ReactNode} [title]
 * @property {RecordTitleLevel} titleAs the element the name is drawn as, stated by the screen and
 *   never defaulted here.
 * @property {string | undefined} [href]
 * @property {ReactNode} [state]
 * @property {StatusRegister | undefined} [register] the register the status word is spoken in.
 * @property {boolean | undefined} [secondary] the quieter of two words, for the one a reader
 *   scanning a list is not looking for.
 * @property {readonly string[] | undefined} [origins]
 * @property {ReactNode} originsLabel what the origins are called on this screen, stated rather than
 *   defaulted: it is the whole of what names the list, and a run of identifiers with no name over it
 *   is the one fact a list of records is scanned for arriving unannounced.
 * @property {ReactNode} emptyOrigins what stands where the list is empty, stated rather than
 *   defaulted for the reason the comment on that branch below gives: a blank value beside a label
 *   reads as a screen that failed to load one rather than as a record no site may use yet.
 * @property {ReactNode} [children]
 */

/** @param {RecordCardProps} props */
export function RecordCard({
	title,
	titleAs,
	href = '#',
	state,
	register,
	secondary = false,
	origins = [],
	originsLabel,
	emptyOrigins,
	children
}) {
	// stated from `useId` rather than written down, because a screen draws one card per record and
	// two lists sharing an id would name the wrong one.
	const labelId = `${useId()}-origins-label`;
	const Title = titleAs;

	return (
		<article className="adm-record">
			<div className="adm-record__head">
				{/* the name is a plain link and takes the title's own type role, rather than arriving at
				    a button's and being pushed back out of it. how loud the words are is
				    `.adm-record__title`'s to say. */}
				<Title className="adm-record__title">
					<a href={href}>{title}</a>
				</Title>
				<StatusWord register={register} secondary={secondary}>
					{state}
				</StatusWord>
			</div>
			{/* the origins are a labelled value and not a run: what they are is the one fact a list of
			    records is scanned for, and a row of identifiers under a title says nothing about which
			    of the record's facts it is. packages/operator/src/styles/adm.css drops the row's rule
			    inside a card, so the card's own border is the only line. */}
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
			{children}
		</article>
	);
}
