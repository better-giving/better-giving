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
 * @property {boolean | undefined} [unset] no value at all, which says something different from
 *   `secondary`. stated by callers and drawn as the neutral badge: the registry's quiet chip is
 *   metadata beside a status and its outline chip an ended record, and an absent value is neither.
 * @property {boolean | undefined} [secondary] the quiet one of two words, drawn as the registry's
 *   quiet chip (`ds-badge-quiet`), which is secondary metadata beside a title.
 * @property {Tone | undefined} [tone] where a record stands on its own lifecycle ladder: `done`
 *   live by the operator's hand, `attention` waiting on somebody, `blocker` failed or refused,
 *   `note` retired, stopped or ended. a record at rest, such as a gift that settled or a repeating
 *   gift still collecting, takes none (packages/app/src/lib/admin/status-tones.ts). absent on every
 *   word that is not one of those statuses — a consent reading and a count are facts about a
 *   record rather than where it stands — and absent wherever `secondary` is passed, since a tone
 *   already says the quiet one is quiet.
 * @property {MarkName | undefined} [mark]
 *
 * @typedef {object} StatusWordBlocked
 * @property {boolean | undefined} [blocked] a momentary word reporting that the thing could not
 *   be done.
 * @property {undefined} [neutral]
 *
 * @typedef {object} StatusWordNeutral
 * @property {boolean | undefined} [neutral] a momentary word reporting that the press changed
 *   nothing: neither done nor refused.
 * @property {undefined} [blocked]
 *
 * @typedef {StatusWordBase & (StatusWordBlocked | StatusWordNeutral)} StatusWordProps
 */

/**
 * the badge each tone is drawn as. `done` is the accent's chip and never the success one, because
 * done is the accent on these surfaces (packages/operator/src/styles/tokens.css); `note` is the
 * registry's outline chip, the one for a record that has ended, with no ground where a record at
 * rest has the neutral one.
 *
 * @type {Record<Tone, string>}
 */
export const BADGE_VARIANT_CLASS = {
	done: 'ds-badge-primary',
	attention: 'ds-badge-warning',
	blocker: 'ds-badge-destructive',
	note: 'ds-badge-outline'
};

/* three registers, and the register is carried by position and accompaniment, never by hue alone.
   descriptive — a fact in a value slot, with no mark and no sentence: a badge everywhere, a
                 table cell included. neutral until it is handed a `tone`, which only a
                 record's own lifecycle status gets.
   momentary   — this just happened, on this control. accent, with the check, transient;
                 attention with the triangle when `blocked`, and ink with the info mark when
                 `neutral`. a `mark` handed in replaces the register's own. */
/** @param {StatusWordProps} props */
export function StatusWord({
	children,
	register = 'descriptive',
	tone,
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
				<Mark name={mark || (blocked ? 'triangle-alert' : neutral ? 'info' : 'check')} />
				{/* one flex item: a message mixing text and elements would otherwise split into columns. */}
				<span>{children}</span>
			</span>
		);
	}
	/* the descriptive word is the registry's badge (../../registry/styles/badge-css.css), one variant
	   per tone, the quiet chip for the quiet one of two words and the neutral chip for everything
	   else. an ended record (`note`) is the outline chip, with no ground, so `Refunded` and
	   `Completed` are not the same drawing (../../styles/state-in-a-cell.spec.ts). */
	return (
		<span
			className={
				tone
					? `ds-badge ${BADGE_VARIANT_CLASS[tone]}`
					: secondary
						? 'ds-badge ds-badge-quiet'
						: 'ds-badge ds-badge-neutral'
			}
		>
			{children}
		</span>
	);
}
