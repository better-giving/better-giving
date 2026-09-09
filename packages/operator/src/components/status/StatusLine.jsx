import { Children, Fragment, isValidElement } from 'react';

import { Mark } from './Mark.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { MarkName } from './Mark.jsx'
 * @import { Tone } from '../closed-sets.js'
 */

/**
 * a ledger line takes two tones the banners do not. `resolved` is a line that was a blocker and is
 * not any more, and it keeps its place so the ledger's outline does not change shape. `running` is
 * a line whose subject is still happening: it is the unfinished outline in the accent, because the
 * line will change on its own and nothing is being asked of the reader.
 *
 * @typedef {Tone | 'resolved' | 'running'} StatusTone
 */

/**
 * @typedef {object} StatusLineBase
 * @property {ReactNode} [label]
 * @property {ReactNode} [aside] what the line has to say about its own progress that its word does
 *   not — a count, a share of something, a bar of cells. it is the caller's own element carrying its
 *   own class: this line knows that something stands there and never what it is.
 *
 *   **where it stands is this part's and how it is set is not.** it stands last on the head, which
 *   is what starts it on the label's own inline edge rather than a gutter in from it, where a block
 *   under the body would begin. the head is a wrapping row, so an aside left at its own width sits
 *   beside a short label and under a long one — a run of rows whose asides have to agree is a
 *   reading the ledger takes and no line can take about itself, and `aligned` on `StatusLedger`
 *   below is that reading.
 * @property {StatusTone | undefined} [tone]
 * @property {ReactNode} [note] the consequence sentence.
 * @property {string | undefined} [fixHref] where the line's own screen is. it rides the end of the
 *   sentence where there is one and stands in a block of its own where there is not, so a line that
 *   is done and has nothing left to say can still be the way to the screen that did it.
 * @property {ReactNode} [fixLabel] what that link is called. `Fix this` is the default and reads as
 *   an instruction on a line that needs none, so a screen linking away from a step already done
 *   states its own word.
 * @property {ReactNode} [children] the blocks attached under the line, each one carrying
 *   `adm-status__attach` itself: packages/operator/src/styles/adm.css steps the first one off the
 *   sentence and every one after it off its peer, which one wrapper around all of them cannot say.
 * @property {ReactNode} [steps] the line opened into the steps its subject is made of, as a run of
 *   `StatusStep`s. it is drawn in the line's own two tracks rather than inside the body, which is
 *   what puts a step's mark in the line's mark gutter and a step's sentence on the label's edge —
 *   the whole of what keeps a run of steps from reading as a tree. a line that opens on a press
 *   takes none: what is under `beneath` is where that line's detail goes.
 *
 *   **one step is folded into the line and never drawn.** a subject made of a single step has that
 *   step's sentence saying what the line's own sentence just said, one line below it, so the run is
 *   drawn from two steps up. a caller hands over what its subject is made of and this decides
 *   whether there is a run to draw — a caller that filtered its own single steps out would be
 *   stating that rule a second time, in a module that cannot see the mark it also decides.
 * @property {boolean | undefined} [dim] a line whose subject does not exist yet. it composes with
 *   the tone rather than replacing it — the line already carries the tone it will read as once the
 *   thing is real — and takes the whole row back to muted ink: the label and any link inside it and
 *   the sentence, as well as the mark and the word. a run of lines lit one at a time is what a
 *   chain making those things reports as it reaches each one.
 * @property {MarkName | undefined} [mark] the mark the tone would otherwise choose.
 * @property {ReactNode} [beneath] a whole screen's worth of detail, which opens in place.
 * @property {boolean | undefined} [open]
 * @property {((open: boolean) => void) | undefined} [onToggle] what the line reports when it is
 *   opened or shut. the element holds that state and nothing else on the page can read it, so a
 *   screen with a control over the whole ledger — expand all, collapse all — cannot say what it
 *   did unless each line tells it.
 * @property {string | undefined} [id] where a screen sends focus when the control it acted on has
 *   gone with the state that drew it. it lands on the label, which is described by the word and the
 *   sentence beside it rather than repeating either.
 * @property {LabelLevel} labelAs the element the label is drawn as, stated by the screen and never
 *   defaulted here: a ledger of one-line statements outlines nothing and takes `span`, while a
 *   ledger whose entries open is a run of sections and takes the level under the heading it stands
 *   beneath. a level this part picked would be right on one screen and wrong on the next, with
 *   nothing on either saying so.
 */

