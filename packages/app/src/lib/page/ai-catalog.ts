// what the drafting model is told a page may hold, and how its draft becomes a stored page.
//
// the model writes a draft in json-render's terms: a flat object of layout, palette and blocks,
// each block a catalog component with its props nested. `pageCatalog` builds that catalog for one
// page type out of ./catalog.ts's own pieces — `BLOCKS` for each block's variants, backgrounds and
// page types, `BLOCK_DATA` for its props — so the prompt cannot offer what the rule refuses, and a
// block its page type forbids is never named in that type's prompt at all. the donation box is the
// one block whose component name differs from its stored type: `DonationFlow` here,
// `donation-box` in a stored page, and "Donation box" on a screen. the two names meet in this file
// and nowhere else.
//
// `pageFromDraft` converts a draft to a page and ends in `parsePage`: the catalog's own `validate`
// is never the rule, and a draft is refused with the message a save would get, its path pointing
// into the draft. it converts and no more: ./accept-reply.ts decides whether a chat reply lands at
// all, and compares its links with the page it replaces, since the model is told to add none.
// `draftFromPage` is the way back, the page as the model reads it and as a reply's patch addresses
// it. the stored format is ours, so a json-render upgrade reaches this file and never a stored
// page.
import { defineCatalog, defineSchema, type PromptContext } from '@json-render/core';
import { z } from 'zod';
import {
	ALT_MAX,
	BLOCK_DATA,
	BLOCK_TYPES,
	BLOCKS,
	type BlockType,
	FAQ_MAX,
	ID_MAX,
	LAYOUTS,
	PALETTES,
	type PageRefusal,
	parsePage,
	type Page,
	TIERS_MAX
} from './catalog';
import { isPhotoType } from './illustration';
import type { Layout, PageType, Palette } from './keys';
import { LIST_DEPTH_MAX } from '../rich-text/document';

const DONATION_FLOW = 'DonationFlow';

/** the most illustrations one reply is drawn. */
export const ILLUSTRATIONS_MAX = 2;

/**
 * a reply's ask for an illustration, written where a hero's or an image block's `imageId` goes.
 * the description is the picture's prompt and, once drawn, its alt text, so it is held to a photo
 * description's length. it lives on a reply alone: $lib/server/pages/draft.ts puts the drawn
 * picture's id, or null, in its place before ./accept-reply.ts reads the reply, and `parsePage`
 * refuses one left standing.
 */
export const illustrationRequest = z.strictObject({
	illustrate: z
		.string()
		.trim()
		.min(1, { error: 'an illustration request describes the picture wanted' })
		.max(ALT_MAX, {
			error: `an illustration’s description holds at most ${ALT_MAX} characters`
		})
});

// the prompt's type rendering cannot show a list item's content, a tuple.
const RICH_TEXT = `a rich-text document; a listItem's content is one paragraph, then any paragraphs, bulletLists and orderedLists, nested at most ${LIST_DEPTH_MAX} lists deep`;

const DESCRIPTIONS: Record<BlockType, string> = {
	title: 'the page’s heading, with an optional lede under it',
	story: `why this matters, in the organisation’s words; body is ${RICH_TEXT}`,
	'impact-tiers': `up to ${TIERS_MAX} amounts, each with what it buys; amountMinor is in minor units`,
	faq: `up to ${FAQ_MAX} questions, each answer ${RICH_TEXT}`,
	'about-us': 'what the organisation does, drawn from its own profile',
	'org-info': 'the organisation’s name, address and legal details',
	share: 'buttons that share the page',
	hero: 'the page’s opening photo; under the cover layout the title lies over it',
	image: 'a photo among the other blocks',
	'goal-bar': 'the campaign’s progress toward its goal',
	'program-chooser': 'lets the donor pick which program their gift supports',
	'donation-box': 'where the donor gives; takes no props and no variant'
};

// as $lib/donate/page-view.tsx and $lib/donate/page.css draw them.
const LAYOUT_DESCRIPTIONS: Record<Layout, string> = {
	'box-right': 'the donation box stands in its own column beside the other blocks',
	banner:
		'a band across the top holds the blocks up to the donation box, with the box beside them; the blocks after it run full width below',
	column: 'one narrow column at every width, the donation box where it is listed',
	cover: 'a cover photo with the title over it; without a hero photo it draws as box-right'
};

