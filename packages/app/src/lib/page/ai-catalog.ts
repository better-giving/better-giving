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
import type { PageType } from './keys';
import { LIST_DEPTH_MAX } from '../rich-text/document';

const DONATION_FLOW = 'DonationFlow';

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
	'goal-bar': 'the campaign’s progress toward its goal',
	'program-chooser': 'lets the donor pick which program their gift supports',
	'donation-box': 'where the donor gives; takes no props and no variant'
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

/** the catalog the model drafts a page of `type` from; its `prompt()` is the system prompt. */
export function pageCatalog(type: PageType) {
	const components: Record<string, Component> = {};
	for (const block of BLOCK_TYPES) {
		const { variants, backgrounds, pages } = BLOCKS[block];
		if (!(pages as readonly PageType[]).includes(type)) continue;
		components[componentName(block)] = {
			props: z.object(BLOCK_DATA[block]),
			description: DESCRIPTIONS[block],
			variants: variants === null ? [] : [...variants],
			backgrounds: [...backgrounds]
		};
	}
	return defineCatalog(draftSchema, { page: PAGE_NAMES[type], components });
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
		'Answer with one JSON object and nothing else:',
		`{"layout": ..., "palette": ..., "blocks": [{"id": ..., "type": ..., "variant": ..., "background": ..., "props": {...}}, {"id": ..., "type": "${DONATION_FLOW}", "background": "none", "props": {}}]}`,
		'',
		`LAYOUTS: ${LAYOUTS.join(' | ')}`,
		`PALETTES: ${PALETTES.join(' | ')}`,
		'',
		'BLOCKS:',
		...blocks,
		'',
		'RULES:',
		`- exactly one ${DONATION_FLOW}, with no variant and empty props`,
		`- every id is unique on the page, 1 to ${ID_MAX} letters, digits, "-" or "_"`,
		'- use only the names above; no colour, HTML or action anywhere',
		'- add no link; keep a link already in the text exactly as it is',
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
