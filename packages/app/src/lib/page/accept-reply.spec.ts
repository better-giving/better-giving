import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acceptReply } from './accept-reply';
import type { Page } from './catalog';
import { defaultCampaign, defaultDonationPage } from './defaults';

// node pool, no database, no model: a reply is the text a model would answer with, and every case
// is one reply through the one door.

const settings = {
	revenueAccountId: '4110',
	minMinor: 500,
	maxMinor: 100_000,
	currency: 'USD',
	programMode: 'none',
	programId: null,
	suggestedAmounts: [2500, 5000],
	allowedOrigins: []
} as const satisfies Page['settings'];

function campaign(): Page {
	return {
		...defaultCampaign(),
		settings: { ...settings, suggestedAmounts: [2500, 5000], allowedOrigins: [] }
	};
}

function accept(reply: unknown, rest: Partial<Parameters<typeof acceptReply>[0]> = {}) {
	return acceptReply({
		type: 'campaign',
		current: campaign(),
		name: 'Winter coats',
		reply: typeof reply === 'string' ? reply : JSON.stringify(reply),
		attached: [],
		messages: [],
		activePrograms: [],
		timeZone: 'America/New_York',
		now: Date.parse('2026-09-28T16:00:00Z'),
		...rest
	});
}

describe('a reply off the reply schema', () => {
	it.each([
		['not JSON', 'Sure! Here is your page.', 'the reply is not JSON'],
		['no say', { page: { kind: 'merge', doc: { palette: 'duo' } } }, 'say: '],
		['an unknown page edit', { say: 'Done.', page: { kind: 'rewrite', doc: {} } }, 'page.kind: ']
	])('is refused when %s, handing current back unchanged', (_, reply, reason) => {
		const current = campaign();
		const result = accept(reply, { current });
		expect(result).toEqual({ ok: false, reason: expect.stringContaining(reason), current });
		expect(current).toEqual(campaign());
	});
});

describe('a reply that edits the page', () => {
	it('lands a patch addressed to the page as the model reads it', () => {
		const result = accept({
			say: 'I centred the title and wrote a lede.',
			page: {
				kind: 'patch',
				ops: [
					{ op: 'replace', path: '/blocks/0/variant', value: 'center' },
					{ op: 'add', path: '/blocks/0/props/lede', value: 'Keep a neighbour warm.' }
				]
			}
		});
		expect(result).toMatchObject({
			ok: true,
			say: 'I centred the title and wrote a lede.',
			draft: {
				...campaign(),
				blocks: [
					{
						id: 'title',
						type: 'title',
						variant: 'center',
						background: 'none',
						heading: '',
						lede: 'Keep a neighbour warm.'
					},
					...campaign().blocks.slice(1)
				]
			}
		});
	});

	it('lands a merge of layout and palette', () => {
		const result = accept({
			say: 'Bolder.',
			page: { kind: 'merge', doc: { layout: 'cover', palette: 'bold' } }
		});
		expect(result).toMatchObject({
			ok: true,
			draft: { ...campaign(), layout: 'cover', palette: 'bold' }
		});
	});

	it('is refused whole when the page it makes breaks the rule, current handed back unchanged', () => {
		const current = campaign();
		const result = accept(
			{
				say: 'Removed the box.',
				page: { kind: 'patch', ops: [{ op: 'remove', path: '/blocks/3' }] }
			},
			{ current }
		);
		expect(result).toEqual({
			ok: false,
			reason: 'blocks: a page holds exactly one donation box, and this one holds none',
			current
		});
	});

	it.each([
		[
			'a goal bar on the Donation page',
			'donation_page' as const,
			{ id: 'goal', type: 'goal-bar', variant: 'bar', background: 'none', props: {} },
			'the Donation page takes no goal-bar; only a campaign does'
		],
		[
			'a program chooser on a campaign',
			'campaign' as const,
			{ id: 'programs', type: 'program-chooser', variant: 'cards', background: 'none', props: {} },
			'a campaign takes no program-chooser; only the Donation page does'
		]
	])('refuses %s', (_, type, block, reason) => {
		const current = type === 'campaign' ? campaign() : defaultDonationPage({ name: 'Harbour' });
		const result = accept(
			{
				say: 'Added it.',
				page: { kind: 'patch', ops: [{ op: 'add', path: '/blocks/1', value: block }] }
			},
			{ type, current, name: type === 'campaign' ? 'Winter coats' : null }
		);
		expect(result).toEqual({ ok: false, reason: expect.stringContaining(reason), current });
	});
});

