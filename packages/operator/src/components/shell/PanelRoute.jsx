/**
 * @import { ReactNode } from 'react'
 */

/**
 * @typedef {object} PanelRouteProps
 * @property {ReactNode} [bar] a strip across the top of the route, carrying whatever the surface
 * puts in it. the slot positions and composes nothing: two children land at the two ends of the
 * strip and what they are is the caller's. absent, the route is the panel alone and no strip is
 * drawn. it is ../../styles/adm.css's `.adm-head`.
 * @property {ReactNode} [foot] the same strip at the other edge and the same arrangement — two
 * children, one at each end. it wraps the same way the head does: a line too narrow for both ends
 * puts them on two rows starting at the same edge. absent, no strip is drawn, for the same reason
 * the head's absence draws none.
 * @property {boolean | undefined} [bare] the route stands its children on the page's own ground
 * with no panel around them. what qualifies is a route with nothing for a box to hold together:
 * one control, and no second thing on the page. a route carrying a heading, prose, a group of boxes
 * or a run of controls has two things the panel is what gathers, and takes it: the chrome that
 * would hold nothing is left off rather than drawn empty.
 * @property {ReactNode} [children]
 */

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
			{/* each strip is the row it is written in — ../../styles/adm.css places nothing by name —
			    so the head stands before the panel and the foot after it. a route handed no strip draws
			    none rather than an empty one: the row would stand at that edge with nothing in it, and
			    the panel would centre in what is left beside a strip nobody can see. the sheet tracks
			    all three combinations that carry one, so a route with a foot and no head is a panel
			    centred over its foot rather than one dropped into the top row. */}
			{bar === undefined ? null : (
				<div className="adm-head">
					<div className="adm-headstrip">{bar}</div>
				</div>
			)}
			{/* the page is the main region whichever way it stands, so a reader can jump past the
			    strips to it. */}
			{bare ? (
				<main className="adm-panelroute__bare">{children}</main>
			) : (
				<main className="adm-panel">{children}</main>
			)}
			{foot === undefined ? null : <div className="adm-footstrip">{foot}</div>}
		</div>
	);
}
