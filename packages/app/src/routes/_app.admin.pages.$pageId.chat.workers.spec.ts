import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { page } from '$lib/server/db/schema';
import { answering, defaultModelReply, insertPage } from '$lib/server/pages/page-row.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { finishedDeployment } from '../page-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as chat from './_app.admin.pages.$pageId.chat';

// a workers spec because a turn reads and writes a page and its chat. the chain is mounted, for
// ../route-request.testing.ts's reason: the session gate is a `middleware` on ./_app.tsx. what a
// turn does to the page is ../lib/server/pages/draft.workers.spec.ts's; here, what the edge takes
// and what it answers.

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/pages/:pageId/chat', module: chat }
	]);
	session = await signIn(db);
});

const TWO_TONE = { say: 'Two-tone now.', page: { kind: 'merge', doc: { palette: 'duo' } } };

function post(
	pageId: string,
	fields: Record<string, string>,
	AI = answering(TWO_TONE),
	cookie = session
) {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	return request(
		new Request(`${ORIGIN}/admin/pages/${pageId}/chat`, {
			method: 'POST',
			headers: { cookie },
			body
		}),
		// the stand-in answers `run` alone, which is all `generate` calls.
		{ env: { ...bindings, AI } as unknown as Env }
	);
}

const TURN = { message: 'make it two-tone', imageIds: '[]', timeZone: 'America/New_York' };

/** a deployment whose set-up is finished, which the layout's set-up gate serves this screen on. */
let bindings: Env;

beforeEach(async () => {
	bindings = await finishedDeployment();
});

describe('a turn posted to a page’s chat', () => {
	it('is answered with its outcome and both turns, which the chat then reads', async () => {
		const pageId = await insertPage(db, 'campaign');

		const response = await post(pageId, TURN);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			outcome: 'accepted',
			turns: [
				{ role: 'operator', text: 'make it two-tone', imageIds: [] },
				{ role: 'assistant', text: 'Two-tone now.' }
			]
		});
		const read = await request(
			new Request(`${ORIGIN}/admin/pages/${pageId}/chat`, { headers: { cookie: session } }),
			{ env: bindings }
		);
		expect(await read.json()).toMatchObject({
			turns: [{ role: 'operator' }, { role: 'assistant', text: 'Two-tone now.' }]
		});
	});
});

describe('a turn that cannot land', () => {
	it('is a 409 marked stale when the page was saved while the model answered', async () => {
		const pageId = await insertPage(db, 'campaign');
		const [row] = await db.select().from(page).where(eq(page.id, pageId));
		const edited = { ...JSON.parse(row?.draft ?? '{}'), palette: 'bold' };
		const run = vi.fn(async () => {
			await db
				.update(page)
				.set({ draft: JSON.stringify(edited) })
				.where(eq(page.id, pageId));
			return defaultModelReply(JSON.stringify(TWO_TONE));
		});

		const response = await post(pageId, TURN, { run });

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ reason: 'stale' });
	});

	it('is a 500 marked failed when the turn throws, and names the page', async () => {
		const pageId = await insertPage(db, 'campaign');
		await db.update(page).set({ draft: '{"blocks":"none"}' }).where(eq(page.id, pageId));

		const response = await post(pageId, TURN);

		expect(response.status).toBe(500);
		const body = (await response.json()) as { error: string; reason: string };
		expect(body).toMatchObject({ reason: 'failed' });
		expect(body.error).toContain(pageId);
	});
});

