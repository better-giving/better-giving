import { Breadcrumbs } from '@better-giving/operator/components/controls/Breadcrumbs';
import { type UIMatch, useMatches } from 'react-router';
import { RouterLink } from './router-link';

// the trail of pages above a dashboard screen, which each screen states through its route module's
// `handle` (https://reactrouter.com/how-to/using-handle) and ./crumbs.dom.spec.tsx holds per screen.
//
// a screen's handle states its whole trail, section first, rather than only its own crumb: no list
// screen is a route ancestor of its detail screen — there is no `_app.admin.forms.tsx` layout — so
// the matched routes alone never reach the section above.

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

/** the trail drawn, with the dashboard's router link so a press stays in the running app. */
export function ScreenCrumbs() {
	return <Breadcrumbs items={useCrumbs()} link={RouterLink} />;
}
