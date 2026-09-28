// the one rule for a donor page as it is stored: what `page.draft`, `published` and
// `last_published` hold. parsed on the way into the database and again on the way out, the way
// ../rich-text/document.ts is, and `parsePage` is the only parser of that document there is.
//
// the document is flat and ours: a layout, a palette and a list of blocks, each block a type, a
// variant, a background and the few values that block draws — no tree, no conditions, no state, no
// actions, no colour, no markup, and no address but a link inside rich text, since every block is
// a strict object whose only free text is plain strings and rich-text documents. drafting speaks a different format
// (./ai-catalog.ts) and lands here through the same parse, so an upgrade on that side never
// touches a stored page.
//
// every name is from a closed set: `LAYOUTS`, `PALETTES`, `BACKGROUNDS`, and per block `BLOCKS`,
// which also says which page type takes the block. the donation box is on every page exactly once,
// and it carries no variant and no data. top-level keys the database reads, and the look's keys and
// sets, are ./keys.ts's; `$lib/server/db/schema.ts` checks the same names.
//
// the rule reads shape only and never the page's data: nothing here looks up a program, a goal's
// progress or the organisation. a block with nothing to show — no tiers, a blank story, a goal bar
// on a campaign with no goal — is accepted and leaves itself out at render. `settings` is the draft
// donation settings publish copies onto the page's owned form row, read by ./settings.ts's rule.
//
// pure and not under `$lib/server/**`: a component renders what this returns.
import { z } from 'zod';
import { richTextDocument } from '../rich-text/document';
import {
	BACKGROUNDS,
	CORNERS,
	LAYOUTS,
	LOOK_KEYS,
	PAGE_KEYS,
	PAGE_TYPES,
	PALETTES,
	type PageType,
	SHADES
} from './keys';
import { draftSettings } from './settings';

export { BACKGROUNDS, LAYOUTS, PALETTES };

const NOT_STRONG = ['none', 'soft', 'tint'] as const;
const NO_GROUND = ['none'] as const;

/** each block's variants, the backgrounds it may sit on, and the page types that take it. */
export const BLOCKS = {
	title: { variants: ['left', 'center', 'compact'], backgrounds: BACKGROUNDS, pages: PAGE_TYPES },
	story: { variants: ['plain', 'lede', 'split'], backgrounds: NOT_STRONG, pages: PAGE_TYPES },
	'impact-tiers': { variants: ['cards', 'list'], backgrounds: BACKGROUNDS, pages: PAGE_TYPES },
	faq: { variants: ['accordion', 'open'], backgrounds: NOT_STRONG, pages: PAGE_TYPES },
	'about-us': {
		variants: ['stacked', 'side-by-side', 'statement'],
		backgrounds: BACKGROUNDS,
		pages: PAGE_TYPES
	},
	'org-info': { variants: ['footer', 'card'], backgrounds: NO_GROUND, pages: PAGE_TYPES },
	share: { variants: ['buttons', 'icons'], backgrounds: NOT_STRONG, pages: PAGE_TYPES },
	'goal-bar': { variants: ['bar', 'figure'], backgrounds: NO_GROUND, pages: ['campaign'] },
	'program-chooser': {
		variants: ['cards', 'list'],
		backgrounds: NO_GROUND,
		pages: ['donation_page']
	},
	'donation-box': { variants: null, backgrounds: NO_GROUND, pages: PAGE_TYPES }
} as const;

export type BlockType = keyof typeof BLOCKS;
export const BLOCK_TYPES = Object.keys(BLOCKS) as BlockType[];

export const ID_MAX = 32;
/** holds "Donate to " and the longest legal name, so the default Donation page always fits. */
export const HEADING_MAX = 250;
export const LEDE_MAX = 400;
export const TIERS_MAX = 6;
export const BUYS_MAX = 140;
export const FAQ_MAX = 10;
export const QUESTION_MAX = 200;
export const SHARE_MESSAGE_MAX = 280;

const TIER_AMOUNT = 'a tier\u2019s amount is a whole number of minor units above zero';

/**
 * the values each block draws, beside its frame. a block with none draws only what it reads at
 * render: about-us and org-info the organisation, share the page's address and share message, the
 * goal bar the campaign's goal and gifts, the program chooser the programs its settings offer.
 */
