import { useState } from 'react';
import { Button } from '../controls/Button.jsx';
import { CopyControl } from '../controls/CopyControl.jsx';
import { Mark } from '../status/Mark.jsx';
import { FieldMessage } from './FieldMessage.jsx';

/**
 * @import { HTMLInputTypeAttribute, InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 */

/**
 * `id` carries no default: every describing block on the field is named from it, so a field
 * without one hands the browser a description nothing points at.
 *
 * @typedef {object} FieldOwnProps
 * @property {string} id
 * @property {ReactNode} [label] absent where the box is named some other way — a row in a repeating
 *   editor carries an `aria-label` and the group's legend is the name on the screen. no label is
 *   rendered then, because an empty one is a labelling relationship the browser reads as no name.
 * @property {boolean | undefined} [optional]
 * @property {ReactNode} [hint]
 * @property {ReactNode} [error]
 * @property {ReactNode} [needed] what marks the field as wanted by something elsewhere on the page.
 * @property {ReactNode} [status] a fact found out about the value after it was typed — a lookup's
 *   answer — said in a polite live region under the box. the region is drawn whenever this is not
 *   `undefined`, and `''` draws it empty: a caller that will speak later hands `''` from the first
 *   render, because a region arriving with its words is an insertion a reader may never be told
 *   about. it is not a refusal and marks nothing on the box. it takes the row `needed` takes, so a
 *   field states one or the other.
 * @property {string | undefined} [statusSaid] words the same region says to a reader alone, ahead of
 *   `status` — what changed elsewhere on the screen because of the value, which the screen shows by
 *   the change itself. drawn only inside a region `status` has put up.
 * @property {ReactNode} [labelAside] what stands at the trailing end of the label's own row: a small
 *   press that writes the whole box, and the words saying where the value in it came from. the
 *   label and it are one row, `.adm-field__head`, as tall as the small control, so the press stands
 *   level with the name of the box it acts on and leaves the box its whole width in a narrow sheet.
 * @property {ReactNode} [beside] a control that acts on what is in the box, put on the box's own
 *   row rather than under it — one destination and one send, instead of a press below a column of
 *   boxes. the row is `.adm-actions`, which is what makes the box take the line's remainder and the
 *   pair wrap at the 375px floor rather than shrink. the box's messages stand in its own column on
 *   that row, so a press wrapped under the box never comes between the box and its refusal.
 * @property {boolean | undefined} [masked] the box holds its value as dots until a press inside it
 *   swaps it to the value, and back. it is for a box seeded with a credential the deployment is
 *   already holding: a stored password standing legible on the screen is one anybody beside the
 *   operator or watching the call can read, and the operator still has to be able to check it
 *   character for character, so the value is one press away rather than withheld.
 *
 *   the press stands at the end of the box rather than on the row {@link beside} uses, so a masked
 *   box is the width of every plain box in the same fold. the state is this field's own and starts
 *   hidden at every mount.
 *
 *   an input's alone: a textarea takes no type, so a masked one holds nothing back and draws no
 *   press at all.
 * @property {boolean | undefined} [copyable] a copy control inside the box, beside the masked
 *   box's press, taking the value the box was handed (`value`, else `defaultValue`). it is for a
 *   read-only box holding a credential somebody pastes elsewhere: copied from the box, the value
 *   need never be shown to be taken. it stands in the same place the masked press does and for the
 *   same reason, and the two share one trailing cluster. an input's alone, as `masked` is.
 * @property {FieldLead | undefined} [lead] a mark inside the box at its start, saying what the value
 *   is read as — a network's mark in front of an address on it. the box reserves the slot whenever
 *   this is stated, a `null` mark included, so text typed into the box never moves as the mark
 *   arrives, changes or goes. an input's alone, as `masked` is.
 * @property {string | undefined} [copyLabel] the copy control's accessible name, where a bare Copy
 *   would not say what of.
 * @property {Ref<HTMLButtonElement> | undefined} [copyRef] the copy control's button, for a caller
 *   moving focus onto it once the value it copies has arrived.
 * @property {boolean | undefined} [code]
 * @property {string | undefined} [placeholder]
 * @property {HTMLInputTypeAttribute | undefined} [type]
 * @property {'input' | 'textarea' | undefined} [as]
 * @property {PointerState | undefined} [state] the state pinned by class rather than reached,
 *   which is what a specimen wants and no screen does. unavailable is not one of them:
 *   packages/operator/src/styles/adm.css draws `.adm-input:disabled` with no twin beside it, so
 *   a box that cannot be used takes the platform's own `disabled` through the rest.
 */

