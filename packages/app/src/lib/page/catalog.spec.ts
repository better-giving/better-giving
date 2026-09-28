import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FAQ_MAX, HEADING_MAX, ID_MAX, parsePage, SHARE_MESSAGE_MAX, TIERS_MAX } from './catalog';

// node pool, no database: the rule is a pure function of the page type and the document.

const box = { id: 'donate', type: 'donation-box', background: 'none' };

function page(blocks: unknown[], rest: Record<string, unknown> = {}) {
	return {
		layout: 'box-right',
		palette: 'tint',
		switches: { openOnMonthly: false, dedicationOn: false },
		blocks,
		...rest
	};
}

describe('which blocks a page holds', () => {
	it('refuses a block it has no name for, naming it and where', () => {
		const result = parsePage(
			'campaign',
			page([box, { id: 'x', type: 'carousel', variant: 'wide' }])
		);
		expect(result).toEqual({
			ok: false,
			path: ['blocks', 1, 'type'],
			message:
				'block 2 (id "x"): "carousel" is not a block; a page holds title, story, impact-tiers, faq, about-us, org-info, share, goal-bar, program-chooser and the donation box'
		});
	});

	it.each([
		[
			'donation_page',
			{ id: 'goal', type: 'goal-bar', variant: 'bar', background: 'none' },
			'block 1 (id "goal"): the Donation page takes no goal-bar; only a campaign does'
		],
		[
			'campaign',
			{ id: 'programs', type: 'program-chooser', variant: 'cards', background: 'none' },
			'block 1 (id "programs"): a campaign takes no program-chooser; only the Donation page does'
		]
	] as const)('refuses on a %s the block its type forbids', (type, forbidden, message) => {
		expect(parsePage(type, page([forbidden, box]))).toEqual({
			ok: false,
			path: ['blocks', 0, 'type'],
			message
		});
	});

	it.each([
		['donation_page', { id: 'programs', type: 'program-chooser', variant: 'cards' }],
		['campaign', { id: 'goal', type: 'goal-bar', variant: 'bar' }]
	] as const)('accepts on a %s the block only its type takes', (type, only) => {
		const blocks = [{ ...only, background: 'none' }, box];
		expect(parsePage(type, page(blocks))).toEqual({ ok: true, page: page(blocks) });
	});
});

describe('the donation box', () => {
	it('accepts a page holding exactly one', () => {
		const result = parsePage('donation_page', page([box]));
		expect(result).toEqual({ ok: true, page: page([box]) });
	});

	it('refuses a page with none, at the block list', () => {
		expect(parsePage('campaign', page([]))).toEqual({
			ok: false,
			path: ['blocks'],
			message: 'a page holds exactly one donation box, and this one holds none'
		});
	});

	it('names it as a screen does when it carries a key it has no use for', () => {
		expect(parsePage('campaign', page([{ ...box, variant: 'wide' }]))).toEqual({
			ok: false,
			path: ['blocks', 0],
			message:
				'block 1 (id "donate"): the donation box carries no "variant"; it carries id, type and background'
		});
	});

	it('refuses a second one, naming it and the first', () => {
		const second = { ...box, id: 'donate-again' };
		expect(parsePage('campaign', page([box, second]))).toEqual({
			ok: false,
			path: ['blocks', 1],
			message:
				'block 2 (id "donate-again"): a page holds exactly one donation box, and block 1 (id "donate") is one'
		});
	});
});

describe('the closed sets', () => {
	const body = { type: 'doc', content: [{ type: 'paragraph' }] };

	it.each([
		[
			'layout',
			page([box], { layout: 'grid' }),
			['layout'],
			'"grid" is not a layout; a page is laid out box-right, banner, column or cover'
		],
		[
			'palette',
			page([box], { palette: '#ff0000' }),
			['palette'],
			'"#ff0000" is not a palette; a page takes plain, tint, duo, bright or bold'
		],
		[
			'variant',
			page([box, { id: 'faq', type: 'faq', variant: 'grid', background: 'none' }]),
			['blocks', 1, 'variant'],
			'block 2 (id "faq"): "grid" is not a variant of faq; it is accordion or open'
		],
		[
			'background',
			page([box, { id: 'about', type: 'about-us', variant: 'stacked', background: 'red' }]),
			['blocks', 1, 'background'],
			'block 2 (id "about"): "red" is not a background about-us takes; it takes none, soft, tint or strong'
		],
		[
			'background its row disallows',
			page([box, { id: 'story', type: 'story', variant: 'plain', background: 'strong', body }]),
			['blocks', 1, 'background'],
			'block 2 (id "story"): "strong" is not a background story takes; it takes none, soft or tint'
		]
	])('refuses an off-list %s, naming it and the list', (_, input, path, message) => {
		expect(parsePage('campaign', input)).toEqual({ ok: false, path, message });
	});
});

