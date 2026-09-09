import { useEffect, useRef, useState } from 'react';
import { Mark } from '../status/Mark.jsx';

/**
 * @typedef {object} CopyControlProps
 * @property {string} text the literal put on the clipboard, copied verbatim.
 * @property {string | undefined} [label] the accessible name at rest, for a call site where a bare
 *   Copy would not say what of. never drawn: at rest the control is the mark, and this is the whole
 *   of what says which one it is to anyone not reading the line it sits on.
 */

/** how long the control holds its outcome before it is offerable again. */
const SETTLE_MS = 2000;

/* text a person would otherwise retype, put on the clipboard, in the one place every operator
   surface draws one.

   at rest it is a copy mark and no words, and a copy that lands swaps it for a tick. that is the
   one place these screens allow a glyph to stand in for a word, and the boundary is this: only
   where the word would repeat text already printed on the same line, and only where the control's
   accessible name still carries the full word.

   the control stays the control through all three states and never gives way to a span: focus is
   on it at the instant a reader wants to hear what happened, and an element that has gone takes
   the report with it.

   the settle timer and the live region are here rather than at each caller, because two copies of
   either is how two surfaces come to report a press differently. */
/** @param {CopyControlProps} props */
export function CopyControl({ text, label = 'Copy' }) {
	// idle, and the two things that can come back from an attempt. `blocked` is the one worth
	// drawing: `writeText` rejects on a refused permission and throws outright on an insecure
	// origin, and a control that answers either by doing nothing visible is worse than no control at
	// all — an operator presses it, pastes the last thing they copied, and runs that instead.
	const [outcome, setOutcome] = useState(/** @type {'idle' | 'copied' | 'blocked'} */ ('idle'));

	// what the live region holds, which is the outcome while there is one and nothing at rest. the
	// resting name is deliberately never in here: putting it back is a settling timer rather than
	// anything the operator did, and a region holding it would report the control to them again two
	// seconds after they pressed it.
	const [announced, setAnnounced] = useState('');

	const restore = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));
	const unsay = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));

	useEffect(
		() => () => {
			clearTimeout(restore.current);
			clearTimeout(unsay.current);
		},
		[]
	);

	// the name at every moment, and the drawn word at the one state where there is one. `blocked`
	// says the clipboard refused rather than what to do about it, because what to do about it is
	// already on the screen: the text it would have copied is a line away, selectable.
	const spoken = outcome === 'copied' ? 'Copied' : outcome === 'blocked' ? 'Copy blocked' : label;

	async function copy() {
		/** @type {'copied' | 'blocked'} */
		let landed;
		try {
			await navigator.clipboard.writeText(text);
			landed = 'copied';
		} catch {
			landed = 'blocked';
		}
		setOutcome(landed);

		// the region is cleared and written a task apart, never written straight over. a second press
		// inside the settle window puts back the word already in the region, and a region handed what
		// it is holding is not a change and is announced by nobody — so a press that worked would be
		// answered with silence.
		setAnnounced('');
		clearTimeout(unsay.current);
		const words = landed === 'copied' ? 'Copied' : 'Copy blocked';
		unsay.current = setTimeout(() => setAnnounced(words), 0);

		// both outcomes revert, so the control is offerable again either way, and the region empties
		// with them: a clear says nothing, so nothing is announced for it.
		clearTimeout(restore.current);
		restore.current = setTimeout(() => {
			setOutcome('idle');
			setAnnounced('');
		}, SETTLE_MS);
	}

	return (
		<>
			{/* the quiet button at the small height, which is the composition
			    packages/operator/src/styles/adm.css draws a copy control as: it stands in a slab's
			    label row, which has no room for a control with a box on it at rest.

			    `aria-label` names the button in all three states, and in `blocked` it is the same
			    word the button draws — a name that did not contain the visible one would leave a
			    voice user with nothing to say (WCAG 2.5.3). */}
			<button
				type="button"
				onClick={copy}
				aria-label={spoken}
				className="adm-btn adm-btn--quiet adm-btn--sm"
			>
				{outcome === 'copied' ? <Mark name="check" /> : null}
				{outcome === 'blocked' ? spoken : null}
				{outcome === 'idle' ? <Mark name="copy" /> : null}
			</button>
			{/* the live region stands beside the button and is never the button itself: a region
			    reports every change to its own contents, so a button that was one would report the
			    tick on the press and then report the resting mark again when it settles.

			    `.adm-vh` from packages/operator/src/styles/base.css: out of the flow, so it is not an
			    item in the row the button is standing in. */}
			<span className="adm-vh" aria-live="polite">
				{announced}
			</span>
		</>
	);
}
