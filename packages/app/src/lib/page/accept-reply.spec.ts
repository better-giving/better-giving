import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	acceptReply,
	DEPTH_MAX,
	DRAFT_BYTES_MAX,
	OPS_MAX,
	REPLY_BYTES_MAX,
	SAY_MAX
} from './accept-reply';
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
		['an unknown page edit', { say: 'Done.', page: { kind: 'rewrite', doc: {} } }, 'page.kind: '],
		['a blank say', { say: '  \n ' }, 'say: say holds no words'],
		['a say past its cap', { say: 'x'.repeat(SAY_MAX + 1) }, `say: say holds at most ${SAY_MAX}`]
	])('is refused when %s, handing current back unchanged', (_, reply, reason) => {
		const current = campaign();
		const result = accept(reply, { current });
		expect(result).toEqual({ ok: false, reason: expect.stringContaining(reason), current });
		expect(current).toEqual(campaign());
	});
});

describe('a reply too big to take', () => {
	const refusedFast = (reply: string, reason: unknown) => {
		const current = campaign();
		const started = performance.now();
		const result = accept(reply, { current });
		expect([result, performance.now() - started < 250]).toEqual([
			{ ok: false, reason, current },
			true
		]);
	};

	it('is refused unread past its byte cap', () => {
		const say = 'x'.repeat(REPLY_BYTES_MAX);
		refusedFast(JSON.stringify({ say }), `the reply is over ${REPLY_BYTES_MAX} bytes`);
	});

	it('is refused past its operation cap', () => {
		const ops = Array.from({ length: OPS_MAX + 1 }, () => ({
			op: 'test',
			path: '/layout',
			value: 'box-right'
		}));
		refusedFast(
			JSON.stringify({ say: 'Many.', page: { kind: 'patch', ops } }),
			`page.ops: a patch holds at most ${OPS_MAX} operations`
		);
	});

	it('is refused, and quickly, when copies double the page past its size', () => {
		const ops = Array.from({ length: 22 }, (_, index) => ({
			op: 'copy',
			from: '/blocks',
			path: `/blocks/1/props/k${index}`
		}));
		refusedFast(
			JSON.stringify({ say: 'Copied.', page: { kind: 'patch', ops } }),
			expect.stringMatching(
				new RegExp(
					`^operation \\d+ \\(copy /blocks/1/props/k\\d+\\): the page would nest deeper than ${DEPTH_MAX}$`
				)
			)
		);
	});

	it('is refused, and quickly, when copies grow the page past its size without nesting it', () => {
		const long = 'x'.repeat(60 * 1024);
		const copies = Array.from({ length: 5 }, (_, index) => ({
			op: 'copy',
			from: '/blocks/1/props/heading',
			path: `/blocks/1/props/h${index}`
		}));
		refusedFast(
			JSON.stringify({
				say: 'Longer.',
				page: {
					kind: 'patch',
					ops: [{ op: 'replace', path: '/blocks/1/props/heading', value: long }, ...copies]
				}
			}),
			`operation 5 (copy /blocks/1/props/h3): the page would be over ${DRAFT_BYTES_MAX} bytes`
		);
	});

	it('is refused, and quickly, when it nests thousands deep', () => {
		let doc: unknown = 'bottom';
		for (let depth = 0; depth < 3000; depth++) doc = [doc];
		refusedFast(
			JSON.stringify({ say: 'Deep.', page: { kind: 'merge', doc: { blocks: doc } } }),
			expect.stringMatching(/^the reply nests deeper than \d+$/)
		);
	});

	it('is refused, never thrown, when anything inside the door throws', () => {
		const current = { ...campaign(), blocks: null } as unknown as Page;
		expect(accept({ say: 'Hi.' }, { current })).toEqual({
			ok: false,
			reason: expect.stringMatching(/^the reply could not be read: /),
			current
		});
	});

	it('is refused when an edit nests the page past its depth', () => {
		// the page › blocks › a block › these levels: one past the cap
		let value: unknown = 'bottom';
		for (let depth = 0; depth < DEPTH_MAX - 2; depth++) value = { v: value };
		const result = accept({
			say: 'Deep.',
			page: { kind: 'merge', doc: { blocks: [{ props: value }] } }
		});
		expect(result).toMatchObject({
			ok: false,
			reason: `the page would nest deeper than ${DEPTH_MAX}`
		});
	});
});

