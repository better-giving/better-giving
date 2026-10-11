// what the editor edits a page by hand through: the forms a block's sheet, the block list and the
// Settings sheet's pictures and share boxes post, and the page as those are drawn from the draft.
// every value a page document holds but its donation settings and switches, goal, end date and
// name — which $lib/server/pages/editor.ts, page-settings.ts and the editor routes write — has a
// form here. each form's id and rules are here, where the sheets ($lib/admin/editor/block-edit.tsx)
// post them and the save ($lib/server/pages/blocks.ts) states and parses them, and both editors'
// actions name the ids.
//
// the boxes carry text, names from closed sets, and a photo block's the id of a photo already
// uploaded, and every value is the block catalog's to judge (./catalog.ts): the save makes the
// change to the draft and runs the page through `parsePage`, so every box is held to the page's one
// rule. the pictures offered come from `BLOCKS`, `LAYOUTS`, `SHADES`, `CORNERS`, `PALETTES` and
// `SHARE_CHANNELS`, so a name the catalog drops is a picture nobody is offered.
//
// a block is added in its type's first variant and first background (`startingBlock` in
// ./defaults.ts), removed, or moved one step; the donation box, which a page holds exactly once, is
// neither added nor removed.
//
// pure and not under `$lib/server/**`: a component draws what `editorBlocks` returns.
import { z } from 'zod';
import { formatMinorBrief } from '../donations/money';
import { groupedEntry } from '../forms/amounts';
import { plainText, type RichTextDocument } from '../rich-text/document';
import { BLOCK_TYPES, BLOCKS, type Block, type BlockType, LAYOUTS, type Page } from './catalog';
import type { AddableBlockType } from './defaults';
import { oneOf } from './refusal';
import {
	SHARE_CHANNEL_LABELS,
	SHARE_CHANNELS,
	SHARE_CHANNELS_DEFAULT,
	type ShareChannel
} from './share';
import {
	type Background,
	type Corner,
	CORNERS,
	DEFAULT_CORNER,
	DEFAULT_SHADE,
	type Layout,
	type PageType,
	type Palette,
	PALETTES,
	type Shade,
	SHADES
} from './keys';

export const BLOCK_FORMS = {
	title: 'block-title',
	story: 'block-story',
	impactTiers: 'block-impact-tiers',
	faq: 'block-faq',
	photo: 'block-photo',
	variant: 'block-variant',
	layout: 'page-layout',
	shade: 'page-shade',
	corners: 'page-corners',
	palette: 'page-palette',
	shareMessage: 'page-share-message',
	shareChannels: 'page-share-channels',
	add: 'block-add',
	remove: 'block-remove',
	move: 'block-move',
	background: 'block-background'
} as const;

export type BlockFormId = (typeof BLOCK_FORMS)[keyof typeof BLOCK_FORMS];

/** every form above, for an editor's `submittedForm`. */
export const BLOCK_FORM_IDS = Object.values(BLOCK_FORMS) as BlockFormId[];

/**
 * the name each form below posts a box under, and the key its schema reads it by: the sheets that
 * post the boxes and the save that parses them both spell a box from here, so a box renamed here is
 * renamed on both sides. a row's box adds its place — `tier_amount[1]` (`rowBox`).
 */
export const BOXES = {
	blockId: 'block_id',
	blockType: 'block_type',
	direction: 'direction',
	background: 'background',
	heading: 'heading',
	lede: 'lede',
	body: 'body',
	tierAmount: 'tier_amount',
	tierBuys: 'tier_buys',
	question: 'question',
	answer: 'answer',
	imageId: 'image_id',
	alt: 'alt',
	variant: 'variant',
	layout: 'layout',
	shade: 'shade',
	corners: 'corners',
	palette: 'palette',
	shareMessage: 'share_message',
	shareChannels: 'share_channels'
} as const;

/** a row's box by its place, as a list of rows posts it — `tier_amount[1]`. */
export const rowBox = (box: string, at: number) => `${box}[${at}]`;

/** a block added to the page, by its type; `addableTypes` says which the page takes. */
export const BLOCK_ADD_INPUT = z.object({ [BOXES.blockType]: z.string('required') });

/** a block taken off the page; the donation box is on every page and is refused. */
export const BLOCK_REMOVE_INPUT = z.object({ [BOXES.blockId]: z.string('required') });

