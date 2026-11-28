import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { RAIL_COOKIE, railCookie } from '../../rail-preference';
import { ActionMenu } from '../controls/ActionMenu.jsx';
import { Mark } from '../status/Mark.jsx';
import { RouteProgress } from './RouteProgress.jsx';

/**
 * @import { ComponentType, FocusEvent, MouseEvent, PointerEvent, ReactNode } from 'react'
 * @import { ShellLinkProps } from '../controls/ActionMenu.jsx'
 * @import { MarkName } from '../status/Mark.jsx'
 */

/**
 * a row's glyph: a name from ../status/glyphs.js, or a company's own image for a destination named
 * after its product, drawn as an `<img>` in the image slot nav-list-css gives a colour mark.
 *
 * @typedef {MarkName | { src: string }} NavMark
 *
 * a page under a parent row: Settings' sections.
 *
 * @typedef {object} NavChild
 * @property {string} href
 * @property {string} label
 * @property {MarkName} mark
 *
 * one row. a row with `children` is a parent: a link to its first child over the list of them,
 * and in the rail a link that opens them in a flyout. its own `href` is not drawn.
 *
 * @typedef {object} NavDestination
 * @property {string} href
 * @property {string} label
 * @property {NavMark | undefined} [mark]
 * @property {readonly NavChild[] | undefined} [children]
 *
 * a run of rows; a `heading` names it as a `role="group"`. the shape of the app's
 * `DESTINATION_GROUPS`, already filtered to what the session may open.
 *
 * @typedef {object} NavGroup
 * @property {string | undefined} [heading]
 * @property {readonly NavDestination[]} destinations
 *
 * where the reader is: the `label` of the destination they are in, whether the address is that
 * destination's own (`page`) or a screen under it (`section`), and for a parent the `href` of the
 * child that is the page. absent, no row is marked.
 *
 * @typedef {object} ShellCurrent
 * @property {string} label
 * @property {'page' | 'section'} kind
 * @property {string | undefined} [child]
 *
 * @typedef {object} ShellProps
 * @property {string} orgName drawn as the top bar's title and under the staff name in the account.
 * @property {string | undefined} [orgLogo] the organisation's logo image, drawn alone in the
 *   sidebar's head, its rail and the drawer's head. absent, the head draws the organisation's
 *   initials (`initials` below) in the registry's avatar instead, so the name is never a text link.
 * @property {{ href: string; label: string }} home where the mark goes as a document load, and the
 *   name it is read by.
 * @property {readonly NavGroup[]} groups
 * @property {ShellCurrent | undefined} [current]
 * @property {{ name: string; email: string }} staff who is signed in.
 * @property {string} donationPage the public donation page, opened as a document load: it is a
 *   donor's page and outside this shell.
 * @property {string} editDonationPage the donation page editor, on this surface.
 * @property {() => void} onSignOut
 * @property {boolean | undefined} [navigating] a navigation is running; draws the route-progress
 *   line across the top bar.
 * @property {ComponentType<ShellLinkProps> | undefined} [link] what every internal link is drawn
 *   as. this package declares no router, so the surface that has one hands it in; unstated, plain
 *   anchors, which load the whole document.
 * @property {ReactNode} [children] the page.
 * @property {boolean | undefined} [initialCollapsed] the rail collapsed on the first render, as
 *   `parseRail` read it off the request's cookie (../../rail-preference.ts). unstated, open.
 */

/* the rail preference in this browser's storage: `collapsed` or `expanded`. each toggle writes it
   beside the cookie, and it is read only to seed the cookie where the cookie is absent. */
const RAIL_STORAGE_KEY = 'bg-operator-rail';

/** @param {boolean} collapsed */
function keepRail(collapsed) {
	// biome-ignore lint/suspicious/noDocumentCookie: the cookie store api is async and missing from browsers the dashboard serves; this is one synchronous write.
	document.cookie = railCookie(collapsed);
}

/* app-shell-css's breakpoint, where the menu button and the drawer give way to the sidebar. */
const WIDE = '(width >= 48rem)';

/* the operator shell, drawn with app-shell-css 2.0.0 and the sheets it reads: the sidebar (mark,
   destinations, account), the top bar (menu button on a phone, rail toggle from 48rem, the
   organisation's name, the donation page), the page, and on a phone the same destinations in a
   modal `<dialog>` drawer. no script ships with the registry item; what its note asks the page to
   wire is here: the toggle and its storage, the drawer, the account menu, the rail's tooltip and a
   parent's flyout.

   the first render, on the server and in the browser alike, draws the rail as `initialCollapsed`
   says, which the surface reads from the request's cookie with ../../rail-preference.ts: a first
   client render that differed from the server's would not hydrate, and one changed after mount
   is a visible jump. */