/**
 * where the line's status word is drawn. it is the caller's statement in both arms and is never
 * derived from the tone: one tone is read by more than one word, and the two operator surfaces do
 * not use the same ones.
 *
 * `word` draws it beside the label, which is where a line asking for something has to say it — the
 * three unfinished tones share a mark between them, so on those lines the word is the only thing
 * telling an operator which problem they have.
 *
 * `wordOnMark` states the same word and draws no text, putting it on the mark as its accessible
 * name instead. what it costs is that the state is then shape and colour for everyone who can see
 * it, so the label has to be the whole subject on its own. `StatusStep` below says its state this
 * way for the same reason and has no other way to.
 *
 * two kinds of line carry it. one is finished — `done` or `resolved` — where the tick already says
 * so and the word beside it is the statement made twice. the other is a line whose label states
 * its own state in words: it reads `Registering your hostnames` while that is happening and `Your
 * hostnames are registered` once it is not, so the label is the subject and its state in one
 * sentence whatever tone the line is in — and a running line puts its word on the mark for exactly
 * the reason a done one does.
 *
 * the arms are what stop a line saying nothing at all: `wordOnMark` may only be set beside a word,
 * so a line drawn without text has named its mark.
 *
 * @typedef {{ word?: string | undefined, wordOnMark?: false } | { word: string, wordOnMark: boolean }} StatusWord
 *
 * @typedef {StatusLineBase & StatusWord} StatusLineProps
 */

/**
 * @typedef {object} StatusLedgerProps
 * @property {ReactNode} [children]
 * @property {boolean | undefined} [sections] the reading a ledger takes when its entries open.
 * @property {boolean | undefined} [aligned] the reading a ledger takes when its lines are read down
 *   rather than across: every mark, label, status word and aside holds one column for the whole
 *   run, so a reader comparing a row against the one under it follows a straight edge instead of
 *   finding each row's word and aside wherever the row before it left off.
 *
 *   a screen passing it is claiming its rows agree, which is a claim no line can make about itself
 *   — one line knows nothing of the line beside it. what it costs is that a long label or a long
 *   word widens that column for every row in the run, and that a row stating its word on the mark
 *   (`wordOnMark` above) leaves the word column standing empty, which is what keeps the asides
 *   after it in line. below the floor packages/operator/src/styles/adm.css states, the run falls
 *   back to the wrapping head it is without this: four columns do not fit a phone, and a run that
 *   overflowed would be worse than one that wraps.
 */

/**
 * where a step of a line's subject stands, which is the same three states the line itself reads in
 * and is named for them: `running` is the one happening now, and `waiting` is what a line says
 * about a subject that does not exist yet.
 *
 * @typedef {'done' | 'running' | 'waiting'} StepState
 *
 * @typedef {object} StatusStepProps
 * @property {StepState} state where the step stands. it chooses the mark and the ink, and it is
 *   the whole of what a caller says about the step besides its sentence.
 * @property {ReactNode} [children] what the step is, in one sentence.
 */

/**
 * what a line's label may be drawn as. `span` is a label that outlines nothing; the rest are the
 * levels a reader can jump between, and which one a line takes is the screen's to say.
 *
 * @typedef {'span' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'} LabelLevel
 */