/** the two ways a block moves, one step at a time. */
export const MOVES = ['up', 'down'] as const;

/** a block moved one step up or down the page. */
export const BLOCK_MOVE_INPUT = z.object({
	[BOXES.blockId]: z.string('required'),
	[BOXES.direction]: oneOf(MOVES, 'a direction', 'a block moves')
});

/** a block's background picture, which applies on pick. */
export const BLOCK_BACKGROUND_INPUT = z.object({
	[BOXES.blockId]: z.string('required'),
	[BOXES.background]: z.string('required')
});

/** a blank heading draws the page's own name, and a blank lede is none. */
export const BLOCK_TITLE_INPUT = z.object({
	[BOXES.blockId]: z.string('required'),
	[BOXES.heading]: z.string().default(''),
	[BOXES.lede]: z.string().default('')
});

/** the story's body, the document's JSON as the rich-text box posts it. */
export const BLOCK_STORY_INPUT = z.object({
	[BOXES.blockId]: z.string('required'),
	[BOXES.body]: z.string('required')
});

/**
 * the tiers as rows of two boxes, `tier_amount[i]` in major units of the page's currency beside
 * `tier_buys[i]`: two lists, since a form's fields are flat ($lib/server/conform.ts).
 */
export const BLOCK_IMPACT_TIERS_INPUT = z.object({
	[BOXES.blockId]: z.string('required'),
	[BOXES.tierAmount]: z.array(z.string().default('')),
	[BOXES.tierBuys]: z.array(z.string().default(''))
});

/** the questions as rows, `question[i]` beside `answer[i]`, the answer's document as JSON. */
export const BLOCK_FAQ_INPUT = z.object({
	[BOXES.blockId]: z.string('required'),
	[BOXES.question]: z.array(z.string().default('')),
	[BOXES.answer]: z.array(z.string().default(''))
});

/**
 * a hero's or an image block's photo, by the id the images route (src/routes/_app.admin.images.ts)
 * answered its upload with, and what describes it; a blank description is a decorative photo.
 */
export const BLOCK_PHOTO_INPUT = z.object({
	[BOXES.blockId]: z.string('required'),
	[BOXES.imageId]: z.string('required'),
	[BOXES.alt]: z.string().default('')
});

/** a block's variant picture, which applies on pick. */
export const BLOCK_VARIANT_INPUT = z.object({
	[BOXES.blockId]: z.string('required'),
	[BOXES.variant]: z.string('required')
});

/** the page's layout picture, which applies on pick. */
export const PAGE_LAYOUT_INPUT = z.object({ [BOXES.layout]: z.string('required') });

/** the page's shade picture, which applies on pick. */
export const PAGE_SHADE_INPUT = z.object({ [BOXES.shade]: z.string('required') });

/** the page's corners picture, which applies on pick. */
export const PAGE_CORNERS_INPUT = z.object({ [BOXES.corners]: z.string('required') });

/** the page's palette picture, which applies on pick. */
export const PAGE_PALETTE_INPUT = z.object({ [BOXES.palette]: z.string('required') });

/** what a share says beside the page's address; a blank box removes it, and the title is said. */
export const PAGE_SHARE_MESSAGE_INPUT = z.object({ [BOXES.shareMessage]: z.string().optional() });

/** the share buttons the page offers, in the order they stand: one `share_channels` each. */
export const PAGE_SHARE_CHANNELS_INPUT = z.object({ [BOXES.shareChannels]: z.array(z.string()) });

/** a block's words as its sheet's boxes are seeded with them; null for a block with none. */
export type BlockText =
	| { readonly kind: 'title'; readonly heading: string; readonly lede: string }
	| { readonly kind: 'story'; readonly body: RichTextDocument }
	| {
			readonly kind: 'impact-tiers';
			/** the three-letter code the amounts are in. */
			readonly currency: string;
			/** each amount as its box is seeded: major units, grouped as the box draws it. */
			readonly tiers: readonly { readonly amount: string; readonly buys: string }[];
	  }
	| {
			readonly kind: 'faq';
			readonly items: readonly { readonly question: string; readonly answer: RichTextDocument }[];
	  }
	| {
			readonly kind: 'photo';
			/** null until a first photo is placed. */
			readonly imageId: string | null;
			readonly alt: string;
	  };

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
	/** the ground its section stands on. */
	readonly background: Background;
	/** the grounds it may stand on; one where it has no choice. */
	readonly backgrounds: readonly Picture[];
	/** false for the donation box alone, which every page holds once. */
	readonly removable: boolean;
	/** whether a block stands above it, and below it, for a move to swap it with. */
	readonly movesUp: boolean;
	readonly movesDown: boolean;
	readonly text: BlockText | null;
};