/** @param {ShellProps} props */
export function Shell({
	initialCollapsed = false,
	orgName,
	orgLogo,
	home,
	groups,
	current,
	staff,
	donationPage,
	editDonationPage,
	onSignOut,
	navigating,
	link,
	children
}) {
	const sidebarId = useId();
	const drawerId = useId();
	const mainId = useId();

	const [collapsed, setCollapsed] = useState(initialCollapsed);
	/* a choice in storage with no cookie beside it becomes the cookie for the next page's server
	   render; this page keeps what the server drew, since flipping it now is the jump. */
	useEffect(() => {
		const hasCookie = document.cookie
			.split(';')
			.some((pair) => pair.trim().startsWith(`${RAIL_COOKIE}=`));
		if (hasCookie) return;
		try {
			const stored = localStorage.getItem(RAIL_STORAGE_KEY);
			if (stored !== null) keepRail(stored === 'collapsed');
		} catch {
			// storage refused (a blocked or private window): there is nothing to carry over.
		}
	}, []);
	function toggle() {
		const next = !collapsed;
		keepRail(next);
		try {
			localStorage.setItem(RAIL_STORAGE_KEY, next ? 'collapsed' : 'expanded');
		} catch {
			// storage refused: the cookie still carries the choice.
		}
		setCollapsed(next);
	}

	const main = useRef(/** @type {HTMLElement | null} */ (null));
	const drawer = useRef(/** @type {HTMLDialogElement | null} */ (null));
	const menuButton = useRef(/** @type {HTMLButtonElement | null} */ (null));
	const closeButton = useRef(/** @type {HTMLButtonElement | null} */ (null));
	const [drawerOpen, setDrawerOpen] = useState(false);

	function openDrawer() {
		drawer.current?.showModal();
		setDrawerOpen(true);
		// the close button is where focus lands as the drawer opens (app-shell-css's `autofocus`,
		// which react does not render as the attribute).
		closeButton.current?.focus();
	}
	function closeDrawer() {
		drawer.current?.close();
	}
	/* every way the drawer shuts — Escape, which the browser turns into `close`, the close button,
	   the scrim, a link chosen, the window widening — arrives here as the dialog's `close`. */
	function drawerClosed() {
		setDrawerOpen(false);
		menuButton.current?.focus();
	}

	/* a drawer left open as the window widens past the breakpoint would hold the keyboard in
	   something the sidebar now stands in for. */
	useEffect(() => {
		if (!drawerOpen) return;
		const wide = matchMedia(WIDE);
		const widened = () => {
			if (wide.matches) drawer.current?.close();
		};
		wide.addEventListener('change', widened);
		return () => wide.removeEventListener('change', widened);
	}, [drawerOpen]);

	const account = (
		<Account
			orgName={orgName}
			staff={staff}
			donationPage={donationPage}
			editDonationPage={editDonationPage}
			onSignOut={onSignOut}
			link={link}
		/>
	);

	const mark = (
		<div className="ds-shell-mark">
			{/* a plain anchor, never the surface's router link: the head opens a donor's page, which is
			    outside this shell and follows as a document load. */}
			<a href={home.href} aria-label={home.label}>
				<HeadMark orgLogo={orgLogo} orgName={orgName} rail={false} />
			</a>
		</div>
	);

	return (
		<div className="ds-shell" data-collapsed={collapsed ? '' : undefined}>
			{/* the first stop. it points at the page's id, so it works before the script arrives;
			    once it has, the press moves focus itself and leaves the address alone, since a
			    fragment on the address is a history entry Back would land on. */}
			<a
				className="ds-site-nav-skip"
				href={`#${mainId}`}
				onClick={(event) => {
					event.preventDefault();
					main.current?.focus();
				}}
			>
				Skip to content
			</a>
			<aside className="ds-shell-sidebar" id={sidebarId}>
				<div className="ds-shell-head">
					{mark}
					<div className="ds-shell-mark-rail">
						<a href={home.href} aria-label={home.label}>
							<HeadMark orgLogo={orgLogo} orgName={orgName} rail />
						</a>
					</div>
				</div>
				<Nav groups={groups} current={current} link={link} rail={collapsed} />
				{account}
			</aside>
			<header className="ds-topbar">
				{navigating === undefined ? null : <RouteProgress busy={navigating} />}
				<div className="ds-topbar-lead">
					<button
						ref={menuButton}
						type="button"
						className="ds-btn ds-btn-ghost ds-btn-icon ds-shell-menu"
						aria-label="Menu"
						aria-expanded={drawerOpen}
						aria-controls={drawerId}
						onClick={openDrawer}
					>
						<Mark name="menu" />
					</button>
					<button
						type="button"
						className="ds-icon-bare ds-shell-toggle"
						aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
						aria-expanded={!collapsed}
						aria-controls={sidebarId}
						onClick={toggle}
					>
						<Mark name="panel-left" />
					</button>
					<p className="ds-topbar-title">{orgName}</p>
				</div>
				<div className="ds-topbar-actions">
					<div className="ds-topbar-secondary">
						<a className="ds-btn ds-btn-secondary" href={donationPage}>
							<Mark name="eye" />
							Open donation page
						</a>
					</div>
				</div>
			</header>
			<main ref={main} className="ds-shell-main" id={mainId} tabIndex={-1}>
				{children}
			</main>
			{/* the scrim is the dialog's own `::backdrop`, so it sits behind the drawer. a press on it
			    is a click whose target is the dialog itself. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: the scrim is a pointer's way out; the
			    keyboard's is Escape, which the browser answers on a modal dialog. */}
			<dialog
				ref={drawer}
				className="ds-shell-drawer"
				id={drawerId}
				aria-label="Menu"
				onClose={drawerClosed}
				onClick={(event) => {
					if (event.target === event.currentTarget) closeDrawer();
				}}
				onClickCapture={(event) => {
					// any link in it, a row or the account menu's, closes it as it is followed
					// (app-shell-css's note). heard in capture, so no handler inside that stops the
					// click keeps it open; a click that opens a new tab leaves the page, and the
					// drawer, where they are.
					if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
					if (/** @type {HTMLElement} */ (event.target).closest('a[href]')) closeDrawer();
				}}
			>
				<div className="ds-shell-head">
					{mark}
					<button
						ref={closeButton}
						type="button"
						className="ds-icon-bare"
						aria-label="Close menu"
						onClick={closeDrawer}
					>
						<Mark name="x" />
					</button>
				</div>
				<Nav groups={groups} current={current} link={link} />
				{account}
			</dialog>
		</div>
	);
}