/**
 * the mark each tone is read by on a line.
 *
 * **the ledger has two shapes and not five: a tick for what is finished and an unfilled outline for
 * what is not.** `attention` and `running` are one shape because they are one statement — this
 * subject is not finished — and which of the two a line means is its ink and its status word, both
 * of which it already carries. a third shape between them would be a notation a reader has to learn
 * before the word beside it will tell them the same thing.
 *
 * that outline is what `STEP_MARKS` below gives `waiting`, because it is the same statement one
 * level down. ./Banner.jsx keeps the alert triangle for `attention` and is right to: a banner is
 * raised over something already true on the screen behind it.
 *
 * the tick is bare and never `circle-check`. the outline it has to be told apart from is a ring of
 * the same diameter, so a ringed tick puts both states inside one silhouette and leaves the whole
 * difference to what is drawn in the middle of a 1rem box.
 *
 * **`running` is the outline only while the line has a run of steps under it to carry the
 * movement.** a line with fewer than two takes the working step's own loader instead
 * (`STEP_MARKS` below), because there is no step drawn beneath it to say the work is going on —
 * and a still outline over nothing is a subject a reader cannot tell from a hung one. the moving
 * mark stays one per report either way: a line moves where its steps do not, and holds where they
 * do.
 *
 * @type {Record<StatusTone, MarkName>}
 */
const MARKS = {
	blocker: 'circle-alert',
	attention: 'circle-dashed',
	note: 'info',
	done: 'check',
	resolved: 'check',
	running: 'circle-dashed'
};

/**
 * the mark a step takes in each state. `done` is the tick `MARKS` above gives a finished line and
 * `waiting` is the outline it gives an unfinished one — a step not reached yet and a capability not
 * set up yet are one statement at two scales. every mark in this system is drawn at one size
 * (../../styles/base.css), so what makes a step the smaller thing is its type and its ink rather
 * than a shape of its own, which would be a second notation for a reader who has already learnt the
 * first.
 *
 * **`running` is the one mark that differs from the line's, and it is the only thing on the ledger
 * that moves.** a line reports which of its steps is under way and a step cannot, so the movement
 * is what says which one — packages/operator/src/styles/adm.css cycles the six dots of
 * `grip-vertical` around their own ring, off `.adm-dots`. the line above it holds still: two things
 * moving over one report is an animation a reader watches instead of a state they read, and the
 * line's word already says it is working.
 *
 * that is also why a line with no run of steps wears this same mark itself. the movement belongs to
 * whatever is the smallest thing the report can point at, and where no step is drawn that is the
 * line.
 *
 * @type {Record<StepState, MarkName>}
 */
const STEP_MARKS = {
	done: 'check',
	running: 'grip-vertical',
	waiting: 'circle-dashed'
};

/**
 * what the mark is called for a reader who cannot see its shape. they are the three words a ledger
 * line puts on the screen beside its own label, and they are stated here rather than taken from
 * the caller so that the two rows of one report cannot come to name one state two ways.
 *
 * @type {Record<StepState, string>}
 */
const STEP_WORDS = {
	done: 'Done',
	running: 'Working',
	waiting: 'Waiting'
};

/**
 * how many steps a run of them is, counting through a fragment.
 *
 * `Children.count` reads a mapped array and a lone element alike, and reads `<>…</>` as the one
 * element it is — so a caller who wrote its steps out by hand rather than mapping a list would be
 * told it had one, and have it folded away. a run is however the caller spelled it.
 *
 * @param {ReactNode} node
 * @returns {number}
 */
function stepsIn(node) {
	if (Children.count(node) === 1 && isValidElement(node) && node.type === Fragment)
		return stepsIn(/** @type {{ children?: ReactNode }} */ (node.props).children);
	return Children.count(node);
}

/* the imperative register, and the operator surfaces' signature.
   a fixed mark gutter, a label and a status word on one baseline, an optional consequence
   sentence, an optional attached block. a resolved line loses its sentence, its weight and its
   colour and keeps its label at full ink, so the ledger's outline does not change shape as a
   deployment is repaired.

   **a line is an `li` and belongs inside a `StatusLedger`**, which is the `ul` below that gives it
   one. mounted anywhere else it is a list item with no list, and nothing on either surface reports
   that: `.adm-status` is drawn whatever the parent is, and no gate here reads an enclosing
   element. nothing in this repository mounts one alone to prove that is still fine — every mount
   runs through a `StatusLedger`. */