/** a picture a picker offers: the catalog's name, and what the picture is called. */
export type Picture = { readonly value: string; readonly label: string };

/** the draft's blocks in its order; `currency` is the draft's donation settings'. */
export function editorBlocks(draft: Page, currency: string): EditorBlock[] {
	return draft.blocks.map((block, at) => ({
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
		background: block.background,
		backgrounds: BLOCKS[block.type].backgrounds.map((name) => ({
			value: name,
			label: BACKGROUND_LABELS[name]
		})),
		removable: block.type !== 'donation-box',
		movesUp: at > 0,
		movesDown: at < draft.blocks.length - 1,
		text: blockText(block, currency)
	}));
}

/** the blocks a page of `type` may be given, in the catalog's order. */
export function addableTypes(type: PageType): AddableBlockType[] {
	return BLOCK_TYPES.filter(
		(block): block is AddableBlockType =>
			block !== 'donation-box' && (BLOCKS[block].pages as readonly PageType[]).includes(type)
	);
}

/** the blocks a page of `type` may be given, as the add picker offers them. */
export function addablePictures(type: PageType): Picture[] {
	return addableTypes(type).map((block) => ({ value: block, label: BLOCK_LABELS[block] }));
}

/** the page's look as it draws: a draft holding no look of its own draws the defaults. */
export type EditorLook = {
	readonly shade: Shade;
	readonly corners: Corner;
	readonly palette: Palette;
};

export function editorLook(draft: Page): EditorLook {
	return {
		shade: draft.look?.shade ?? DEFAULT_SHADE,
		corners: draft.look?.corner ?? DEFAULT_CORNER,
		palette: draft.palette
	};
}

/** the look's pictures, each offering the catalog's names. */
export function lookPictures() {
	return {
		shades: SHADES.map((name) => ({ value: name, label: SHADE_LABELS[name] })),
		corners: CORNERS.map((name) => ({ value: name, label: CORNER_LABELS[name] })),
		palettes: PALETTES.map((name) => ({ value: name, label: PALETTE_LABELS[name] }))
	} satisfies Record<string, Picture[]>;
}

const SHADE_LABELS: Record<Shade, string> = { light: 'Light', warm: 'Warm', cool: 'Cool' };

const CORNER_LABELS: Record<Corner, string> = { square: 'Square', soft: 'Soft', round: 'Round' };

const PALETTE_LABELS: Record<Palette, string> = {
	plain: 'Plain',
	tint: 'Tinted',
	duo: 'Two-tone',
	bright: 'Bright',
	bold: 'Bold'
};

/** every share button a page may offer, as the share sheet lists them. */
export function shareChannelPictures(): Picture[] {
	return SHARE_CHANNELS.map((name) => ({ value: name, label: SHARE_CHANNEL_LABELS[name] }));
}

/** what the page's share block hands a donor's share, as the draft holds it. */
export type EditorShare = {
	/** `''` where the page has none, and a share says the page's title. */
	readonly message: string;
	/** the buttons in the order they stand: the draft's, or the default where it has chosen none. */
	readonly channels: readonly ShareChannel[];
};

export function editorShare(draft: Page): EditorShare {
	return {
		message: draft.shareMessage ?? '',
		channels: draft.shareChannels ?? SHARE_CHANNELS_DEFAULT
	};
}

/** the page's layouts, as the Settings sheet's pictures offer them. */
export function layoutPictures(): Picture[] {
	return LAYOUTS.map((name) => ({ value: name, label: LAYOUT_LABELS[name] }));
}

const BACKGROUND_LABELS: Record<Background, string> = {
	none: 'None',
	soft: 'Soft',
	tint: 'Tinted',
	strong: 'Strong'
};

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
			return clipped(block.items.map((item) => item.question).join(', '));
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
					amount: groupedEntry(tier.amountMinor, currency),
					buys: tier.buys
				}))
			};
		case 'faq':
			return { kind: 'faq', items: block.items };
		case 'hero':
		case 'image':
			return { kind: 'photo', imageId: block.imageId, alt: block.alt ?? '' };
		default:
			return null;
	}
}
