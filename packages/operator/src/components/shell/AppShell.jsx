import { useEffect, useState } from 'react';
import { DestinationCell } from './DestinationCell.jsx';
import { Button } from '../controls/Button.jsx';

/**
 * @import { ComponentType, ReactNode } from 'react'
 * @import { DestinationLinkProps, DestinationMark, DestinationStatus } from './DestinationCell.jsx'
 */

/**
 * a destination is a word, or the word plus the shorter one the rail reads across a narrow
 * window. both are in the markup and the sheet chooses between them.
 *
 * @typedef {object} Destination
 * @property {string} label
 * @property {string | undefined} [short]
 * @property {string | undefined} [href] where the cell goes. absent, it is `#`, which is what a
 * specimen wants and no mounted rail does.
 * @property {DestinationMark | undefined} [mark] the column's mark; the bar draws none.
 * @property {DestinationStatus | undefined} [status]
 */

/**
 * a run of destinations the rail draws together. a rule separates one group from the next; a
 * group with a `heading` stands a step apart, under its heading, and the group after it draws no
 * rule of its own. the heading names the group and goes nowhere.
 *
 * @typedef {object} DestinationGroup
 * @property {string | undefined} [heading]
 * @property {readonly Destination[]} destinations
 */

/**
 * where the reader is: the `label` of the destination they are in, and which kind of currency its
 * cell announces — `page` where the address is that destination's own, `section` where the
 * destination only contains it. this package is a leaf and matches no address, so the kind is the
 * caller's to state: the surface that resolved the destination is the one that knows which it is.
 *
 * @typedef {object} Whereabouts
 * @property {string} label
 * @property {'page' | 'section'} kind
 */

/**
 * @typedef {object} AppShellProps
 * @property {ReactNode} [org] the operating organisation's legal name. there is no logo.
 * @property {ReactNode} [under] drawn under the name, in the narrow band and the rail's head alike.
 * the console hands its deployment's address; the dashboard hands nothing.
 * @property {string | Whereabouts | undefined} [current] the destination the reader is in: a bare
 * word is the `label`, and the page itself. absent, the reader is in none of them and no cell is
 * marked — which is what a surface hands for an address under no destination, and is the only
 * honest rail to draw there.
 * @property {readonly DestinationGroup[] | undefined} [groups]
 * @property {ComponentType<DestinationLinkProps> | undefined} [link] what every cell in the rail
 * is drawn as, handed straight to ./DestinationCell.jsx — see the note on the prop there for why
 * this package takes one rather than importing a router's link. a surface that leaves it unstated
 * gets plain anchors and a rail of full document loads that renders identically.
 * @property {boolean | undefined} [centred] the screen is one short block and stands in the middle
 * of the space under the head rather than at the top of it. what it is for is a screen that is
 * waiting — nothing has arrived and there is nothing on it to act on — and a screen with anything
 * to do on it is read from the top. ../../styles/adm.css's `.adm-main--centred` is the rule and
 * holds why the page rather than the column carries it.
 * @property {ReactNode} [wayOut] the way out: the dashboard's sign-out, the console's close. drawn
 * in the narrow band, and in the rail's foot when no `foot` is handed. unstated, it is the quiet
 * button a specimen shows; `null` is none. absence cannot say that: a slot with a default of its
 * own reads nothing stated as a request for the default. a way out carrying a mark and a word
 * wraps the word in `.adm-signout__word`, so the icon rail can show the mark alone.
 * @property {ReactNode} [foot] what the rail's foot holds in place of `wayOut` — the console's
 * account and release lines, which carry its close. absent, the foot holds `wayOut`; a foot that
 * comes to `null` either way is not drawn.
 * @property {ReactNode} [head] the panel's strip, over the page: `.adm-headstrip`, whose two ends
 * are the caller's (`.adm-headstrip__title` for the page's name). absent, no strip.
 * @property {ReactNode} [children]
 *
 * @typedef {object} PanelRouteProps
 * @property {ReactNode} [bar] a strip across the top of the route, carrying whatever the surface
 * puts in it. the slot positions and composes nothing: two children land at the two ends of the
 * strip and what they are is the caller's. absent, the route is the panel alone and no strip is
 * drawn. it is the same `.adm-head` ./BareShell.jsx stands over its page, so a surface drawing one
 * head on the route and the shell alike hands the same ends to both — which the console does, from
 * packages/console-ui/src/lib/head-strip.tsx. what it does not take is the run of stated facts:
 * ./TopBar.jsx is the other head this system has and only ./BareShell.jsx stands it.
 * @property {ReactNode} [foot] the same strip at the other edge and the same arrangement — two
 * children, one at each end. the console hands the release it was built as, and the organisation's
 * own links. it wraps the same way the head does: a line too narrow for both ends puts them on two
 * rows starting at the same edge. absent, no strip is drawn,
 * for the same reason the head's absence draws none. it is `.adm-footstrip` and not this route's
 * own class, because ./BareShell.jsx takes the same slot and stands the same strip.
 * @property {boolean | undefined} [bare] the route stands its children on the page's own ground
 * with no panel around them. what qualifies is a route with nothing for a box to hold together:
 * one control, and no second thing on the page — the console's signed-out face is the whole of it.
 * a route carrying a heading, prose, a group of boxes or a run of controls has two things the panel
 * is what gathers, and takes it. the same word as ./BareShell.jsx's, and the same relation: the
 * chrome that would hold nothing is left off rather than drawn empty.
 * @property {ReactNode} [children]
 */