/**
 * @typedef {object} NavProps
 * @property {readonly NavGroup[]} groups
 * @property {ShellCurrent | undefined} current
 * @property {ComponentType<ShellLinkProps> | undefined} link
 * @property {boolean | undefined} [rail] the sidebar's copy, drawn as the rail. the sidebar's
 *   copy alone carries the rail's parts (a parent's flyout, the tooltip); the drawer's never
 *   becomes a rail.
 */

/** @param {NavProps} props */
function Nav({ groups, current, link, rail }) {
	const sidebar = rail !== undefined;
	const tip = useRef(/** @type {HTMLDivElement | null} */ (null));
	const [pointed, setPointed] = useState(
		/** @type {{ link: HTMLElement; label: string } | null} */ (null)
	);
	/* the sidebar opened out of the rail drops a tip it was showing. */
	const tipFor = rail ? pointed : null;

	/* the rail's tooltip: the hovered or focused link's name, 8px past the rail's edge and centred
	   on the link (app-shell-css → `ds-shell-tip`). a parent's link has its flyout instead. */
	/** @param {PointerEvent<HTMLElement> | FocusEvent<HTMLElement>} event */
	function point(event) {
		if (!rail) return;
		const at = /** @type {HTMLElement} */ (event.target).closest('a.ds-nav-link');
		const named =
			at instanceof HTMLElement &&
			!at.classList.contains('ds-shell-rail-parent') &&
			at.closest('.ds-shell-flyout') === null;
		setPointed(
			named ? { link: at, label: at.querySelector('.ds-nav-label')?.textContent ?? '' } : null
		);
	}
	const unpoint = () => setPointed(null);

	useLayoutEffect(() => {
		const box = tip.current;
		if (tipFor === null || box === null) return;
		const row = tipFor.link.getBoundingClientRect();
		const edge = tipFor.link.closest('.ds-shell-sidebar')?.getBoundingClientRect() ?? row;
		const rtl = getComputedStyle(tipFor.link).direction === 'rtl';
		box.style.insetBlockStart = `${row.top + row.height / 2 - box.offsetHeight / 2}px`;
		box.style.insetInlineStart = `${rtl ? innerWidth - edge.left + 8 : edge.right + 8}px`;
	}, [tipFor]);

	useEffect(() => {
		if (tipFor === null) return;
		/** @param {KeyboardEvent} event */
		const hideOnEscape = (event) => {
			if (event.key === 'Escape') setPointed(null);
		};
		document.addEventListener('keydown', hideOnEscape);
		return () => document.removeEventListener('keydown', hideOnEscape);
	}, [tipFor]);

	return (
		<>
			<nav
				className="ds-nav-list ds-shell-nav"
				aria-label="Sidebar"
				onPointerOver={sidebar ? point : undefined}
				onPointerLeave={sidebar ? unpoint : undefined}
				onFocus={sidebar ? point : undefined}
				onBlur={sidebar ? unpoint : undefined}
			>
				{groups.map((group, at) => (
					<Group
						key={group.heading ?? at}
						group={group}
						current={current}
						link={link}
						sidebar={sidebar}
					/>
				))}
			</nav>
			{sidebar ? (
				/* the link already carries its name, so the tip is out of the tree. it stands at the
				   end of the sidebar, `position: fixed`, where nothing clips it. */
				<div ref={tip} className="ds-shell-tip" aria-hidden="true" hidden={tipFor === null}>
					{tipFor?.label}
				</div>
			) : null}
		</>
	);
}