describe('a reply that edits the page', () => {
	it('lands a patch addressed to the page as the model reads it', () => {
		const result = accept({
			say: 'I centred the title and wrote a lede.',
			page: {
				kind: 'patch',
				ops: [
					{ op: 'replace', path: '/blocks/1/variant', value: 'center' },
					{ op: 'add', path: '/blocks/1/props/lede', value: 'Keep a neighbour warm.' }
				]
			}
		});
		expect(result).toMatchObject({
			ok: true,
			say: 'I centred the title and wrote a lede.',
			draft: {
				...campaign(),
				blocks: [
					campaign().blocks[0],
					{
						id: 'title',
						type: 'title',
						variant: 'center',
						background: 'none',
						heading: '',
						lede: 'Keep a neighbour warm.'
					},
					...campaign().blocks.slice(2)
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
				page: { kind: 'patch', ops: [{ op: 'remove', path: '/blocks/4' }] }
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
		const current = type === 'campaign' ? campaign() : defaultDonationPage();
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
			{ kind: 'patch', ops: [{ op: 'move', from: '/shareMessage', path: '/blocks/1/props/lede' }] },
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

	it.each(['__proto__', 'constructor', 'toString'])(
		'names nothing but the key for a page edit reaching %j',
		(key) => {
			const result = accept(
				`{"say":"Hi.","page":{"kind":"patch","ops":[{"op":"add","path":"/${key}","value":1}]}}`
			);
			expect(result).toMatchObject({
				ok: false,
				reason: `a page edit reaches layout, palette and blocks only, not "${key}"`
			});
		}
	);

	it('names set as the way to a goal', () => {
		const result = accept({
			say: 'Goal set.',
			page: { kind: 'merge', doc: { goalMinor: 500_000 } }
		});
		expect(result).toMatchObject({
			ok: false,
			reason:
				'a page edit reaches layout, palette and blocks only, not "goalMinor"; a campaign’s goal goes through set.goalMinor'
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
			draft: {
				...campaign(),
				name: 'Coats for winter',
				goalMinor: 500_000,
				endsAt,
				endsZone: 'America/New_York',
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
				{
					field: 'program',
					from: { mode: 'none', programId: null },
					to: { mode: 'pinned', programId: 'prg_coats' }
				},
				{ field: 'amounts', from: [2500, 5000], to: [3000, 6000] }
			],
			dropped: []
		});
	});

	it('renames from the name the draft holds, where it holds one', () => {
		const current = { ...campaign(), name: 'Coats for winter' };
		const result = accept({ say: 'Renamed.', set: { name: 'Coats for Kids' } }, { current });
		expect(result).toMatchObject({
			ok: true,
			draft: { name: 'Coats for Kids' },
			changes: [{ field: 'name', from: 'Coats for winter', to: 'Coats for Kids' }]
		});
	});

	it('returns no change for a value set to what it already is', () => {
		// the end of 31 December where the operator who set it was, in london
		const current = {
			...campaign(),
			goalMinor: 500_000,
			endsAt: Date.parse('2027-01-01T00:00:00Z') - 1,
			endsZone: 'Europe/London'
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
			...defaultDonationPage(),
			settings: { ...settings, suggestedAmounts: [], allowedOrigins: [] }
		};
		const result = accept({ say: 'Done.', set }, { type: 'donation_page', current, name: null });
		expect(result).toEqual({ ok: false, reason, current });
	});

	it('reports an end date moved to another day as the day it moved from', () => {
		const current = {
			...campaign(),
			endsAt: Date.parse('2027-01-01T05:00:00Z') - 1,
			endsZone: 'America/New_York'
		};
		const result = accept({ say: 'A week longer.', set: { endDate: '2027-01-07' } }, { current });
		expect(result).toMatchObject({
			ok: true,
			draft: { endsAt: Date.parse('2027-01-08T05:00:00Z') - 1 },
			changes: [{ field: 'endDate', from: '2026-12-31', to: '2027-01-07' }]
		});
	});

	it('reads the end it holds as its day in the zone it was chosen in', () => {
		// the end of 31 December in los angeles, already 1 January in london where it is read
		const current = {
			...campaign(),
			endsAt: Date.parse('2027-01-01T08:00:00Z') - 1,
			endsZone: 'America/Los_Angeles'
		};
		const result = accept(
			{ say: 'Kept it.', set: { endDate: '2026-12-31' } },
			{ current, timeZone: 'Europe/London' }
		);
		expect(result).toMatchObject({ ok: true, draft: current, changes: [] });
	});

	it('stores the zone the new day was chosen in beside the end', () => {
		// set in london, moved by an operator in los angeles, on PST by January, UTC-8
		const current = {
			...campaign(),
			endsAt: Date.parse('2027-01-01T00:00:00Z') - 1,
			endsZone: 'Europe/London'
		};
		const result = accept(
			{ say: 'A week longer.', set: { endDate: '2027-01-07' } },
			{ current, timeZone: 'America/Los_Angeles' }
		);
		expect(result).toMatchObject({
			ok: true,
			draft: { endsAt: Date.parse('2027-01-08T08:00:00Z') - 1, endsZone: 'America/Los_Angeles' }
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

	it('names the donor’s choice given up when a campaign is pinned to one program', () => {
		const current = {
			...campaign(),
			settings: {
				...settings,
				suggestedAmounts: [],
				allowedOrigins: [],
				programMode: 'choice' as const
			}
		};
		const result = accept(
			{ say: 'Pinned to Meals.', set: { programId: 'prg_meals' } },
			{ current, activePrograms: programs }
		);
		expect(result).toMatchObject({
			ok: true,
			draft: { settings: { programMode: 'pinned', programId: 'prg_meals' } },
			changes: [
				{
					field: 'program',
					from: { mode: 'choice', programId: null },
					to: { mode: 'pinned', programId: 'prg_meals' }
				}
			]
		});
	});

	it('refuses a program on the Donation page while its donors choose one', () => {
		const current = {
			...defaultDonationPage(),
			settings: {
				...settings,
				suggestedAmounts: [],
				allowedOrigins: [],
				programMode: 'choice' as const
			}
		};
		const result = accept(
			{ say: 'Pinned to Meals.', set: { programId: 'prg_meals' } },
			{ type: 'donation_page', current, name: null, activePrograms: programs }
		);
		expect(result).toEqual({
			ok: false,
			reason:
				'set.programId: the Donation page lets each donor choose a program, and a reply cannot pin it to one',
			current
		});
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
		page: { kind: 'patch', ops: [{ op: 'add', path: '/blocks/3', value: tiers(amounts) }] }
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
		current.blocks.splice(3, 0, {
			id: 'impact',
			type: 'impact-tiers',
			variant: 'list',
			background: 'none',
			tiers: [{ amountMinor: 4000, buys: 'boots' }]
		});
		const result = accept(
			{
				say: 'Cards now.',
				page: { kind: 'patch', ops: [{ op: 'replace', path: '/blocks/3/variant', value: 'cards' }] }
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

	it('with what it buys rewritten is a new tier, kept only when the operator stated its figure', () => {
		const current = campaign();
		current.blocks.splice(3, 0, {
			id: 'impact',
			type: 'impact-tiers',
			variant: 'list',
			background: 'none',
			tiers: [{ amountMinor: 4000, buys: 'boots' }]
		});
		const rewrite = {
			say: 'Warmer words.',
			page: {
				kind: 'patch',
				ops: [
					{
						op: 'replace',
						path: '/blocks/3/props/tiers/0/buys',
						value: 'heats a family’s home for a winter'
					}
				]
			}
		};
		expect(accept(rewrite, { current })).toMatchObject({
			ok: true,
			dropped: [{ what: 'tier', blockId: 'impact', amountMinor: 4000 }]
		});
		const stated = accept(rewrite, { current, messages: [operator('$40 heats a home')] });
		expect(tiersOf(stated)).toMatchObject({
			tiers: [{ amountMinor: 4000, buys: 'heats a family’s home for a winter' }]
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
		['US$75', 7500],
		['$15k', 1_500_000],
		['$2.5K', 250_000],
		['$1.2m', 120_000_000],
		['3k dollars', 300_000],
		['$15 thousand', 1_500_000],
		['$2 Million', 200_000_000],
		['$15 k', 1_500_000],
		['15 thousand dollars', 1_500_000],
		['$1.2555k', 125_550]
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
		['$1,00', 100],
		['$15kids', 1_500_000]
	])('does not read %j as the figure %i', (text, amountMinor) => {
		const result = accept(addTiers([amountMinor]), { messages: [operator(text)] });
		expect(tiersOf(result)).toMatchObject({ tiers: [] });
	});
});

describe('a figure in the words', () => {
	const operator = (text: string) => ({ author: 'operator' as const, text });
	const lede = (text: string) => ({
		say: 'Wrote a lede.',
		page: { kind: 'patch', ops: [{ op: 'add', path: '/blocks/1/props/lede', value: text }] }
	});
	const paragraph = (text: string) => ({
		type: 'doc' as const,
		content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }]
	});

	it('the operator never stated refuses the whole reply, naming it', () => {
		const current = campaign();
		const result = accept(lede('Every $25 feeds 40 children for a week.'), { current });
		expect(result).toEqual({
			ok: false,
			reason:
				'block 2 (id "title"): "$25" is not a figure the operator wrote in the chat or one the page already shows',
			current
		});
	});

	it('the operator stated in the chat lands', () => {
		const result = accept(lede('Every $25 feeds 40 children for a week.'), {
			messages: [operator('twenty-five dollars, so $25, feeds 40 children')]
		});
		expect(result.ok && result.draft.blocks[1]).toMatchObject({
			lede: 'Every $25 feeds 40 children for a week.'
		});
	});

	it('the page already shows lands: in its words, a tier or its goal', () => {
		const current = { ...campaign(), goalMinor: 500_000 };
		current.blocks[3] = {
			id: 'story',
			type: 'story',
			variant: 'plain',
			background: 'none',
			body: paragraph('A coat costs us $25.')
		};
		current.blocks.splice(3, 0, {
			id: 'impact',
			type: 'impact-tiers',
			variant: 'list',
			background: 'none',
			tiers: [{ amountMinor: 4000, buys: 'boots' }]
		});
		const result = accept(lede('$25 buys a coat, $40 buys boots; help us reach $5,000.'), {
			current
		});
		expect(result).toMatchObject({ ok: true });
	});

	it('the same reply sets as the goal lands', () => {
		const words = lede('Help us raise $15,000 this winter.');
		expect(accept(words)).toMatchObject({ ok: false });
		expect(accept({ ...words, set: { goalMinor: 1_500_000 } })).toMatchObject({ ok: true });
	});

	it('scaled by a word is the scaled figure, not the digits', () => {
		const result = accept(lede('$15 million raised so far.'), { messages: [operator('$15 each')] });
		expect(result).toMatchObject({
			ok: false,
			reason:
				'block 2 (id "title"): "$15 million" is not a figure the operator wrote in the chat or one the page already shows'
		});
	});

	it('scaled past a cent refuses the reply rather than passing unread', () => {
		const result = accept(lede('Nearly $1.234567k raised.'));
		expect(result).toMatchObject({
			ok: false,
			reason:
				'block 2 (id "title"): "$1.234567k" is not a figure the operator wrote in the chat or one the page already shows'
		});
	});

	it('in a new campaign name the operator never stated refuses the reply', () => {
		const result = accept({ say: 'Renamed.', set: { name: 'The $50,000 winter drive' } });
		expect(result).toMatchObject({
			ok: false,
			reason:
				'set.name: "$50,000" is not a figure the operator wrote in the chat or one the page already shows'
		});
	});

	it('in an answer the operator never gave refuses the reply', () => {
		const faq = {
			id: 'faq',
			type: 'faq',
			variant: 'open',
			background: 'none',
			props: {
				items: [
					{
						question: 'Where does my gift go?',
						answer: paragraph('Only 10 dollars goes to overheads.')
					}
				]
			}
		};
		const result = accept({
			say: 'Added a FAQ.',
			page: { kind: 'patch', ops: [{ op: 'add', path: '/blocks/4', value: faq }] }
		});
		expect(result).toMatchObject({
			ok: false,
			reason:
				'block 5 (id "faq"): "10 dollars" is not a figure the operator wrote in the chat or one the page already shows'
		});
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
		page.blocks[3] = {
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
							path: '/blocks/3/props/body/content/-',
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
		const story = result.ok ? result.draft.blocks[3] : undefined;
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
							path: '/blocks/3/props/body/content/0/content/0/marks/1/attrs/href',
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
		const story = result.ok ? result.draft.blocks[3] : undefined;
		expect(story).toMatchObject({
			body: { content: [{ content: [{ text: 'our report', marks: [{ type: 'bold' }] }] }] }
		});
	});
});

describe('an image', () => {
	const mine = '01926f3e-7c1a-7b2e-9d4f-3a5b6c7d8e9f';
	const elsewhere = '01926f3e-0000-7b2e-9d4f-3a5b6c7d8e9f';
	const inHero = (imageId: string) => ({
		say: 'Put your photo in the hero.',
		page: {
			kind: 'patch',
			ops: [{ op: 'replace', path: '/blocks/0/props/imageId', value: imageId }]
		}
	});
	const withHero = (imageId: string): Page => {
		const current = campaign();
		current.blocks[0] = {
			...defaultCampaign().blocks[0],
			imageId,
			alt: 'A well'
		} as Page['blocks'][number];
		return current;
	};

	it('attached in this chat lands where the reply places it', () => {
		const result = accept(inHero(mine), { attached: [mine] });
		expect(result.ok && result.draft.blocks[0]).toEqual({
			id: 'hero',
			type: 'hero',
			variant: 'framed',
			background: 'none',
			imageId: mine,
			alt: null
		});
	});

	it('not attached in this chat is refused, the whole reply with it', () => {
		const current = campaign();
		const result = accept(inHero(elsewhere), { current, attached: [mine] });
		expect(result).toEqual({
			ok: false,
			reason: `blocks.0.props.imageId: image "${elsewhere}" was not attached in this chat`,
			current
		});
	});

	it('already on the page stands through a reply that leaves it, and may move to another block', () => {
		const current = withHero(mine);
		const layout = accept(
			{ say: 'Cover now.', page: { kind: 'merge', doc: { layout: 'cover' } } },
			{ current }
		);
		expect(layout).toMatchObject({ ok: true, draft: { layout: 'cover', blocks: current.blocks } });
		const image = {
			id: 'photo',
			type: 'image',
			variant: 'column',
			background: 'none',
			props: { imageId: mine, alt: null }
		};
		const moved = accept(
			{
				say: 'Moved it down.',
				page: { kind: 'patch', ops: [{ op: 'add', path: '/blocks/4', value: image }] }
			},
			{ current }
		);
		expect(moved.ok && moved.draft.blocks[4]).toMatchObject({ type: 'image', imageId: mine });
	});

	it('named by an address instead of an id is refused, attached or not', () => {
		const url = 'https://elsewhere.example/a.png';
		expect(accept(inHero(url), { attached: [url] })).toMatchObject({
			ok: false,
			reason: expect.stringContaining('blocks.0.props.imageId: ')
		});
		const beside = {
			say: 'Linked it.',
			page: { kind: 'patch', ops: [{ op: 'add', path: '/blocks/0/props/src', value: url }] }
		};
		expect(accept(beside)).toMatchObject({
			ok: false,
			reason: expect.stringContaining('hero carries no "src"')
		});
	});
});

describe('the one door', () => {
	const src = resolve(import.meta.dirname, '../..');
	const reaching = (pattern: RegExp) =>
		readdirSync(src, { recursive: true, encoding: 'utf8' })
			.filter((file) => /\.tsx?$/.test(file) && !/\.spec\.tsx?$/.test(file))
			.filter((file) => pattern.test(readFileSync(join(src, file), 'utf8')))
			.sort();

	it('is the only module that turns a reply into a draft', () => {
		expect(reaching(/\bpageFromDraft\b/)).toEqual([
			join('lib', 'page', 'accept-reply.ts'),
			join('lib', 'page', 'ai-catalog.ts')
		]);
	});

	it('is the only module that edits a page by patch or merge', () => {
		expect(reaching(/from '[^']*json-patch'/)).toEqual([join('lib', 'page', 'accept-reply.ts')]);
	});
});