/** @param {StatusLineProps} props */
export function StatusLine({
	label,
	aside,
	word,
	wordOnMark = false,
	tone = 'note',
	note,
	fixHref,
	fixLabel,
	children,
	steps,
	dim = false,
	mark,
	beneath,
	open = false,
	onToggle,
	id,
	labelAs
}) {
	/* the word is only in the description while it is on the screen: a line that moved it on to the
	   mark draws no `-word` element, and an `aria-describedby` still naming one points at nothing. */
	const describedBy = id
		? [wordOnMark ? '' : `${id}-word`, note ? `${id}-note` : ''].filter(Boolean).join(' ')
		: '';
	const Label = labelAs;
	/* how many steps the line was handed, which is what the two rules below turn on — and what lets
	   them be stated here rather than at every screen that draws a run. */
	const stepCount = stepsIn(steps);
	/* the line carrying the movement itself, which is what it does when no step is drawn under it
	   to carry it. it is off where the caller named a mark: a screen that states its own has said
	   what the line reads as, and a loader put over that would be this component overruling it. */
	const loading = tone === 'running' && !mark && stepCount < 2;
	/* the mark, settled once for both shapes the line is drawn in below. `.adm-dots` is what
	   packages/operator/src/styles/adm.css turns, and the rule reads that class rather than the
	   glyph's name — it is the class the working step wears too, so the loader is one thing wherever
	   it stands. */
	const glyph = (
		<Mark
			name={mark || (loading ? STEP_MARKS.running : MARKS[tone])}
			label={wordOnMark ? word : undefined}
			className={loading ? 'adm-dots' : ''}
		/>
	);
	/* the way on, settled once and placed by whether the line has a sentence to hang it off. */
	const fix = fixHref ? <a href={fixHref}>{fixLabel || 'Fix this'}</a> : null;
	const body = (
		<div className="adm-status__body">
			<div className="adm-status__head">
				{/* the label is the focus target and never the word: a reader landed on the word alone
				    hears what changed with nothing saying what it changed about. `-1` because nothing
				    on the line is operable — it is reached by a screen sending focus here, not by a
				    tab. */}
				<Label
					className="adm-status__label"
					id={id}
					tabIndex={id ? -1 : undefined}
					aria-describedby={describedBy || undefined}
				>
					{label}
				</Label>
				{wordOnMark ? null : (
					<span className="adm-status__word" id={id ? `${id}-word` : undefined}>
						{word}
					</span>
				)}
				{/* last on the head, and after the word wherever one is drawn: the word qualifies the
				    label and belongs against it, so anything standing between the two would put the
				    state a gap away from the subject it is the state of. */}
				{aside}
			</div>
			{note ? (
				<p className="adm-status__note" id={id ? `${id}-note` : undefined}>
					{/* the space belongs to the link and not to the note: this paragraph is what the
					    label's `aria-describedby` points at, so a separator emitted with no link
					    behind it is a trailing space inside the accessible description. */}
					{note}
					{fix ? <> {fix}</> : null}
				</p>
			) : fix ? (
				/* the link where the line has no sentence over it. it stands exactly where the sentence
				   would and is set exactly as one — packages/operator/src/styles/adm.css draws both off
				   one rule — and it is outside the label's description, which is the whole of why it is
				   a block of its own rather than an empty sentence carrying it: a description that was
				   only the link's own words tells a reader nothing the link does not already say. */
				<p className="adm-status__fix">{fix}</p>
			) : null}
			{children}
		</div>
	);
	/* a line is an item of the ledger it stands in, however it is drawn, and the item is the `li`
	   rather than the element that draws the line: `.adm-status` is a grid and a line that opens is
	   a `details`, and an element is a list item only while it is displayed as one. so the drawing
	   stays where it was and the item carries nothing.

	   a line with a whole screen's worth of detail under it opens rather than linking away, and it
	   opens in place: what is beneath is about this capability and nowhere else. the caret is the
	   only thing the summary adds — the line reads the same shut as it does open, so the ledger's
	   outline does not change shape when one entry is expanded. */
	if (beneath) {
		return (
			<li>
				<details
					className={`adm-status adm-status--${tone} adm-status--section${dim ? ' adm-status--dim' : ''}`}
					open={open}
					onToggle={(event) => onToggle?.(event.currentTarget.open)}
				>
					<summary>
						<div className="adm-status__mark">{glyph}</div>
						{body}
						<span className="adm-status__caret">
							<Mark name="chevron-right" />
						</span>
					</summary>
					<div className="adm-status__panel">{beneath}</div>
				</details>
			</li>
		);
	}
	return (
		<li>
			<div className={`adm-status adm-status--${tone}${dim ? ' adm-status--dim' : ''}`}>
				<div className="adm-status__mark">{glyph}</div>
				{body}
				{stepCount > 1 ? (
					/* the role is stated for the reason `StatusLedger` states its own: the reset takes
					   the marker off every list in the document, and webkit answers a list drawn that
					   way by not reporting it as one — so a reader is told neither how many steps the
					   line has nor where one ends. */
					<ul
						/* biome-ignore lint/a11y/noRedundantRoles: not redundant here, for the reason
						   above. */
						role="list"
						className="adm-status__steps"
					>
						{steps}
					</ul>
				) : null}
			</div>
		</li>
	);
}

