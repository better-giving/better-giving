import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { createDb, type Db } from '$lib/server/db/client';
import { page } from '$lib/server/db/schema';
import { readServedCampaign } from '$lib/server/pages/campaign';
import { insertPage } from '$lib/server/pages/page-row.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { finishedDeployment } from '../page-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as editor from './_app.admin.campaigns.$pageId';
import { client, stmt } from '$lib/server/db/database.testing';

// a db spec because the edit page reads a page and its saves and presses write one. what each
// card's save checks is $lib/server/pages/section-saves.db.spec.ts's; this holds the route's wiring. the chain is mounted,
// for ../route-request.testing.ts's reason: the session gate is a `middleware` on ./_app.tsx.

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(client);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/campaigns/:pageId', module: editor }
	]);
	session = await signIn(db);
});

beforeEach(async () => {
	await client.batch([
		stmt('delete from page'),
		stmt('delete from form'),
		stmt('delete from program')
	]);
});

type State = 'never_published' | 'live' | 'ended';

/** a campaign called `name` at `slug`, in `state`. */
async function campaign(name: string, slug: string | null, state: State): Promise<string> {
	const pageId = await insertPage(db, 'campaign');
	const [row] = await db.select().from(page).where(eq(page.id, pageId));
	const draft = { ...JSON.parse(row?.draft ?? '{}'), name };
	await db
		.update(page)
		.set({
			name,
			slug,
			state,
			draft: JSON.stringify(draft),
			published: state === 'never_published' ? null : JSON.stringify(draft)
		})
		.where(eq(page.id, pageId));
	return pageId;
}

async function stored(pageId: string) {
	const [row] = await db.select().from(page).where(eq(page.id, pageId));
	if (!row) throw new Error(`no page ${pageId}`);
	return row;
}

/** the edit page as a load draws it. */
const open = (pageId: string) =>
	request(new Request(`${ORIGIN}/admin/campaigns/${pageId}`, { headers: { cookie: session } }), {
		env: bindings
	});

/** the version the page was drawn with: the row's `updated_at` as it stands. */
async function version(pageId: string): Promise<string> {
	return String((await stored(pageId)).updatedAt.getTime());
}

/** a press on the edit page, drawn at the version the row holds now unless `drawn` says otherwise. */
async function post(pageId: string, form: string, fields: Record<string, string>, drawn?: string) {
	const body = new FormData();
	body.set(WHICH_FORM, form);
	body.set(RECORD_VERSION, drawn ?? (await version(pageId)));
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	return request(
		new Request(`${ORIGIN}/admin/campaigns/${pageId}`, {
			method: 'POST',
			headers: { cookie: session },
			body
		}),
		{ env: bindings }
	);
}

/** a story document holding `text` as one paragraph, as the description box posts it. */
const story = (text: string) =>
	JSON.stringify({
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
	});

/** General as its boxes post it, the name and link left as `pageId` holds them unless stated. */
async function general(pageId: string, fields: Record<string, string>, drawn?: string) {
	const row = await stored(pageId);
	return post(
		pageId,
		'campaign-general',
		{
			name: row.name ?? '',
			slug: row.slug ?? '',
			story: story('Coats for every child.'),
			...fields
		},
		drawn
	);
}

/** the sentence a refused press carries under `box`, `''` for the form's own. */
async function refusedUnder(response: Response, box: string): Promise<unknown> {
	const answer = (await response.json()) as {
		form?: { result?: { error?: Record<string, string[]> } };
	};
	return answer.form?.result?.error?.[box];
}

/** a deployment whose set-up is finished. */
let bindings: Env;

beforeEach(async () => {
	bindings = await finishedDeployment();
});

describe('the edit page', () => {
	it('draws a campaign never published as not public, with its cards seeded from the draft', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		const response = await open(pageId);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			unreadable: false,
			name: 'Winter coat drive',
			host: 'donations.example.workers.dev/',
			version: (await stored(pageId)).updatedAt.getTime(),
			banner: {
				state: 'not_public',
				address: '/winter-coat-drive',
				preview: `/preview/${pageId}`,
				unpublishable: false,
				endable: false
			},
			seeds: { general: { boxes: { name: 'Winter coat drive', slug: 'winter-coat-drive' } } }
		});
	});

	it('draws a live campaign as public, offering Unpublish and End', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');

		expect(await (await open(pageId)).json()).toMatchObject({
			banner: { state: 'public', unpublishable: true, endable: true }
		});
	});

	it('draws an ended campaign as ended, offering neither Unpublish nor End', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'ended');

		expect(await (await open(pageId)).json()).toMatchObject({
			banner: { state: 'ended', unpublishable: false, endable: false }
		});
	});

	it('answers 404 for the Donation page and for an id no page has', async () => {
		const donationPage = await insertPage(db, 'donation_page');

		expect((await open(donationPage)).status).toBe(404);
		expect((await open('no-such-page')).status).toBe(404);
	});
});

