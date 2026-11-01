import { z } from 'zod';
import { SECTION_DATA } from '../../page/catalog';
import { FEATURE_EXTRAS, STORY_THRESHOLD } from '../../page/shape';
import { CONTENT_KEYS, type ContentKey } from './campaigns';

// `content.catalog`: every content key a page holds, what it shows a donor, and the JSON Schema of
// its value as the page rule holds it (../../page/catalog.ts), so a chat writes content the rule
// takes; and how the page picks its layout from that content, since no chat picks one. a campaign
// holds every key, the donation page its heading alone. a page's own rules beyond a key's shape are
// refused at the write, naming the key.

const DESCRIPTIONS: Record<ContentKey, string> = {
	heading:
		'The page’s title; an empty heading shows the campaign’s name, or “Donate to” the organisation on the donation page.',
	lede: 'A sentence or two under the title; a campaign only.',
	story: 'The story behind the appeal, in rich text; a campaign only.',
	hero: 'The cover photo, the organisation’s logo standing in without one; a campaign only.',
	photos: 'Photos beside the cover; a campaign only.',
	tiers: 'Up to six gift amounts, each with what that gift buys; a campaign only.',
	faq: 'Up to ten questions donors ask, each with its answer; a campaign only.'
};

export type CatalogEntry = {
	readonly key: ContentKey;
	readonly description: string;
	readonly schema: Record<string, unknown>;
};

/** the catalog: the content keys in `CONTENT_KEYS` order, and the layout rule. */
export function contentCatalog() {
	const content: CatalogEntry[] = CONTENT_KEYS.map((key) => ({
		key,
		description: DESCRIPTIONS[key],
		schema: z.toJSONSchema(SECTION_DATA[key], { io: 'input' }) as Record<string, unknown>
	}));
	return {
		content,
		layout: {
			description: `A campaign is drawn in one of three layouts, picked from its content and never set: the card for a story of at most ${STORY_THRESHOLD} characters and nothing else; the letter for a longer story, or one to ${FEATURE_EXTRAS - 1} tiers, questions and photos beside the cover counted together; the feature for ${FEATURE_EXTRAS} or more. The donation page has one fixed layout.`,
			story_threshold: STORY_THRESHOLD,
			feature_extras: FEATURE_EXTRAS
		}
	};
}