describe('what a block carries', () => {
	const title = { id: 'title', type: 'title', variant: 'left', background: 'none' };

	it('accepts a title with a heading and a lede', () => {
		const blocks = [
			{ ...title, heading: 'Clean water for Kisumu', lede: 'Every tap counts.' },
			box
		];
		expect(parsePage('campaign', page(blocks))).toEqual({ ok: true, page: page(blocks) });
	});

	it('refuses a heading over its length, naming the limit', () => {
		const heading = 'x'.repeat(HEADING_MAX + 1);
		expect(parsePage('campaign', page([{ ...title, heading }, box]))).toEqual({
			ok: false,
			path: ['blocks', 0, 'heading'],
			message: `block 1 (id "title"): a heading holds at most ${HEADING_MAX} characters`
		});
	});

	it.each(['colour', 'href', 'html', 'onClick'])('refuses a %s prop, naming it', (key) => {
		expect(parsePage('campaign', page([{ ...title, heading: 'Hi', [key]: 'x' }, box]))).toEqual({
			ok: false,
			path: ['blocks', 0],
			message: `block 1 (id "title"): title carries no "${key}"; it carries id, type, variant, background, heading and lede`
		});
	});
});

describe('rich text and lists in a block', () => {
	const doc = (text: string) => ({
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
	});
	const story = { id: 'story', type: 'story', variant: 'plain', background: 'none' };
	const tiers = { id: 'impact', type: 'impact-tiers', variant: 'cards', background: 'none' };
	const faq = { id: 'faq', type: 'faq', variant: 'open', background: 'none' };

	it('holds a story to the rich-text rule', () => {
		const result = parsePage('campaign', page([box, { ...story, body: '<p>hi</p>' }]));
		expect(result).toEqual({
			ok: false,
			path: ['blocks', 1, 'body'],
			message:
				'block 2 (id "story"): a document is Tiptap JSON, an object of type "doc", not a string, and HTML is refused'
		});
	});

	it('refuses a seventh impact tier', () => {
		const tier = { amountMinor: 2500, buys: 'a water filter' };
		const result = parsePage('campaign', page([box, { ...tiers, tiers: Array(7).fill(tier) }]));
		expect(result).toEqual({
			ok: false,
			path: ['blocks', 1, 'tiers'],
			message: `block 2 (id "impact"): an impact-tiers block holds at most ${TIERS_MAX} tiers`
		});
	});

	it('refuses a tier that does not say what it buys', () => {
		const result = parsePage(
			'campaign',
			page([box, { ...tiers, tiers: [{ amountMinor: 2500, buys: '' }] }])
		);
		expect(result).toEqual({
			ok: false,
			path: ['blocks', 1, 'tiers', 0, 'buys'],
			message: 'block 2 (id "impact"): a tier says what its amount buys'
		});
	});

	it('refuses a tier whose amount is not a whole positive number of minor units', () => {
		const result = parsePage(
			'campaign',
			page([box, { ...tiers, tiers: [{ amountMinor: 25.5, buys: 'a filter' }] }])
		);
		expect(result).toEqual({
			ok: false,
			path: ['blocks', 1, 'tiers', 0, 'amountMinor'],
			message: 'block 2 (id "impact"): a tier’s amount is a whole number of minor units above zero'
		});
	});

	it('refuses an eleventh question', () => {
		const item = { question: 'Is it tax-deductible?', answer: doc('Yes.') };
		const result = parsePage('campaign', page([box, { ...faq, items: Array(11).fill(item) }]));
		expect(result).toEqual({
			ok: false,
			path: ['blocks', 1, 'items'],
			message: `block 2 (id "faq"): a faq holds at most ${FAQ_MAX} questions`
		});
	});

	it('holds an answer to the rich-text rule', () => {
		const item = {
			question: 'Where does it go?',
			answer: { type: 'doc', content: [{ type: 'heading' }] }
		};
		const result = parsePage('campaign', page([box, { ...faq, items: [item] }]));
		expect(result).toEqual({
			ok: false,
			path: ['blocks', 1, 'items', 0, 'answer', 'content', 0, 'type'],
			message:
				'block 2 (id "faq"): "heading" is not allowed in a document; it holds paragraphs, bulleted lists and numbered lists'
		});
	});
});

describe('a block id', () => {
	const share = { type: 'share', variant: 'buttons', background: 'none' };

	it('refuses a second block under an id already taken, naming both', () => {
		const result = parsePage('campaign', page([{ ...share, id: 'donate' }, box]));
		expect(result).toEqual({
			ok: false,
			path: ['blocks', 1, 'id'],
			message: 'block 2 (id "donate"): an id names one block, and block 1 already has it'
		});
	});

	it.each(['', 'has space', 'x'.repeat(ID_MAX + 1)])('refuses the id %j', (id) => {
		const result = parsePage('campaign', page([{ ...share, id }, box]));
		expect(result).toMatchObject({
			ok: false,
			path: ['blocks', 0, 'id'],
			message: expect.stringContaining(`an id is 1 to ${ID_MAX} letters, digits, "-" or "_"`)
		});
	});
});

