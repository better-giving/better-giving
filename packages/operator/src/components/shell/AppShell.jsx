import { Dialog } from '@ark-ui/react/dialog';
import { useEffect, useId, useRef, useState } from 'react';
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
 * @property {boolean | undefined} [bar] a tab on the phone's bar. where any destination in the rail
 * carries it, the bar draws those and a More tab opening a sheet with the rest; where none does,
 * the bar draws every destination. the column at the wide width draws every one either way.
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
 * @property {ReactNode} org the operating organisation's legal name. there is no logo. it has no
 * default, and neither has `groups`: a shell that filled either in would put a fictional
 * organisation and its rail on a real deployment whose surface forgot to state its own.
 * @property {string | undefined} [site] the address of the deployment's dashboard. drawn as a globe
 * leading the name, in the narrow band and the rail's head alike, opening in a new tab: the address
 * is its `title` and never printed. the console hands it; the dashboard hands nothing.
 * @property {string | Whereabouts | undefined} [current] the destination the reader is in: a bare
 * word is the `label`, and the page itself. absent, the reader is in none of them and no cell is
 * marked — which is what a surface hands for an address under no destination, and is the only
 * honest rail to draw there.
 * @property {readonly DestinationGroup[]} groups
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
 * @property {ReactNode} [head] the panel's strip, over the page: `.adm-headstrip`, holding what the
 * caller hands it — the dashboard's trail of pages on a nested screen. absent, no strip: a screen
 * named by its tab title and its marked rail cell has nothing for one to add.
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
   the top and a bar of tabs fixed to the foot of the viewport on a row that never wraps — a tab is
   an equal share of the width whatever the count, so what bounds how many the bar holds is the
   share each is left with at the 375px floor rather than a number written anywhere. a rail whose
   destinations state `bar` puts those on it and ends it with More, which opens a sheet holding the
   rest in the column's order, under the column's rules and headings; a rail stating none has a tab
   per destination. the bar itself is flat: groups, marks and headings are the column's and the
   sheet's. above it: a left column with the identity and the collapse toggle at its head, the
   grouped destinations, and the foot; the page is a panel filling the rest of the window beside
   it.
   the identity slot renders the operating organisation's legal name — there is no logo. */
