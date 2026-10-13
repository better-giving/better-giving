import { z } from 'zod';
import { BLOCK_TYPES, type BlockType, block } from '../../page/catalog';

// `blocks.catalog`: every block a page may hold, what it shows a donor, and the JSON Schema of one
// block of that type as the page rule holds it (../../page/catalog.ts), so a chat writes blocks the
// rule takes. the schema is the shape alone: a page's own rules — one donation box, ids unique,
// the goal bar on a campaign only — are refused at the write, naming the block.

const DESCRIPTIONS: Record<BlockType, string> = {
	title:
		'The page’s heading and an optional lede; an empty heading shows the campaign’s name, or “Donate to” the organisation on the donation page.',
	story: 'The story behind the appeal, in rich text.',
	'impact-tiers': 'Up to six gift amounts, each with what that gift buys.',
	faq: 'Up to ten questions donors ask, each with its answer.',
	'about-us': 'What the organisation is about, drawn from its profile.',
	'org-info': 'The organisation’s own details, drawn from its profile.',
	share: 'Buttons for sharing the page, with its share message.',
	hero: 'A large photo at the top of the page.',
	image: 'A photo within the page.',
	'goal-bar': 'A campaign’s progress toward its goal; a campaign only.',
	'program-chooser': 'The programs a donor may give to, to choose one; the donation page only.',
	'donation-box': 'The donation form itself; every page holds exactly one.'
};

export type CatalogEntry = {
	readonly type: BlockType;
	readonly description: string;
	readonly schema: Record<string, unknown>;
};

/** the catalog, in `BLOCK_TYPES` order. */
export function blockCatalog(): CatalogEntry[] {
	return BLOCK_TYPES.map((type) => {
		const arm = block.options.find((option) => option.shape.type.value === type);
		if (arm === undefined) throw new Error(`the page rule has no block ${type}`);
		return {
			type,
			description: DESCRIPTIONS[type],
			schema: z.toJSONSchema(arm, { io: 'input' }) as Record<string, unknown>
		};
	});
}
