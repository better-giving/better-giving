import { DestinationCell } from './DestinationCell.jsx';
import { Button } from '../controls/Button.jsx';

/**
 * @import { ComponentType, ReactNode } from 'react'
 * @import { DestinationLinkProps } from './DestinationCell.jsx'
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
 * @property {ReactNode} [tagline]
 * @property {string | Whereabouts | undefined} [current] the destination the reader is in: a bare
 * word is the `label`, and the page itself. absent, the reader is in none of them and no cell is
 * marked — which is what a surface hands for an address under no destination, and is the only
 * honest rail to draw there.
 * @property {readonly (string | Destination)[] | undefined} [destinations]
 * @property {ComponentType<DestinationLinkProps> | undefined} [link] what every cell in the rail
 * is drawn as, handed straight to ./DestinationCell.jsx — see the note on the prop there for why
 * this package takes one rather than importing a router's link. a surface that leaves it unstated
 * gets plain anchors and a rail of full document loads that renders identically.
 * @property {boolean | undefined} [centred] the screen is one short block and stands in the middle
 * of the space under the head rather than at the top of it. what it is for is a screen that is
 * waiting — nothing has arrived and there is nothing on it to act on — and a screen with anything
 * to do on it is read from the top. ../../styles/adm.css's `.adm-main--centred` is the rule and
 * holds why the page rather than the column carries it.
 * @property {ReactNode} [signOut] the way out, which the shell draws twice — see the note on the
 * slot below. unstated, it is the quiet button a specimen shows; `null` is a surface that has no
 * way out to draw at all, and the console is one — it runs on the operator's own machine with no
 * session to end, so a button there would be a control over nothing. absence cannot say that: a
 * slot with a default of its own reads nothing stated as a request for the default.
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

/* two arrangements from one markup order. below the shell's breakpoint: an identity band across
   the top and a bar of tabs fixed to the foot of the viewport, one tab per destination on a row
   that never wraps — a tab is an equal share of the width whatever the count, so what bounds how
   many the bar holds is the share each is left with at the 375px floor rather than a number
   written anywhere. above it: a left column with the identity at its head and a low-emphasis
   sign-out pinned to its foot.
   the identity slot renders the operating organisation's legal name — there is no logo. */
/** @param {AppShellProps} props */
export function AppShell({
	org = 'Riverbank Trust',
	tagline = 'better-giving',
	current,
	destinations = [
		{ label: 'Forms', short: 'Forms' },
		{ label: 'Donors', short: 'Donors' },
		{ label: 'Gifts', short: 'Gifts' },
		{ label: 'Settings', short: 'Set up' }
	],
	link,
	signOut,
	centred = false,
	children
}) {
	/* one statement for the whole rail, so at most one cell can claim the reader. both kinds keep
	   `is-current`: the section is marked exactly as the page and only what is read out differs,
	   so a reader who can see the rail loses nothing to the distinction and a reader who cannot
	   stops being told the section is the screen. packages/operator/src/styles/adm.css draws the
	   band off a bare `[aria-current]` and off `.is-current`, and neither reads the kind. */
	/** @type {Whereabouts | undefined} */
	const at = typeof current === 'string' ? { label: current, kind: 'page' } : current;

	/* settled once and drawn in both slots, so the two cannot disagree about which control the way
	   out is. the specimen's own button carries `.adm-signout` for the same reason a caller's node
	   does — the band needs it and the foot is unreached by it. */
	/** @type {ReactNode} */
	const wayOut =
		signOut === undefined ? (
			<Button variant="quiet" size="sm" className="adm-signout">
				Sign out
			</Button>
		) : (
			signOut
		);

	return (
		<div className="adm-shell">
			<div className="adm-identity">
				<div>
					<div className="adm-identity__name">{org}</div>
					<div className="adm-identity__sub">{tagline}</div>
				</div>
				{wayOut}
			</div>
			<nav className="adm-rail" aria-label="Sections">
				<div className="adm-rail__identity">
					<div className="adm-identity__name">{org}</div>
					<div className="adm-identity__sub">{tagline}</div>
				</div>
				<div className="adm-rail__cells">
					{destinations.map((d) => {
						const label = typeof d === 'string' ? d : d.label;
						const short = typeof d === 'string' ? undefined : d.short;
						const href = typeof d === 'string' ? undefined : d.href;
						return (
							<DestinationCell
								key={label}
								short={short}
								href={href}
								link={link}
								current={at && label === at.label ? at.kind : undefined}
							>
								{label}
							</DestinationCell>
						);
					})}
				</div>
				{/* the same node in both slots, because the way out is one control drawn at two widths
				    and only one of them is ever visible: the sheet hides the band above 64rem and the
				    foot below it. a caller passing a form gives it `.adm-signout`, which the band needs
				    to keep it from shrinking and which reaches nothing in the foot's block flow.

				    a surface with no way out drops the foot rather than standing an empty one: the
				    box draws its own rule and its own padding, so left in place it is a divider at
				    the end of the column with nothing under it. the band above needs no such test —
				    it carries the identity whatever else it holds. */}
				{wayOut === null ? null : <div className="adm-rail__foot">{wayOut}</div>}
			</nav>
			<main className={centred ? 'adm-main adm-main--centred' : 'adm-main'}>{children}</main>
		</div>
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
