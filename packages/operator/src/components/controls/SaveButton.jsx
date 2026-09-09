import { useEffect, useState } from 'react';
import { Mark } from '../status/Mark.jsx';
import { BusyDots } from './Button.jsx';

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
 *
 * two of a caller's own arrive as the platform's attributes rather than as props of this button's,
 * and each is taken in rather than replaced: `className` is added to the class list this button
 * composes, and `disabled` closes the press alongside whatever the state already says about it — a
 * fold closing every control on it while a run is going must not re-open the press on a group that
 * has nothing to save.
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
	className,
	disabled,
	...rest
}) {
	const busy = state === 'pending';

	// whether the region below is holding the confirmation. a flag rather than the words, because
	// the words are `doneLabel` and a caller spells that however its group needs.
	const [saying, setSaying] = useState(false);

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
			<button
				// the class list is composed here rather than in a name above, so that every one of these
				// stands inside a `className={…}` — which is where
				// packages/app/src/lib/admin/styles/conformance.spec.ts reads what markup carries, and a
				// name it cannot see there reads as a dead rule in the sheet. ../data/DataTable.jsx
				// composes its cells' classes at the cell for the same reason.
				//
				// resting wears no name of its own: `.adm-save.is-idle` matches no rule in
				// ../../styles/adm.css, and what a resting save button looks like is what
				// `.adm-btn--primary` already draws. a class nothing draws paints nothing, errors
				// nowhere, and still reads as a state the sheet handles.
				//
				// the other two are drawn by the ladder rather than by a `.adm-save` rule: pending is
				// `.adm-save.is-pending` for the pressed ground it holds over the primary rank's
				// closed one, and closed is `.adm-btn.is-disabled` and
				// `.adm-btn--primary.is-disabled` in that same sheet. what a press in flight draws
				// over its own label is neither of those and wears no name of this button's: it
				// hangs off `aria-busy` below, through `.adm-btn[aria-busy='true']`.
				className={[
					'adm-btn',
					'adm-btn--primary',
					'adm-save',
					state === 'idle' ? '' : `is-${state}`,
					className
				]
					.filter(Boolean)
					.join(' ')}
				type="submit"
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
				disabled={state === 'disabled' || state === 'done' || busy || disabled || undefined}
				aria-busy={busy || undefined}
				{...rest}
			>
				{/* the resting label stands in this span in every state, and under a press it is what
				    the dots stand over: swapped for a word of its own, a button reporting a write
				    would resize the row of actions it is in at the moment it is closed to a press.
				    `.adm-btn__label` and the dots are ./Button.jsx's and drawn once, so this button
				    and the shared one report a press the same way. */}
				<span className="adm-btn__label">
					{state === 'done' ? (
						<span className="adm-save__done">
							<Mark name="check" />
							{doneLabel}
						</span>
					) : (
						label
					)}
				</span>
				{/* the dots say a write is going and never how far it has got: this button carries one
				    write, which is a moment with no named steps to be part of the way through. a press
				    that starts a run of them reports at the card it stands in instead, which is
				    packages/console-ui/src/lib/run-bar.tsx. */}
				{busy ? <BusyDots /> : null}
			</button>
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
				{saying ? <>{doneLabel}. Nothing else on this page changed.</> : null}
			</span>
		</>
	);
}
