// the boxes the AI may be asked to write one of ($lib/server/pages/suggest.ts): every text box a
// page's editors draw, named as their forms name it — a block's sheet by the box's `name`
// (./block-edit.ts, $lib/admin/editor/block-edit.tsx) and the page's own boxes under `PAGE_BOXES`
// — each with the bound ./catalog.ts holds its words to and the place in the page as the model reads
// it (`draftFromPage` in ./ai-catalog.ts) its words go. a box holding an amount, a photo's id or a
// picked name is no text box, and a block that draws only what it reads at render, such as the
// share buttons or the donation box, has none. a photo's description is no box here either: the
// model is never shown the photo, so its words would describe a picture nobody described, and a
// screen-reader donor hears them as fact.
//
// a box is resolved against the draft as it stands: a block by its id, and a row of a list by its
// index among the rows the draft holds. `block` sent as `PAGE_BLOCK` names the page's own boxes
// for `name` and `share_message` alone; any other field of it is a block's whose id is `page`.
//
// the box beside the one asked for is read from the open sheet where the caller sends it, since
// the sheet may hold what the draft does not yet: a tier's amount for what that tier buys, a
// figure as the sheet draws it (`100`, `1,000.50`) refused by name where it does not read as one
// above zero, and a question's words for its answer. sent for any other box, it is ignored; not
// sent, the draft's is told.
//
// a plain box's words are one line. a rich-text box's — a story's body, an answer — are paragraphs a
// blank line apart, and `richTextOf` is the document they fill that box with.
//
// pure and not under `$lib/server/**`: the editor fills a rich-text box with `richTextOf`.
import { formatMinorBrief } from '../donations/money';
import { type AmountRead, FORM_CURRENCY, readAmount } from '../forms/amounts';
import { type RichTextDocument, TEXT_MAX } from '../rich-text/document';
import {
	type Block,
	BUYS_MAX,
	HEADING_MAX,
	LEDE_MAX,
	type Page,
	QUESTION_MAX,
	SHARE_MESSAGE_MAX
} from './catalog';
import type { PageType } from './keys';
import { listed } from './refusal';

/** what `block` is sent as to name the page's own boxes rather than a block's. */
export const PAGE_BLOCK = 'page';

/** the page's own text boxes by name, and the page types that draw each. */
const PAGE_BOXES = {
	name: ['campaign'],
	share_message: ['donation_page', 'campaign']
} as const satisfies Record<string, readonly PageType[]>;

export type SuggestBox = {
	readonly kind: 'plain' | 'rich';
	/** the most characters its words hold; a rich box counts each paragraph break as one. */
	readonly max: number;
	/** the box as the model is told it, saying what its words are for. */
	readonly what: string;
	/** where its words go: a pointer into the page as the model reads it, or a reply's `set`. */
	readonly target:
		| { readonly in: 'page'; readonly pointer: string }
		| { readonly in: 'set'; readonly key: 'name' | 'shareMessage' };
};

export type ResolvedBox = { ok: true; box: SuggestBox } | { ok: false; error: string };

/**
 * the box `field` of `block` in `page`, a page of `type`, told the model with `beside` where it
 * reads one, or why there is no such text box.
 */
export function suggestBox(
	page: Page,
	type: PageType,
	block: string,
	field: string,
	beside?: string
): ResolvedBox {
	if (block === PAGE_BLOCK && Object.hasOwn(PAGE_BOXES, field)) return pageBox(type, field);
	const index = page.blocks.findIndex(({ id }) => id === block);
	const found = page.blocks[index];
	if (found === undefined && block === PAGE_BLOCK) return pageBox(type, field);
	if (found === undefined) {
		return {
			ok: false,
			error: `block "${block}" is no block of this page’s draft; its blocks are ${listed(page.blocks.map(({ id }) => `"${id}"`))}, or send "${PAGE_BLOCK}" for the page’s own boxes`
		};
	}
	const named = `block "${block}" (${found.type})`;
	const boxes = boxNames(found);
	if (boxes.length === 0) {
		return { ok: false, error: `field "${field}" is no text box: ${named} has none` };
	}
	const resolved = blockBox(found, index, field, beside);
	if (resolved !== null) return resolved;
	return {
		ok: false,
		error: `field "${field}" is no text box of ${named}; its text boxes are ${listed(boxes)}`
	};
}

/** `text`, a rich box's words, as the document that box holds: a paragraph per blank-line break. */
export function richTextOf(text: string): RichTextDocument {
	const paragraphs = text
		.split(/\n\s*\n/)
		.map((one) => one.replace(/\s+/g, ' ').trim())
		.filter((one) => one !== '');
	if (paragraphs.length === 0) return { type: 'doc', content: [{ type: 'paragraph' }] };
	return {
		type: 'doc',
		content: paragraphs.map((one) => ({
			type: 'paragraph',
			content: [{ type: 'text', text: one }]
		}))
	};
}

