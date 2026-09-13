import { Mark } from '../status/Mark.jsx';

/**
 * @import { ComponentType, ReactNode } from 'react'
 * @import { PointerState } from '../closed-sets.js'
 *
 * what a crumb's link hands whatever it is drawn as: the address and the class list the sheet draws
 * off. everything the link settles, and nothing a caller restates.
 *
 * @typedef {{
 *   href: string;
 *   className: string;
 *   children?: ReactNode | undefined;
 * }} BreadcrumbsAnchorProps
 *
 * @typedef {{ href: string; label: ReactNode }} Crumb
 *
 * @typedef {object} BreadcrumbsProps
 * @property {readonly Crumb[]} items the trail, root first. the last is the page being looked at.
 * @property {PointerState | undefined} [state] pinned on the link to the page directly above this
 *   one — the crumb a reader presses to go back, and so the one a specimen shows pressed.
 * @property {ComponentType<BreadcrumbsAnchorProps> | undefined} [link] what each link is drawn as.
 *   unstated, a plain `<a>` — a router's link imported here would look for a context that is not
 *   there, and a specimen wants the plain one. **a trail on a mounted screen states one.** this
 *   package declares no router and cannot (CLAUDE.md: the graph is `app → operator ← console-ui`,
 *   and the leaf reaches neither), so the surface that has one hands it in — and a bare anchor to an
 *   internal address takes the whole document with it, which is the running application thrown away
 *   and the section fetched again on every press up the trail.
 */

/* the pages above this one, root first, and this one last as words rather than a link: pressing
   the page already open is a reload dressed as navigation.

   a trail of one is the page's own name and nothing above it, which the heading beneath already
   says, so fewer than two draws nothing. each separator is a mark with no label, which is out of the
   accessibility tree — the list is what tells a reader the items are steps. */
/** @param {BreadcrumbsProps} props */
export function Breadcrumbs({ items, state, link }) {
	if (items.length < 2) return null;
	const Crumb = link ?? 'a';
	const current = items.length - 1;
	return (
		<nav aria-label="Breadcrumb">
			<ol className="adm-crumbs__list">
				{items.map((item, at) => (
					<li className="adm-crumbs__item" key={item.href}>
						{at > 0 ? <Mark name="chevron-right" className="adm-crumbs__sep" /> : null}
						{at === current ? (
							<span className="adm-crumbs__current" aria-current="page">
								{item.label}
							</span>
						) : (
							<Crumb
								className={
									state && at === current - 1 ? `adm-crumbs__link is-${state}` : 'adm-crumbs__link'
								}
								href={item.href}
							>
								{item.label}
							</Crumb>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}
