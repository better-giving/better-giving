import { useEffect, useState } from 'react';
import { Mark } from '../status/Mark.jsx';
import { Button } from './Button.jsx';

/**
 * @import { ComponentProps, ReactNode } from 'react'
 */

/**
 * @typedef {'idle' | 'pending' | 'done' | 'disabled'} SaveButtonState
 *
 * @typedef {object} SaveButtonOwnProps
 * @property {SaveButtonState | undefined} [state]
 * @property {ReactNode} [label]
 * @property {ReactNode} [doneLabel]
 * @property {string | undefined} [elsewhere] the sentence said after the confirmation about the
 *   rest of the page. the default is true of a save that changes nothing but its own group; a save
 *   that shuts its step and opens the next says so here, or the reader is told something false in
 *   exactly the case they cannot see. `''` claims nothing either way, for a save whose effect on the
 *   rest of the page its caller cannot say. it is taken as the confirmation begins and kept while
 *   it stands.
 *
 * three of a caller's own arrive as the platform's attributes rather than as props of this
 * button's, and each is taken in rather than replaced: `className` is added to the class list this
 * button composes, `disabled` closes the press alongside whatever the state already says about it —
 * a fold closing every control on it while a run is going must not re-open the press on a group
 * that has nothing to save — and `onClick` is called only for a press the button lets through.
 *
 * @typedef {SaveButtonOwnProps & ComponentProps<'button'>} SaveButtonProps
 */

/* four states. the outcome reports at the control that carried the write, in place, with scroll
   preserved — not a toast, not a banner at the top of the page. four of these sit in one column
   on the settings screen, so "done" is a quiet swap and never an alarm.
   a group holding nothing to save is "disabled" and has no second spelling: what the button
   reports is the group's own state, answerable and answered wherever the markup was rendered
   (packages/operator/src/save-state.ts). */
/** @param {SaveButtonProps} props */
export function SaveButton({
	state = 'idle',
	label = 'Save',
	doneLabel = 'Saved',
	elsewhere = 'Nothing else on this page changed.',
	className,
	disabled,
	onClick,
	...rest
}) {
	const busy = state === 'pending';
	const closed = state === 'disabled' || state === 'done' || busy || Boolean(disabled);

	// whether the region below is holding the confirmation, which it takes a task after the state
	// turns (the effect below).
	const [saying, setSaying] = useState(false);

	// what the region says, taken on the render the confirmation begins and kept while it stands: a
	// region rewritten under a standing confirmation is announced again, and a caller whose page is
	// still settling would have the first announcement contradicted by the second.
	const [said, setSaid] = useState(
		/** @type {{ state: SaveButtonState, words: { doneLabel: ReactNode, elsewhere: string } | null }} */ ({
			state,
			words: state === 'done' ? { doneLabel, elsewhere } : null
		})
	);
	if (said.state !== state)
		setSaid({ state, words: state === 'done' ? { doneLabel, elsewhere } : null });

	// the region is emptied on the run the state changes and written a task later, never written
	// straight over. a group saved twice reports the same words both times, and a region handed
	// what it is already holding is not a change and is announced by nobody — so the second save
	// would be answered with silence. ./CopyControl.jsx clears and writes the same way, and
	// `#announce` in packages/form/src/element.ts is the third.
	//
	// a state that is not `done` leaves the region empty and schedules nothing: a clear says
	// nothing, so the confirmation going at packages/operator/src/save-state.ts's four seconds is
	// announced to nobody, and the next save has an empty region to write into.
	useEffect(() => {
		setSaying(false);
		if (state !== 'done') return;
		const say = setTimeout(() => setSaying(true), 0);
		return () => clearTimeout(say);
	}, [state]);

	return (
		<>
			<Button
				variant="primary"
				type="submit"
				// before the three this button answers for itself, so a caller's own spelling of any of
				// them cannot re-open a press the state has closed.
				{...rest}
				// the caller's class is added to ./Button.jsx's, never put in place of it. the states
				// draw no class of their own: pending, done and disabled are each the closed press the
				// registry draws for `aria-busy` and for `aria-disabled` on a `<button>`
				// (../../registry/styles/button-css.css), in its one closed pair.
				className={className}
				// the press is closed while its own write is in flight as well as for the two conditions
				// beside it: a press left open under `aria-busy` is one operator intent and two writes,
				// because the second press starts a second navigation while the first is still going. it
				// drops no submission of its own — a caller computes `state` from the router's navigation
				// state, so it turns pending only after the submission has begun.
				//
				// a button reporting a save is closed for a reason of its own: a confirmation is drawn
				// only over a group holding nothing left to save, so `done` and `disabled` are true
				// together and the rung that picks the tick over the closed word decides the label alone
				// (packages/operator/src/save-state.ts). a press on it posts a form with no change in it
				// and answers the operator with a second tick over the same values.
				//
				// closed by `aria-disabled` and a press turned away here, never by `disabled`: a natively
				// closed control cannot hold focus, so the caret would drop to the document on the press
				// and the tick would land on a button nobody is standing on. cancelling the click cancels
				// the submission it would make, Enter in a box of the form included — implicit
				// submission is a click on this button.
				aria-disabled={closed || undefined}
				aria-busy={busy || undefined}
				onClick={(event) => {
					if (closed) {
						event.preventDefault();
						return;
					}
					onClick?.(event);
				}}
			>
				{/* the resting label stands in every state but done, under a press too: swapped for a
				    word of its own, a button reporting a write would resize the row of actions it is in
				    at the moment it is closed to a press. */}
				{state === 'done' ? (
					<span className="adm-save__done">
						<Mark name="check" />
						{doneLabel}
					</span>
				) : (
					label
				)}
			</Button>
			{/* the live region stands beside the press and is never the press itself, nor anything
			    inside it: a region reports every change to its own contents, so a button that was one
			    would report the tick arriving over the label and the label coming back — two
			    announcements for a press that made one write. it is also outside whatever carries
			    `aria-busy`, which a reader is told to hold: a region under one is silenced for
			    exactly the wait it exists to narrate.

			    it stays mounted through all four states, because a region that arrives carrying its
			    own text is one insertion rather than a change and is announced by nobody.

			    `.adm-vh` from ../../styles/base.css: out of the flow, so it is not an item in the
			    row of actions the button is standing in. */}
			<span className="adm-vh" aria-live="polite">
				{saying && said.words !== null ? (
					<>
						{said.words.doneLabel}.{said.words.elsewhere === '' ? null : ` ${said.words.elsewhere}`}
					</>
				) : null}
			</span>
		</>
	);
}