/**
 * @param {{
 *   group: NavGroup;
 *   current: ShellCurrent | undefined;
 *   link: ComponentType<ShellLinkProps> | undefined;
 *   sidebar: boolean;
 * }} props
 */
function Group({ group, current, link, sidebar }) {
	const headingId = useId();
	const rows = group.destinations.map((destination) =>
		destination.children && destination.children.length > 0 ? (
			<ParentRow
				key={destination.label}
				destination={destination}
				items={destination.children}
				current={current}
				link={link}
				sidebar={sidebar}
			/>
		) : (
			<li key={destination.label}>
				<NavLink
					link={link}
					className="ds-nav-link"
					href={destination.href}
					mark={destination.mark}
					label={destination.label}
					current={
						current?.label === destination.label
							? current.kind === 'page'
								? 'page'
								: 'true'
							: undefined
					}
				/>
			</li>
		)
	);
	if (group.heading === undefined) return <ul className="ds-nav-group">{rows}</ul>;
	return (
		/* biome-ignore lint/a11y/useSemanticElements: a `<fieldset>` groups a form's controls, and
		   these are links; nav-list-css names the group with `role="group"`. */
		<div className="ds-nav-group" role="group" aria-labelledby={headingId}>
			<h2 className="ds-nav-title" id={headingId}>
				{group.heading}
			</h2>
			<ul>{rows}</ul>
		</div>
	);
}

/**
 * @typedef {object} NavLinkProps
 * @property {ComponentType<ShellLinkProps> | undefined} link
 * @property {string} className
 * @property {string} href
 * @property {NavMark | undefined} mark
 * @property {string} label
 * @property {'page' | 'true' | undefined} [current]
 */

/* a row: its glyph first, then the label in a `ds-lead-row`, as nav-list-css's contract has it. */
/** @param {NavLinkProps} props */
function NavLink({ link, className, href, mark, label, current }) {
	const Link = link ?? 'a';
	return (
		<Link className={className} href={href} aria-current={current}>
			<Glyph mark={mark} />
			<span className="ds-nav-label ds-lead-row">
				<span>{label}</span>
			</span>
		</Link>
	);
}

/** @param {{ mark: NavMark | undefined }} props */
function Glyph({ mark }) {
	if (mark === undefined) return null;
	if (typeof mark === 'string') return <Mark name={mark} />;
	return <img className="adm-mark adm-nav-image" src={mark.src} alt="" />;
}

/**
 * @typedef {object} ParentRowProps
 * @property {NavDestination} destination
 * @property {readonly NavChild[]} items
 * @property {ShellCurrent | undefined} current
 * @property {ComponentType<ShellLinkProps> | undefined} link
 * @property {boolean} sidebar
 */