describe('a turn the edge refuses', () => {
	it.each([
		[
			'a blank message with no photo',
			{ ...TURN, message: '   ' },
			'message is blank and no photo is attached'
		],
		[
			'no imageIds box',
			{ message: TURN.message, timeZone: TURN.timeZone },
			'imageIds is a JSON array'
		],
		['imageIds that are not JSON', { ...TURN, imageIds: 'img_1' }, 'imageIds is a JSON array'],
		[
			'an unknown time zone',
			{ ...TURN, timeZone: 'Mars/Olympus' },
			'timeZone "Mars/Olympus" is not an IANA time zone'
		],
		[
			'a photo that is not stored',
			{ ...TURN, imageIds: '["img_nope"]' },
			'imageIds names "img_nope"'
		]
	])('is a 400 naming the box, for %s, and asks no model', async (_, fields, error) => {
		const pageId = await insertPage(db, 'campaign');
		const AI = answering(TWO_TONE);

		const response = await post(pageId, fields, AI);

		expect([response.status, await response.json()]).toEqual([
			400,
			{ error: expect.stringContaining(error) }
		]);
		expect(AI.run).not.toHaveBeenCalled();
	});

	it('is a 404 for a page that does not exist', async () => {
		const response = await post('no-such-page', TURN);
		expect([response.status, await response.json()]).toEqual([
			404,
			{ error: 'no page has the id "no-such-page"' }
		]);
	});
});

it('sends a turn from someone signed out to sign in, and asks no model', async () => {
	const pageId = await insertPage(db, 'campaign');
	const AI = answering(TWO_TONE);

	const response = await post(pageId, TURN, AI, '');

	expect([response.status, response.headers.get('Location')]).toEqual([
		303,
		expect.stringMatching(/^\/login\?/)
	]);
	expect(AI.run).not.toHaveBeenCalled();
});

const ASK = { say: 'A few questions.', ask: [{ id: 'goal', kind: 'amount', prompt: 'Your goal' }] };
const ZONE = 'America/New_York';

describe('a page’s opening, posted as intent open', () => {
	it('is answered with the one assistant turn holding its questions', async () => {
		const pageId = await insertPage(db, 'campaign');

		const response = await post(pageId, { intent: 'open', timeZone: ZONE }, answering(ASK));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			outcome: 'asked',
			turns: [
				{
					role: 'assistant',
					questions: expect.arrayContaining([expect.objectContaining({ id: 'goal' })])
				}
			]
		});
	});

	it('of a chat with turns answers them all, unchanged', async () => {
		const pageId = await insertPage(db, 'campaign');
		await post(pageId, TURN);

		const response = await post(pageId, { intent: 'open', timeZone: ZONE });

		expect(await response.json()).toMatchObject({
			outcome: 'unchanged',
			turns: [{ role: 'operator' }, { role: 'assistant' }]
		});
	});
});

