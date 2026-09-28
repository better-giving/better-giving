// what the editor edits a page's blocks by hand through: the forms a block's sheet and the Settings
// sheet's layout pictures post, and each block as those sheets are drawn from the draft. each form's
// id and rules are here, where the sheets ($lib/admin/editor/block-edit.tsx) post them and the save
// ($lib/server/pages/blocks.ts) states and parses them, and both editors' actions name the ids.
//
// the boxes carry text, and a photo block's the id of a photo already uploaded, and every value is
// the block catalog's to judge (./catalog.ts): the save puts the words into the block and runs the
// page through `parsePage`, so a box and the chat are held to the one rule. a block's variants and
// the page's layouts come from `BLOCKS` and `LAYOUTS`, so a name the catalog drops is a picture
// nobody is offered.
//
// no form here adds, removes or moves a block: arranging the page is the chat's.
//
// pure and not under `$lib/server/**`: a component draws what `editorBlocks` returns.
import { z } from 'zod';
import { formatMinorBrief } from '../donations/money';
import { majorEntry } from '../forms/amounts';
import { plainText, type RichTextDocument } from '../rich-text/document';
import { BLOCKS, type Block, type BlockType, LAYOUTS, type Page } from './catalog';
import type { Layout } from './keys';

export const BLOCK_FORMS = {
	title: 'block-title',
	story: 'block-story',
	impactTiers: 'block-impact-tiers',
	faq: 'block-faq',
	photo: 'block-photo',
	variant: 'block-variant',
	layout: 'page-layout'
} as const;

export type BlockFormId = (typeof BLOCK_FORMS)[keyof typeof BLOCK_FORMS];

/** every form a block's sheet or the layout pictures post, for an editor's `submittedForm`. */
export const BLOCK_FORM_IDS = Object.values(BLOCK_FORMS) as BlockFormId[];

/** a blank heading draws the page's own name, and a blank lede is none. */
export const BLOCK_TITLE_INPUT = z.object({
	block_id: z.string('required'),
	heading: z.string().default(''),
	lede: z.string().default('')
});

/** the story's body, the document's JSON as the rich-text box posts it. */
export const BLOCK_STORY_INPUT = z.object({
	block_id: z.string('required'),
	body: z.string('required')
});

/**
 * the tiers as rows of two boxes, `tier_amount[i]` in major units of the page's currency beside
 * `tier_buys[i]`: two lists, since a form's fields are flat ($lib/server/conform.ts).
 */
export const BLOCK_IMPACT_TIERS_INPUT = z.object({
	block_id: z.string('required'),
	tier_amount: z.array(z.string().default('')),
	tier_buys: z.array(z.string().default(''))
});

/** the questions as rows, `question[i]` beside `answer[i]`, the answer's document as JSON. */
export const BLOCK_FAQ_INPUT = z.object({
	block_id: z.string('required'),
	question: z.array(z.string().default('')),
	answer: z.array(z.string().default(''))
});

/**
 * a hero's or an image block's photo, by the id the images route (src/routes/_app.admin.images.ts)
 * answered its upload with, and what describes it; a blank description is a decorative photo.
 */
export const BLOCK_PHOTO_INPUT = z.object({
	block_id: z.string('required'),
	image_id: z.string('required'),
	alt: z.string().default('')
});

/** a block's variant picture, which applies on pick. */
export const BLOCK_VARIANT_INPUT = z.object({
	block_id: z.string('required'),
	variant: z.string('required')
});

/** the page's layout picture, which applies on pick. */
export const PAGE_LAYOUT_INPUT = z.object({ layout: z.string('required') });

/** a block's words as its sheet's boxes are seeded with them; null for a block with none. */
export type BlockText =
	| { readonly kind: 'title'; readonly heading: string; readonly lede: string }
	| { readonly kind: 'story'; readonly body: RichTextDocument }
	| {
			readonly kind: 'impact-tiers';
			/** the three-letter code the amounts are in. */
			readonly currency: string;
			/** each amount as its box is seeded, major units. */
			readonly tiers: readonly { readonly amount: string; readonly buys: string }[];
	  }
	| {
			readonly kind: 'faq';
			readonly items: readonly { readonly question: string; readonly answer: RichTextDocument }[];
	  }
	| { readonly kind: 'photo'; readonly imageId: string; readonly alt: string };

