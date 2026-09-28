import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { type Page, parsePage } from '../../page/catalog';
import { defaultCampaign, defaultDonationPage } from '../../page/defaults';
import { createDb, type Db } from '../db/client';
import { createImage } from '../images/queries';
import { chatTurn, page } from '../db/schema';
import { draftTurn, readChat } from './draft';
import { answering, insertPage, SETTINGS } from './page-row.testing';

// a workers spec because every turn reads a page and its chat and writes them back. the model is
// the one stand-in: a binding whose `run` answers with the text given, as ../ai/generate.spec.ts
// stubs it, so what is asserted is what reaches the page and the chat from a known reply.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

const NOW = Date.parse('2026-09-28T16:00:00Z');
const ZONE = 'America/New_York';

function turn(pageId: string, message: string, AI: { run: unknown }, extra: object = {}) {
	return draftTurn(
		db,
		{ ...env, AI, ...extra },
		{ pageId, message, imageIds: [], timeZone: ZONE, now: NOW }
	);
}

async function stored(pageId: string) {
	const [row] = await db.select().from(page).where(eq(page.id, pageId));
	if (!row) throw new Error('the page is gone');
	const draft = parsePage(row.type, JSON.parse(row.draft));
	if (!draft.ok) throw new Error(draft.message);
	return { ...row, draft: draft.page };
}

async function chat(pageId: string) {
	return db
		.select({
			author: chatTurn.author,
			text: chatTurn.text,
			model: chatTurn.model,
			note: chatTurn.note
		})
		.from(chatTurn)
		.where(eq(chatTurn.pageId, pageId))
		.orderBy(chatTurn.seq);
}

describe('an accepted reply', () => {
	it('becomes the draft, and the published page stays as it was', async () => {
		const live: Page = { ...defaultCampaign(), settings: SETTINGS };
		const pageId = await insertPage(db, 'campaign', live, live);
		const AI = answering({
			say: 'Two-tone now.',
			page: { kind: 'merge', doc: { palette: 'duo' } }
		});

		expect(await turn(pageId, 'make it two-tone', AI)).toMatchObject({
			ok: true,
			outcome: 'accepted'
		});

		const after = await stored(pageId);
		expect(after.draft.palette).toBe('duo');
		expect(JSON.parse(after.published ?? 'null')).toEqual(live);
		expect(await chat(pageId)).toEqual([
			{ author: 'operator', text: 'make it two-tone', model: null, note: null },
			{
				author: 'assistant',
				text: 'Two-tone now.',
				model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
				note: null
			}
		]);
	});

	it('whose words open as a refusal would is still no refusal', async () => {
		const pageId = await insertPage(db, 'campaign');
		const say = 'I couldn’t apply that: only joking, it is two-tone now.';
		const AI = answering({ say, page: { kind: 'merge', doc: { palette: 'duo' } } });

		await turn(pageId, 'make it two-tone', AI);

		expect(await readChat(db, pageId)).toEqual([
			expect.objectContaining({ role: 'operator' }),
			{ id: expect.any(String), role: 'assistant', text: say, imageIds: [] }
		]);
	});

	it('sent twice lands once: the second reply was written against a page already changed', async () => {
		const pageId = await insertPage(db, 'campaign');
		const reply = { say: 'Two-tone now.', page: { kind: 'merge', doc: { palette: 'duo' } } };
		const second = turn(pageId, 'make it two-tone', answering(reply));
		const first = turn(pageId, 'make it two-tone', answering(reply));

		const results = await Promise.all([first, second]);

		expect(results.filter(({ ok }) => !ok)).toEqual([{ ok: false, reason: 'stale' }]);
		expect(await chat(pageId)).toHaveLength(2);
	});
});

