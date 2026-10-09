import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	acceptReply,
	DEPTH_MAX,
	DRAFT_BYTES_MAX,
	illustrationRequests,
	OPS_MAX,
	REPLY_BYTES_MAX,
	REPLY_JSON_SCHEMA,
	SAY_MAX
} from './accept-reply';
import { MAX_SUGGESTED_AMOUNTS, TOO_MANY_SUGGESTED_AMOUNTS } from '../forms/amounts';
import { draftFromPage } from './ai-catalog';
import { ALT_MAX, GOAL_MINOR_MAX, type Page, SHARE_MESSAGE_MAX } from './catalog';
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
		illustrations: [],
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
		['a say past its cap', { say: 'x'.repeat(SAY_MAX + 1) }, `say: say holds at most ${SAY_MAX}`],
		[
			'suggested amounts past their cap',
			{
				say: 'Set.',
				set: {
					suggestedAmounts: Array.from({ length: MAX_SUGGESTED_AMOUNTS + 1 }, (_, i) => 500 + i)
				}
			},
			`set.suggestedAmounts: a page suggests ${TOO_MANY_SUGGESTED_AMOUNTS}`
		]
	])('is refused when %s, handing current back unchanged', (_, reply, reason) => {
		const current = campaign();
		const result = accept(reply, { current });
		expect(result).toEqual({ ok: false, reason: expect.stringContaining(reason), current });
		expect(current).toEqual(campaign());
	});
});

