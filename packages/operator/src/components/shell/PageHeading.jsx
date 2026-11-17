import { useSyncExternalStore } from 'react';
import { ActionMenu } from '../controls/ActionMenu.jsx';
import { Mark } from '../status/Mark.jsx';

/**
 * @import { ComponentType, ReactNode } from 'react'
 * @import { ActionMenuItem, ShellLinkProps } from '../controls/ActionMenu.jsx'
 */

/**
 * @typedef {{ href: string; label: string }} PageCrumb
 *
 * @typedef {object} PageHeadingProps
 * @property {ReactNode} title the page's `h1`. it takes focus from script and is no Tab stop
 *   (`tabIndex={-1}`), so a screen whose press unmounted the focused control can land focus here.
 * @property {ReactNode} [status] a badge about the page as a whole, kept on the title's first line
 *   however the title wraps (lead-css's `ds-lead-1lh`).
 * @property {ReactNode} [description] the line under the title.
 * @property {readonly PageCrumb[] | undefined} [crumbs] the pages above this one, root first, and
 *   this one last, which is drawn as words: only on detail and Settings pages.
 * @property {ReactNode} [primary] the page's one primary action, a `ds-btn-primary` press or link.
 * @property {readonly ActionMenuItem[] | undefined} [secondary] the page's other actions. drawn as
 *   secondary buttons from 40rem; under it they leave and a More button opens them as a menu.
 * @property {ComponentType<ShellLinkProps> | undefined} [link] what a crumb and an `internal`
 *   action are drawn as.
 */

/* page-header-css's 40rem, under which the secondary actions move into More. */
const NARROW = '(width < 40rem)';

/** @param {() => void} changed */
function subscribeNarrow(changed) {
	const query = matchMedia(NARROW);
	query.addEventListener('change', changed);
	return () => query.removeEventListener('change', changed);
}
const narrowNow = () => matchMedia(NARROW).matches;
// the server draws the wide header; a phone's More arrives with the first client render.
const narrowOnServer = () => false;

/* a page's header on page-header-css: crumbs, the title with its status on the first line, the
   line under it, and the actions. More is drawn only where it has rows: under 40rem, and only for
   a page with secondary actions, which page-header-css hides there. */
/** @param {PageHeadingProps} props */
export function PageHeading({ title, status, description, crumbs, primary, secondary = [], link }) {
	const Link = link ?? 'a';
	const narrow = useSyncExternalStore(subscribeNarrow, narrowNow, narrowOnServer);
	const actions = secondary.length > 0 || primary !== undefined;
	return (
		<header className="ds-page-header">
			{crumbs && crumbs.length > 0 ? <Crumbs crumbs={crumbs} link={link} /> : null}
			<div className="ds-page-header-row">
				<div className="ds-page-header-text">
					<div className="ds-page-title-row ds-lead-row">
						<h1 className="ds-page-title" tabIndex={-1}>
							{title}
						</h1>
						{status === undefined ? null : <span className="ds-lead-1lh">{status}</span>}
					</div>
					{description === undefined ? null : <p className="ds-page-desc">{description}</p>}
				</div>
				{actions ? (
					<div className="ds-page-actions">
						{secondary.map((action) => {
							if (action.href === undefined)
								return (
									<button
										key={action.label}
										type="button"
										className="ds-btn ds-btn-secondary ds-ph-secondary"
										onClick={action.onSelect}
									>
										{action.mark ? <Mark name={action.mark} /> : null}
										{action.label}
									</button>
								);
							const Anchor = action.internal ? Link : 'a';
							return (
								<Anchor
									key={action.label}
									className="ds-btn ds-btn-secondary ds-ph-secondary"
									href={action.href}
								>
									{action.mark ? <Mark name={action.mark} /> : null}
									{action.label}
								</Anchor>
							);
						})}
						{primary === undefined ? null : <div className="ds-ph-primary">{primary}</div>}
						{narrow && secondary.length > 0 ? (
							<ActionMenu
								placement="below-end"
								link={link}
								runs={[secondary]}
								trigger={
									<button
										type="button"
										className="ds-btn ds-btn-secondary ds-btn-icon"
										aria-label="More actions"
									>
										<Mark name="ellipsis" />
									</button>
								}
							/>
						) : null}
					</div>
				) : null}
			</div>
		</header>
	);
}

/* top-bar-css's trail, standing above the title: links in order, the current page last as a
   `<span aria-current="page">`, a chevron after each link. */
/** @param {{ crumbs: readonly PageCrumb[]; link: ComponentType<ShellLinkProps> | undefined }} props */
function Crumbs({ crumbs, link }) {
	const Link = link ?? 'a';
	const last = crumbs.length - 1;
	return (
		<nav className="ds-crumbs" aria-label="Breadcrumb">
			<ol>
				{crumbs.map((crumb, at) => (
					<li key={crumb.href}>
						{at === last ? (
							<span aria-current="page">{crumb.label}</span>
						) : (
							<>
								<Link href={crumb.href}>{crumb.label}</Link>
								<Mark name="chevron-right" />
							</>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}