describe('what a reply never changes', () => {
	const look = { shade: 'warm', corner: 'round', brandColour: '#aa3300' };

	it.each([
		[
			'a look by patch',
			{ kind: 'patch', ops: [{ op: 'add', path: '/look', value: look }] },
			'"look"'
		],
		['a look by merge', { kind: 'merge', doc: { look } }, '"look"'],
		[
			'a switch',
			{ kind: 'patch', ops: [{ op: 'replace', path: '/switches/openOnMonthly', value: true }] },
			'"switches"'
		],
		[
			'the fund',
			{
				kind: 'patch',
				ops: [{ op: 'replace', path: '/settings/revenueAccountId', value: '4120' }]
			},
			'"settings"'
		],
		[
			'a share message moved in',
			{ kind: 'patch', ops: [{ op: 'move', from: '/shareMessage', path: '/blocks/0/props/lede' }] },
			'"shareMessage"'
		],
		[
			'the whole document',
			{
				kind: 'patch',
				ops: [
					{ op: 'replace', path: '', value: { layout: 'column', palette: 'duo', blocks: [], look } }
				]
			},
			'"look"'
		]
	])('refuses %s through a page edit', (_, page, key) => {
		const current = campaign();
		const result = accept({ say: 'Changed it.', page }, { current });
		expect(result).toEqual({
			ok: false,
			reason: expect.stringMatching(
				new RegExp(`^a page edit reaches layout, palette and blocks only, not ${key}`)
			),
			current
		});
	});

	it('names set as the way to a goal', () => {
		const result = accept({
			say: 'Goal set.',
			page: { kind: 'merge', doc: { goalMinor: 500_000 } }
		});
		expect(result).toMatchObject({
			ok: false,
			reason:
				'a page edit reaches layout, palette and blocks only, not "goalMinor"; a goal goes through set'
		});
	});

	it.each([
		['the fund', 'revenueAccountId', '4120'],
		['a payment option', 'paymentMethods', ['card']],
		['the look', 'look', look],
		['a switch', 'switches', { openOnMonthly: true, dedicationOn: false }]
	])('refuses %s through set', (_, key, value) => {
		const current = campaign();
		const result = accept({ say: 'Changed it.', set: { [key]: value } }, { current });
		expect(result).toEqual({
			ok: false,
			reason: `set: a reply sets only name, goalMinor, endDate, programId and suggestedAmounts, not "${key}"`,
			current
		});
	});
});

describe('what a reply sets', () => {
	const programs = [
		{ id: 'prg_coats', name: 'Coats' },
		{ id: 'prg_meals', name: 'Meals' }
	];

	it('returns each change to a campaign’s name, goal, end date, program and amounts', () => {
		// new york is on EST by 31 December, UTC-5
		const endsAt = Date.parse('2027-01-01T05:00:00Z') - 1;
		const result = accept(
			{
				say: 'Renamed it, set a $5,000 goal ending 31 December, pinned it to Coats and suggested $30 and $60.',
				set: {
					name: '  Coats for winter ',
					goalMinor: 500_000,
					endDate: '2026-12-31',
					programId: 'prg_coats',
					suggestedAmounts: [3000, 6000]
				}
			},
			{ activePrograms: programs }
		);
		expect(result).toEqual({
			ok: true,
			say: 'Renamed it, set a $5,000 goal ending 31 December, pinned it to Coats and suggested $30 and $60.',
			name: 'Coats for winter',
			draft: {
				...campaign(),
				goalMinor: 500_000,
				endsAt,
				settings: {
					...settings,
					programMode: 'pinned',
					programId: 'prg_coats',
					suggestedAmounts: [3000, 6000]
				}
			},
			changes: [
				{ field: 'name', from: 'Winter coats', to: 'Coats for winter' },
				{ field: 'goal', from: null, to: 500_000 },
				{ field: 'endDate', from: null, to: '2026-12-31' },
				{ field: 'program', from: null, to: 'prg_coats' },
				{ field: 'amounts', from: [2500, 5000], to: [3000, 6000] }
			],
			dropped: []
		});
	});

	it('returns no change for a value set to what it already is', () => {
		// the end of 31 December where the operator who set it was, in london
		const current = {
			...campaign(),
			goalMinor: 500_000,
			endsAt: Date.parse('2027-01-01T00:00:00Z') - 1
		};
		const result = accept(
			{
				say: 'Kept it.',
				set: {
					name: 'Winter coats',
					goalMinor: 500_000,
					endDate: '2026-12-31',
					suggestedAmounts: [2500, 5000]
				}
			},
			{ current }
		);
		expect(result).toMatchObject({ ok: true, draft: current, changes: [] });
	});

	it.each([
		['name', { name: 'Spring' }, 'the Donation page has no name; only a campaign does'],
		['goalMinor', { goalMinor: 100_000 }, 'the Donation page has no goal; only a campaign does'],
		[
			'endDate',
			{ endDate: '2027-01-01' },
			'the Donation page has no end date; only a campaign does'
		]
	])('refuses a %s on the Donation page', (_, set, reason) => {
		const current = {
			...defaultDonationPage({ name: 'Harbour' }),
			settings: { ...settings, suggestedAmounts: [], allowedOrigins: [] }
		};
		const result = accept({ say: 'Done.', set }, { type: 'donation_page', current, name: null });
		expect(result).toEqual({ ok: false, reason, current });
	});

	it('reports an end date moved to another day as the day it moved from', () => {
		const current = { ...campaign(), endsAt: Date.parse('2027-01-01T05:00:00Z') - 1 };
		const result = accept({ say: 'A week longer.', set: { endDate: '2027-01-07' } }, { current });
		expect(result).toMatchObject({
			ok: true,
			draft: { endsAt: Date.parse('2027-01-08T05:00:00Z') - 1 },
			changes: [{ field: 'endDate', from: '2026-12-31', to: '2027-01-07' }]
		});
	});

	it.each([
		[
			'not a day',
			'2026-02-30',
			'set.endDate: "2026-02-30" is not a day; an end date is written YYYY-MM-DD'
		],
		['a day already over', '2026-09-27', 'set.endDate: 2026-09-27 is already over']
	])('refuses an end date that is %s', (_, endDate, reason) => {
		const current = campaign();
		const result = accept({ say: 'Ends then.', set: { endDate } }, { current });
		expect(result).toEqual({ ok: false, reason, current });
	});

	it('refuses a program that is not active, naming the ones that are', () => {
		const current = campaign();
		const result = accept(
			{ say: 'Pinned.', set: { programId: 'prg_old' } },
			{ current, activePrograms: programs }
		);
		expect(result).toEqual({
			ok: false,
			reason:
				'set.programId: "prg_old" is not an active program; the active ones are prg_coats (Coats) and prg_meals (Meals)',
			current
		});
	});

	it.each([
		[[300, 2500], 'set.suggestedAmounts: $3 must be more than smallest gift of $5'],
		[[2500, 150_000], 'set.suggestedAmounts: $1,500 must be less than largest gift of $1,000']
	])(
		'refuses suggested amounts %j outside the page’s bounds, naming the bound',
		(suggestedAmounts, reason) => {
			const current = campaign();
			const result = accept({ say: 'New amounts.', set: { suggestedAmounts } }, { current });
			expect(result).toEqual({ ok: false, reason, current });
		}
	);
});

