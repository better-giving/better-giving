import type { AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router';

// what a part of the dashboard that navigates is drawn as. ../../routes/_app.tsx hands it to the
// shell for every row of its rail, its mark and its account menu, and each screen to its heading's
// crumbs.
//
// it is here and not in `@better-giving/operator` because that package declares no router and
// cannot — the leaf reaches no surface (AGENTS.md → Workspace). so the surface that has a router
// writes the hop, and this is that hop for the whole dashboard.
//
// it exists at all because a part that settles its own address hands `href` and react router's link
// reads `to`. one hop rather than one per part: every part taking a `link` states its own props
// typedef and all of them agree on an anchor's, so what is typed here is an anchor whose address is
// required. the part settles the address, the class list and anything it announces, and this only
// turns the address into the prop react router's link reads. a plain `<a>` in its place renders the
// same attributes and takes the whole document with it — ./rail-navigates.dom.spec.tsx is where
// the difference is asserted, because nothing in the markup shows it.
//
// **a link pointed at loads its page ahead of the press**: the route's module and its data on hover
// or focus (`prefetch="intent"`), so the line over the press that follows is as short as it can be.

type Addressed = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };

export function RouterLink({ href, ...rest }: Addressed) {
	return <Link to={href} prefetch="intent" {...rest} />;
}