/** @param {AppShellProps} props */
export function AppShell({
	org,
	site,
	current,
	groups,
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
	const [sheetOpen, setSheetOpen] = useState(false);
	/** @type {import('react').RefObject<HTMLButtonElement | null>} */
	const moreTab = useRef(null);
	/** @type {import('react').RefObject<HTMLElement | null>} */
	const railBox = useRef(null);
	const mainId = useId();
	/** @type {import('react').RefObject<HTMLElement | null>} */
	const page = useRef(null);

	/* the sheet closes when the tab that opened it stops being drawn — a window widened past the
	   shell's breakpoint, a tablet turned on its side — because a modal left open under a column
	   that has no More holds the keyboard in something nobody can see. the tab's own boxes are the
	   signal: `display: none` leaves it none, and no width is restated here. */
	useEffect(() => {
		const tab = moreTab.current;
		if (!sheetOpen || tab === null) return;
		const watch = new ResizeObserver(() => {
			if (tab.getClientRects().length === 0) setSheetOpen(false);
		});
		watch.observe(tab);
		return () => watch.disconnect();
	}, [sheetOpen]);

	/* and it closes on a step through the history — Back and Forward, a phone's Back included —
	   because a sheet left open over a page it was not opened on holds the keyboard in front of the
	   wrong screen. the step is heard as it happens rather than read off `current`, since a step
	   between two addresses under one destination hands this shell the `current` it already had. */
	useEffect(() => {
		if (!sheetOpen) return;
		const stepped = () => setSheetOpen(false);
		window.addEventListener('popstate', stepped);
		return () => window.removeEventListener('popstate', stepped);
	}, [sheetOpen]);

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

	/* the destination the sheet was last drawn under. a surface handing a different one has moved
	   the reader — a move the page itself made, with no press in the sheet — and the sheet comes
	   down in the same render rather than a frame after it. */
	const whereabouts = at === undefined ? '' : `${at.kind} ${at.label}`;
	const [drawnAt, setDrawnAt] = useState(whereabouts);
	if (drawnAt !== whereabouts) {
		setDrawnAt(whereabouts);
		setSheetOpen(false);
	}

	const barred = groups.some((group) => group.destinations.some((d) => d.bar));
	const sheet = barred ? offBar(groups) : [];
	/* the tab stands for every destination it opens, so it claims containment while the reader is
	   in any of them: it is never the page itself. */
	const inSheet =
		at !== undefined && sheet.some((group) => group.destinations.some((d) => d.label === at.label));

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

	/* one row at both widths: the site's globe, the name cut to one line, and the control at the far
	   end. the name's `title` is the whole of it wherever the cut takes the end off. */
	/** @type {ReactNode} */
	const lead =
		site === undefined ? null : (
			<span className="adm-rail__lead">
				<Button
					as="a"
					href={site}
					target="_blank"
					rel="noreferrer"
					variant="quiet"
					size="sm"
					mark="globe"
					aria-label="Open dashboard"
					title={site}
				/>
			</span>
		);
	const name = (
		<div className="adm-identity__name" title={typeof org === 'string' ? org : undefined}>
			{org}
		</div>
	);

	const rail = (
		<nav className="adm-rail" aria-label="Sections" ref={railBox}>
			<div className="adm-rail__identity">
				{lead}
				{name}
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
						barred={barred}
						onChoose={barred ? () => setSheetOpen(false) : undefined}
					/>
				))}
				{barred ? (
					<Dialog.Trigger
						ref={moreTab}
						className="adm-dest adm-rail__more"
						aria-current={inSheet ? 'true' : undefined}
					>
						<span className="adm-dest__short">More</span>
						<span className="adm-dest__full">More</span>
					</Dialog.Trigger>
				) : null}
			</div>
			{footing === null ? null : <div className="adm-rail__foot">{footing}</div>}
		</nav>
	);

	return (
		<div className={collapsed ? 'adm-shell adm-shell--collapsed' : 'adm-shell'}>
			{/* the first stop, and the way past the identity and every destination the rail holds. it
			    points at the page's own id, so it works before the script arrives; once it has, the
			    press moves focus itself and leaves the address alone, because a fragment on the address
			    is a history entry, and Back would then land on this same page rather than leave it. */}
			<Button
				as="a"
				href={`#${mainId}`}
				className="adm-skip"
				onClick={(/** @type {import('react').MouseEvent} */ event) => {
					event.preventDefault();
					page.current?.focus();
				}}
			>
				Skip to content
			</Button>
			<div className="adm-identity">
				{lead}
				{name}
				{out}
			</div>
			{barred ? (
				<Dialog.Root
					open={sheetOpen}
					onOpenChange={(details) => setSheetOpen(details.open)}
					aria-label="More"
					lazyMount
					unmountOnExit
					persistentElements={[() => railBox.current]}
				>
					{/* before the bar in the markup and at its step (../../styles/adm.css, `.adm-rail`), so
					    the bar draws over the scrim rather than under it — undimmed, and live: the bar is
					    the machine's persistent element, so a tab pressed while the sheet is open goes
					    where it says and its cell closes the sheet on the way. while it is open the
					    machine hides everything but the sheet from the tree, and a press anywhere else
					    outside it closes it. */}
					<Dialog.Backdrop className="adm-sheetscrim" />
					<Dialog.Positioner>
						<Dialog.Content className="adm-sheet">
							<nav className="adm-sheet__cells" aria-label="More sections">
								{sheet.map((group, index) => (
									<RailGroup
										key={group.heading ?? `group-${index}`}
										group={group}
										rule={ruleBefore(group, sheet[index - 1])}
										at={at}
										link={link}
										collapsed={false}
										barred={false}
										onChoose={() => setSheetOpen(false)}
									/>
								))}
							</nav>
							{/* last in the tab order and drawn under the last row: the way out for a reader
							    with no Escape to send, which a phone's screen reader is — whose cursor
							    reaches a control without focusing it, so one drawn only on focus would be a
							    point a finger cannot find. */}
							<Dialog.CloseTrigger className="adm-btn adm-btn--quiet adm-btn--sm adm-sheet__close">
								Close
							</Dialog.CloseTrigger>
						</Dialog.Content>
					</Dialog.Positioner>
					{rail}
				</Dialog.Root>
			) : (
				rail
			)}
			<main className="adm-main" id={mainId} tabIndex={-1} ref={page}>
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
 * the rail's groups with every bar destination taken out, and a group left with none dropped: what
 * the sheet stands, rules and headings still decided by `ruleBefore` over what remains.
 *
 * @param {readonly DestinationGroup[]} groups
 * @returns {DestinationGroup[]}
 */
function offBar(groups) {
	return groups
		.map((group) => ({ ...group, destinations: group.destinations.filter((d) => !d.bar) }))
		.filter((group) => group.destinations.length > 0);
}

/**
 * @typedef {object} RailGroupProps
 * @property {DestinationGroup} group
 * @property {'none' | 'plain' | 'group'} rule
 * @property {Whereabouts | undefined} at
 * @property {ComponentType<DestinationLinkProps> | undefined} link
 * @property {boolean} collapsed
 * @property {boolean} barred hide from the bar the cells it leaves to the More sheet: the rail's own
 *   run in a rail whose destinations state `bar`, and never the sheet's.
 * @property {(() => void) | undefined} [onChoose] a press on any cell — the sheet's close, from a
 *   cell in the sheet or a tab on the bar pressed while it is open.
 */

/* one group's run of cells, flat inside `.adm-rail__cells` so the bar can stand every entry as a
   tab of its own, and inside `.adm-sheet__cells` for the More sheet's rows.

   a headed group's heading and cells are one `group` named by the heading, so a reader moving
   through the links hears which group they are in rather than meeting the heading as loose text
   before them. the element is `.adm-rail__group`, which ../../styles/adm.css draws as
   `display: contents`: it is in the accessibility tree and out of the layout, so the bar still
   stands each entry as a tab and the column and the sheet still lay the entries out in their own
   grid. an unheaded group has no name to be a group by and draws no element.

   a headed group none of whose cells is a tab is `--offbar` in the bar's run, and
   ../../styles/adm.css hides it on the bar as it hides the cells: `display: contents` keeps a box
   out of the layout and not out of the tree, so it would stand on the bar as a named group
   holding nothing. */
/** @param {RailGroupProps} props */
function RailGroup({ group, rule, at, link, collapsed, barred, onChoose }) {
	const { heading, destinations } = group;
	const headingId = useId();
	const cells = destinations.map((d, i) => (
		<DestinationCell
			key={d.label}
			short={d.short}
			href={d.href}
			mark={d.mark}
			status={d.status}
			title={collapsed ? d.label : undefined}
			groupEnd={heading !== undefined && i === destinations.length - 1}
			offBar={barred && !d.bar}
			onClick={onChoose}
			link={link}
			current={at && d.label === at.label ? at.kind : undefined}
		>
			{d.label}
		</DestinationCell>
	));
	return (
		<>
			{rule === 'plain' ? <hr className="adm-rail__rule" /> : null}
			{rule === 'group' ? <hr className="adm-rail__rule adm-rail__rule--group" /> : null}
			{heading === undefined ? (
				cells
			) : (
				/* biome-ignore lint/a11y/useSemanticElements: a `<fieldset>` groups a form's own
				   controls, and these are links to other pages — read as one, the rail would be a
				   question with nothing to answer. */
				<div
					className={
						barred && !destinations.some((d) => d.bar)
							? 'adm-rail__group adm-rail__group--offbar'
							: 'adm-rail__group'
					}
					role="group"
					aria-labelledby={headingId}
				>
					<span className="adm-rail__heading" id={headingId}>
						{heading}
					</span>
					{cells}
				</div>
			)}
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
			{/* the page is the main region whichever way it stands, so a reader can jump past the
			    strips to it — ./BareShell.jsx's `main` is the same landmark. */}
			{bare ? (
				<main className="adm-panelroute__bare">{children}</main>
			) : (
				<main className="adm-panel">{children}</main>
			)}
			{foot === undefined ? null : <div className="adm-footstrip">{foot}</div>}
		</div>
	);
}