export const BLOCK_DATA = {
	title: {
		/**
		 * empty draws the campaign's name on a campaign, which is not in this document, and
		 * "Donate to" the organisation's name on the Donation page.
		 */
		heading: z.string().max(HEADING_MAX, {
			error: `a heading holds at most ${HEADING_MAX} characters`
		}),
		lede: z
			.string()
			.max(LEDE_MAX, { error: `a lede holds at most ${LEDE_MAX} characters` })
			.optional()
	},
	story: { body: richTextDocument },
	'impact-tiers': {
		tiers: z
			.array(
				z.strictObject({
					amountMinor: z.int({ error: TIER_AMOUNT }).positive({ error: TIER_AMOUNT }),
					buys: z
						.string()
						.min(1, { error: 'a tier says what its amount buys' })
						.max(BUYS_MAX, { error: `what a tier buys is at most ${BUYS_MAX} characters` })
				})
			)
			.max(TIERS_MAX, { error: `an impact-tiers block holds at most ${TIERS_MAX} tiers` })
	},
	faq: {
		items: z
			.array(
				z.strictObject({
					question: z
						.string()
						.min(1, { error: 'a question is not blank' })
						.max(QUESTION_MAX, { error: `a question holds at most ${QUESTION_MAX} characters` }),
					answer: richTextDocument
				})
			)
			.max(FAQ_MAX, { error: `a faq holds at most ${FAQ_MAX} questions` })
	},
	'about-us': {},
	'org-info': {},
	share: {},
	'goal-bar': {},
	'program-chooser': {},
	'donation-box': {}
} as const satisfies Record<BlockType, z.ZodRawShape>;

const blockId = z.string().regex(new RegExp(`^[A-Za-z0-9_-]{1,${ID_MAX}}$`), {
	error: `an id is 1 to ${ID_MAX} letters, digits, "-" or "_"`
});

const look = z.strictObject({
	[LOOK_KEYS.shade]: oneOf(SHADES, 'a shade', 'a look is'),
	[LOOK_KEYS.corner]: oneOf(CORNERS, 'a corner', 'a look is'),
	[LOOK_KEYS.brandColour]: z.string().regex(/^#[0-9a-f]{6}$/, {
		error: 'a brand colour is a lowercase #rrggbb'
	})
});

type Names = readonly [string, ...string[]];

/** the keys every block but the donation box carries: which block it is, drawn how, on what. */
function frame<T extends BlockType, V extends Names, B extends Names>(
	type: T,
	{ variants, backgrounds }: { variants: V; backgrounds: B }
) {
	return {
		id: blockId,
		type: z.literal(type),
		variant: oneOf(variants, `a variant of ${blockLabel(type)}`, 'it is'),
		background: oneOf(backgrounds, `a background ${blockLabel(type)} takes`, 'it takes')
	};
}

/** a block as a refusal names it: its type, but the donation box as a screen calls it. */
function blockLabel(type: BlockType) {
	return type === 'donation-box' ? 'the donation box' : type;
}

/** a block's rule: its frame and its data, and nothing else — a key off the list is refused. */
function strictBlock<S extends z.ZodRawShape>(type: BlockType, shape: S) {
	const keys = Object.keys(shape);
	return z.strictObject(shape, {
		error: (issue) =>
			issue.code === 'unrecognized_keys'
				? `${blockLabel(type)} carries no ${issue.keys.map((key) => `"${key}"`).join(', ')}; it carries ${listed(keys)}`
				: undefined
	});
}

const block = z.discriminatedUnion(
	'type',
	[
		strictBlock('title', { ...frame('title', BLOCKS.title), ...BLOCK_DATA.title }),
		strictBlock('story', { ...frame('story', BLOCKS.story), ...BLOCK_DATA.story }),
		strictBlock('impact-tiers', {
			...frame('impact-tiers', BLOCKS['impact-tiers']),
			...BLOCK_DATA['impact-tiers']
		}),
		strictBlock('faq', { ...frame('faq', BLOCKS.faq), ...BLOCK_DATA.faq }),
		strictBlock('about-us', {
			...frame('about-us', BLOCKS['about-us']),
			...BLOCK_DATA['about-us']
		}),
		strictBlock('org-info', {
			...frame('org-info', BLOCKS['org-info']),
			...BLOCK_DATA['org-info']
		}),
		strictBlock('share', { ...frame('share', BLOCKS.share), ...BLOCK_DATA.share }),
		strictBlock('goal-bar', {
			...frame('goal-bar', BLOCKS['goal-bar']),
			...BLOCK_DATA['goal-bar']
		}),
		strictBlock('program-chooser', {
			...frame('program-chooser', BLOCKS['program-chooser']),
			...BLOCK_DATA['program-chooser']
		}),
		strictBlock('donation-box', {
			id: blockId,
			type: z.literal('donation-box'),
			background: oneOf(NO_GROUND, 'a background the donation box takes', 'it takes')
		})
	],
	{
		error: (issue) =>
			isRecord(issue.input) && typeof issue.input.type === 'string'
				? `"${issue.input.type}" is not a block; a page holds ${listed(BLOCK_TYPES.map(blockLabel))}`
				: `expected a block, an object with a type; a page holds ${listed(BLOCK_TYPES.map(blockLabel))}`
	}
);

export type Block = z.infer<typeof block>;

const PAGE_NAMES: Record<PageType, string> = {
	donation_page: 'the Donation page',
	campaign: 'a campaign'
};

const GOAL = 'a goal is a whole number of minor units above zero';
const END = 'an end date is a whole number of milliseconds since 1970';
const CAMPAIGN_ONLY = [
	[PAGE_KEYS.name, 'name'],
	[PAGE_KEYS.goalMinor, 'goal'],
	[PAGE_KEYS.endsAt, 'end date']
] as const;

