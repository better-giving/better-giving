import type { Corner, Shade } from './keys';

// the editor's Settings sheet as its look, goal, end date and share message post: four forms, each
// under its id where it is posted ($lib/admin/editor/page-settings.tsx) and where it is read
// ($lib/server/pages/page-settings.ts), and named by both editors' actions. a body carries every
// box its form states, blank where the choice needs none.

export const PAGE_LOOK_FORM_ID = 'page-look';
export const PAGE_GOAL_FORM_ID = 'page-goal';
export const PAGE_END_DATE_FORM_ID = 'page-end-date';
export const PAGE_SHARE_FORM_ID = 'page-share-message';

export const PAGE_SETTING_FORM_IDS = [
	PAGE_LOOK_FORM_ID,
	PAGE_GOAL_FORM_ID,
	PAGE_END_DATE_FORM_ID,
	PAGE_SHARE_FORM_ID
] as const;
export type PageSettingFormId = (typeof PAGE_SETTING_FORM_IDS)[number];

/** where a page's look or share message comes from: the Organisation's, or the page's own. */
export const SETTING_SOURCES = ['organisation', 'custom'] as const;

/** a look as the Organisation holds it, and as a page holds its own. */
export type SeedLook = {
	readonly shade: Shade;
	readonly corner: Corner;
	/** lowercase `#rrggbb`, or null for none. */
	readonly brandColour: string | null;
};

/** what the editor's loader hands the look and the share message sheet. */
export type PageSettingsSeed = {
	readonly look: { readonly source: 'organisation' } | ({ readonly source: 'custom' } & SeedLook);
	readonly organisationLook: SeedLook;
	/** the Organisation's share message, or null where it has written none. */
	readonly organisationShareMessage: string | null;
};