describe('the schema a model is sent', () => {
	// a model decoding under JSON mode stops a list only where the schema caps it: Workers AI's
	// default model, sent an uncapped list of amounts, wrote amounts until the request timed out.
	it('caps every list a reply names', () => {
		const uncapped: string[] = [];
		const visit = (node: unknown, path: string) => {
			if (typeof node !== 'object' || node === null) return;
			const schema = node as Record<string, unknown>;
			if (schema.type === 'array' && typeof schema.maxItems !== 'number') uncapped.push(path);
			for (const [key, value] of Object.entries(schema)) {
				// `$defs` holds `z.json()`'s any-JSON value, which no list in it can cap.
				if (key !== '$defs') visit(value, `${path}/${key}`);
			}
		};
		visit(REPLY_JSON_SCHEMA, '');
		expect(uncapped).toEqual([]);
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
			'Open on monthly',
			{ kind: 'patch', ops: [{ op: 'replace', path: '/switches/openOnMonthly', value: true }] },
			'"switches"'
		],
		[
			'Dedication on by default',
			{ kind: 'patch', ops: [{ op: 'replace', path: '/switches/dedicationOn', value: true }] },
			'"switches"'
		],
		[
			'a switch by merge',
			{ kind: 'merge', doc: { switches: { openOnMonthly: false, dedicationOn: true } } },
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
			reason: `set: a reply sets only corner, endDate, goalMinor, name, programId, shade, shareChannels, shareMessage and suggestedAmounts, not "${key}"`,
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
			{
				activePrograms: programs,
				messages: [{ author: 'operator', text: 'aim for $5,000 by the end of December' }]
			}
		);
		expect(result).toEqual({
			ok: true,
			kind: 'drafted',
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

	it('refuses a goal the operator never stated, naming it, and leaves the draft as it was', () => {
		const current = campaign();
		const result = accept(
			{ say: 'Set a goal.', set: { goalMinor: 500_000_000 } },
			{ current, messages: [{ author: 'operator', text: 'set an ambitious goal' }] }
		);
		expect(result).toEqual({
			ok: false,
			reason: 'set.goalMinor: $5,000,000 is not a figure the operator wrote in the chat',
			current
		});
	});

	it.each(['set the goal to $20,000', 'a $20k goal', 'we need 20,000 dollars'])(
		'takes a goal the operator stated as "%s"',
		(text) => {
			const result = accept(
				{ say: 'Goal set.', set: { goalMinor: 2_000_000 } },
				{ messages: [{ author: 'operator', text }] }
			);
			expect(result).toMatchObject({
				ok: true,
				draft: { goalMinor: 2_000_000 },
				changes: [{ field: 'goal', from: null, to: 2_000_000 }]
			});
		}
	);

	it('refuses a goal only the assistant or the page’s own words state', () => {
		const current = campaign();
		current.blocks[1] = {
			id: 'title',
			type: 'title',
			variant: 'left',
			background: 'none',
			heading: 'Last winter we raised $20,000'
		};
		const reply = { say: 'Goal set.', set: { goalMinor: 2_000_000 } };
		const refused = {
			ok: false,
			reason: 'set.goalMinor: $20,000 is not a figure the operator wrote in the chat'
		};
		expect(accept(reply, { current })).toMatchObject(refused);
		expect(
			accept(reply, {
				messages: [
					{ author: 'assistant', text: 'Shall I set the goal to $20,000?' },
					{ author: 'operator', text: 'sure' }
				]
			})
		).toMatchObject(refused);
	});

	it('takes a goal up to the largest the Settings sheet takes, and refuses one past it', () => {
		const current = campaign();
		const messages = [{ author: 'operator' as const, text: 'a goal of $9,999,999,999,999.99' }];
		const at = accept(
			{ say: 'Goal set.', set: { goalMinor: GOAL_MINOR_MAX } },
			{ current, messages }
		);
		expect(at).toMatchObject({ ok: true, draft: { goalMinor: GOAL_MINOR_MAX } });

		const past = accept({ say: 'Goal set.', set: { goalMinor: GOAL_MINOR_MAX + 1 } }, { current });
		expect(past).toEqual({
			ok: false,
			reason:
				'set.goalMinor: $10,000,000,000,000 must be less than largest goal of $9,999,999,999,999.99',
			current
		});
	});

	describe('the share buttons', () => {
		it('sets which stand and in what order, returning the change from the buttons drawn', () => {
			const result = accept({
				say: 'Copy link first, then WhatsApp.',
				set: { shareChannels: ['copy-link', 'whatsapp'] }
			});
			expect(result).toMatchObject({
				ok: true,
				draft: { shareChannels: ['copy-link', 'whatsapp'] },
				changes: [
					{
						field: 'shareChannels',
						from: ['facebook', 'email', 'copy-link'],
						to: ['copy-link', 'whatsapp']
					}
				]
			});
		});

		it('takes none as a page with no share buttons, on the Donation page too', () => {
			const current = { ...defaultDonationPage(), shareChannels: ['x' as const] };
			const result = accept(
				{ say: 'Took the share buttons off.', set: { shareChannels: [] } },
				{ type: 'donation_page', current, name: null }
			);
			expect(result).toMatchObject({
				ok: true,
				draft: { shareChannels: [] },
				changes: [{ field: 'shareChannels', from: ['x'], to: [] }]
			});
		});

		it.each([
			[
				['facebook', 'myspace'],
				'set.shareChannels.1: "myspace" is not a share channel; a channel is facebook, whatsapp, email, copy-link, linkedin or x'
			],
			[
				['x', 'email', 'x'],
				'set.shareChannels: "x" is named twice; a page offers each share button once'
			]
		])('refuses %j, naming the channel, and hands current back', (shareChannels, reason) => {
			const current = campaign();
			const result = accept({ say: 'Done.', set: { shareChannels } }, { current });
			expect(result).toEqual({ ok: false, reason, current });
		});
	});

	describe('the look', () => {
		it('sets the shade, keeping the corners the page drew, and returns the change', () => {
			const result = accept({ say: 'Warmer now.', set: { shade: 'warm' } });
			expect(result).toMatchObject({
				ok: true,
				draft: { look: { shade: 'warm', corner: 'soft' } },
				changes: [{ field: 'shade', from: 'light', to: 'warm' }]
			});
		});

		it('sets the corners, keeping the page’s own shade, on the Donation page too', () => {
			const current: Page = { ...defaultDonationPage(), look: { shade: 'cool', corner: 'square' } };
			const result = accept(
				{ say: 'Rounder now.', set: { corner: 'round' } },
				{ type: 'donation_page', current, name: null }
			);
			expect(result).toMatchObject({
				ok: true,
				draft: { look: { shade: 'cool', corner: 'round' } },
				changes: [{ field: 'corner', from: 'square', to: 'round' }]
			});
		});

		it.each([
			[
				'the defaults, on a page with no look of its own',
				undefined,
				{ shade: 'light', corner: 'soft' }
			],
			[
				'its own look, echoed',
				{ shade: 'warm', corner: 'round' },
				{ shade: 'warm', corner: 'round' }
			]
		] as const)('changes nothing where the page already draws %s', (_, look, set) => {
			const before: Page = look === undefined ? campaign() : { ...campaign(), look };
			const result = accept({ say: 'As it was.', set }, { current: structuredClone(before) });
			expect(result).toMatchObject({ ok: true, changes: [] });
			expect(result.ok && result.kind === 'drafted' && result.draft.look).toEqual(before.look);
		});

		it.each([
			[{ shade: 'dark' }, 'set.shade: "dark" is not a shade; a shade is light, warm or cool'],
			[{ corner: 'pill' }, 'set.corner: "pill" is not a corner; a corner is square, soft or round']
		])('refuses %j, naming it and the presets, and hands current back', (set, reason) => {
			const current = campaign();
			const result = accept({ say: 'Done.', set }, { current });
			expect(result).toEqual({ ok: false, reason, current });
		});
	});

	describe('the share message', () => {
		const shareMessage = (result: ReturnType<typeof accept>) =>
			result.ok && result.kind === 'drafted' ? result.draft.shareMessage : 'refused';

		it('sets the words a donor shares the page with, trimmed, and returns the change', () => {
			const result = accept({ say: 'Set.', set: { shareMessage: '  Keep a neighbour warm. ' } });
			expect(result).toMatchObject({
				ok: true,
				changes: [{ field: 'shareMessage', from: null, to: 'Keep a neighbour warm.' }]
			});
			expect(shareMessage(result)).toBe('Keep a neighbour warm.');
		});

		it('keeps the message the page has where the reply sets null, on the Donation page too', () => {
			const current = { ...defaultDonationPage(), shareMessage: 'Give today.' };
			const result = accept(
				{ say: 'Cleared.', set: { shareMessage: null } },
				{ type: 'donation_page', current, name: null }
			);
			expect(result).toMatchObject({ ok: true, changes: [] });
			expect(shareMessage(result)).toBe('Give today.');
		});

		it.each([
			[
				'words past the cap',
				'x'.repeat(SHARE_MESSAGE_MAX + 1),
				`set.shareMessage: a share message holds at most ${SHARE_MESSAGE_MAX} characters`
			],
			['no words', '   ', 'set.shareMessage: a share message holds words, or is null to keep it'],
			[
				'a figure the operator never wrote',
				'$40 keeps a child warm all winter.',
				'set.shareMessage: "$40" is not a figure the operator wrote in the chat or one the page already shows'
			]
		])('refuses %s and hands current back', (_, words, reason) => {
			const current = campaign();
			const result = accept({ say: 'Set.', set: { shareMessage: words } }, { current });
			expect(result).toEqual({ ok: false, reason, current });
		});

		it('takes a figure the operator wrote, said of what it does', () => {
			const result = accept(
				{ say: 'Set.', set: { shareMessage: '$40 keeps a child warm all winter.' } },
				{ messages: [{ author: 'operator', text: '$40 keeps a child warm all winter.' }] }
			);
			expect(shareMessage(result)).toBe('$40 keeps a child warm all winter.');
		});
	});
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
	const addTier = (amountMinor: number, buys: string) => ({
		say: 'Added what a gift buys.',
		page: {
			kind: 'patch',
			ops: [
				{
					op: 'add',
					path: '/blocks/3',
					value: { ...tiers([]), props: { tiers: [{ amountMinor, buys }] } }
				}
			]
		}
	});
	const operator = (text: string) => ({ author: 'operator' as const, text });
	const tiersOf = (result: ReturnType<typeof accept>) =>
		'draft' in result
			? result.draft.blocks.find((block) => block.type === 'impact-tiers')
			: undefined;

	it('is kept when the operator stated it, and dropped and noted when nobody did', () => {
		const result = accept(addTiers([2500, 7500]), {
			messages: [operator('$25 buys a coat for a child.')]
		});
		expect(tiersOf(result)).toMatchObject({ tiers: [{ amountMinor: 2500 }] });
		expect(result).toMatchObject({
			ok: true,
			dropped: [{ what: 'tier', blockId: 'impact', amountMinor: 7500, reworded: false }]
		});
	});

	it('is dropped when the operator gave its amount but not what it does', () => {
		const result = accept(addTier(5000, 'a winter coat and boots for one child'), {
			messages: [operator('set the suggested amounts to $25, $50 and $100')]
		});
		expect(tiersOf(result)).toMatchObject({ tiers: [] });
		expect(result).toMatchObject({
			ok: true,
			dropped: [{ what: 'tier', blockId: 'impact', amountMinor: 5000 }]
		});
	});

	it('is dropped when what the amount does is in another sentence', () => {
		const result = accept(addTier(5000, 'a winter coat'), {
			messages: [operator('Suggest $25, $50 and $100. A coat keeps a child warm!\nBoots help too')]
		});
		expect(tiersOf(result)).toMatchObject({ tiers: [] });
	});

	it('is kept in its own words when the operator stated its amount and what it does', () => {
		const result = accept(addTier(5000, 'a warm coat for one child this winter'), {
			messages: [operator('Suggest $25 and $100. And $50 buys a winter coat')]
		});
		expect(tiersOf(result)).toMatchObject({
			tiers: [{ amountMinor: 5000, buys: 'a warm coat for one child this winter' }]
		});
	});

	it('is kept when the operator typed its amount and what it does on the page by hand', () => {
		const current = campaign();
		current.blocks[3] = {
			id: 'story',
			type: 'story',
			variant: 'plain',
			background: 'none',
			body: {
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'We hand out coats every December. ' },
							{ type: 'text', text: '$50 buys a winter coat for a child.' }
						]
					}
				]
			}
		};
		const result = accept(addTier(5000, 'a winter coat for a child'), {
			current,
			messages: [operator('turn the amount in my story into an impact tier')]
		});
		expect(tiersOf(result)).toMatchObject({ tiers: [{ amountMinor: 5000 }] });
		expect(result).toMatchObject({ ok: true, dropped: [] });
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
			dropped: [{ what: 'tier', blockId: 'impact', amountMinor: 4000, reworded: true }]
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
		['$1.2555k', 125_550],
		['USD25', 2500],
		['25$', 2500],
		['25 $', 2500],
		['$.50', 50],
		['50 bucks', 5000],
		['1 buck', 100],
		['fifty dollars', 5000],
		['Twenty-five dollars', 2500],
		['one hundred and fifty dollars', 15_000],
		['a hundred bucks', 10_000],
		['two thousand five hundred dollars', 250_000],
		['fifteen thousand USD', 1_500_000]
	])('reads %j as a figure the operator stated', (text, amountMinor) => {
		const result = accept(addTiers([amountMinor]), {
			messages: [operator(`about ${text} buys a coat, thanks`)]
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
		const result = accept(addTiers([amountMinor]), {
			messages: [operator(`${text} buys a coat`)]
		});
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
		expect('draft' in result && result.draft.blocks[1]).toMatchObject({
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
		const result = accept(lede('$25 for a coat, $40 for boots; help us reach $5,000.'), {
			current
		});
		expect(result).toMatchObject({ ok: true });
		const tierSaid = accept(lede('$40 buys boots.'), { current });
		expect(tierSaid).toMatchObject({
			ok: false,
			reason:
				'block 2 (id "title"): "$40 buys boots." says what "$40" does, and the operator never said what it does in one sentence in the chat or on the page'
		});
	});

	it('the same reply sets as the goal lands only when the operator stated it', () => {
		const words = { ...lede('Help us raise $15,000 this winter.'), set: { goalMinor: 1_500_000 } };
		expect(accept(words)).toMatchObject({
			ok: false,
			reason: 'set.goalMinor: $15,000 is not a figure the operator wrote in the chat'
		});
		const asked = accept(words, { messages: [operator('set the goal to $15,000')] });
		expect(asked).toMatchObject({ ok: true });
	});

	it('the reply sets as a goal nobody asked for refuses the reply', () => {
		const result = accept(
			{ ...lede('$50 buys a coat.'), set: { goalMinor: 5000 } },
			{ messages: [operator('make it warmer')] }
		);
		expect(result).toMatchObject({
			ok: false,
			reason: 'set.goalMinor: $50 is not a figure the operator wrote in the chat'
		});
	});

	it.each([
		'Fifty dollars',
		'twenty-five dollars',
		'A hundred bucks',
		'50 bucks',
		'25$',
		'USD25',
		'USD 25',
		'$.50'
	])('spelled %j and never stated refuses the reply, naming it as written', (written) => {
		const result = accept(lede(`${written} keeps a child warm.`));
		expect(result).toMatchObject({
			ok: false,
			reason: `block 2 (id "title"): "${written}" is not a figure the operator wrote in the chat or one the page already shows`
		});
	});

	it('spelled out lands when the operator stated it in digits', () => {
		const result = accept(lede('Fifty dollars keeps a child warm.'), {
			messages: [operator('$50 buys a coat')]
		});
		expect(result).toMatchObject({ ok: true });
	});

	it('saying what it does refuses the reply, naming the sentence, when the operator only stated it bare', () => {
		const current = campaign();
		const result = accept(lede('Warm a child this winter. $50 buys a coat.'), {
			current,
			messages: [operator('set the suggested amounts to $25, $50 and $100')]
		});
		expect(result).toEqual({
			ok: false,
			reason:
				'block 2 (id "title"): "$50 buys a coat." says what "$50" does, and the operator never said what it does in one sentence in the chat or on the page',
			current
		});
	});

	it('saying what it does lands when the operator said what it does in one sentence', () => {
		const result = accept(lede('Warm a child this winter. $50 buys a coat.'), {
			messages: [operator('$50 buys a coat for one child')]
		});
		expect(result).toMatchObject({ ok: true });
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
		const story = 'draft' in result ? result.draft.blocks[3] : undefined;
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

	it.each([
		['https://evil.example/pay', 'Give at https://evil.example/pay today.'],
		['www.evil.example', 'Give at www.evil.example!'],
		['https://harbour.org/report?ref=ai', 'Read https://harbour.org/report?ref=ai.']
	])(
		'in a share message the AI sets refuses %s, which the page does not link',
		(address, words) => {
			const current = withStory();
			const result = accept({ say: 'Set.', set: { shareMessage: words } }, { current });
			expect(result).toEqual({
				ok: false,
				reason: `set.shareMessage: "${address}" is not a link the page already holds`,
				current
			});
		}
	);

	it('in a share message the AI sets is kept where the page already links it', () => {
		const result = accept(
			{ say: 'Set.', set: { shareMessage: 'Read https://harbour.org/report.' } },
			{ current: withStory() }
		);
		expect(result.ok && result.kind === 'drafted' && result.draft.shareMessage).toBe(
			'Read https://harbour.org/report.'
		);
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
		const story = 'draft' in result ? result.draft.blocks[3] : undefined;
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
		expect('draft' in result && result.draft.blocks[0]).toEqual({
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

	it('that is the organisation’s logo is refused, the whole reply with it', () => {
		const logo = '01926f3e-1111-7b2e-9d4f-3a5b6c7d8e9f';
		const current = campaign();
		expect(accept(inHero(logo), { current, attached: [mine] })).toEqual({
			ok: false,
			reason: `blocks.0.props.imageId: image "${logo}" was not attached in this chat`,
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
		expect('draft' in moved && moved.draft.blocks[4]).toMatchObject({
			type: 'image',
			imageId: mine
		});
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

describe('an illustration a reply asks for', () => {
	const drawn = '01926f3e-7c1a-7b2e-9d4f-3a5b6c7d8e9f';
	const image = (imageId: unknown) => ({
		id: 'photo',
		type: 'image',
		variant: 'column',
		background: 'none',
		props: { imageId, alt: null }
	});

	it('is read wherever an imageId goes, in the order written, and the reply takes the drawn id or null in its place', () => {
		const reply = JSON.stringify({
			say: 'Two pictures.',
			page: {
				kind: 'patch',
				ops: [
					{
						op: 'replace',
						path: '/blocks/0/props/imageId',
						value: { illustrate: '  a coat rack ' }
					},
					{ op: 'add', path: '/blocks/1', value: image({ illustrate: 'a van' }) }
				]
			}
		});

		const asked = illustrationRequests(JSON.parse(reply));

		expect(asked.ok && asked.requests.map(({ description }) => description)).toEqual([
			'a coat rack',
			'a van'
		]);
		if (!asked.ok) return;
		const result = accept(asked.place([drawn, null]), { attached: [drawn] });
		expect('draft' in result && result.draft.blocks.slice(0, 2)).toMatchObject([
			{ type: 'hero', imageId: drawn },
			{ type: 'image', imageId: null }
		]);
	});

	it('is read inside a merged block too', () => {
		const blocks = [...draftFromPage(campaign()).blocks, image({ illustrate: 'a van' })];
		const reply = JSON.stringify({ say: 'A picture.', page: { kind: 'merge', doc: { blocks } } });

		const asked = illustrationRequests(JSON.parse(reply));

		expect(asked.ok && asked.requests.map(({ description }) => description)).toEqual(['a van']);
		if (!asked.ok) return;
		const result = accept(asked.place([drawn]), { attached: [drawn] });
		expect('draft' in result && result.draft.blocks.at(-1)).toMatchObject({
			type: 'image',
			imageId: drawn
		});
	});

	it('past a photo description’s length refuses the reply, naming where it was asked', () => {
		const reply = JSON.stringify({
			say: 'A picture.',
			page: {
				kind: 'patch',
				ops: [
					{ op: 'add', path: '/blocks/1', value: image({ illustrate: 'x'.repeat(ALT_MAX + 1) }) }
				]
			}
		});

		expect(illustrationRequests(JSON.parse(reply))).toEqual({
			ok: false,
			reason: `page.ops.0.value.props.imageId.illustrate: an illustration’s description holds at most ${ALT_MAX} characters`
		});
	});

	it.each([
		[
			'blank',
			{ illustrate: '  ' },
			'page.ops.0.value.illustrate: an illustration request describes the picture wanted'
		],
		[
			'beside an id',
			{ illustrate: 'a van', id: '01926f3e-7c1a-7b2e-9d4f-3a5b6c7d8e9f' },
			'page.ops.0.value: '
		]
	])('refuses the reply when %s, naming where it was asked', (_, value, reason) => {
		const reply = {
			say: 'A picture.',
			page: { kind: 'patch', ops: [{ op: 'replace', path: '/blocks/0/props/imageId', value }] }
		};

		expect(illustrationRequests(reply)).toEqual({
			ok: false,
			reason: expect.stringContaining(reason)
		});
	});

	it('whose description holds a figure the operator never wrote refuses the reply, naming where it was asked', () => {
		const reply = {
			say: 'A picture.',
			page: {
				kind: 'patch',
				ops: [
					{
						op: 'replace',
						path: '/blocks/0/props/imageId',
						value: { illustrate: 'a banner reading $50,000 raised' }
					}
				]
			}
		};
		const asked = illustrationRequests(reply);
		if (!asked.ok) throw new Error(asked.reason);

		expect(
			accept(asked.place([drawn]), { attached: [drawn], illustrations: asked.requests })
		).toMatchObject({
			ok: false,
			reason:
				'page.ops.0.value.illustrate: "$50,000" is not a figure the operator wrote in the chat or one the page already shows'
		});
		const stated = [{ author: 'operator' as const, text: 'we raised $50,000 last year' }];
		expect(
			accept(asked.place([drawn]), {
				attached: [drawn],
				illustrations: asked.requests,
				messages: stated
			})
		).toMatchObject({ ok: true });
	});

	it('anywhere but an imageId is no request, and the reply is refused as off the page’s shape', () => {
		const reply = JSON.stringify({
			say: 'A picture.',
			page: {
				kind: 'patch',
				ops: [{ op: 'add', path: '/blocks/0/props/alt', value: { illustrate: 'a van' } }]
			}
		});

		const asked = illustrationRequests(JSON.parse(reply));

		expect(asked.ok && asked.requests.map(({ description }) => description)).toEqual([]);
		expect(accept(asked.ok ? asked.place([]) : reply)).toMatchObject({
			ok: false,
			reason: expect.stringContaining('blocks.0.props.alt: ')
		});
	});

	it('left standing is refused by the page rule, so no stored page carries one', () => {
		const reply = {
			say: 'A picture.',
			page: {
				kind: 'patch',
				ops: [{ op: 'replace', path: '/blocks/0/props/imageId', value: { illustrate: 'a van' } }]
			}
		};

		expect(accept(reply)).toMatchObject({
			ok: false,
			reason: expect.stringContaining('blocks.0.props.imageId: ')
		});
	});
});

describe('a reply that asks', () => {
	const ask = [
		{ id: 'goal', kind: 'amount', prompt: 'Your goal' },
		{ id: 'ends', kind: 'date', prompt: 'When does it end?' }
	];

	it('is asked: its say and its questions, and no draft', () => {
		expect(accept({ say: 'Two quick questions.', ask })).toEqual({
			ok: true,
			kind: 'asked',
			say: 'Two quick questions.',
			questions: ask
		});
	});

	it.each([
		['a page edit', { page: { kind: 'merge', doc: { palette: 'duo' } } }],
		['a value set', { set: { goalMinor: 1_500_000 } }]
	])('is refused beside %s, current handed back unchanged', (_, beside) => {
		const current = campaign();
		expect(accept({ say: 'Asking.', ask, ...beside }, { current })).toEqual({
			ok: false,
			reason: 'a reply that asks never also changes the page',
			current
		});
	});

	it.each([
		['empty', []],
		['null', null]
	])('that is %s is no ask, so the page change beside it lands', (_, empty) => {
		expect(
			accept({ say: 'Two-tone.', ask: empty, page: { kind: 'merge', doc: { palette: 'duo' } } })
		).toMatchObject({ ok: true, kind: 'drafted', draft: { palette: 'duo' } });
	});

	it('is taken in reply to answers to the chat’s first round of questions', () => {
		expect(accept({ say: 'One more.', ask }, { answering: 1 })).toEqual({
			ok: true,
			kind: 'asked',
			say: 'One more.',
			questions: ask
		});
	});

	it.each([2, 3])(
		'is refused in reply to answers to round %i, which it changes the page from instead',
		(round) => {
			const current = campaign();
			expect(accept({ say: 'One more.', ask }, { current, answering: round })).toEqual({
				ok: false,
				reason:
					'a reply to answers past the chat’s first round of questions changes the page from them and never asks again',
				current,
				askedAgain: true
			});
		}
	);

	it.each([
		['six questions', [...ask, ...['a', 'b', 'c', 'd'].map((id) => ({ ...ask[0], id }))], 'ask: '],
		['a duplicate id', [ask[0], ask[0]], 'ask: '],
		[
			'one option',
			[{ id: 'who', kind: 'choice', prompt: 'Who?', options: ['Kids'] }],
			'ask.0.options: '
		],
		['markup', [{ ...ask[0], prompt: '<b>Goal</b>' }], 'ask.0.prompt: '],
		['a link', [{ ...ask[0], hint: 'like https://example.org' }], 'ask.0.hint: '],
		['a web address', [{ ...ask[0], hint: 'like www.example.org' }], 'ask.0.hint: ']
	])('is refused for %s, naming where', (_, questions, reason) => {
		expect(accept({ say: 'Asking.', ask: questions })).toMatchObject({
			ok: false,
			reason: expect.stringContaining(reason)
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