describe('a refused reply', () => {
	it('leaves the draft as it was, and the chat says why', async () => {
		const before = { ...defaultCampaign(), settings: SETTINGS };
		const pageId = await insertPage(db, 'campaign', before);
		const AI = answering({ say: 'Neon!', page: { kind: 'merge', doc: { palette: 'neon' } } });

		const result = await turn(pageId, 'make it neon', AI);

		expect((await stored(pageId)).draft).toEqual(before);
		expect(result).toMatchObject({
			ok: true,
			outcome: 'refused',
			turns: [{ role: 'operator' }, { role: 'assistant', note: 'refused' }]
		});
		const [, answer] = await chat(pageId);
		expect(answer).toMatchObject({
			text: expect.stringMatching(/^I couldn’t apply that: palette: /),
			note: 'refused'
		});
	});
});

describe('a campaign’s goal and end date', () => {
	it('are set from "goal $15k by Dec 31", and the reply names both', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering({
			say: 'Drafted your coat drive.',
			page: {
				kind: 'patch',
				ops: [
					{ op: 'add', path: '/blocks/0/props/lede', value: 'Help us reach $15,000 by winter.' }
				]
			},
			set: { goalMinor: 1_500_000, endDate: '2026-12-31' }
		});

		await turn(pageId, 'coats for 300 kids, goal $15k by Dec 31', AI);

		const after = await stored(pageId);
		expect(after.draft.goalMinor).toBe(1_500_000);
		expect(after.draft.endsAt).toBe(Date.parse('2027-01-01T05:00:00Z') - 1);
		const [, answer] = await chat(pageId);
		expect(answer?.text).toBe('Drafted your coat drive.\nGoal set to $15,000. Ends Dec 31, 2026.');
	});

	it('is set on a later turn from "Raise $15,000"', async () => {
		const pageId = await insertPage(db, 'campaign', {
			...defaultCampaign(),
			settings: SETTINGS,
			goalMinor: 500_000
		});
		await turn(pageId, 'Winter coat drive', answering({ say: 'Drafted.' }));

		await turn(
			pageId,
			'Raise $15,000',
			answering({ say: 'Raised the goal.', set: { goalMinor: 1_500_000 } })
		);

		expect((await stored(pageId)).draft.goalMinor).toBe(1_500_000);
	});
});

describe('a campaign’s name', () => {
	it('changes on "call it Coats for Kids", and the reply names it', async () => {
		const pageId = await insertPage(db, 'campaign');

		await turn(
			pageId,
			'call it Coats for Kids',
			answering({ say: 'Done.', set: { name: 'Coats for Kids' } })
		);

		const after = await stored(pageId);
		expect([after.draft.name, after.name]).toEqual(['Coats for Kids', 'Winter coat drive']);
		const [, answer] = await chat(pageId);
		expect(answer?.text).toBe('Done.\nRenamed to “Coats for Kids”.');
	});
});

describe('the Donation page', () => {
	it.each([
		['a name', { name: 'Coats for Kids' }, 'name'],
		['a goal', { goalMinor: 1_500_000 }, 'goal'],
		['an end date', { endDate: '2026-12-31' }, 'end date']
	])('asked for %s changes nothing, and the reply says why', async (_, set, what) => {
		const before = { ...defaultDonationPage(), settings: SETTINGS };
		const pageId = await insertPage(db, 'donation_page', before);

		await turn(pageId, 'set it', answering({ say: 'Set.', set }));

		const after = await stored(pageId);
		expect([after.draft, after.name]).toEqual([before, null]);
		const [, answer] = await chat(pageId);
		expect(answer?.text).toBe(
			`I couldn’t apply that: the Donation page has no ${what}; only a campaign does`
		);
	});
});

