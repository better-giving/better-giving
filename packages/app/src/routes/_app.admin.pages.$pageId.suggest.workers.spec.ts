import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { chatTurn, page } from '$lib/server/db/schema';
import { defaultCampaign, defaultDonationPage } from '$lib/page/defaults';
import { answering, insertPage, SETTINGS } from '$lib/server/pages/page-row.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { finishedDeployment } from '../page-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as suggest from './_app.admin.pages.$pageId.suggest';

// a workers spec because a suggestion reads a page, its chat and the organisation's profile. the
// chain is mounted, for ../route-request.testing.ts's reason: the session gate is a `middleware` on
// ./_app.tsx. no case here looks anything up: a suggestion asks the model alone.

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/pages/:pageId/suggest', module: suggest }
	]);
	session = await signIn(db);
});

/** a deployment whose set-up is finished, which the layout's set-up gate serves this route on. */
let bindings: Env;

beforeEach(async () => {
	bindings = await finishedDeployment();
});

function post(pageId: string, fields: Record<string, string>, AI: unknown) {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	return request(
		new Request(`${ORIGIN}/admin/pages/${pageId}/suggest`, {
			method: 'POST',
			headers: { cookie: session },
			body
		}),
		{ env: { ...bindings, AI } as unknown as Env }
	);
}

const HEADING = { block: 'title', field: 'heading', current: '' };

describe('a box the AI is asked to write', () => {
	it('is answered with words within the box’s bound', async () => {
		const pageId = await insertPage(db, 'campaign');

		const response = await post(pageId, HEADING, answering({ text: 'Coats for every kid' }));

		expect([response.status, await response.json()]).toEqual([
			200,
			{ ok: true, text: 'Coats for every kid' }
		]);
	});

	it('asks again once, saying why, where the words are over the box’s bound, then refuses', async () => {
		const pageId = await insertPage(db, 'campaign');
		const long = { text: 'warm '.repeat(60).trim() };
		const AI = answering(long, long);

		const response = await post(pageId, HEADING, AI);

		expect([response.status, await response.json()]).toEqual([
			422,
			{ ok: false, reason: 'refused', text: 'Couldn’t write that box. Try again.' }
		]);
		expect(AI.run).toHaveBeenCalledTimes(2);
		const [, retry] = AI.run.mock.calls[1] ?? [];
		expect(retry.messages.at(-1).content).toContain('a heading holds at most 250 characters');
	});

	it('lands the words the retry wrote within the bound', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering({ text: 'warm '.repeat(60).trim() }, { text: 'Warm coats' });

		const response = await post(pageId, HEADING, AI);

		expect([response.status, await response.json()]).toEqual([
			200,
			{ ok: true, text: 'Warm coats' }
		]);
	});
});

describe('the box asked for', () => {
	it('is told the model with the box’s words now, to improve where it holds any', async () => {
		const pageId = await insertPage(db, 'campaign');
		const empty = answering({ text: 'Coats for every kid' });
		const filled = answering({ text: 'Coats for every kid' });

		await post(pageId, HEADING, empty);
		await post(pageId, { ...HEADING, current: 'Coats  for kids' }, filled);

		const [, asked] = empty.run.mock.calls[0] ?? [];
		expect(asked.messages.at(-1).content).toBe(
			'Write the heading of block 2 (id "title"), the page’s headline: one line of at most 250 characters.\nThe box is empty now.'
		);
		const [, improved] = filled.run.mock.calls[0] ?? [];
		expect(improved.messages.at(-1).content).toContain(
			'The box reads now: "Coats  for kids". Improve it, keeping what it says.'
		);
	});

	it('is told the model beside the page as it stands and the organisation', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering({ text: 'Coats for every kid' });

		await post(pageId, HEADING, AI);

		const [, asked] = AI.run.mock.calls[0] ?? [];
		const system = asked.messages[0].content;
		expect(system).toContain('- page: a campaign named "Winter coat drive"');
		expect(system).toContain('"id":"story","type":"story"');
		expect(system).toMatch(/- organisation: \S/);
	});

	it('is a story’s body, answered as paragraphs a blank line apart', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering({ text: 'Winter is hard.\n\n  Every  coat\nhelps a child.  ' });

		const response = await post(pageId, { block: 'story', field: 'body', current: '' }, AI);

		expect([response.status, await response.json()]).toEqual([
			200,
			{ ok: true, text: 'Winter is hard.\n\nEvery coat helps a child.' }
		]);
	});

	it.each([
		['a block the draft has no such id for', { block: 'hero-2', field: 'alt' }, 'block "hero-2"'],
		[
			'a field the block draws no box for',
			{ block: 'title', field: 'subtitle' },
			'field "subtitle"'
		],
		['a block with no text box', { block: 'donate', field: 'heading' }, 'block "donate"'],
		['a page box the Donation page does not draw', { block: 'page', field: 'name' }, 'field "name"']
	])('is a 400 naming it, for %s, and asks no model', async (_, fields, named) => {
		const pageId =
			fields.field === 'name'
				? await insertPage(db, 'donation_page', { ...defaultDonationPage(), settings: SETTINGS })
				: await insertPage(db, 'campaign');
		const AI = answering({ text: 'Coats for every kid' });

		const response = await post(pageId, { ...fields, current: '' }, AI);

		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toContain(named);
		expect(AI.run).not.toHaveBeenCalled();
	});

	it('is a 400 naming the box, where one is missing, and asks no model', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering({ text: 'Coats for every kid' });

		const response = await post(pageId, { block: 'title', field: 'heading' }, AI);

		expect([response.status, await response.json()]).toEqual([
			400,
			{ error: 'current is required: the box’s words now, "" for an empty box' }
		]);
		expect(AI.run).not.toHaveBeenCalled();
	});
});