/* the key the rail's collapsed state is kept under, per browser. */
const RAIL_STORAGE_KEY = 'bg-operator-rail';

/* two arrangements from one markup order. below the shell's breakpoint: an identity band across
   the top and a bar of tabs fixed to the foot of the viewport, one tab per destination on a row
   that never wraps — a tab is an equal share of the width whatever the count, so what bounds how
   many the bar holds is the share each is left with at the 375px floor rather than a number
   written anywhere. the bar is flat: groups, marks and headings are the column's. above it: a
   left column with the identity and the collapse toggle at its head, the grouped destinations,
   and the foot; the page is an inset panel beside it.
   the identity slot renders the operating organisation's legal name — there is no logo. */
/** @param {AppShellProps} props */
export function AppShell({
	org = 'Riverbank Trust',
	under,
	current,
	groups = [
		{ destinations: [{ label: 'Dashboard', short: 'Dashboard', mark: 'layout-dashboard' }] },
		{
			destinations: [
				{ label: 'Donation forms', short: 'Forms', mark: 'file-text' },
				{ label: 'Donors', short: 'Donors', mark: 'users' },
				{ label: 'Gifts', short: 'Gifts', mark: 'hand-heart' }
			]
		}
	],
	link,
	wayOut,
	foot,
	head,
	centred = false,
	children
}) {
	/* expanded on the first render wherever it happens, and the stored choice read only after
	   mount: the dashboard renders this on the server, which has no storage, and a first client
	   render that differed from it would not hydrate. storage can be refused (a blocked or private
	   window), and then the rail simply forgets the choice. */
	const [collapsed, setCollapsed] = useState(false);

	useEffect(() => {
		try {
			if (localStorage.getItem(RAIL_STORAGE_KEY) === 'collapsed') setCollapsed(true);
		} catch {
			// storage refused: the rail stays expanded.
		}
	}, []);

	function toggle() {
		const next = !collapsed;
		try {
			localStorage.setItem(RAIL_STORAGE_KEY, next ? 'collapsed' : 'expanded');
		} catch {
			// storage refused: the choice holds for this page only.
		}
		setCollapsed(next);
	}

	/* one statement for the whole rail, so at most one cell can claim the reader. both kinds keep
	   `is-current`: the section is marked exactly as the page and only what is read out differs,
	   so a reader who can see the rail loses nothing to the distinction and a reader who cannot
	   stops being told the section is the screen. packages/operator/src/styles/adm.css draws the
	   tint off a bare `[aria-current]` and off `.is-current`, and neither reads the kind. */
	/** @type {Whereabouts | undefined} */
	const at = typeof current === 'string' ? { label: current, kind: 'page' } : current;

	/* settled once and drawn in both slots, so the two cannot disagree about which control the way
	   out is. the specimen's own button carries `.adm-signout` for the same reason a caller's node
	   does — the band needs it to keep from shrinking, and the icon rail keys its foot off it. */
	/** @type {ReactNode} */
	const out =
		wayOut === undefined ? (
			<Button variant="quiet" size="sm" mark="log-out" className="adm-signout">
				<span className="adm-signout__word">Sign out</span>
			</Button>
		) : (
			wayOut
		);

	/* the same node as the band's when no foot is handed, because the way out is one control drawn
	   at two widths and only one of them is ever visible: the sheet hides the band above 64rem and
	   the foot below it. a foot that comes to nothing is dropped rather than stood empty: the box
	   draws its own rule and its own padding, so left in place it is a divider at the end of the
	   column with nothing under it. */
	/** @type {ReactNode} */
	const footing = foot === undefined ? out : foot;

	return (
		<div className={collapsed ? 'adm-shell adm-shell--collapsed' : 'adm-shell'}>
			<div className="adm-identity">
				<div className="adm-rail__who">
					<div className="adm-identity__name">{org}</div>
					{under}
				</div>
				{out}
			</div>
			<nav className="adm-rail" aria-label="Sections">
				<div className="adm-rail__identity">
					<div className="adm-rail__who">
						<div className="adm-identity__name">{org}</div>
						{under}
					</div>
					<span className="adm-rail__togglebox">
						<Button
							type="button"
							variant="quiet"
							size="sm"
							mark="panel-left"
							className="adm-rail__toggle"
							aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
							aria-expanded={!collapsed}
							onClick={toggle}
						/>
					</span>
				</div>
				<div className="adm-rail__cells">
					{groups.map((group, index) => (
						<RailGroup
							key={group.heading ?? `group-${index}`}
							group={group}
							rule={ruleBefore(group, groups[index - 1])}
							at={at}
							link={link}
							collapsed={collapsed}
						/>
					))}
				</div>
				{footing === null ? null : <div className="adm-rail__foot">{footing}</div>}
			</nav>
			<main className="adm-main">
				{head === undefined || head === null ? null : (
					<div className="adm-head">
						<div className="adm-headstrip">{head}</div>
					</div>
				)}
				<div className={centred ? 'adm-panelbody adm-main--centred' : 'adm-panelbody'}>
					{children}
				</div>
			</main>
		</div>
	);
}