// what a block's `soft`, `tint` and `strong` backgrounds are drawn in, off the brand colour.
const PALETTE_DESCRIPTIONS: Record<Palette, string> = {
	plain: 'greys only; the brand colour stays on buttons',
	tint: 'pale and full grounds of the brand colour',
	duo: 'the brand colour, with tint grounds in a second, contrasting hue',
	bright: 'livelier grounds in a hue beside the brand colour',
	bold: 'grey soft grounds and the deepest brand colour for strong ones'
};

type Component = {
	props: z.ZodObject;
	description: string;
	variants: string[];
	backgrounds: string[];
};
type DraftCatalog = { page: string; components: Record<string, Component> };

const draftSchema = defineSchema(
	(s) => ({
		spec: s.object({
			layout: s.string(),
			palette: s.string(),
			blocks: s.array(
				s.object({
					id: s.string(),
					type: s.ref('catalog.components'),
					variant: { ...s.string(), ...s.optional() },
					background: s.string(),
					props: s.propsOf('catalog.components')
				})
			)
		}),
		catalog: s.object({
			page: s.string(),
			components: s.map({
				props: s.zod(),
				description: s.string(),
				variants: s.array(s.string()),
				backgrounds: s.array(s.string())
			})
		})
	}),
	{ promptTemplate: (context) => prompt(context as PromptContext<DraftCatalog>) }
);

const PAGE_NAMES: Record<PageType, string> = {
	donation_page: 'an organisation’s Donation page',
	campaign: 'a fundraising campaign'
};

/**
 * the catalog the model drafts a page of `type` from. its `prompt()` opens the system prompt, which
 * $lib/server/pages/draft.ts follows with the reply's shape and the page as it stands.
 */
export function pageCatalog(type: PageType) {
	const components: Record<string, Component> = {};
	for (const block of BLOCK_TYPES) {
		const { variants, backgrounds, pages } = BLOCKS[block];
		if (!(pages as readonly PageType[]).includes(type)) continue;
		const data: z.ZodRawShape = isPhotoType(block)
			? { ...BLOCK_DATA[block], imageId: BLOCK_DATA.hero.imageId.or(illustrationRequest) }
			: BLOCK_DATA[block];
		components[componentName(block)] = {
			props: z.object(data),
			description: DESCRIPTIONS[block],
			variants: variants === null ? [] : [...variants],
			backgrounds: [...backgrounds]
		};
	}
	return defineCatalog(draftSchema, { page: PAGE_NAMES[type], components });
}

/**
 * the wording each of the donation box's switches asks of the words while it is on, as rules for
 * `pageCatalog(type).prompt({ customRules })`; none while both are off. each names no label and no
 * figure, and ./accept-reply.ts still refuses a figure the operator never stated.
 */
export function switchRules({ openOnMonthly, dedicationOn }: Page['switches']): string[] {
	return [
		...(openOnMonthly
			? [
					'the donation box opens on a monthly gift: the story may invite a monthly gift; say what an amount does only as the operator said it, never as what it does every month unless they said so'
				]
			: []),
		...(dedicationOn
			? [
					'the donation box opens with a dedication: the words may speak of giving in honour or in memory of someone'
				]
			: [])
	];
}