describe('a suggestion that cannot be written', () => {
	it('is refused after one retry where the words hold markup', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering({ text: '<b>Coats</b>' }, { text: '<b>Coats</b>' });

		const response = await post(pageId, HEADING, AI);

		expect(response.status).toBe(422);
		const [, retry] = AI.run.mock.calls[1] ?? [];
		expect(retry.messages.at(-1).content).toContain('text holds "<" or ">"');
	});

	it('is refused where a share message holds a web address the page does not link', async () => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering(
			{ text: 'Give a coat at https://coats.example.org' },
			{ text: 'Give a coat at https://coats.example.org' }
		);

		const response = await post(pageId, { block: 'page', field: 'share_message', current: '' }, AI);

		expect(response.status).toBe(422);
		const [, retry] = AI.run.mock.calls[1] ?? [];
		expect(retry.messages.at(-1).content).toContain(
			'"https://coats.example.org" is not a link the page already holds'
		);
	});

	it('is a 503 marked unanswered where no model answered, in the chat’s words', async () => {
		const pageId = await insertPage(db, 'campaign');

		const response = await post(pageId, HEADING, {});

		expect([response.status, await response.json()]).toEqual([
			503,
			{
				ok: false,
				reason: 'unanswered',
				text: expect.stringMatching(/^No model answered, so nothing changed\. /)
			}
		]);
	});
});

it('writes nothing: the draft and the chat are as they were', async () => {
	const pageId = await insertPage(db, 'campaign');
	const [before] = await db.select().from(page).where(eq(page.id, pageId));

	const response = await post(pageId, HEADING, answering({ text: 'Coats for every kid' }));

	expect(response.status).toBe(200);
	const [after] = await db.select().from(page).where(eq(page.id, pageId));
	expect(after).toEqual(before);
	const turns = await db.select().from(chatTurn).where(eq(chatTurn.pageId, pageId));
	expect(turns).toEqual([]);
});

describe('what a tier buys', () => {
	const tiered = () => ({
		...defaultCampaign(),
		settings: SETTINGS,
		blocks: [
			...defaultCampaign().blocks,
			{
				id: 'tiers',
				type: 'impact-tiers' as const,
				variant: 'cards' as const,
				background: 'none' as const,
				tiers: [{ amountMinor: 2500, buys: 'A coat' }]
			}
		]
	});
	const BUYS = { block: 'tiers', field: 'tier_buys[0]', current: 'A coat' };

	it('is refused where the operator never said what its amount does', async () => {
		const pageId = await insertPage(db, 'campaign', tiered());
		const AI = answering({ text: 'A warm winter coat' }, { text: 'A warm winter coat' });

		const response = await post(pageId, BUYS, AI);

		expect(response.status).toBe(422);
		const [, retry] = AI.run.mock.calls[1] ?? [];
		expect(retry.messages.at(-1).content).toContain('the operator never said what $25 does');
	});

	it('lands where the operator said what its amount does in the chat', async () => {
		const pageId = await insertPage(db, 'campaign', tiered());
		await db.insert(chatTurn).values({
			pageId,
			seq: 1,
			author: 'operator',
			text: 'Every $25 buys a warm winter coat for one child.'
		});

		const response = await post(pageId, BUYS, answering({ text: 'A warm winter coat' }));

		expect([response.status, await response.json()]).toEqual([
			200,
			{ ok: true, text: 'A warm winter coat' }
		]);
	});

	it('names a row the block does not hold', async () => {
		const pageId = await insertPage(db, 'campaign', tiered());

		const response = await post(pageId, { ...BUYS, field: 'tier_buys[1]' }, answering());

		expect([response.status, await response.json()]).toEqual([
			400,
			{
				error:
					'field "tier_buys[1]" is no text box of block "tiers" (impact-tiers); its text boxes are tier_buys[0]'
			}
		]);
	});
});