/* a parent over its children (nav-list-css's `ds-nav-parent` over a `ds-nav-sub`), expanded from
   the route alone: a press follows the link to the first child and toggles nothing. in the
   sidebar the `<li>` also holds the two parts the rail draws in its place, app-shell-css's
   `ds-shell-rail-parent` and `ds-shell-flyout`, and the behaviour that note's script gives them. */
/** @param {ParentRowProps} props */
function ParentRow({ destination, items, current, link, sidebar }) {
	const Link = link ?? 'a';
	const subId = useId();
	const flyoutId = useId();
	const first = items[0]?.href ?? destination.href;
	const open = current?.label === destination.label;
	const childCurrent = (/** @type {NavChild} */ item) =>
		open && current?.child === item.href ? 'page' : undefined;
	const sublinks = items.map((item) => (
		<li key={item.href}>
			<NavLink
				link={link}
				className="ds-nav-link ds-nav-sublink"
				href={item.href}
				mark={item.mark}
				label={item.label}
				current={childCurrent(item)}
			/>
		</li>
	));

	const li = useRef(/** @type {HTMLLIElement | null} */ (null));
	const railLink = useRef(/** @type {HTMLAnchorElement | null} */ (null));
	const flyout = useRef(/** @type {HTMLElement | null} */ (null));
	const [shown, setShown] = useState(false);

	/* the flyout is shown by the stylesheet (hover, or keyboard focus in the `<li>`), and the link's
	   `aria-expanded` follows what it shows, read a frame later. `data-dismissed` is written on the
	   element rather than rendered: the handlers read it in the same event that sets it. */
	const sync = () =>
		requestAnimationFrame(() => {
			if (flyout.current) setShown(getComputedStyle(flyout.current).display !== 'none');
		});
	const place = () => {
		const at = railLink.current?.getBoundingClientRect();
		const rail = li.current?.closest('.ds-shell-sidebar')?.getBoundingClientRect();
		const box = flyout.current;
		if (!at || !rail || !box || !li.current) return;
		const rtl = getComputedStyle(li.current).direction === 'rtl';
		// the flyout's top 8px above the row's, its title 1px under it (app-shell-css).
		box.style.insetBlockStart = `${at.top - 8}px`;
		box.style.insetInlineStart = `${rtl ? innerWidth - rail.left + 8 : rail.right + 8}px`;
	};
	const undismiss = () => {
		if (li.current) delete li.current.dataset.dismissed;
	};
	const dismiss = () => {
		if (li.current) li.current.dataset.dismissed = '';
	};

	/* Escape closes it however it opened, heard on the document since focus may be anywhere; only
	   focus inside the flyout moves back to the link. */
	useEffect(() => {
		if (!sidebar) return;
		/** @param {KeyboardEvent} event */
		const hideOnEscape = (event) => {
			const item = li.current;
			const box = flyout.current;
			if (event.key !== 'Escape' || event.defaultPrevented || !item || !box) return;
			if ('dismissed' in item.dataset || getComputedStyle(box).display === 'none') return;
			item.dataset.dismissed = '';
			if (box.contains(document.activeElement)) railLink.current?.focus();
			sync();
		};
		document.addEventListener('keydown', hideOnEscape);
		return () => document.removeEventListener('keydown', hideOnEscape);
	}, [sidebar]);

	return (
		<li
			ref={li}
			onPointerEnter={
				sidebar
					? () => {
							undismiss();
							place();
							sync();
						}
					: undefined
			}
			onPointerLeave={sidebar ? sync : undefined}
			onFocus={
				sidebar
					? (/** @type {FocusEvent<HTMLLIElement>} */ event) => {
							// focus arriving from outside clears the hold, so it cannot stick when an
							// Escape left focus elsewhere and focus never entered the `<li>`
							if (!event.currentTarget.contains(/** @type {Node | null} */ (event.relatedTarget)))
								undismiss();
							place();
							sync();
						}
					: undefined
			}
			onBlur={
				sidebar
					? (/** @type {FocusEvent<HTMLLIElement>} */ event) => {
							if (!event.currentTarget.contains(/** @type {Node | null} */ (event.relatedTarget)))
								undismiss();
							sync();
						}
					: undefined
			}
		>
			<Link
				className="ds-nav-link ds-nav-parent"
				href={first}
				aria-expanded={open}
				aria-controls={subId}
			>
				<Glyph mark={destination.mark} />
				<span className="ds-nav-label ds-lead-row">
					<span>{destination.label}</span>
				</span>
				<Mark name="chevron-right" className="ds-nav-chev" />
			</Link>
			<ul className="ds-nav-sub" id={subId} aria-label={`${destination.label} sections`}>
				{sublinks}
			</ul>
			{sidebar ? (
				<>
					<Link
						ref={railLink}
						className="ds-nav-link ds-shell-rail-parent"
						href={first}
						aria-current={open ? 'true' : undefined}
						aria-expanded={shown}
						aria-controls={flyoutId}
					>
						<Glyph mark={destination.mark} />
						<span className="ds-nav-label">
							<span>{destination.label}</span>
						</span>
					</Link>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: the only click acted on here is
					    the keyboard's own, Enter on a link inside (`detail` 0). */}
					<nav
						ref={flyout}
						className="ds-shell-flyout"
						id={flyoutId}
						aria-label={`${destination.label} sections`}
						onClick={(/** @type {MouseEvent<HTMLElement>} */ event) => {
							// Enter on one of its links follows it and closes it as Escape does, focus
							// back on the link where the page stays. a keyboard's click has no
							// pointer detail; a pointer's closes it as the pointer leaves.
							if (event.detail !== 0) return;
							if (!(/** @type {HTMLElement} */ (event.target).closest('a[href]'))) return;
							dismiss();
							railLink.current?.focus();
							sync();
						}}
					>
						<p className="ds-shell-flyout-title" aria-hidden="true">
							{destination.label}
						</p>
						<ul>{sublinks}</ul>
					</nav>
				</>
			) : null}
		</li>
	);
}