describe('an impact figure', () => {
	const tiers = (amounts: number[]) => ({
		id: 'impact',
		type: 'impact-tiers',
		variant: 'cards',
		background: 'none',
		props: {
			tiers: amounts.map((amountMinor) => ({ amountMinor, buys: `what ${amountMinor} buys` }))
		}
	});
	const addTiers = (amounts: number[]) => ({
		say: 'Added impact tiers.',
		page: { kind: 'patch', ops: [{ op: 'add', path: '/blocks/2', value: tiers(amounts) }] }
	});
	const operator = (text: string) => ({ author: 'operator' as const, text });
	const tiersOf = (result: ReturnType<typeof accept>) =>
		result.ok ? result.draft.blocks.find((block) => block.type === 'impact-tiers') : undefined;

	it('is kept when the operator stated it, and dropped and noted when nobody did', () => {
		const result = accept(addTiers([2500, 7500]), {
			messages: [operator('$25 buys a coat for a child.')]
		});
		expect(tiersOf(result)).toMatchObject({ tiers: [{ amountMinor: 2500 }] });
		expect(result).toMatchObject({
			ok: true,
			dropped: [{ what: 'tier', blockId: 'impact', amountMinor: 7500 }]
		});
	});

	it('is not the operator’s when only the assistant said it', () => {
		const result = accept(addTiers([2500]), {
			messages: [{ author: 'assistant', text: 'Shall I say $25 buys a coat?' }, operator('yes')]
		});
		expect(tiersOf(result)).toMatchObject({ tiers: [] });
	});

	it('stands when the page already held it, set by hand', () => {
		const current = campaign();
		current.blocks.splice(2, 0, {
			id: 'impact',
			type: 'impact-tiers',
			variant: 'list',
			background: 'none',
			tiers: [{ amountMinor: 4000, buys: 'boots' }]
		});
		const result = accept(
			{
				say: 'Cards now.',
				page: { kind: 'patch', ops: [{ op: 'replace', path: '/blocks/2/variant', value: 'cards' }] }
			},
			{ current }
		);
		expect(tiersOf(result)).toEqual({
			id: 'impact',
			type: 'impact-tiers',
			variant: 'cards',
			background: 'none',
			tiers: [{ amountMinor: 4000, buys: 'boots' }]
		});
	});

	it.each([
		['$25', 2500],
		['$ 25', 2500],
		['$1,000', 100_000],
		['$12.50', 1250],
		['25 dollars', 2500],
		['1 dollar', 100],
		['USD 40', 4000],
		['40 usd', 4000],
		['US$75', 7500]
	])('reads %j as a figure the operator stated', (text, amountMinor) => {
		const result = accept(addTiers([amountMinor]), {
			messages: [operator(`about ${text}, thanks`)]
		});
		expect(tiersOf(result)).toMatchObject({ tiers: [{ amountMinor }] });
	});

	it.each([
		['25 children', 2500],
		['25', 2500],
		['$12.505', 1250],
		['$1,00', 100]
	])('does not read %j as the figure %i', (text, amountMinor) => {
		const result = accept(addTiers([amountMinor]), { messages: [operator(text)] });
		expect(tiersOf(result)).toMatchObject({ tiers: [] });
	});
});