/**
 * the mark is drawn out of the tree and `said` is what it says, in words the box is described by:
 * drawn inside the hidden mark and named `${id}-lead`. a description reads hidden words it names
 * directly (https://www.w3.org/TR/accname-1.2/, step 2A), so a reader meets them once, on the box,
 * and browse mode does not read them out a second time as loose text. a mark that says nothing a
 * reader needs — a glyph standing for no reading at all — states no words.
 *
 * @typedef {object} FieldLead
 * @property {ReactNode} mark
 * @property {string | undefined} [said]
 */

/**
 * the masked box's press is named for the value with both of its names or with neither, and a
 * caller cannot hand one: a press named `Show signing secret` and then `Hide the value` is named
 * for one value and renamed for another.
 *
 * @typedef {object} MaskNamesUnstated `Show the value` and `Hide the value`.
 * @property {undefined} [revealLabel]
 * @property {undefined} [hideLabel]
 *
 * @typedef {object} MaskNamesStated
 * @property {string} revealLabel the press's accessible name while the value is hidden, where a
 *   bare `Show the value` would not say which value — a screen holding a second credential beside
 *   this one names it: `Show signing secret`.
 * @property {string} hideLabel its name while the value is showing, which is the same noun turned
 *   round: `Hide signing secret`.
 */

/**
 * the rest reaches whichever box `as` names.
 *
 * four of a caller's own arrive as the platform's attributes rather than as props of this field's,
 * and each is taken in rather than replaced: `className` is added to the class list this field
 * composes, `aria-invalid` marks the box refused alongside whatever message it holds, and the
 * starting value is `defaultValue` — or `value` with a handler beside it, which this field has no
 * opinion about either way.
 *
 * the fourth, `aria-describedby`, names blocks the caller draws — a group's hint, a pair's
 * refusal — and they join the ones this field names rather than standing in for them: the lead's
 * words, then the field's own hint, refusal, needed note and status in the order they are drawn,
 * then the caller's as stated. an id named twice keeps its first place, and `undefined` states
 * nothing, so the field's own still describe the box. a caller names only the blocks it draws
 * itself.
 *
 * @typedef {FieldOwnProps
 *   & (MaskNamesUnstated | MaskNamesStated)
 *   & Omit<InputHTMLAttributes<HTMLInputElement>, keyof FieldOwnProps>
 *   & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, keyof FieldOwnProps>} FieldProps
 */

/* label above the box, always. optional markers appear only on boxes that may legitimately be
   blank. four states, and the fourth is the one a design tool will not infer:
   "needed" — something elsewhere on the page has marked this field as required for a thing to
   work, without the field itself being in error. the operator has not done anything wrong yet. */