describe('a credit-billed model that fails', () => {
	it('is answered by the free model, whose turn carries its note', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering(new Error('3036: insufficient credits'), {
			say: 'Two-tone now.',
			page: { kind: 'merge', doc: { palette: 'duo' } }
		});

		const result = await turn(pageId, 'make it two-tone', AI, {
			AI_MODEL: 'anthropic/claude-sonnet-4.6'
		});

		expect((await stored(pageId)).draft.palette).toBe('duo');
		expect(await chat(pageId)).toMatchObject([
			{ author: 'operator' },
			{
				author: 'assistant',
				text: 'Two-tone now.',
				model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
				note: 'fell-back'
			}
		]);
		const answer = { role: 'assistant', text: 'Two-tone now.', note: 'fell-back' };
		expect(result).toMatchObject({ turns: [{ role: 'operator' }, answer] });
		expect(await readChat(db, pageId)).toMatchObject([{ role: 'operator' }, answer]);
	});
	it('that the free model then answers off the page is marked refused, since nothing changed', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering(new Error('3036: insufficient credits'), {
			say: 'Neon!',
			page: { kind: 'merge', doc: { palette: 'neon' } }
		});

		await turn(pageId, 'make it neon', AI, { AI_MODEL: 'anthropic/claude-sonnet-4.6' });

		const [, answer] = (await readChat(db, pageId)) ?? [];
		expect(answer).toMatchObject({
			note: 'refused',
			text: expect.stringMatching(/^I couldn’t apply that: palette: /)
		});
	});
});

describe('what the model is told', () => {
	const handEdited = (): Page => {
		const draft = { ...defaultCampaign(), settings: SETTINGS };
		draft.blocks[0] = {
			id: 'title',
			type: 'title',
			variant: 'left',
			background: 'none',
			heading: 'Coats for every kid'
		};
		return draft;
	};

	it('is the draft with its hand edits, the page’s type and its donation settings, and the chat so far', async () => {
		const pageId = await insertPage(db, 'campaign', handEdited());
		await turn(pageId, 'Winter coat drive', answering({ say: 'Drafted.' }));
		const AI = answering({ say: 'Warmer.' });

		await turn(pageId, 'warmer colours', AI);

		const [, input] = AI.run.mock.calls[0] ?? [];
		const [system, ...chatSoFar] = input.messages;
		expect(system.content).toContain('"heading":"Coats for every kid"');
		expect(system.content).toContain('- page: a campaign named "Winter coat drive"');
		expect(system.content).toContain(
			'- donation settings: minimum $5, maximum $1,000, suggested amounts $25, $50, program none'
		);
		expect(chatSoFar).toEqual([
			{ role: 'user', content: 'Winter coat drive' },
			{ role: 'assistant', content: 'Drafted.' },
			{ role: 'user', content: 'warmer colours' }
		]);
	});

	it('of the chat so far, is only what the model said, leaving out each exchange that changed nothing', async () => {
		const pageId = await insertPage(db, 'campaign');
		await turn(
			pageId,
			'Winter coat drive',
			answering({ say: 'Drafted.', set: { goalMinor: 1_500_000 } })
		);
		await turn(
			pageId,
			'make it neon',
			answering({ say: 'Neon!', page: { kind: 'merge', doc: { palette: 'neon' } } })
		);
		await turn(pageId, 'hello?', undefined as never);
		const AI = answering({ say: 'Warmer.' });

		await turn(pageId, 'warmer colours', AI);

		const [, input] = AI.run.mock.calls[0] ?? [];
		const [, ...chatSoFar] = input.messages;
		expect(chatSoFar).toEqual([
			{ role: 'user', content: 'Winter coat drive' },
			{ role: 'assistant', content: 'Drafted.' },
			{ role: 'user', content: 'warmer colours' }
		]);
	});

	it('keeps a hand edit the follow-up did not ask to change', async () => {
		const pageId = await insertPage(db, 'campaign', handEdited());
		const AI = answering({
			say: 'Two-tone.',
			page: { kind: 'patch', ops: [{ op: 'replace', path: '/palette', value: 'duo' }] }
		});

		await turn(pageId, 'two-tone please', AI);

		const after = await stored(pageId);
		expect([after.draft.palette, after.draft.blocks[0]]).toEqual(['duo', handEdited().blocks[0]]);
	});
});