/**
 * the head's link to the home page, in the sidebar, the rail and the drawer's head: the
 * organisation's logo, or its initials in the registry's avatar (avatar-css) where it has none.
 * `rail` draws the logo in the rail's box, 28px: ./styles/adm.css's `.adm-logo--rail`.
 *
 * @param {{ orgLogo: string | undefined; orgName: string; rail: boolean }} props
 */
function HeadMark({ orgLogo, orgName, rail }) {
	const letters = initials(orgName);
	return (
		<>
			{/* app-shell-css's contract draws the mark 36px tall, the rail's box 28px: ./styles/adm.css
			    sizes each on its hook. */}
			{orgLogo === undefined ? null : rail ? (
				<img className="adm-logo adm-logo--rail" src={orgLogo} alt="" height={28} />
			) : (
				<img className="adm-logo" src={orgLogo} alt="" height={36} />
			)}
			{/* a name with no letter in it draws no initials, so the mark is the logo alone. */}
			{orgLogo === undefined && letters !== '' ? (
				<span className="ds-avatar ds-avatar-square ds-avatar-logo" aria-hidden="true">
					<span aria-hidden="true">{letters}</span>
				</span>
			) : null}
		</>
	);
}

/**
 * @typedef {object} AccountProps
 * @property {string} orgName
 * @property {{ name: string; email: string }} staff
 * @property {string} donationPage
 * @property {string} editDonationPage
 * @property {() => void} onSignOut
 * @property {ComponentType<ShellLinkProps> | undefined} link
 */

/* the sidebar's foot: who is signed in, opening the account menu above it, starts aligned. */
/** @param {AccountProps} props */
function Account({ orgName, staff, donationPage, editDonationPage, onSignOut, link }) {
	return (
		<div className="ds-shell-account">
			<ActionMenu
				placement="above-start"
				link={link}
				header={{ title: staff.name, meta: staff.email }}
				runs={[
					[
						{ label: 'Edit donation page', mark: 'globe', href: editDonationPage, internal: true },
						{ label: 'Open donation page', mark: 'eye', href: donationPage }
					],
					[{ label: 'Sign out', mark: 'log-out', onSelect: onSignOut }]
				]}
				trigger={
					<button type="button" className="ds-shell-account-btn">
						<span className="ds-avatar" aria-hidden="true">
							<span aria-hidden="true">{initials(staff.name)}</span>
						</span>
						<span className="ds-shell-account-text">
							<span className="ds-shell-account-name">{staff.name}</span>
							<span className="ds-shell-account-org">{orgName}</span>
						</span>
						<Mark name="chevrons-up-down" />
					</button>
				}
			/>
		</div>
	);
}

/** the first letters of a name's first two words, which the avatar draws uppercase. */
export function initials(/** @type {string} */ name) {
	return name
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map((word) => word.charAt(0))
		.join('');
}
