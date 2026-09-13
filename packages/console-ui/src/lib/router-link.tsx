import type { DestinationGroup } from '@better-giving/operator/components/shell/AppShell';
import type { LinkProps } from 'react-router';
import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { opening } from './progress-bar';

// what the rail's cells are drawn as on this console: the `link` ../routes/_sections.tsx hands
// `AppShell`.
//
// it is here and not in `@better-giving/operator` because that package declares no router and
// cannot (CLAUDE.md: the graph is `app → operator ← console-ui`), and it exists at all because such a
// part hands `href` where react router's link reads `to`. a plain `<a>` in its place renders the same
// attributes and loads the whole document again, which throws away every reading this console holds
// (../internal-links.spec.ts).
//
// **a move names the page it opens.** the bar over a move reads its words off the link's history
// state (./progress-bar.ts), and a cell hands its link only the address — so the rail's labels stand
// in a context over the shell, keyed by that address, and a cell with none there moves as `Opening`.

export type RouterLinkProps = Omit<LinkProps, 'to'> & { href: string };

const RailLabels = createContext<ReadonlyMap<string, string>>(new Map());

/** the rail's labels by address, over the shell whose cells are drawn as {@link RouterLink}. */
export function RailLabelsProvider({
	groups,
	children
}: {
	groups: readonly DestinationGroup[];
	children: ReactNode;
}): ReactNode {
	const labels = new Map<string, string>();
	for (const destination of groups.flatMap((group) => group.destinations)) {
		if (destination.href !== undefined) labels.set(destination.href, destination.label);
	}
	return <RailLabels.Provider value={labels}>{children}</RailLabels.Provider>;
}

export function RouterLink({ href, ...rest }: RouterLinkProps) {
	const label = useContext(RailLabels).get(href);
	return (
		<Link
			to={href}
			state={label === undefined ? undefined : opening(`Opening ${label}`)}
			{...rest}
		/>
	);
}
