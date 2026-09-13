import type { AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router';

// what an operator part that settles its own address is drawn as on this console — the back link on
// each processor screen (../routes/payments_.stripe.tsx, ../routes/payments_.paypal.tsx).
//
// it is here and not in `@better-giving/operator` because that package declares no router and
// cannot (CLAUDE.md: the graph is `app → operator ← console-ui`), and it exists at all because such a
// part hands `href` where react router's link reads `to`. a plain `<a>` in its place renders the same
// attributes and loads the whole document again, which throws away every reading this console holds
// (../internal-links.spec.ts).

type Addressed = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };

export function RouterLink({ href, ...rest }: Addressed) {
	return <Link to={href} {...rest} />;
}
