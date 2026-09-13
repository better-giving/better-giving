import { type UIMatch, useMatches } from 'react-router';

// the trail of pages above a console screen, which each screen states through its route module's
// `handle` (https://reactrouter.com/how-to/using-handle).
//
// a screen's handle states its whole trail, home first, rather than only its own crumb: the
// processor screens are `payments_.*` precisely so that ../routes/payments.tsx is not their
// ancestor, so the matched routes alone never reach the page above.

export type Crumb = { href: string; label: string };

/** what a route module exports as `handle`, typed with that route's loader data. */
export type CrumbHandle<Data = unknown> = {
	crumbs: (match: UIMatch<Data>) => readonly Crumb[];
};

function carriesCrumbs(handle: unknown): handle is CrumbHandle {
	return typeof handle === 'object' && handle !== null && 'crumbs' in handle;
}

/** the trail the deepest matched route states, or none where no route states one. */
export function useCrumbs(): readonly Crumb[] {
	const match = useMatches().findLast((each) => carriesCrumbs(each.handle));
	return match && carriesCrumbs(match.handle) ? match.handle.crumbs(match) : [];
}