describe('what a page carries beside its blocks', () => {
	const endsAt = Date.UTC(2026, 11, 31);

	it('accepts a campaign with a goal, an end date, its own look and a share message', () => {
		const input = page([box], {
			goalMinor: 5_000_000,
			endsAt,
			look: { shade: 'warm', corner: 'round', brandColour: '#1f6feb' },
			shareMessage: 'I just gave to clean water. Join me?'
		});
		expect(parsePage('campaign', input)).toEqual({ ok: true, page: input });
	});

	it('reads a null look as the organisation’s', () => {
		expect(parsePage('campaign', page([box], { look: null }))).toEqual({
			ok: true,
			page: page([box], { look: null })
		});
	});

	it('refuses a partial look, naming the key it lacks', () => {
		expect(parsePage('campaign', page([box], { look: { shade: 'warm' } }))).toMatchObject({
			ok: false,
			path: ['look', 'corner']
		});
	});

	it.each([
		['goalMinor', 5_000_000, 'the Donation page has no goal; only a campaign does'],
		['endsAt', endsAt, 'the Donation page has no end date; only a campaign does']
	])('refuses %s on the Donation page', (key, value, message) => {
		expect(parsePage('donation_page', page([box], { [key]: value }))).toEqual({
			ok: false,
			path: [key],
			message
		});
	});

	it.each([
		[{ shade: 'warm', corner: 'round', brandColour: 'red' }, ['look', 'brandColour']],
		[{ shade: 'dusk', corner: 'round', brandColour: '#1f6feb' }, ['look', 'shade']],
		[{ shade: 'warm', corner: 'pill', brandColour: '#1f6feb' }, ['look', 'corner']],
		[{ shade: 'warm', corner: 'round', brandColour: '#1F6FEB' }, ['look', 'brandColour']]
	])('refuses the look %j off its closed sets', (look, path) => {
		expect(parsePage('campaign', page([box], { look }))).toMatchObject({ ok: false, path });
	});

	it('refuses a share message over its length', () => {
		const shareMessage = 'x'.repeat(SHARE_MESSAGE_MAX + 1);
		expect(parsePage('campaign', page([box], { shareMessage }))).toEqual({
			ok: false,
			path: ['shareMessage'],
			message: `a share message holds at most ${SHARE_MESSAGE_MAX} characters`
		});
	});

	it('carries the draft donation settings through unread', () => {
		const settings = { min_minor: 500, suggested_amounts: [2500, 5000], program_mode: 'none' };
		expect(parsePage('donation_page', page([box], { settings }))).toEqual({
			ok: true,
			page: page([box], { settings })
		});
	});
});

describe('the rule reads shape only, never the page’s data', () => {
	const blank = { type: 'doc', content: [{ type: 'paragraph' }] };

	it('accepts on a campaign every block with nothing to show, which leaves itself out at render', () => {
		const blocks = [
			{ id: 'title', type: 'title', variant: 'left', background: 'none', heading: '' },
			{ id: 'goal', type: 'goal-bar', variant: 'bar', background: 'none' },
			{ id: 'story', type: 'story', variant: 'plain', background: 'none', body: blank },
			{ id: 'impact', type: 'impact-tiers', variant: 'list', background: 'none', tiers: [] },
			{ id: 'faq', type: 'faq', variant: 'accordion', background: 'none', items: [] },
			{ id: 'about', type: 'about-us', variant: 'statement', background: 'strong' },
			box,
			{ id: 'share', type: 'share', variant: 'icons', background: 'soft' },
			{ id: 'footer', type: 'org-info', variant: 'card', background: 'none' }
		];
		expect(parsePage('campaign', page(blocks))).toEqual({ ok: true, page: page(blocks) });
	});

	it('accepts a program chooser on a Donation page with no settings to choose among', () => {
		const blocks = [
			{ id: 'programs', type: 'program-chooser', variant: 'list', background: 'none' },
			box
		];
		expect(parsePage('donation_page', page(blocks))).toEqual({ ok: true, page: page(blocks) });
	});
});

describe('one rule', () => {
	it('is the only function the catalog exports, and no schema it exports passes a page', async () => {
		const exported = Object.entries(await import('./catalog'));
		const functions = exported.filter(([, value]) => typeof value === 'function');
		expect(functions.map(([name]) => name)).toEqual(['parsePage']);
		const valid = page([box]);
		expect(parsePage('campaign', valid).ok).toBe(true);
		for (const [name, value] of exported) {
			if (value instanceof z.ZodType)
				expect([name, value.safeParse(valid).success]).toEqual([name, false]);
		}
	});

	it('reaches json-render from the drafting side alone, so an upgrade there never touches a stored page', () => {
		const src = resolve(import.meta.dirname, '../..');
		const reaching = readdirSync(src, { recursive: true, encoding: 'utf8' })
			.filter((file) => /\.tsx?$/.test(file) && !/\.spec\.tsx?$/.test(file))
			.filter((file) => /from '@json-render\//.test(readFileSync(join(src, file), 'utf8')));
		expect(reaching).toEqual([join('lib', 'page', 'ai-catalog.ts')]);
	});
});
