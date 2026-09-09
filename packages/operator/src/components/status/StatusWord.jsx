import { Mark } from './Mark.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { MarkName } from './Mark.jsx'
 *
 * @typedef {'descriptive' | 'momentary'} StatusRegister
 *
 * @typedef {object} StatusWordProps
 * @property {ReactNode} [children]
 * @property {StatusRegister | undefined} [register]
 * @property {boolean | undefined} [unset] no value at all, which says something different from `secondary`.
 * @property {boolean | undefined} [secondary]
 * @property {MarkName | undefined} [mark]
 * @property {boolean | undefined} [blocked] a momentary word reporting that the thing could not be done.
 */

/* three registers, and the register is carried by position and accompaniment, not by hue.
   descriptive — a fact. an ink word with a flat neutral underscore, no mark, no colour,
                 uniform across every value so nothing ranks.
   momentary   — this just happened, on this control. accent, with a mark, transient. */
/** @param {StatusWordProps} props */
export function StatusWord({
	children,
	register = 'descriptive',
	unset = false,
	secondary = false,
	mark,
	blocked = false
}) {
	if (register === 'momentary') {
		return (
			<span className={`adm-momentary${blocked ? ' adm-momentary--blocked' : ''}`}>
				<Mark name={mark || 'check'} />
				{children}
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