/** @param {FieldProps} props */
export function Field({
	id,
	label,
	optional,
	hint,
	error,
	needed,
	status,
	statusSaid,
	labelAside,
	beside,
	masked,
	lead,
	revealLabel = 'Show the value',
	hideLabel = 'Hide the value',
	copyable,
	copyLabel,
	copyRef,
	code,
	placeholder,
	type = 'text',
	as = 'input',
	state,
	className,
	'aria-invalid': stated,
	'aria-describedby': describedByStated,
	...rest
}) {
	const Tag = as === 'textarea' ? 'textarea' : 'input';
	/* what the box is holding, and it starts hidden at every mount: a press is what puts a stored
	   credential on the screen, so a box that came back revealed because something above it drew
	   again is one nobody asked to see. */
	const [shown, setShown] = useState(false);
	const hidden = masked && !shown;
	/* the press that swaps the two. it stands inside the box rather than on the row `beside` uses —
	   `.adm-maskwrap` in packages/operator/src/styles/adm.css, which argues why.
	   what it says is what the press does and it changes with what the press did; the mark carries
	   no name of its own (../status/Mark.jsx draws an unlabelled one out of the tree), so the button
	   is what a reader is told, and `aria-controls` is what says which box it is about.
	   it closes with the box: a live press inside a box shut for a write in flight reads as a
	   control that missed the state its own field is in. it closes as the copy control beside it
	   does, with `aria-disabled` and the press turned away here, so the two in one cluster draw one
	   closed look and neither drops the focus standing on it — ../controls/CopyControl.jsx's
	   `disabled` argues the spelling.

	   and it is drawn for an input alone. a textarea takes no `type`, so there is nothing to swap:
	   the press would stand in a box already legible, promising a change it cannot make. */
	const reveal =
		masked && as !== 'textarea' ? (
			<Button
				type="button"
				variant="quiet"
				size="sm"
				mark={hidden ? 'eye' : 'eye-off'}
				aria-controls={id}
				aria-label={hidden ? revealLabel : hideLabel}
				aria-disabled={rest.disabled || undefined}
				onClick={() => {
					if (!rest.disabled) setShown((was) => !was);
				}}
			/>
		) : null;
	/* the copy control, whole: its live region stands beside its button and is out of the flow
	   (`.adm-vh`), so the cluster below lays out the button alone. a refused copy shows a masked
	   value, because dots are nothing a reader can select by hand. */
	const copy =
		copyable && as !== 'textarea' ? (
			<CopyControl
				text={String(rest.value ?? rest.defaultValue ?? '')}
				{...(copyLabel ? { label: copyLabel } : {})}
				disabled={rest.disabled}
				onBlocked={() => setShown(true)}
				ref={copyRef}
			/>
		) : null;
	/* the box with its own presses inside it: `.adm-maskwrap` in packages/operator/src/styles/adm.css
	   is what places them and reserves the room. one press stands in the wrapper on its own; two
	   stand in `.adm-maskwrap__presses`, the copy first so the reveal keeps the trailing end it has
	   on every other masked box. a box with no press draws no wrapper. */
	const withPresses = (/** @type {ReactNode} */ box) =>
		reveal === null && copy === null ? (
			box
		) : (
			<div className="adm-maskwrap">
				{box}
				{copy === null ? (
					reveal
				) : (
					<div className="adm-maskwrap__presses">
						{copy}
						{reveal}
					</div>
				)}
			</div>
		);
	/* the leading mark stands in a wrapper of its own around everything above, which reserves its
	   slot inside the box (`.adm-leadwrap` in packages/operator/src/styles/adm.css). */
	const leading = lead === undefined || as === 'textarea' ? undefined : lead;
	const leadSaid = leading?.said ? `${id}-lead` : null;
	const inBox = (/** @type {ReactNode} */ box) =>
		leading === undefined ? (
			withPresses(box)
		) : (
			<div className="adm-leadwrap">
				<span className="adm-leadwrap__lead" aria-hidden="true">
					{leading.mark}
					{leadSaid ? (
						<span hidden id={leadSaid}>
							{leading.said}
						</span>
					) : null}
				</span>
				{withPresses(box)}
			</div>
		);
	/* the box, alone on its row or sharing it. what shares it is wrapped rather than placed beside
	   the box, because the row a pair needs is `.adm-actions`: packages/operator/src/styles/adm.css
	   puts that row in the box's own grid row. a field with nothing beside its box draws no row — a
	   flex line around one element answers nothing — and its messages take the field's own rows.

	   on a shared row the box and its messages are one column, `.adm-field__boxcol`, and the press
	   is the item after it. the row wraps at the floor, and a message placed after the whole row
	   would land under the press once it wrapped, reading as the press's rather than the box's. the
	   column is drawn whether or not a message is up: a box that changed parent when its refusal
	   arrived would be remounted, value and focus gone, on the very press that moved focus to it.

	   a masked box stands on that row as its wrapper, as a select does: what is on the row is what
	   the box is inside of. */
	const withBox = (/** @type {ReactNode} */ box, /** @type {ReactNode} */ messages) =>
		beside ? (
			<div className="adm-actions">
				<div className="adm-field__boxcol">
					{box}
					{messages}
				</div>
				{beside}
			</div>
		) : (
			<>
				{box}
				{messages}
			</>
		);
	// refused by the message this field holds, or by a rule that belongs to something larger than
	// one box: a fieldset draws a pair's message once and marks both boxes from out here, since
	// either box fixes the pair and neither one is the wrong one.
	const refused = error ? true : stated === true || stated === 'true';
	// the lead's words first, as the mark they stand for is the first thing in the box.
	const describedBy =
		[
			...new Set(
				[
					leadSaid,
					hint ? `${id}-hint` : null,
					error ? `${id}-err` : null,
					needed ? `${id}-need` : null,
					status ? `${id}-status` : null,
					...(describedByStated?.split(/\s+/) ?? [])
				].filter(Boolean)
			)
		].join(' ') || undefined;
	const cls = [
		as === 'textarea' ? 'adm-textarea' : 'adm-input',
		refused ? (as === 'textarea' ? 'adm-textarea--invalid' : 'adm-input--invalid') : '',
		!refused && needed ? 'adm-input--needed' : '',
		code ? 'adm-input--code' : '',
		state ? `is-${state}` : '',
		className
	]
		.filter(Boolean)
		.join(' ');
	const named = label ? (
		<label className="adm-field__label" htmlFor={id}>
			{label}
			{optional ? <span className="adm-field__optional"> (optional)</span> : null}
		</label>
	) : null;
	return (
		<div className="adm-field">
			{labelAside ? (
				<div className="adm-field__head">
					{named}
					<div className="adm-field__aside">{labelAside}</div>
				</div>
			) : (
				named
			)}
			{hint ? (
				<p className="adm-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			{withBox(
				inBox(
					<Tag
						id={id}
						className={cls}
						type={as === 'textarea' ? undefined : hidden ? 'password' : type}
						placeholder={placeholder}
						aria-invalid={refused ? 'true' : undefined}
						aria-describedby={describedBy}
						{...rest}
					/>
				),
				<>
					{/* both rows are ./FieldMessage.jsx's, and the sentence is wrapped there: which of the
					    two announces itself, and why a message is never handed to the row unwrapped, are
					    argued in that file. */}
					{error ? <FieldMessage id={`${id}-err`}>{error}</FieldMessage> : null}
					{/* drawn beside a message rather than instead of one. the two are reachable together —
					    a test send marks a blank box as wanted, and a save refused afterwards leaves the
					    field holding both — and the one that would disappear is the one saying what the
					    box is for. */}
					{needed ? (
						<FieldMessage tone="needed" id={`${id}-need`}>
							{needed}
						</FieldMessage>
					) : null}
					{/* the standing row's look on an element that is a region rather than a message: the
					    mark and the words only while there are words to see, so a region holding nothing
					    on the screen holds no room (`.adm-field > .adm-field__needed` in
					    packages/operator/src/styles/adm.css). */}
					{status === undefined ? null : (
						<p className="adm-field__needed" id={`${id}-status`} role="status">
							{statusSaid ? <span className="adm-vh">{statusSaid}</span> : null}
							{status ? (
								<>
									<Mark name="triangle-alert" />
									<span>{status}</span>
								</>
							) : null}
						</p>
					)}
				</>
			)}
		</div>
	);
}