function prompt({ catalog, options, formatZodType }: PromptContext<DraftCatalog>) {
	const blocks = Object.entries(catalog.components).flatMap(([name, component]) => {
		const { props, description, variants, backgrounds } = component;
		return [
			`- ${name}: ${description}`,
			...(variants.length === 0 ? [] : [`  variants: ${variants.join(' | ')}`]),
			`  backgrounds: ${backgrounds.join(' | ')}`,
			`  props: ${formatZodType(props)}`
		];
	});
	return [
		options.system ?? `You draft ${catalog.page}.`,
		'',
		'A page is one JSON object:',
		`{"layout": ..., "palette": ..., "blocks": [{"id": ..., "type": ..., "variant": ..., "background": ..., "props": {...}}, {"id": ..., "type": "${DONATION_FLOW}", "background": "none", "props": {}}]}`,
		'',
		'LAYOUTS:',
		...LAYOUTS.map((layout) => `- ${layout}: ${LAYOUT_DESCRIPTIONS[layout]}`),
		'',
		'PALETTES:',
		...PALETTES.map((palette) => `- ${palette}: ${PALETTE_DESCRIPTIONS[palette]}`),
		'',
		'BLOCKS:',
		...blocks,
		'',
		'RULES:',
		`- exactly one ${DONATION_FLOW}, with no variant and empty props`,
		`- every id is unique on the page, 1 to ${ID_MAX} letters, digits, "-" or "_"`,
		'- use only the names above; no colour, HTML or action anywhere',
		'- add no link; keep a link already in the text exactly as it is',
		// the chat names a turn's photos this way: `withImages` in $lib/server/pages/draft.ts.
		'- a photo’s imageId is an id from "(attached photos: …)" in the chat or one the page already holds, never an address; null leaves the block out',
		`- where no photo attached in the chat or already on the page fits a hero or image block, its imageId may be {"illustrate": "a short description of the picture wanted"} and an illustration is drawn from it; a photo that fits always wins, and a reply asks for at most ${ILLUSTRATIONS_MAX}`,
		...(options.customRules ?? []).map((rule) => `- ${rule}`)
	].join('\n');
}

/**
 * the model's draft as a page of `type`, put onto `onto` — the page being redrafted, or a default
 * for a first draft — so the operator's look, switches, goal, end date, share message and settings
 * stay theirs. the draft brings the layout, the palette and the blocks, and the result is
 * `parsePage`'s.
 */
export function pageFromDraft(
	type: PageType,
	draft: unknown,
	onto: Page
): { ok: true; page: Page } | PageRefusal {
	if (!isRecord(draft)) return parsePage(type, draft);
	const { layout, palette, blocks } = draft;
	const result = parsePage(type, {
		...onto,
		layout,
		palette,
		blocks: Array.isArray(blocks) ? blocks.map(storedBlock) : blocks
	});
	if (result.ok) return result;
	return { ...result, path: draftPath(result.path, blocks) };
}

type DraftBlock = {
	id: string;
	type: string;
	variant?: string;
	background: string;
	props: Record<string, unknown>;
};
export type Draft = { layout: string; palette: string; blocks: DraftBlock[] };

/** a page in the model's terms: its layout, palette and blocks, and nothing the operator owns. */
export function draftFromPage(page: Page): Draft {
	return {
		layout: page.layout,
		palette: page.palette,
		blocks: page.blocks.map(({ id, type, background, ...values }) => {
			const { variant, ...props }: { variant?: string } = values;
			return {
				id,
				type: componentName(type),
				...(variant === undefined ? {} : { variant }),
				background,
				props
			};
		})
	};
}

const FRAME_KEYS: readonly unknown[] = ['id', 'type', 'variant', 'background'];

/** a refusal's path inside a block's data, put back under the `props` the draft wrote it in. */
function draftPath(path: (string | number)[], blocks: unknown) {
	const [list, index, key, ...rest] = path;
	if (list !== 'blocks' || typeof index !== 'number' || key === undefined) return path;
	if (FRAME_KEYS.includes(key)) return path;
	const block = Array.isArray(blocks) ? blocks[index] : undefined;
	if (!isRecord(block) || !isRecord(block.props)) return path;
	return [list, index, 'props', key, ...rest];
}

/**
 * a draft block in the stored format: its props lifted beside its frame, its type renamed back.
 * props that are not an object stay under `props`, which no block carries, so the rule names them.
 * a blank variant on the donation box, which has none, is dropped.
 */
function storedBlock(block: unknown) {
	if (!isRecord(block)) return block;
	const { props, type, ...frame } = block;
	if (type === DONATION_FLOW && (frame.variant === null || frame.variant === '')) {
		delete frame.variant;
	}
	return {
		...(isRecord(props) ? props : props === undefined ? {} : { props }),
		...frame,
		type: type === DONATION_FLOW ? 'donation-box' : type
	};
}

function componentName(type: BlockType) {
	return type === 'donation-box' ? DONATION_FLOW : type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
