import { Mark } from './Mark.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { MarkName } from './Mark.jsx'
 * @import { Tone } from '../closed-sets.js'
 *
 * @typedef {object} BannerProps
 * @property {Tone | undefined} [tone]
 * @property {ReactNode} [word]
 * @property {ReactNode} [children]
 * @property {ReactNode} [actions] the controls, which sit beneath the banner rather than inside it.
 */

/** @type {Record<Tone, MarkName>} */
const MARKS = {
	blocker: 'circle-alert',
	attention: 'triangle-alert',
	note: 'info',
	done: 'circle-check'
};

/* four tones, and one of them has no hue: a note is a fact, and a fact is not coloured.
   note takes no modifier class — the bare `.adm-banner` is already the note tone in
   packages/operator/src/styles/adm.css, the way the bare `.adm-btn` is the secondary rank.

   the aria role follows the tone and is not a prop. three of the four are `role="status"` and a
   blocker is `role="alert"`, and those are not interchangeable — alert interrupts a screen reader
   mid-sentence, status waits its turn. a pairing hand-written at each call site is one mismatched
   pair away from a state that announces itself as information, and an operator screen draws eleven
   of them. */
/** @param {BannerProps} props */
export function Banner({ tone = 'note', word, children, actions }) {
	return (
		<div
			className={`adm-banner${tone === 'note' ? '' : ` adm-banner--${tone}`}`}
			role={tone === 'blocker' ? 'alert' : 'status'}
		>
			<div className="adm-banner__mark">
				<Mark name={MARKS[tone]} size="lg" />
			</div>
			<div>
				{/* every row is guarded, the way the actions row is. a banner is drawn from copy a screen
				    computes, and computed copy comes back blank — an unguarded row is then a line of
				    nothing at a sentence's height, and a band holding two of them says nothing at all. */}
				{word ? <p className="adm-banner__word">{word}</p> : null}
				{children ? <p className="adm-banner__text">{children}</p> : null}
				{actions ? <div className="adm-dialog__actions">{actions}</div> : null}
			</div>
		</div>
	);
}
