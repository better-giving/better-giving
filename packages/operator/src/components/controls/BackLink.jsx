import { Mark } from '../status/Mark.jsx';

/**
 * @import { ComponentType, ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 *
 * what a back link hands whatever it is drawn as: the address and the class list the sheet draws
 * off. everything the link settles, and nothing a caller restates.
 *
 * @typedef {{
 *   href: string;
 *   className: string;
 *   children?: ReactNode | undefined;
 * }} BackLinkAnchorProps
 *
 * @typedef {object} BackLinkProps
 * @property {string | undefined} [href]
 * @property {ReactNode} [children]
 * @property {PointerState | undefined} [state]
 * @property {ComponentType<BackLinkAnchorProps> | undefined} [link] what the link is drawn as.
 *   unstated, a plain `<a>` — a router's link imported here would look for a context that is not
 *   there, and a specimen wants the plain one. **a back link on a mounted screen states one.** this
 *   package declares no router and cannot (CLAUDE.md: the graph is `app → operator ← console`, and
 *   the leaf reaches neither), so the surface that has one hands it in — and a bare anchor to an
 *   internal address takes the whole document with it, which is the running application thrown away
 *   and the section fetched again on every press back.
 */

/* one back link per child screen. never a breadcrumb trail: the second half of a trail is
   always the heading directly beneath it. */
/** @param {BackLinkProps} props */
export function BackLink({ href = '#', children, state, link }) {
	const cls = ['adm-back', state ? `is-${state}` : ''].filter(Boolean).join(' ');
	const Back = link ?? 'a';
	return (
		<Back className={cls} href={href}>
			<Mark name="arrow-left" />
			{children}
		</Back>
	);
}
