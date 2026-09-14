import { opening } from '@better-giving/operator/progress-bar';
import type { AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { DESTINATIONS } from './destinations';

// what a part of the dashboard that navigates is drawn as. ../../routes/_app.tsx hands it to every
// cell of the shell's rail, and ./crumbs.tsx to the trail the panel's top strip carries over every
// screen under a section.
//
// it is here and not in `@better-giving/operator` because that package declares no router and
// cannot — the graph is `app → operator ← console` and the leaf reaches neither surface (CLAUDE.md).
// so the surface that has a router writes the hop, and this is that hop for the whole dashboard.
//
// it exists at all because a part that settles its own address hands `href` and react router's link
// reads `to`. a part that settles no address needs none: packages/console-ui/src/routes/_index.tsx
// hands `Link` straight into `Button`'s `as` and writes `to` at the call site.
//
// one hop rather than one per part: every part taking a `link` states its own props typedef and all
// of them agree on an anchor's, so what is typed here is an anchor whose address is required. the
// part settles the address, the class list and anything it announces, and this only turns the
// address into the prop react router's link reads. a plain `<a>` in its place renders the same
// attributes and takes the whole document with it — ./rail-navigates.dom.spec.tsx and
// ./crumbs.dom.spec.tsx are where the difference is asserted, because nothing in the markup
// shows it.
//
// **a move names the page it opens.** the bar over a move reads its words off the link's history
// state (packages/operator/src/progress-bar.ts), and a part hands its link only the address — so
// the name is the destination's at that address (./destinations.ts). every link either part draws
// today is a rail cell or a trail's section crumb, both a destination; any other moves as `Opening`.
//
// **a link pointed at loads its page ahead of the press**: the route's module and its data on hover
// or focus (`prefetch="intent"`), so the bar over the press that follows is as short as it can be.

type Addressed = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };

export function RouterLink({ href, ...rest }: Addressed) {
	const label = DESTINATIONS.find((destination) => destination.href === href)?.label;
	return (
		<Link
			to={href}
			prefetch="intent"
			state={label === undefined ? undefined : opening(`Opening ${label}`)}
			{...rest}
		/>
	);
}
