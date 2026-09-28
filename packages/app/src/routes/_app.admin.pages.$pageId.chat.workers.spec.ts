import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { answering, insertPage } from '$lib/server/pages/page-row.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
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
		{ env: { ...env, AI } as unknown as Env }
	);
}

const TURN = { message: 'make it two-tone', imageIds: '[]', timeZone: 'America/New_York' };

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
			{ env }
		);
		expect(await read.json()).toMatchObject({
			turns: [{ role: 'operator' }, { role: 'assistant', text: 'Two-tone now.' }]
		});
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