describe('a link', () => {
	const linked = (text: string, href: string) => ({
		type: 'text' as const,
		text,
		marks: [{ type: 'bold' as const }, { type: 'link' as const, attrs: { href } }]
	});
	const withStory = (): Page => {
		const page = campaign();
		page.blocks[2] = {
			id: 'story',
			type: 'story',
			variant: 'plain',
			background: 'none',
			body: {
				type: 'doc',
				content: [
					{ type: 'paragraph', content: [linked('our report', 'https://harbour.org/report')] }
				]
			}
		};
		return page;
	};

	it('from the AI loses its link and keeps its text, noted; one already on the page is kept', () => {
		const result = accept(
			{
				say: 'Added a line.',
				page: {
					kind: 'patch',
					ops: [
						{
							op: 'add',
							path: '/blocks/2/props/body/content/-',
							value: {
								type: 'paragraph',
								content: [
									linked('donate on our site', 'https://evil.example/pay'),
									linked('the report', 'https://harbour.org/report')
								]
							}
						}
					]
				}
			},
			{ current: withStory() }
		);
		expect(result).toMatchObject({
			ok: true,
			dropped: [{ what: 'link', href: 'https://evil.example/pay', text: 'donate on our site' }]
		});
		const story = result.ok ? result.draft.blocks[2] : undefined;
		expect(story).toMatchObject({
			body: {
				content: [
					{ content: [linked('our report', 'https://harbour.org/report')] },
					{
						content: [
							{ type: 'text', text: 'donate on our site', marks: [{ type: 'bold' }] },
							linked('the report', 'https://harbour.org/report')
						]
					}
				]
			}
		});
	});

	it('changed to a new address loses its link, as a new one would', () => {
		const result = accept(
			{
				say: 'Updated the link.',
				page: {
					kind: 'patch',
					ops: [
						{
							op: 'replace',
							path: '/blocks/2/props/body/content/0/content/0/marks/1/attrs/href',
							value: 'https://harbour.org/report?ref=ai'
						}
					]
				}
			},
			{ current: withStory() }
		);
		expect(result).toMatchObject({
			ok: true,
			dropped: [{ what: 'link', href: 'https://harbour.org/report?ref=ai' }]
		});
		const story = result.ok ? result.draft.blocks[2] : undefined;
		expect(story).toMatchObject({
			body: { content: [{ content: [{ text: 'our report', marks: [{ type: 'bold' }] }] }] }
		});
	});
});

describe('an image', () => {
	const pictured = (imageId: string) => ({
		say: 'Added your photo.',
		page: {
			kind: 'patch',
			ops: [{ op: 'add', path: '/blocks/0/props/imageId', value: imageId }]
		}
	});

	it('not attached in this chat is refused, the whole reply with it', () => {
		const current = campaign();
		const result = accept(pictured('img_elsewhere'), { current, attached: ['img_mine'] });
		expect(result).toEqual({
			ok: false,
			reason: 'blocks.0.props.imageId: image "img_elsewhere" was not attached in this chat',
			current
		});
	});

	it('attached in this chat passes, on to the block’s own rule', () => {
		const result = accept(pictured('img_mine'), { attached: ['img_mine'] });
		expect(result).toMatchObject({
			ok: false,
			reason:
				'blocks.0: block 1 (id "title"): title carries no "imageId"; it carries id, type, variant, background, heading and lede'
		});
	});
});

describe('the one door', () => {
	it('is the only module that turns a reply into a draft', () => {
		const src = resolve(import.meta.dirname, '../..');
		const reaching = readdirSync(src, { recursive: true, encoding: 'utf8' })
			.filter((file) => /\.tsx?$/.test(file) && !/\.spec\.tsx?$/.test(file))
			.filter((file) => /\bpageFromDraft\b/.test(readFileSync(join(src, file), 'utf8')))
			.sort();
		expect(reaching).toEqual([
			join('lib', 'page', 'accept-reply.ts'),
			join('lib', 'page', 'ai-catalog.ts')
		]);
	});
});