/** one block of the draft, as the block list and its sheet draw it. */
export type EditorBlock = {
	readonly id: string;
	readonly type: BlockType;
	/** the block's name — Title, Story, Donation box — which is its row's label and its sheet's title. */
	readonly label: string;
	/** a line of what it holds, or `''` for a block that holds nothing typed. */
	readonly summary: string;
	/** the variant it is drawn as, or null for a block with one way to draw it. */
	readonly variant: string | null;
	/** the variants it may take, empty where `variant` is null. */
	readonly variants: readonly Picture[];
	readonly text: BlockText | null;
};

/** a picture a picker offers: the catalog's name, and what the picture is called. */
export type Picture = { readonly value: string; readonly label: string };

/** the draft's blocks in its order; `currency` is the draft's donation settings'. */
export function editorBlocks(draft: Page, currency: string): EditorBlock[] {
	return draft.blocks.map((block) => ({
		id: block.id,
		type: block.type,
		label: BLOCK_LABELS[block.type],
		summary: summaryOf(block, currency),
		...(block.type === 'donation-box'
			? { variant: null, variants: [] }
			: {
					variant: block.variant,
					variants: BLOCKS[block.type].variants.map((name) => ({
						value: name,
						label: VARIANT_LABELS[name]
					}))
				}),
		text: blockText(block, currency)
	}));
}

/** the page's layouts, as the Settings sheet's pictures offer them. */
export function layoutPictures(): Picture[] {
	return LAYOUTS.map((name) => ({ value: name, label: LAYOUT_LABELS[name] }));
}

const LAYOUT_LABELS: Record<Layout, string> = {
	'box-right': 'Box beside',
	banner: 'Banner',
	column: 'Column',
	cover: 'Cover'
};

type VariantName = NonNullable<(typeof BLOCKS)[BlockType]['variants']>[number];

const VARIANT_LABELS: Record<VariantName, string> = {
	left: 'Left',
	center: 'Centred',
	compact: 'Compact',
	plain: 'Plain',
	lede: 'Lead-in',
	split: 'Two columns',
	cards: 'Cards',
	list: 'List',
	accordion: 'Folded',
	open: 'Open',
	stacked: 'Stacked',
	'side-by-side': 'Side by side',
	statement: 'Statement',
	footer: 'Footer',
	card: 'Card',
	buttons: 'Buttons',
	icons: 'Icons',
	bar: 'Bar',
	figure: 'Figure',
	wide: 'Wide',
	framed: 'Framed',
	column: 'Column'
};

/** each block as a fundraiser calls it. */
const BLOCK_LABELS: Record<BlockType, string> = {
	title: 'Title',
	story: 'Story',
	'impact-tiers': 'Impact tiers',
	faq: 'Questions',
	'about-us': 'About us',
	'org-info': 'Organisation details',
	share: 'Share buttons',
	hero: 'Cover photo',
	image: 'Photo',
	'goal-bar': 'Goal',
	'program-chooser': 'Program choice',
	'donation-box': 'Donation box'
};

/** the first words a summary shows; the row cuts what it cannot fit. */
const SUMMARY_MAX = 80;

function summaryOf(block: Block, currency: string): string {
	switch (block.type) {
		case 'title':
			return block.heading === '' ? 'The page’s name' : clipped(block.heading);
		case 'story':
			return clipped(plainText(block.body));
		case 'impact-tiers':
			return block.tiers.map((tier) => formatMinorBrief(tier.amountMinor, currency)).join(', ');
		case 'faq':
			return clipped(block.items.map((item) => item.question).join(' · '));
		case 'hero':
		case 'image':
			return block.imageId === null ? 'No photo yet' : clipped(block.alt ?? '');
		default:
			return '';
	}
}

function clipped(words: string): string {
	const line = words.replace(/\s+/g, ' ').trim();
	return line.length <= SUMMARY_MAX ? line : `${line.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;
}

function blockText(block: Block, currency: string): BlockText | null {
	switch (block.type) {
		case 'title':
			return { kind: 'title', heading: block.heading, lede: block.lede ?? '' };
		case 'story':
			return { kind: 'story', body: block.body };
		case 'impact-tiers':
			return {
				kind: 'impact-tiers',
				currency,
				tiers: block.tiers.map((tier) => ({
					amount: majorEntry(tier.amountMinor, currency),
					buys: tier.buys
				}))
			};
		case 'faq':
			return { kind: 'faq', items: block.items };
		// a photo is replaced where one is placed; placing the first is the chat's.
		case 'hero':
		case 'image':
			return block.imageId === null
				? null
				: { kind: 'photo', imageId: block.imageId, alt: block.alt ?? '' };
		default:
			return null;
	}
}
