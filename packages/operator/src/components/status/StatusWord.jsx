import { Mark } from './Mark.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { MarkName } from './Mark.jsx'
 * @import { Tone } from '../closed-sets.js'
 *
 * @typedef {'descriptive' | 'momentary'} StatusRegister
 *
 * @typedef {object} StatusWordBase
 * @property {ReactNode} [children]
 * @property {StatusRegister | undefined} [register]
 * @property {boolean | undefined} [unset] no value at all, which says something different from `secondary`.
 * @property {boolean | undefined} [secondary]
 * @property {Tone | undefined} [tone] where a record stands on its own lifecycle ladder: `done`
 *   settled or running, `attention` waiting on somebody, `blocker` failed or refused, `note`
 *   retired, stopped or ended. absent on every word that is not one of those statuses — a consent
 *   reading and a count are facts about a record rather than where it stands — and absent wherever
 *   `secondary` is passed, since a tone already says the quiet one is quiet.
 * @property {MarkName | undefined} [mark]
 *
 * @typedef {object} StatusWordBlocked
 * @property {boolean | undefined} [blocked] a momentary word reporting that the thing could not be done.
 * @property {undefined} [neutral]
 *
 * @typedef {object} StatusWordNeutral
 * @property {boolean | undefined} [neutral] a momentary word reporting that the press changed nothing: neither done nor refused.
 * @property {undefined} [blocked]
 *
 * @typedef {StatusWordBase & (StatusWordBlocked | StatusWordNeutral)} StatusWordProps
 */

/* three registers, and the register is carried by position and accompaniment, never by hue alone.
   descriptive — a fact, drawn as a pill in a value slot with no mark and no sentence. hueless
                 until it is handed a `tone`, which only a record's own lifecycle status gets.
   momentary   — this just happened, on this control. accent, with a mark, transient; attention
                 when `blocked`, and ink with the info mark when `neutral`. */
/** @param {StatusWordProps} props */
export function StatusWord({
	children,
	register = 'descriptive',
	unset = false,
	secondary = false,
	tone,
	mark,
	blocked = false,
	neutral = false
}) {
	if (register === 'momentary') {
		return (
			<span
				className={
					blocked
						? 'adm-momentary adm-momentary--blocked'
						: neutral
							? 'adm-momentary adm-momentary--neutral'
							: 'adm-momentary'
				}
			>
				<Mark name={mark || (neutral ? 'info' : 'check')} />
				{/* one flex item: a message mixing text and elements would otherwise split into columns. */}
				<span>{children}</span>
			</span>
		);
	}
	/* `secondary` is a fact nobody needs to act on, and it says something different from `unset`:
	   there is a value here and it is quiet, rather than no value at all. */
	const cls = [
		'adm-state',
		unset ? 'adm-state--unset' : '',
		secondary ? 'adm-state--secondary' : '',
		tone ? `adm-state--${tone}` : ''
	]
		.filter(Boolean)
		.join(' ');
	return <span className={cls}>{children}</span>;
}
