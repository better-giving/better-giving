import type { ShouldRevalidateFunctionArgs } from 'react-router';

// the suggest route's address, and the editor's loaders let alone after an ask of it: the ask
// writes nothing (src/routes/_app.admin.pages.$pageId.suggest.ts), so nothing a loader read has
// moved. kept apart from ./suggest.tsx so the layout route above the editors takes it without the
// rich-text editor.

/** the suggest route for the page `pageId`. */
export const suggestUrl = (pageId: string) => `/admin/pages/${pageId}/suggest`;

const SUGGEST_PATH = /^\/admin\/pages\/[^/]+\/suggest$/;

/** a route's `shouldRevalidate` on the editor's screen: as react router would, except after an ask. */
export function revalidatesAfter({
	formAction,
	defaultShouldRevalidate
}: ShouldRevalidateFunctionArgs): boolean {
	return formAction !== undefined && SUGGEST_PATH.test(formAction)
		? false
		: defaultShouldRevalidate;
}
