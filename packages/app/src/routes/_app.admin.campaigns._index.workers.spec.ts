import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultCampaign } from '$lib/page/defaults';
import { slugFromTitle } from '$lib/page/slug';
import { createDb, type Db } from '$lib/server/db/client';
import { page } from '$lib/server/db/schema';
import { readChat } from '$lib/server/pages/draft';
import { answering, insertPage, SETTINGS } from '$lib/server/pages/page-row.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as campaigns from './_app.admin.campaigns._index';

// a workers spec because the list reads pages and New campaign writes one. the chain is mounted, for
// ../route-request.testing.ts's reason: the session gate is a `middleware` on ./_app.tsx. what a
// create writes is ../lib/server/pages/campaign.workers.spec.ts's; here, what the edge takes and
// what it answers.

const LIST = '/admin/campaigns';

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/campaigns', module: campaigns }
	]);
	session = await signIn(db);
});

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare('delete from chat_turn'),
		env.DB.prepare('delete from page'),
		env.DB.prepare('delete from form')
	]);
});

function post(fields: Record<string, string>, AI: { run: unknown } = answering()) {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	return request(
		new Request(`${ORIGIN}${LIST}?new`, { method: 'POST', headers: { cookie: session }, body }),
		// the stand-in answers `run` alone, which is all `generate` calls.
		{ env: { ...env, AI } as unknown as Env }
	);
}

const CREATE = {
	title: 'Winter coat drive',
	purpose: '',
	time_zone: 'America/New_York'
};

type Row = {
	id: string;
	name: string;
	address: string | null;
	state: string;
	goal: string | null;
	endsAt: number | null;
};

async function load(): Promise<{ campaigns: Row[]; ended: Row[] }> {
	const response = await request(
		new Request(`${ORIGIN}${LIST}`, { headers: { cookie: session } }),
		{
			env
		}
	);
	expect(response.status).toBe(200);
	return response.json();
}

/** a campaign in `state`, made `at` ms, its draft carrying `extra`. */
async function campaign(
	name: string,
	state: 'never_published' | 'live' | 'ended',
	at: number,
	extra: object = {}
) {
	const document = { ...defaultCampaign(), settings: SETTINGS, ...extra };
	const pageId = await insertPage(
		db,
		'campaign',
		document,
		state === 'never_published' ? null : document
	);
	await db
		.update(page)
		.set({ name, slug: slugFromTitle(name), state, createdAt: new Date(at) })
		.where(eq(page.id, pageId));
	return pageId;
}

const DAY = 86_400_000;
const NOW = Date.now();

describe('the Campaigns list', () => {
	it('lists live and unpublished campaigns newest first, and the ended ones apart, never the Donation page', async () => {
		await insertPage(db, 'donation_page');
		await campaign('Spring gala appeal', 'never_published', NOW - DAY);
		await campaign('Winter coat drive', 'live', NOW - 3 * DAY);
		await campaign('Giving Tuesday', 'live', NOW - 2 * DAY);
		await campaign('Summer camp fund', 'ended', NOW - 9 * DAY);

		const { campaigns: listed, ended } = await load();

		expect(listed.map((row) => [row.name, row.state, row.address])).toEqual([
			['Spring gala appeal', 'never_published', '/spring-gala-appeal'],
			['Giving Tuesday', 'live', '/giving-tuesday'],
			['Winter coat drive', 'live', '/winter-coat-drive']
		]);
		expect(ended.map((row) => [row.name, row.state])).toEqual([['Summer camp fund', 'ended']]);
	});

	it('shows a campaign’s goal and end date from its draft', async () => {
		const endsAt = NOW + 30 * DAY;
		await campaign('Winter coat drive', 'live', NOW, {
			goalMinor: 1_500_000,
			endsAt,
			endsZone: 'America/New_York'
		});
		await campaign('Spring gala appeal', 'never_published', NOW - DAY);

		const { campaigns: listed } = await load();

		expect(listed.map(({ goal, endsAt }) => ({ goal, endsAt }))).toEqual([
			{ goal: '$15,000', endsAt },
			{ goal: null, endsAt: null }
		]);
	});

	it('gives an ended campaign no end date where it was ended before it', async () => {
		await campaign('Flood relief', 'ended', NOW - 9 * DAY, {
			endsAt: NOW + DAY,
			endsZone: 'America/New_York'
		});
		const endedOn = NOW - DAY;
		await campaign('Summer camp fund', 'ended', NOW - 10 * DAY, {
			endsAt: endedOn,
			endsZone: 'America/New_York'
		});

		const { ended } = await load();

		expect(ended.map(({ name, endsAt }) => [name, endsAt])).toEqual([
			['Flood relief', null],
			['Summer camp fund', endedOn]
		]);
	});
});

describe('New campaign', () => {
	it('makes the campaign and opens its editor', async () => {
		const response = await post(CREATE);

		expect(response.status).toBe(302);
		const [made] = await db.select().from(page).where(eq(page.type, 'campaign'));
		expect(made?.name).toBe('Winter coat drive');
		expect(response.headers.get('Location')).toBe(`${LIST}/${made?.id}`);
	});

	it('sends what it is for as the first chat message, reading its dates in the browser’s zone', async () => {
		const AI = answering({
			say: 'Drafted your coat drive.',
			page: { kind: 'merge', doc: {} },
			set: { endDate: '2026-12-31' }
		});

		await post({ ...CREATE, purpose: 'coats for 300 kids by Dec 31' }, AI);

		const [made] = await db.select().from(page).where(eq(page.type, 'campaign'));
		expect(await readChat(db, made?.id ?? '')).toMatchObject([
			{ role: 'operator', text: 'Winter coat drive\ncoats for 300 kids by Dec 31' },
			{ role: 'assistant' }
		]);
		expect(JSON.parse(made?.draft ?? '{}').endsAt).toBe(Date.parse('2027-01-01T05:00:00Z') - 1);
	});

	it('refuses a blank title at its box, and makes nothing', async () => {
		const response = await post({ ...CREATE, title: '   ' });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			form: { id: 'campaign-create', result: { error: { title: ['Give the campaign a title.'] } } }
		});
		expect(await db.select().from(page)).toEqual([]);
	});
});
