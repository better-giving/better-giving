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
 * @property {ReactNode} title the page's one `h1`. it takes focus from script and is no Tab stop
 *   (`tabIndex={-1}`), so a screen whose press unmounted the focused control can land focus here.
 *   on a page with a sidebar entry it is visually hidden (`ds-sr-only`); on a nested page it is
 *   the trail's last item.
 * @property {readonly PageCrumb[] | undefined} [crumbs] the pages above this one, root first, and
 *   this one last. two or more make a nested page: the pages above are drawn as links and this
 *   one's place is taken by `title`. fewer than two, or none, is a page with a sidebar entry,
 *   which draws no trail.
 * @property {ReactNode} [status] a nested page's badge about the page as a whole, kept on the
 *   title's first line however the title wraps (lead-css's `ds-lead-1lh`). not drawn on a page
 *   with a sidebar entry.
 * @property {ReactNode} [description] a nested page's line under the trail. not drawn on a page
 *   with a sidebar entry.
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

/* a page's header in page-header-css's two shapes (its usage note, "No visible page title"). a
   page with a sidebar entry has a hidden h1 and, only when it has actions, one end-aligned row of
   them; with none it is the h1 alone, so main's gap adds no stray row. a nested page's title is
   the last item of its trail, with the status on its first line and the description under it. */
/** @param {PageHeadingProps} props */
export function PageHeading({ title, status, description, crumbs, primary, secondary = [], link }) {
	const narrow = useSyncExternalStore(subscribeNarrow, narrowNow, narrowOnServer);
	const hasActions = secondary.length > 0 || primary !== undefined;
	const actions = hasActions ? (
		<Actions primary={primary} secondary={secondary} link={link} narrow={narrow} />
	) : null;

	if (crumbs === undefined || crumbs.length < 2) {
		const heading = (
			<h1 className="ds-sr-only" tabIndex={-1}>
				{title}
			</h1>
		);
		if (!hasActions) return heading;
		return (
			<header className="ds-page-header">
				{heading}
				<div className="ds-page-header-row">{actions}</div>
			</header>
		);
	}

	const Link = link ?? 'a';
	return (
		<header className="ds-page-header">
			<div className="ds-page-header-row">
				<div className="ds-page-header-text">
					<nav className="ds-crumbs ds-crumbs-heading" aria-label="Breadcrumb">
						<ol>
							{crumbs.slice(0, -1).map((crumb) => (
								<li key={crumb.href}>
									<Link href={crumb.href}>{crumb.label}</Link>
									<Mark name="chevron-right" />
								</li>
							))}
							<li>
								<div className="ds-page-title-row ds-lead-row">
									<h1 className="ds-page-title" aria-current="page" tabIndex={-1}>
										{title}
									</h1>
									{status === undefined ? null : <span className="ds-lead-1lh">{status}</span>}
								</div>
							</li>
						</ol>
					</nav>
					{description === undefined ? null : <p className="ds-page-desc">{description}</p>}
				</div>
				{actions}
			</div>
		</header>
	);
}

/* the secondary buttons, the primary, and More, which is drawn only where it has rows: under
   40rem, and only for a page with secondary actions, which page-header-css hides there. */
/**
 * @param {{
 *   primary: ReactNode;
 *   secondary: readonly ActionMenuItem[];
 *   link: ComponentType<ShellLinkProps> | undefined;
 *   narrow: boolean;
 * }} props
 */
function Actions({ primary, secondary, link, narrow }) {
	const Link = link ?? 'a';
	return (
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
	);
}