function pageBox(type: PageType, field: string): ResolvedBox {
	const drawn = Object.entries(PAGE_BOXES)
		.filter(([, types]) => (types as readonly PageType[]).includes(type))
		.map(([name]) => name);
	const what = type === 'campaign' ? 'a campaign' : 'the Donation page';
	if (!drawn.includes(field)) {
		return {
			ok: false,
			error: `field "${field}" is no text box of ${what}; its own boxes are ${listed(drawn)}`
		};
	}
	return field === 'name'
		? {
				ok: true,
				box: {
					kind: 'plain',
					max: HEADING_MAX,
					what: 'the campaign’s name, which its title draws and the dashboard lists it by',
					target: { in: 'set', key: 'name' }
				}
			}
		: {
				ok: true,
				box: {
					kind: 'plain',
					max: SHARE_MESSAGE_MAX,
					what: 'the share message: the words a donor shares the page with, beside its link',
					target: { in: 'set', key: 'shareMessage' }
				}
			};
}

/** the names of `block`'s text boxes, as its sheet posts them. */
function boxNames(block: Block): string[] {
	switch (block.type) {
		case 'title':
			return ['heading', 'lede'];
		case 'story':
			return ['body'];
		case 'impact-tiers':
			return block.tiers.map((_, at) => `tier_buys[${at}]`);
		case 'faq':
			return block.items.flatMap((_, at) => [`question[${at}]`, `answer[${at}]`]);
		default:
			return [];
	}
}

function blockBox(
	block: Block,
	index: number,
	field: string,
	beside: string | undefined
): ResolvedBox | null {
	const at = `/blocks/${index}/props`;
	const of = `block ${index + 1} (id "${block.id}")`;
	const row = /^([a-z_]+)\[(0|[1-9]\d{0,2})\]$/.exec(field);
	const [, list, position] = row ?? [];
	const n = position === undefined ? -1 : Number(position);
	switch (block.type) {
		case 'title':
			if (field === 'heading') {
				return plain(HEADING_MAX, `the heading of ${of}, the page’s headline`, `${at}/heading`);
			}
			if (field === 'lede') {
				return plain(
					LEDE_MAX,
					`the lead-in of ${of}: a sentence or two under the heading`,
					`${at}/lede`
				);
			}
			return null;
		case 'story':
			return field === 'body'
				? rich(`the story of ${of}: why a gift matters, in a few short paragraphs`, `${at}/body`)
				: null;
		case 'impact-tiers': {
			const tier = block.tiers[n];
			if (list !== 'tier_buys' || tier === undefined) return null;
			const amount =
				beside === undefined ? { minor: tier.amountMinor, problem: null } : tierAmount(beside);
			if (amount.problem !== null) {
				return {
					ok: false,
					error: `beside "${beside}" ${amount.problem}: send tier ${n + 1}’s amount as the sheet holds it`
				};
			}
			return plain(
				BUYS_MAX,
				`what a gift of ${formatMinorBrief(amount.minor, FORM_CURRENCY)} buys, tier ${n + 1} of ${of}, as a short phrase`,
				`${at}/tiers/${n}/buys`
			);
		}
		case 'faq': {
			const item = block.items[n];
			if (item === undefined) return null;
			if (list === 'question') {
				return plain(
					QUESTION_MAX,
					`question ${n + 1} of ${of}: one a donor asks before giving`,
					`${at}/items/${n}/question`
				);
			}
			if (list === 'answer') {
				const question = (beside ?? item.question).trim();
				return rich(
					`the answer to question ${n + 1} of ${of}, ${question === '' ? 'whose question is not written yet' : `"${question}"`}`,
					`${at}/items/${n}/answer`
				);
			}
			return null;
		}
		default:
			return null;
	}
}

/** a tier's amount as the open sheet holds it; a tier's amount is above zero (./catalog.ts). */
function tierAmount(text: string): AmountRead {
	const read = readAmount(text, FORM_CURRENCY);
	return read.minor === 0 ? { minor: null, problem: 'must be above zero' } : read;
}

function plain(max: number, what: string, pointer: string): ResolvedBox {
	return { ok: true, box: { kind: 'plain', max, what, target: { in: 'page', pointer } } };
}

function rich(what: string, pointer: string): ResolvedBox {
	return { ok: true, box: { kind: 'rich', max: TEXT_MAX, what, target: { in: 'page', pointer } } };
}