/**
 * what stands before a group: nothing before the first, the headed rule before a headed group,
 * nothing after a headed group (its last entry already stands a step apart), and a plain rule
 * between any other two.
 *
 * @param {DestinationGroup} group
 * @param {DestinationGroup | undefined} previous
 * @returns {'none' | 'plain' | 'group'}
 */
function ruleBefore(group, previous) {
	if (previous === undefined) return 'none';
	if (group.heading !== undefined) return 'group';
	if (previous.heading !== undefined) return 'none';
	return 'plain';
}

/**
 * @typedef {object} RailGroupProps
 * @property {DestinationGroup} group
 * @property {'none' | 'plain' | 'group'} rule
 * @property {Whereabouts | undefined} at
 * @property {ComponentType<DestinationLinkProps> | undefined} link
 * @property {boolean} collapsed
 */

/* one group's run of cells, flat inside `.adm-rail__cells` so the bar can stand every entry as a
   tab of its own. */
/** @param {RailGroupProps} props */
function RailGroup({ group, rule, at, link, collapsed }) {
	const { heading, destinations } = group;
	return (
		<>
			{rule === 'plain' ? <hr className="adm-rail__rule" /> : null}
			{rule === 'group' ? <hr className="adm-rail__rule adm-rail__rule--group" /> : null}
			{heading === undefined ? null : <span className="adm-rail__heading">{heading}</span>}
			{destinations.map((d, i) => (
				<DestinationCell
					key={d.label}
					short={d.short}
					href={d.href}
					mark={d.mark}
					status={d.status}
					title={collapsed ? d.label : undefined}
					groupEnd={heading !== undefined && i === destinations.length - 1}
					link={link}
					current={at && d.label === at.label ? at.kind : undefined}
				>
					{d.label}
				</DestinationCell>
			))}
		</>
	);
}

/* a route outside the shell: sign-in and the error pages are one composition — a centred panel
   carrying a heading, one field and one action.

   `bare` is that composition with the panel left off, and it is a state rather than a way past the
   box: what the panel does is hold several things together, so a route with one control and nothing
   else on it has a box drawing a boundary around a single press. the middle row stays either way —
   the strips are tracked by which of them is there and the panel's row is the one that grows, so a
   route that put its children straight into the grid would hand two of them a row each and centre
   neither. */
/** @param {PanelRouteProps} props */
export function PanelRoute({ bar, foot, bare = false, children }) {
	return (
		<div className="adm-panelroute">
			{/* each strip is the row it is written in — ../../styles/adm.css places nothing by name, the
			    same way ./BareShell.jsx's bar is that shell's first row — so the head stands before the
			    panel and the foot after it. a route handed no strip draws none rather than an empty one:
			    the row would stand at that edge with nothing in it, and the panel would centre in what
			    is left beside a strip nobody can see. the sheet tracks all three combinations that carry
			    one, so a route with a foot and no head is a panel centred over its foot rather than one
			    dropped into the top row. */}
			{bar === undefined ? null : (
				<div className="adm-head">
					<div className="adm-headstrip">{bar}</div>
				</div>
			)}
			{bare ? (
				<div className="adm-panelroute__bare">{children}</div>
			) : (
				<div className="adm-panel">{children}</div>
			)}
			{foot === undefined ? null : <div className="adm-footstrip">{foot}</div>}
		</div>
	);
}
