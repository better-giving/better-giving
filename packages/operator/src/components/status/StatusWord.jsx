import { Mark } from './Mark.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { MarkName } from './Mark.jsx'
 *
 * @typedef {'descriptive' | 'momentary'} StatusRegister
 *
 * @typedef {object} StatusWordBase
 * @property {ReactNode} [children]
 * @property {StatusRegister | undefined} [register]
 * @property {boolean | undefined} [unset] no value at all, which says something different from `secondary`.
 * @property {boolean | undefined} [secondary]
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

/* three registers, and the register is carried by position and accompaniment, not by hue.
   descriptive — a fact. an ink word with a flat neutral underscore, no mark, no colour,
                 uniform across every value so nothing ranks.
   momentary   — this just happened, on this control. accent, with a mark, transient; attention
                 when `blocked`, and ink with the info mark when `neutral`. */
/** @param {StatusWordProps} props */
export function StatusWord({
	children,
	register = 'descriptive',
	unset = false,
	secondary = false,
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
		secondary ? 'adm-state--secondary' : ''
	]
		.filter(Boolean)
		.join(' ');
	return <span className={cls}>{children}</span>;
}