describe('a section’s Save', () => {
	it('writes the draft alone: donors see the live page as it was, and the banner says so', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		const live = (await stored(pageId)).published;

		const saved = await general(pageId, { story: story('Every child warm this winter.') });

		expect(saved.status).toBe(200);
		expect(await saved.json()).toEqual({ saved: 'campaign-general' });
		const row = await stored(pageId);
		expect(row.published).toBe(live);
		expect(JSON.parse(row.draft).story.content[0].content[0].text).toBe(
			'Every child warm this winter.'
		);
		expect(await (await open(pageId)).json()).toMatchObject({ banner: { state: 'changed' } });
	});

	it('saves suggested amounts with their labels, up to four', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		const saved = await post(pageId, 'campaign-goal', {
			goal_mode: 'fixed',
			goal_amount: '5,000',
			'amount[0]': '25',
			'amount_label[0]': 'A scarf',
			'amount[1]': '100',
			'amount_label[1]': ''
		});

		expect(saved.status).toBe(200);
		expect(await (await open(pageId)).json()).toMatchObject({
			seeds: {
				goal: {
					boxes: {
						goal_mode: 'fixed',
						goal_amount: '5,000',
						amount: ['25', '100'],
						amount_label: ['A scarf', '']
					}
				}
			}
		});
	});

	it('refuses a fifth suggested amount, writing nothing', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');
		const before = (await stored(pageId)).draft;
		const fields = Object.fromEntries(
			['10', '20', '30', '40', '50'].map((amount, at) => [`amount[${at}]`, amount])
		);

		const refused = await post(pageId, 'campaign-goal', { goal_mode: 'none', ...fields });

		expect(refused.status).toBe(400);
		expect(await refusedUnder(refused, 'amount')).toEqual(['at most 4']);
		expect((await stored(pageId)).draft).toBe(before);
	});

	it('refuses a save drawn before another save landed, writing nothing', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		const drawn = await version(pageId);
		await general(pageId, { story: story('First.') });
		const between = (await stored(pageId)).draft;

		const refused = await general(pageId, { story: story('Second.') }, drawn);

		expect(refused.status).toBe(409);
		expect((await stored(pageId)).draft).toBe(between);
	});

	it('asks before moving a published campaign’s link, and moves it once the move is confirmed', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');

		const asked = await general(pageId, { slug: 'warm-hands' });

		expect(await asked.json()).toEqual({
			ask: { kind: 'move', from: '/winter-coat-drive', to: '/warm-hands' }
		});
		expect((await stored(pageId)).slug).toBe('winter-coat-drive');

		const moved = await general(pageId, { slug: 'warm-hands', move: 'on' });

		expect(moved.status).toBe(200);
		expect((await stored(pageId)).slug).toBe('warm-hands');
	});
});

describe('Publish, Publish changes and Unpublish', () => {
	it('puts a campaign never published live on its draft', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		const published = await post(pageId, 'page-publish', {});

		expect(published.status).toBe(200);
		const row = await stored(pageId);
		expect(row.state).toBe('live');
		expect(row.published).toBe(row.draft);
		expect(await (await open(pageId)).json()).toMatchObject({ banner: { state: 'public' } });
	});

	it('makes saved changes live at Publish changes', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		await general(pageId, { story: story('Every child warm this winter.') });

		const published = await post(pageId, 'page-publish', {});

		expect(published.status).toBe(200);
		const row = await stored(pageId);
		expect(row.published).toBe(row.draft);
		expect(await (await open(pageId)).json()).toMatchObject({ banner: { state: 'public' } });
	});

	it('hides an unpublished campaign from donors until it is published again', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');

		const unpublished = await post(pageId, 'page-unpublish', {});

		expect(unpublished.status).toBe(200);
		expect(await readServedCampaign(db, 'winter-coat-drive', Date.now())).toBeNull();
		expect(await (await open(pageId)).json()).toMatchObject({
			banner: { state: 'not_public', unpublishable: false, endable: true }
		});

		expect((await post(pageId, 'page-publish', {})).status).toBe(200);
		expect(await readServedCampaign(db, 'winter-coat-drive', Date.now())).not.toBeNull();
	});

	it('refuses Unpublish on a campaign that is not public, changing nothing', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		const refused = await post(pageId, 'page-unpublish', {});

		expect(refused.status).toBe(409);
		expect((await stored(pageId)).state).toBe('never_published');
	});
});

describe('a draft the page rule refuses', () => {
	/** `pageId`'s `column` holding its document with a key the rule no longer knows, as a narrowed rule reads it. */
	async function unreadable(pageId: string, column: 'draft' | 'published') {
		const document = JSON.parse((await stored(pageId))[column] ?? '{}');
		await db
			.update(page)
			.set({ [column]: JSON.stringify({ ...document, blocks: [] }) })
			.where(eq(page.id, pageId));
	}

	it('opens the page saying so, offering Discard changes while the live page reads', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		await unreadable(pageId, 'draft');

		const response = await open(pageId);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			unreadable: true,
			discardable: true,
			name: 'Winter coat drive',
			banner: { state: 'changed', address: '/winter-coat-drive' }
		});
	});

	it('is repaired by Discard changes, and the page draws its cards again', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		await unreadable(pageId, 'draft');

		const discarded = await post(pageId, 'page-discard', {});

		expect(discarded.status).toBe(200);
		expect(await (await open(pageId)).json()).toMatchObject({
			unreadable: false,
			banner: { state: 'public' }
		});
	});

	it('offers no Discard changes where the live page fails the rule too', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		await unreadable(pageId, 'published');
		await unreadable(pageId, 'draft');

		expect(await (await open(pageId)).json()).toMatchObject({
			unreadable: true,
			discardable: false
		});
	});
});