describe('answers, posted as intent answers', () => {
	async function asked() {
		const pageId = await insertPage(db, 'campaign');
		await post(pageId, { intent: 'open', timeZone: ZONE }, answering(ASK));
		return pageId;
	}

	it('are answered with the operator turn in words and the reply, which the chat then reads', async () => {
		const pageId = await asked();

		const response = await post(pageId, {
			intent: 'answers',
			answers: JSON.stringify([{ id: 'goal', value: 5000 }]),
			timeZone: ZONE
		});

		expect(response.status).toBe(200);
		const answered = {
			role: 'operator',
			text: 'Your goal — $50',
			answers: [{ id: 'goal', prompt: 'Your goal', words: '$50' }]
		};
		expect(await response.json()).toMatchObject({
			outcome: 'accepted',
			turns: [answered, { role: 'assistant' }]
		});
		const read = await request(
			new Request(`${ORIGIN}/admin/pages/${pageId}/chat`, { headers: { cookie: session } }),
			{ env: bindings }
		);
		expect(await read.json()).toMatchObject({
			turns: [
				{
					role: 'assistant',
					questions: expect.arrayContaining([expect.objectContaining({ id: 'goal' })])
				},
				answered,
				{ role: 'assistant' }
			]
		});
	});

	it('to questions already answered are a 409 marked answered', async () => {
		const pageId = await asked();
		const fields = { intent: 'answers', answers: '[]', timeZone: ZONE };
		await post(pageId, fields);
		const AI = answering(TWO_TONE);

		const response = await post(pageId, fields, AI);

		expect([response.status, await response.json()]).toEqual([
			409,
			{
				error: expect.stringContaining('are no longer the chat’s last turn'),
				reason: 'answered'
			}
		]);
		expect(AI.run).not.toHaveBeenCalled();
	});

	it('to questions a message has followed are the same 409, which claims no answer', async () => {
		const pageId = await asked();
		await post(pageId, TURN);

		const response = await post(pageId, { intent: 'answers', answers: '[]', timeZone: ZONE });

		expect(response.status).toBe(409);
		const body = (await response.json()) as { error: string; reason: string };
		expect(body.reason).toBe('answered');
		expect(body.error).not.toContain('answered already');
	});

	it('landing after a save made while the model answered are a 409 marked stale, asking them sent again', async () => {
		const pageId = await asked();
		const [row] = await db.select().from(page).where(eq(page.id, pageId));
		const edited = { ...JSON.parse(row?.draft ?? '{}'), palette: 'bold' };
		const run = vi.fn(async () => {
			await db
				.update(page)
				.set({ draft: JSON.stringify(edited) })
				.where(eq(page.id, pageId));
			return defaultModelReply(JSON.stringify(TWO_TONE));
		});

		const response = await post(
			pageId,
			{ intent: 'answers', answers: '[]', timeZone: ZONE },
			{ run }
		);

		expect([response.status, await response.json()]).toEqual([
			409,
			{ error: expect.stringContaining('send the answers again'), reason: 'stale' }
		]);
	});

	it('that no model answers are a 503 marked unanswered, and sent again once one does, land', async () => {
		const pageId = await asked();
		const fields = { intent: 'answers', answers: '[{"id":"goal","value":5000}]', timeZone: ZONE };

		const response = await post(pageId, fields, {} as never);

		expect([response.status, await response.json()]).toEqual([
			503,
			{
				error: expect.stringMatching(/^No model answered, so nothing changed\. /),
				reason: 'unanswered'
			}
		]);
		const resent = await post(pageId, fields);
		expect([resent.status, await resent.json()]).toMatchObject([200, { outcome: 'accepted' }]);
	});

	it('whose reply asks again are a 422 marked refused, saying why', async () => {
		const pageId = await asked();

		const response = await post(
			pageId,
			{ intent: 'answers', answers: '[]', timeZone: ZONE },
			answering(ASK)
		);

		expect([response.status, await response.json()]).toEqual([
			422,
			{
				error:
					'I couldn’t apply that: a reply to answers changes the page from them and never asks again',
				reason: 'refused'
			}
		]);
	});

	it.each([
		[
			'an answer to no question asked',
			{ answers: '[{"id":"colour","value":"red"}]' },
			'answers.0: "colour" is no question asked'
		],
		['an amount of nothing', { answers: '[{"id":"goal","value":0}]' }, 'answers.0.value: '],
		[
			'more answers than an ask holds questions',
			{ answers: JSON.stringify(Array.from({ length: 6 }, () => ({ id: 'goal', value: 5000 }))) },
			'answers: holds at most 5 answers, one per question asked'
		],
		['no answers box', {}, 'answers is a JSON array'],
		['answers that are not JSON', { answers: 'goal=50' }, 'answers is a JSON array']
	])('are a 400 naming the box, for %s, and ask no model', async (_, fields, error) => {
		const pageId = await asked();
		const AI = answering(TWO_TONE);

		const response = await post(pageId, { intent: 'answers', timeZone: ZONE, ...fields }, AI);

		expect([response.status, await response.json()]).toEqual([
			400,
			{ error: expect.stringContaining(error) }
		]);
		expect(AI.run).not.toHaveBeenCalled();
	});
});

it.each([
	[
		'an unknown intent',
		{ intent: 'publish', timeZone: ZONE },
		'intent is message, answers or open, not "publish"'
	],
	['an opening with no time zone', { intent: 'open' }, 'timeZone is required']
])('refuses %s with a 400 naming the box', async (_, fields, error) => {
	const pageId = await insertPage(db, 'campaign');

	const response = await post(pageId, fields);

	expect([response.status, await response.json()]).toEqual([
		400,
		{ error: expect.stringContaining(error) }
	]);
});