describe('an impact tier', () => {
	it('stands only on a figure the operator gave, and the reply names the one left out', async () => {
		const pageId = await insertPage(db, 'campaign');
		const tiers = {
			id: 'impact',
			type: 'impact-tiers',
			variant: 'cards',
			background: 'none',
			props: {
				tiers: [
					{ amountMinor: 2500, buys: 'a warm coat' },
					{ amountMinor: 7500, buys: 'a coat, hat and boots' }
				]
			}
		};
		const AI = answering({
			say: 'Added what a gift buys.',
			page: { kind: 'patch', ops: [{ op: 'add', path: '/blocks/3', value: tiers }] }
		});

		await turn(pageId, '$25 buys a coat', AI);

		const impact = (await stored(pageId)).draft.blocks.find(({ type }) => type === 'impact-tiers');
		expect(impact).toMatchObject({ tiers: [{ amountMinor: 2500, buys: 'a warm coat' }] });
		const [, answer] = await chat(pageId);
		expect(answer?.text).toBe(
			'Added what a gift buys.\nLeft out the $75 tier: you haven’t given that figure.'
		);
	});
});

describe('a turn no model answers', () => {
	it('leaves the draft as it was and says so plainly, with what the operator can do', async () => {
		const before = { ...defaultCampaign(), settings: SETTINGS };
		const pageId = await insertPage(db, 'campaign', before);

		const result = await turn(pageId, 'make it two-tone', undefined as never);

		expect(result).toMatchObject({ ok: true, outcome: 'unanswered' });
		expect((await stored(pageId)).draft).toEqual(before);
		const [, answer] = await chat(pageId);
		expect(answer).toMatchObject({
			text: expect.stringMatching(
				/^No model answered, so nothing changed\. This deployment was uploaded without the Workers AI binding `AI`/
			),
			model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
			note: 'unanswered'
		});
		const [, drawn] = (await readChat(db, pageId)) ?? [];
		expect(drawn).not.toHaveProperty('note');
	});
});

describe('a hand edit saved while the model was answering', () => {
	it('stands, and the turn writes nothing', async () => {
		const pageId = await insertPage(db, 'campaign');
		const edited = { ...defaultCampaign(), settings: SETTINGS, palette: 'bold' as const };
		const run = vi.fn(async () => {
			await db
				.update(page)
				.set({ draft: JSON.stringify(edited) })
				.where(eq(page.id, pageId));
			return {
				response: JSON.stringify({
					say: 'Two-tone.',
					page: { kind: 'merge', doc: { palette: 'duo' } }
				})
			};
		});

		expect(await turn(pageId, 'two-tone', { run })).toEqual({ ok: false, reason: 'stale' });

		expect((await stored(pageId)).draft).toEqual(edited);
		expect(await chat(pageId)).toEqual([]);
	});
});

it('answers a page that does not exist with not_found, asking no model', async () => {
	const AI = answering({ say: 'Hi.' });
	expect(await turn('no-such-page', 'hello', AI)).toEqual({ ok: false, reason: 'not_found' });
	expect(AI.run).not.toHaveBeenCalled();
});

describe('a photo sent with a turn', () => {
	const photo = () =>
		createImage(
			db,
			{ kind: 'photo', contentType: 'image/webp', width: 4, height: 3, alt: null },
			new Uint8Array([1, 2, 3])
		);

	it('is kept on the operator’s turn and named to the model', async () => {
		const pageId = await insertPage(db, 'campaign');
		const imageId = await photo();
		const AI = answering({ say: 'Nice photo.' });

		await draftTurn(
			db,
			{ ...env, AI },
			{ pageId, message: 'our volunteers', imageIds: [imageId], timeZone: ZONE, now: NOW }
		);

		expect(await readChat(db, pageId)).toMatchObject([
			{ role: 'operator', imageIds: [imageId] },
			{ role: 'assistant' }
		]);
		const [, input] = AI.run.mock.calls[0] ?? [];
		expect(input.messages.at(-1)).toEqual({
			role: 'user',
			content: `our volunteers\n\n(attached photos: ${imageId})`
		});
	});

	it('that is no stored image is refused by its id, asking no model', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering({ say: 'Nice photo.' });

		const result = await draftTurn(
			db,
			{ ...env, AI },
			{ pageId, message: 'look', imageIds: ['img_nope'], timeZone: ZONE, now: NOW }
		);

		expect(result).toEqual({ ok: false, reason: 'unknown_image', imageId: 'img_nope' });
		expect(AI.run).not.toHaveBeenCalled();
		expect(await chat(pageId)).toEqual([]);
	});
});