const pageDocument = (type: PageType) =>
	z
		.strictObject({
			layout: oneOf(LAYOUTS, 'a layout', 'a page is laid out'),
			palette: oneOf(PALETTES, 'a palette', 'a page takes'),
			[PAGE_KEYS.look]: look.nullable().optional(),
			shareMessage: z
				.string()
				.max(SHARE_MESSAGE_MAX, {
					error: `a share message holds at most ${SHARE_MESSAGE_MAX} characters`
				})
				.optional(),
			switches: z.strictObject({ openOnMonthly: z.boolean(), dedicationOn: z.boolean() }),
			[PAGE_KEYS.name]: z
				.string()
				.trim()
				.min(1, { error: 'a campaign name holds words' })
				.max(HEADING_MAX, { error: `a campaign name holds at most ${HEADING_MAX} characters` })
				.optional(),
			[PAGE_KEYS.goalMinor]: z.int({ error: GOAL }).positive({ error: GOAL }).optional(),
			[PAGE_KEYS.endsAt]: z.int({ error: END }).positive({ error: END }).optional(),
			settings: draftSettings.optional(),
			blocks: z.array(block)
		})
		.check((ctx) => {
			if (type !== 'campaign') {
				for (const [key, what] of CAMPAIGN_ONLY) {
					if (ctx.value[key] === undefined) continue;
					ctx.issues.push({
						code: 'custom',
						input: ctx.value[key],
						path: [key],
						message: `${PAGE_NAMES[type]} has no ${what}; only a campaign does`
					});
				}
			}
			const firstWithId = new Map<string, number>();
			for (const [index, { id }] of ctx.value.blocks.entries()) {
				const first = firstWithId.get(id);
				if (first === undefined) {
					firstWithId.set(id, index);
					continue;
				}
				ctx.issues.push({
					code: 'custom',
					input: id,
					path: ['blocks', index, 'id'],
					message: `an id names one block, and block ${first + 1} already has it`
				});
			}
			for (const [index, { type: blockType }] of ctx.value.blocks.entries()) {
				const takenOn: readonly PageType[] = BLOCKS[blockType].pages;
				if (takenOn.includes(type)) continue;
				ctx.issues.push({
					code: 'custom',
					input: blockType,
					path: ['blocks', index, 'type'],
					message: `${PAGE_NAMES[type]} takes no ${blockLabel(blockType)}; only ${listed(takenOn.map((page) => PAGE_NAMES[page]))} does`
				});
			}
			const boxes = [...ctx.value.blocks.entries()].filter(
				([, block]) => block.type === 'donation-box'
			);
			const [first, second] = boxes;
			if (first === undefined) {
				ctx.issues.push({
					code: 'custom',
					input: ctx.value.blocks,
					path: ['blocks'],
					message: 'a page holds exactly one donation box, and this one holds none'
				});
			} else if (second !== undefined) {
				const [index, block] = first;
				ctx.issues.push({
					code: 'custom',
					input: second[1],
					path: ['blocks', second[0]],
					message: `a page holds exactly one donation box, and ${blockName(index, block.id)} is one`
				});
			}
		});

const PAGE_RULES = {
	donation_page: pageDocument('donation_page'),
	campaign: pageDocument('campaign')
};

export type Page = z.infer<ReturnType<typeof pageDocument>>;
type Path = (string | number)[];

export type PageRefusal = {
	ok: false;
	/** where in the input the refusal lands, as keys and indexes from the document's root */
	path: Path;
	/** names the block by position and id where the refusal is inside one */
	message: string;
};

/** the rule on write and on read alike. */
export function parsePage(type: PageType, input: unknown): { ok: true; page: Page } | PageRefusal {
	const result = PAGE_RULES[type].safeParse(input);
	if (result.success) return { ok: true, page: result.data };
	const issue = result.error.issues[0];
	if (issue === undefined) throw result.error;
	const path = issue.path.filter((key): key is string | number => typeof key !== 'symbol');
	const [list, index] = path;
	if (list !== 'blocks' || typeof index !== 'number')
		return { ok: false, path, message: issue.message };
	const block = (input as { blocks: unknown[] }).blocks[index];
	const id = isRecord(block) && typeof block.id === 'string' ? block.id : null;
	return { ok: false, path, message: `${blockName(index, id)}: ${issue.message}` };
}

function blockName(index: number, id: string | null) {
	return id === null ? `block ${index + 1}` : `block ${index + 1} (id "${id}")`;
}

/** a name from `names`, refused as `"x" is not <what>; <offered> a, b or c`. */
function oneOf<const T extends Names>(names: T, what: string, offered: string) {
	return z.enum(names, {
		error: (issue) => `${shown(issue.input)} is not ${what}; ${offered} ${listed(names, 'or')}`
	});
}

function listed(names: readonly string[], joiner: 'and' | 'or' = 'and') {
	return names.length < 2
		? names.join('')
		: `${names.slice(0, -1).join(', ')} ${joiner} ${names.at(-1)}`;
}

function shown(input: unknown) {
	return input === undefined ? 'nothing' : JSON.stringify(input);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
