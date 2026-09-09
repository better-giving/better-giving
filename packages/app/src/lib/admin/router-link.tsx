import type { AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router';

// what a part of the dashboard that navigates is drawn as. ../../routes/_app.tsx hands it to every
// cell of the shell's rail, and every screen standing under a section hands it to its back link.
//
// it is here and not in `@better-giving/operator` because that package declares no router and
// cannot — the graph is `app → operator ← console` and the leaf reaches neither surface (CLAUDE.md).
// so the surface that has a router writes the hop, and this is that hop for the whole dashboard.
//
// it exists at all because a part that settles its own address hands `href` and react router's link
// reads `to`. a part that settles no address needs none: packages/console-ui/src/lib/connect-panel.tsx
// hands `Link` straight into `Button`'s `as` and writes `to` at the call site.
//
// one hop rather than one per part: every part taking a `link` states its own props typedef and all
// of them agree on an anchor's, so what is typed here is an anchor whose address is required. the
// part settles the address, the class list and anything it announces, and this only turns the
// address into the prop react router's link reads. a plain `<a>` in its place renders the same
// attributes and takes the whole document with it — ./rail-navigates.dom.spec.tsx and
// ./back-navigates.dom.spec.tsx are where the difference is asserted, because nothing in the markup
// shows it.

type Addressed = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };

export function RouterLink({ href, ...rest }: Addressed) {
	return <Link to={href} {...rest} />;
}
