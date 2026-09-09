import type { loader as appLayoutLoader } from '../../routes/_app';

/**
 * what a browser tab says a staff screen is: the screen's own name, then whose deployment it is
 * on.
 *
 * the second half is there because an operator has this open beside other tabs and the screen word
 * alone does not say which deployment they are looking at — `Gifts` is every fork's tab. it is the
 * name the identity band already carries, so a title and a frame cannot disagree about it.
 *
 * the name is read off ../../routes/_app.tsx's match rather than re-read from the organisation
 * row. `meta` is handed every match on the way to a screen, the layout's among them, and a second
 * read here would be a database round trip per page view for a value already on the page.
 *
 * `import type` and it has to stay type-only: ../../routes/_app.tsx imports the session gate, and
 * `meta` ships to the browser — a value import here would put D1, the stripe client and this
 * deployment's secrets in the bundle a visitor downloads (../../routes.spec.ts is what reports
 * that). `verbatimModuleSyntax` erases the line as written, so nothing of that route is emitted
 * here and there is no cycle at runtime.
 */
export function screenTitle<M extends { id: string }>(
	screen: string,
	matches: readonly (M | undefined)[]
): string {
	const layout = matches.find(
		(match): match is Extract<M, LayoutMatch> => match?.id === APP_LAYOUT_ROUTE_ID
	);
	return `${screen} · ${layout?.loaderData.orgName ?? APP_NAME}`;
}

/** what the frame and every tab call this deployment before an organisation's name is stored. */
export const APP_NAME = 'Better Giving';

/** the layout every staff screen sits under, spelled as react router ids a route module. */
const APP_LAYOUT_ROUTE_ID = 'routes/_app';

/** as much of that layout's match as a title reads. */
type LayoutMatch = {
	id: typeof APP_LAYOUT_ROUTE_ID;
	loaderData: Awaited<ReturnType<typeof appLayoutLoader>>;
};
