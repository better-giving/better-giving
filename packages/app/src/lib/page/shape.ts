// which whole layout a campaign is drawn in, picked from what its content holds and never by the
// organisation: there is no layout to choose, only words, photos, tiers and questions to add. a
// fresh campaign is the card, and the page grows into the letter and the feature as content is
// added.
//
// two measures decide it. `storyLength` is the story's plain text, counted in characters. `extras`
// counts the impact tiers, the questions and the photos beside the cover photo.
//
// - card: a story of at most `STORY_THRESHOLD` characters and no extras.
// - letter: a longer story, or one to three extras.
// - feature: `FEATURE_EXTRAS` extras or more, whatever the story's length.
//
// the cover photo falls back to the organisation's logo, and to none where it has no logo. the
// goal bar is drawn only where a goal is set, and the feature closes on About us where the
// organisation has written a mission or a vision. ../donate/page-view.tsx draws what this returns.
//
// pure and not under `$lib/server/**`: the renderer and its specs read it alike.
import { plainText } from '../rich-text/document';
import type { Page } from './catalog';

/** the longest story the card holds; a longer one is a letter. */
export const STORY_THRESHOLD = 320;
/** the fewest extras the feature is drawn for. */
export const FEATURE_EXTRAS = 4;

export const LAYOUTS = ['card', 'letter', 'feature'] as const;
export type Layout = (typeof LAYOUTS)[number];

/** what the campaign's cover is drawn from. */
export type Cover =
	| { readonly source: 'photo'; readonly imageId: string; readonly alt: string | null }
	| { readonly source: 'logo'; readonly imageId: string }
	| null;

export type CampaignShape = {
	readonly layout: Layout;
	readonly storyLength: number;
	readonly extras: number;
	readonly cover: Cover;
	readonly goalBar: boolean;
	readonly aboutUs: boolean;
};

/** what the shape reads of the organisation. */
export type ShapeOrg = {
	/** the stored logo's image id, or null for none. */
	readonly logoImageId: string | null;
	/** the organisation has written a mission or a vision. absent reads as none. */
	readonly hasMission?: boolean | undefined;
};

/** the story's length in characters of plain text; an absent story is 0. */
export function storyLength(page: Pick<Page, 'story'>): number {
	return page.story === undefined ? 0 : plainText(page.story).trim().length;
}

/** the tiers, the questions and the photos beside the cover. */
export function extrasOf(page: Pick<Page, 'tiers' | 'faq' | 'photos'>): number {
	return (page.tiers?.length ?? 0) + (page.faq?.length ?? 0) + (page.photos?.length ?? 0);
}

/** the layout two measures pick. */
export function thresholdLayout(story: number, extras: number): Layout {
	if (extras >= FEATURE_EXTRAS) return 'feature';
	if (story > STORY_THRESHOLD || extras > 0) return 'letter';
	return 'card';
}

export function campaignShape(page: Page, org: ShapeOrg): CampaignShape {
	const story = storyLength(page);
	const extras = extrasOf(page);
	const layout = thresholdLayout(story, extras);
	const cover: Cover =
		page.hero !== undefined
			? { source: 'photo', imageId: page.hero.imageId, alt: page.hero.alt }
			: org.logoImageId !== null
				? { source: 'logo', imageId: org.logoImageId }
				: null;
	return {
		layout,
		storyLength: story,
		extras,
		cover,
		goalBar: page.goalMinor !== undefined,
		aboutUs: layout === 'feature' && org.hasMission === true
	};
}