/* one step of the line above it: a mark and a sentence, and no status word.

   a line carries a word because it carries a label for that word to qualify; a step is a sentence
   and the mark is what qualifies it, so a run of words down the list would compete with the one
   word the line above them states. what a reader who cannot see the mark's shape gets instead is
   the mark's own name, which is that same word.

   the step is an item of the list `StatusLine` draws around whatever it is handed, and it is
   nothing on its own: mounted outside one it is a list item with no list, exactly as a line
   mounted outside a ledger is. packages/operator/src/styles/adm.css draws it in the line's own
   two tracks, which is what puts its mark in the line's mark gutter and its sentence on the
   label's edge. */
/** @param {StatusStepProps} props */
export function StatusStep({ state, children }) {
	return (
		<li className={`adm-status__step adm-status__step--${state}`}>
			<span className="adm-status__step-mark">
				<Mark
					name={STEP_MARKS[state]}
					label={STEP_WORDS[state]}
					className={state === 'running' ? 'adm-dots' : ''}
				/>
			</span>
			<span className="adm-status__step-note">{children}</span>
		</li>
	);
}

/* the run of lines. `sections` is the reading a screen takes when its entries open — each one is a
   box standing on the page, rather than a line standing in the space around it. `aligned` is the
   other reading a run takes, and both are the ledger's because both are about the lines together. */
/** @param {StatusLedgerProps} props */
export function StatusLedger({ children, sections = false, aligned = false }) {
	return (
		/* the role is stated because the marker is not drawn: packages/operator/src/styles/base.css
		   takes `list-style` off every list in the document, and webkit answers a list drawn that way
		   by dropping it from what it reports — so a reader is told neither how many capabilities
		   are being reported nor where one line ends. it belongs here rather than at each screen:
		   how a run of lines is read is this part's own. */
		<ul
			/* biome-ignore lint/a11y/noRedundantRoles: not redundant here, for the reason above — the
			   list is drawn with no marker, and webkit answers that by not reporting it as a list at
			   all. removing the attribute re-opens the defect the role was added to fix. */
			role="list"
			className={[
				'adm-ledger',
				sections ? 'adm-ledger--sections' : '',
				aligned ? 'adm-ledger--aligned' : ''
			]
				.filter(Boolean)
				.join(' ')}
		>
			{children}
		</ul>
	);
}
