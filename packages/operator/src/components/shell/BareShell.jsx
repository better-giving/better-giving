import { TopBar } from './TopBar.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { TopBarFact } from './TopBar.jsx'
 */

/**
 * @typedef {object} BareShellProps
 * @property {ReactNode} [head] the whole head as one node, in place of the bar of facts: what
 *   stands on it and what stands under it are the caller's, the way ./AppShell.jsx's `PanelRoute`
 *   takes its `bar`. it is the same `.adm-head` that route stands, so a surface drawing one head on
 *   both hands the same node to both — which is what the console does, from
 *   packages/console-ui/src/lib/head-strip.tsx. handed one, `facts` and `end` are not read: the two
 *   heads are alternatives and a shell drawing both would be two bands over one page.
 * @property {readonly TopBarFact[] | undefined} [facts] the bar's, handed straight to ./TopBar.jsx
 *   — see the note on the prop there. stated on the shell rather than taken as a bar node, the way
 *   ./AppShell.jsx takes `org` rather than an identity band: a run of stated facts is the shell's
 *   own furniture, and the surface that wants a head of its own takes `head` above instead.
 * @property {ReactNode} [end] what acts on the surface, at the bar's far end, handed through the
 *   same way, and `null` is still a bar with no control to draw. absence cannot say that —
 *   ./TopBar.jsx's own note is what argues it, and what may stand there.
 * @property {boolean | undefined} [centred] the screen is one short block and stands in the middle
 *   of the space under the bar rather than at the top of it. what it is for is a screen that is
 *   waiting — nothing has arrived and there is nothing on it to act on — and a screen with anything
 *   to do on it is read from the top. ../../styles/adm.css's `.adm-main--centred` is the rule and
 *   holds why the page rather than the column carries it.
 * @property {ReactNode} [foot] a strip across the foot of the page, under the screen: two children
 *   land at the two ends of it and what they are is the caller's. it wraps — a line too narrow for
 *   both ends puts them on two rows starting at the same edge. absent, no strip
 *   is drawn, because a row standing at the foot of the page with nothing in it is a rule under the
 *   screen and space beneath it. it is the same `.adm-footstrip` ./AppShell.jsx's `PanelRoute`
 *   stands in its own foot slot, so a surface drawing one strip on the shell and the route alike
 *   hands the same node to both.
 * @property {ReactNode} [children] the screen.
 */

/* the shell a surface takes when it has no rail: a bar of facts across the top, the screen under
   it, and the strip of small print a surface may stand at its foot.

   it is a second shell beside ./AppShell.jsx rather than a mode on it, because the two differ in
   what they are for and not in what they draw. a rail is a set of destinations, and a surface whose
   whole product is one screen has none to offer — so the shell that carries one would take every
   destination it has conditionally, and a rail nobody asked for is the shape a screen gets by
   forgetting a prop.

   the bar is ./TopBar.jsx and is not redrawn here: what a head of stated facts looks like is
   settled in one place, and a second copy is how the two surfaces come to disagree about it.
   ../../styles/adm.css draws the shell and says what the bare modifier takes back. */
/** @param {BareShellProps} props */
export function BareShell({ head, facts, end, centred = false, foot, children }) {
	return (
		<div className="adm-shell adm-shell--bare">
			{/* one row either way: the head is the shell's first, and a node handed in stands in the
			    band rather than beside it — the lines a surface puts under its strip are inside the
			    head and the shell's tracks never see them. */}
			{head === undefined ? (
				<TopBar facts={facts} end={end} />
			) : (
				<div className="adm-head">{head}</div>
			)}
			<main className={centred ? 'adm-main adm-main--centred' : 'adm-main'}>{children}</main>
			{/* the last row it is written in, the way the bar is the first: ../../styles/adm.css
			    tracks the shell by whether the strip is there and places nothing by name. */}
			{foot === undefined ? null : <div className="adm-footstrip">{foot}</div>}
		</div>
	);
}
