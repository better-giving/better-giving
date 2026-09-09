/**
 * @import { ComponentType, ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 *
 * what a cell hands whatever it is drawn as: the address, the class list the sheet draws off, and
 * the claim about where the reader is. everything the cell settles, and nothing a caller restates.
 *
 * @typedef {{
 *   href: string;
 *   className: string;
 *   'aria-current'?: 'page' | 'true' | undefined;
 *   children?: ReactNode | undefined;
 * }} DestinationLinkProps
 *
 * @typedef {object} DestinationCellProps
 * @property {ReactNode} [children]
 * @property {string | undefined} [short]
 * @property {string | undefined} [href]
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
   current and hovered must be unmistakably different, so they differ on three axes at once:
   current changes hue, changes weight, and gains an accent edge. hover only fills.
   `short` is the word the rail reads across the top of a narrow window, where the full one does
   not fit. both are in the markup and the sheet chooses — a cell that swapped its own text would
   be a name changing under a reader between two widths.

   the ground is one thing and what is announced is another, which is why the caller states the
   kind. `aria-current="page"` is a claim that this cell is the address in the location bar, and a
   reader hearing it on the section a screen sits under is told the section is the screen. that
   kind is `aria-current="true"` — the current one of these — so the section reads as containing
   where they are rather than as being it, and only one cell in the rail ever claims the page. */
/** @param {DestinationCellProps} props */
export function DestinationCell({ children, short, href = '#', current, state, link }) {
	const cls = ['adm-dest', current ? 'is-current' : '', state ? `is-${state}` : '']
		.filter(Boolean)
		.join(' ');
	const Cell = link ?? 'a';
	return (
		<Cell
			className={cls}
			href={href}
			aria-current={current ? (current === 'section' ? 'true' : 'page') : undefined}
		>
			{short ? <span className="adm-dest__short">{short}</span> : null}
			<span className="adm-dest__full">{children}</span>
		</Cell>
	);
}
