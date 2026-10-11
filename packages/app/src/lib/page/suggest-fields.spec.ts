import { describe, expect, it } from 'vitest';
import type { Block, Page } from './catalog';
import { defaultCampaign, defaultDonationPage } from './defaults';
import { richTextOf, suggestBox } from './suggest-fields';

// node pool, no database: which boxes a page's editors may ask the AI for, and how a box is told
// the model, is a pure reading of the draft and the request.

function campaignWith(...blocks: Block[]): Page {
	return { ...defaultCampaign(), blocks: [...defaultCampaign().blocks, ...blocks] };
}

const TIERS: Block = {
	id: 'tiers',
	type: 'impact-tiers',
	variant: 'cards',
	background: 'none',
	tiers: [{ amountMinor: 2500, buys: 'A coat' }]
};

const FAQ: Block = {
	id: 'faq',
	type: 'faq',
	variant: 'accordion',
	background: 'none',
	items: [{ question: 'Where do the coats go?', answer: richTextOf('To the shelter.') }]
};

function what(resolved: ReturnType<typeof suggestBox>) {
	if (!resolved.ok) throw new Error(`expected a box, got: ${resolved.error}`);
	return resolved.box.what;
}

describe('the box beside the one asked for', () => {
	it('is the tier’s amount as the sheet holds it, over the stored one', () => {
		const resolved = suggestBox(campaignWith(TIERS), 'campaign', 'tiers', 'tier_buys[0]', '100');

		expect(what(resolved)).toBe(
			'what a gift of $100 buys, tier 1 of block 8 (id "tiers"), as a short phrase'
		);
	});

	it.each([
		['grouped', '1,000', 'must be an amount, write 25.00 for $25.00'],
		['blank', '', 'must be an amount, write 25.00 for $25.00'],
		['zero', '0', 'must be above zero']
	])('refuses a tier amount that is %s, naming it', (_, beside, problem) => {
		const resolved = suggestBox(campaignWith(TIERS), 'campaign', 'tiers', 'tier_buys[0]', beside);

		expect(resolved).toEqual({
			ok: false,
			error: `beside "${beside}" ${problem}: send tier 1’s amount as the sheet holds it, ungrouped`
		});
	});

	it('is the question’s words as the sheet holds them, for its answer', () => {
		const resolved = suggestBox(
			campaignWith(FAQ),
			'campaign',
			'faq',
			'answer[0]',
			'Who gets a coat?'
		);

		expect(what(resolved)).toBe(
			'the answer to question 1 of block 8 (id "faq"), "Who gets a coat?"'
		);
	});

	it('says the question is not written yet where the sheet holds it blank', () => {
		const resolved = suggestBox(campaignWith(FAQ), 'campaign', 'faq', 'answer[0]', ' ');

		expect(what(resolved)).toBe(
			'the answer to question 1 of block 8 (id "faq"), whose question is not written yet'
		);
	});

	it.each([
		['the heading', 'title', 'heading', 'the heading of block 2 (id "title"), the page’s headline'],
		[
			'a question',
			'faq',
			'question[0]',
			'question 1 of block 8 (id "faq"): one a donor asks before giving'
		]
	])('is ignored for %s', (_, block, field, told) => {
		const resolved = suggestBox(campaignWith(FAQ), 'campaign', block, field, 'not an amount');

		expect(what(resolved)).toBe(told);
	});
});

describe('the boxes a page offers', () => {
	it.each([
		['hero', 'framed'],
		['image', 'wide']
	] as const)('offers no description of a placed photo in the %s block', (type, variant) => {
		const photo = {
			id: 'photo',
			type,
			variant,
			background: 'none',
			imageId: '01a12858-5d63-7b47-b122-cb8befd53843',
			alt: ''
		} as Block;

		const resolved = suggestBox(campaignWith(photo), 'campaign', 'photo', 'alt');

		expect(resolved).toEqual({
			ok: false,
			error: `field "alt" is no text box: block "photo" (${type}) has none`
		});
	});

	it('reaches the boxes of a block whose id is "page"', () => {
		const named: Block = {
			id: 'page',
			type: 'title',
			variant: 'left',
			background: 'none',
			heading: ''
		};

		const resolved = suggestBox(campaignWith(named), 'campaign', 'page', 'heading');

		expect(what(resolved)).toBe('the heading of block 8 (id "page"), the page’s headline');
	});

	it.each([
		['heading', 'title', 'heading', 'plain', { in: 'page', pointer: '/blocks/1/props/heading' }],
		['lede', 'title', 'lede', 'plain', { in: 'page', pointer: '/blocks/1/props/lede' }],
		['story', 'story', 'body', 'rich', { in: 'page', pointer: '/blocks/3/props/body' }],
		[
			'tier',
			'tiers',
			'tier_buys[0]',
			'plain',
			{ in: 'page', pointer: '/blocks/7/props/tiers/0/buys' }
		],
		[
			'question',
			'faq',
			'question[0]',
			'plain',
			{ in: 'page', pointer: '/blocks/8/props/items/0/question' }
		],
		[
			'answer',
			'faq',
			'answer[0]',
			'rich',
			{ in: 'page', pointer: '/blocks/8/props/items/0/answer' }
		],
		['name', 'page', 'name', 'plain', { in: 'set', key: 'name' }],
		['share message', 'page', 'share_message', 'plain', { in: 'set', key: 'shareMessage' }]
	])('offers a campaign’s %s', (_, block, field, kind, target) => {
		const resolved = suggestBox(campaignWith(TIERS, FAQ), 'campaign', block, field);

		expect(resolved).toMatchObject({ ok: true, box: { kind, target } });
	});

	it.each([
		[
			'a row the block does not hold',
			'tiers',
			'tier_buys[1]',
			'field "tier_buys[1]" is no text box of block "tiers" (impact-tiers); its text boxes are tier_buys[0]'
		],
		[
			'a block with no text box',
			'donate',
			'heading',
			'field "heading" is no text box: block "donate" (donation-box) has none'
		],
		[
			'a block the draft has no such id for',
			'hero-2',
			'heading',
			'block "hero-2" is no block of this page’s draft'
		],
		[
			'a page box no block or page answers',
			'page',
			'heading',
			'field "heading" is no text box of a campaign; its own boxes are name and share_message'
		]
	])('refuses %s, naming it', (_, block, field, error) => {
		const resolved = suggestBox(campaignWith(TIERS, FAQ), 'campaign', block, field);

		expect(resolved).toEqual({ ok: false, error: expect.stringContaining(error) });
	});

	it('offers the Donation page its share message and no name', () => {
		const page = defaultDonationPage();

		expect(suggestBox(page, 'donation_page', 'page', 'share_message')).toMatchObject({ ok: true });
		expect(suggestBox(page, 'donation_page', 'page', 'name')).toEqual({
			ok: false,
			error: 'field "name" is no text box of the Donation page; its own boxes are share_message'
		});
	});

	it('keeps the page’s own name where a block’s id is "page"', () => {
		const named: Block = {
			id: 'page',
			type: 'title',
			variant: 'left',
			background: 'none',
			heading: ''
		};

		const resolved = suggestBox(campaignWith(named), 'campaign', 'page', 'name');

		expect(resolved).toMatchObject({ ok: true, box: { target: { in: 'set', key: 'name' } } });
	});
});
