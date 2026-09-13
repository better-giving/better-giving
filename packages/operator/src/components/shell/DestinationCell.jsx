import { Mark } from '../status/Mark.jsx';

/**
 * @import { ComponentType, ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 * @import { MarkName } from '../status/Mark.jsx'
 *
 * what a cell hands whatever it is drawn as: the address, the class list the sheet draws off, and
 * the claim about where the reader is. everything the cell settles, and nothing a caller restates.
 *
 * @typedef {{
 *   href: string;
 *   className: string;
 *   'aria-current'?: 'page' | 'true' | undefined;
 *   title?: string | undefined;
 *   children?: ReactNode | undefined;
 * }} DestinationLinkProps
 *
 * a glyph from ../status/glyphs.js, or a picture somebody else drew (a processor's logo), which
 * carries no ink of this system's and is drawn as an image.
 *
 * @typedef {MarkName | { src: string }} DestinationMark
 *
 * where the destination stands, as StatusLine's glyph in StatusLine's tone. `label` is the word a
 * reader hears after the destination's name; the glyph itself is out of the tree.
 *
 * @typedef {object} DestinationStatus
 * @property {'done' | 'note' | 'attention'} tone
 * @property {MarkName} mark
 * @property {string} label
 *
 * @typedef {object} DestinationCellProps
 * @property {ReactNode} [children]
 * @property {string | undefined} [short]
 * @property {string | undefined} [href]
 * @property {DestinationMark | undefined} [mark] drawn in the rail's column and not in the bar.
 * @property {DestinationStatus | undefined} [status]
 * @property {string | undefined} [title] the pointer's hint, for the icon rail where the name is
 *   off the screen.
 * @property {boolean | undefined} [groupEnd] the last entry of a headed group in the rail, which
 *   the column stands a step apart from what follows.
 * @property {boolean | 'page' | 'section' | undefined} [current] where the reader is, and which
 *   kind of currency the cell announces. `page` — which bare `true` is — is the address itself;
 *   `section` is a destination that only contains it, which is every rail cell standing over a
 *   screen one level down.
 * @property {PointerState | undefined} [state]
 * @property {ComponentType<DestinationLinkProps> | undefined} [link] what the cell is drawn as.
 *   unstated, a plain `<a>` — a router's link imported here would look for a context that is not
 *   there. **a mounted rail states one.** this package declares no router and
 *   cannot (CLAUDE.md: the graph is `app → operator ← console`, and the leaf reaches neither), so
 *   the surface that has one hands it in — and a bare anchor to an internal address takes the
 *   whole document with it, which is a rail of full page loads that renders identically.
 */

/* five states: rest, hover, focus, current, current-and-hover.
   current and hovered must be unmistakably different: current changes ground and ink, hover only
   fills. the current cell is marked by that tint alone — no edge, at either width.
   `short` is the word the rail reads across the top of a narrow window, where the full one does
   not fit. both are in the markup and the sheet chooses — a cell that swapped its own text would
   be a name changing under a reader between two widths.

   the status word is `.adm-vh` and outside `.adm-dest__status`, because the sheet hides the glyph
   in the bar and a status hidden with it would stop being read out there. its comma is what
   separates it from the name in the link's accessible name.

   the ground is one thing and what is announced is another, which is why the caller states the
   kind. `aria-current="page"` is a claim that this cell is the address in the location bar, and a
   reader hearing it on the section a screen sits under is told the section is the screen. that
   kind is `aria-current="true"` — the current one of these — so the section reads as containing
   where they are rather than as being it, and only one cell in the rail ever claims the page. */
/** @param {DestinationCellProps} props */
export function DestinationCell({
	children,
	short,
	href = '#',
	mark,
	status,
	title,
	groupEnd = false,
	current,
	state,
	link
}) {
	const cls = [
		'adm-dest',
		groupEnd ? 'adm-dest--groupend' : '',
		current ? 'is-current' : '',
		state ? `is-${state}` : ''
	]
		.filter(Boolean)
		.join(' ');
	const Cell = link ?? 'a';
	return (
		<Cell
			className={cls}
			href={href}
			title={title}
			aria-current={current ? (current === 'section' ? 'true' : 'page') : undefined}
		>
			{mark === undefined ? null : typeof mark === 'string' ? (
				<Mark name={mark} />
			) : (
				<img className="adm-mark" src={mark.src} alt="" />
			)}
			{short ? <span className="adm-dest__short">{short}</span> : null}
			<span className="adm-dest__full">{children}</span>
			{status ? (
				<>
					<span className={`adm-dest__status adm-dest__status--${status.tone}`}>
						<Mark name={status.mark} />
					</span>
					<span className="adm-vh">, {status.label}</span>
				</>
			) : null}
		</Cell>
	);
}
