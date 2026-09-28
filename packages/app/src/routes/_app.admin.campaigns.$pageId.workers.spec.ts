import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { createDb, type Db } from '$lib/server/db/client';
import { form, page, program } from '$lib/server/db/schema';
import { createCampaign, readServedCampaign } from '$lib/server/pages/campaign';
import { insertPage, SETTINGS } from '$lib/server/pages/page-row.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as editor from './_app.admin.campaigns.$pageId';

// a workers spec because the editor reads a page and its presses write one. the chain is mounted,
// for ../route-request.testing.ts's reason: the session gate is a `middleware` on ./_app.tsx.

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/campaigns/:pageId', module: editor }
	]);
	session = await signIn(db);
});

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare('delete from chat_turn'),
		env.DB.prepare('delete from page'),
		env.DB.prepare('delete from form'),
		env.DB.prepare('delete from program')
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

/** moves the published end of the live campaign `pageId` a second into the past. */
async function endedByDate(pageId: string): Promise<void> {
	const published = JSON.parse((await stored(pageId)).published ?? '{}');
	await db
		.update(page)
		.set({
			published: JSON.stringify({
				...published,
				endsAt: Date.now() - 1_000,
				endsZone: 'America/New_York'
			})
		})
		.where(eq(page.id, pageId));
}

async function stored(pageId: string) {
	const [row] = await db.select().from(page).where(eq(page.id, pageId));
	if (!row) throw new Error(`no page ${pageId}`);
	return row;
}

/** the version the editor was drawn with: the row's `updated_at` as it stands. */
async function version(pageId: string): Promise<string> {
	return String((await stored(pageId)).updatedAt.getTime());
}

/** a press on the editor, drawn at the version the row holds now unless `drawn` says otherwise. */
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
		{ env }
	);
}

const address = (pageId: string, slug: string, extra: Record<string, string> = {}) =>
	post(pageId, 'campaign-address', { slug, ...extra });

async function slugError(response: Response): Promise<unknown> {
	const answer = (await response.json()) as {
		form?: { result?: { error?: Record<string, string[]> } };
	};
	return answer.form?.result?.error?.slug;
}

describe('the address', () => {
	it.each([
		['admin', '/admin'],
		['api', '/api'],
		['console', '/console']
	])('refuses %s, naming the route it clashes with, and moves nothing', async (slug, route) => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		const response = await address(pageId, slug);

		expect(response.status).toBe(400);
		const answer = await response.clone().json();
		expect(answer).toMatchObject({ form: { result: { initialValue: { slug } } } });
		expect(await slugError(response)).toEqual([`clashes with ${route}`]);
		expect((await stored(pageId)).slug).toBe('winter-coat-drive');
	});

	it('refuses donate as the Donation page’s', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		const response = await address(pageId, 'donate');

		expect(response.status).toBe(400);
		expect(await slugError(response)).toEqual(['taken by the Donation page']);
	});

	it.each([
		['live', 'live'],
		['never published', 'never_published']
	] as const)('refuses an address a %s campaign holds, naming it', async (_, state) => {
		await campaign('Giving Tuesday', 'giving-tuesday', state);
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		const response = await address(pageId, 'giving-tuesday');

		expect(response.status).toBe(409);
		expect(await slugError(response)).toEqual(['taken by Giving Tuesday']);
		expect((await stored(pageId)).slug).toBe('winter-coat-drive');
	});

	it('moves a never-published campaign’s address at once, repairing its case', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		const response = await address(pageId, ' Coats ');

		expect(response.status).toBe(200);
		expect((await stored(pageId)).slug).toBe('coats');
	});

	it('asks before moving a published campaign, and moves nothing until it is answered', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');

		const response = await address(pageId, 'coats');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ask: { kind: 'move', from: '/winter-coat-drive', to: '/coats' }
		});
		expect((await stored(pageId)).slug).toBe('winter-coat-drive');
	});

	it('moves a published campaign once the move is confirmed, and the old address answers nothing', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');

		const response = await address(pageId, 'coats', { move: 'on' });

		expect(response.status).toBe(200);
		expect((await readServedCampaign(db, 'coats', Date.now()))?.id).toBe(pageId);
		expect(await readServedCampaign(db, 'winter-coat-drive', Date.now())).toBeNull();
	});
});

describe('an ended campaign’s address', () => {
	it('is asked for before it is taken, and nothing moves until it is answered', async () => {
		const ended = await campaign('Summer camp fund', 'summer-camp', 'ended');
		const pageId = await campaign('Summer camp 2027', 'summer-camp-2027', 'never_published');

		const response = await address(pageId, 'summer-camp');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ask: { kind: 'takeover', holder: 'Summer camp fund', to: '/summer-camp' }
		});
		expect((await stored(pageId)).slug).toBe('summer-camp-2027');
		expect((await stored(ended)).slug).toBe('summer-camp');
	});

	it('moves here once the takeover is confirmed, and the ended campaign has none', async () => {
		const ended = await campaign('Summer camp fund', 'summer-camp', 'ended');
		const pageId = await campaign('Summer camp 2027', 'summer-camp-2027', 'never_published');

		const response = await address(pageId, 'summer-camp', { takeover: 'on' });

		expect(response.status).toBe(200);
		expect((await stored(pageId)).slug).toBe('summer-camp');
		expect((await stored(ended)).slug).toBeNull();
	});

	it('is taken the same from a live campaign past its published end date, which ends as End leaves it', async () => {
		const ended = await campaign('Summer camp fund', 'summer-camp', 'live');
		await endedByDate(ended);
		// live, as publish leaves a live campaign's row.
		await db
			.update(form)
			.set({ status: 'live' })
			.where(eq(form.id, (await stored(ended)).formId));
		const pageId = await campaign('Summer camp 2027', 'summer-camp-2027', 'never_published');

		const asked = await address(pageId, 'summer-camp');
		expect(await asked.json()).toEqual({
			ask: { kind: 'takeover', holder: 'Summer camp fund', to: '/summer-camp' }
		});

		const response = await address(pageId, 'summer-camp', { takeover: 'on' });

		expect(response.status).toBe(200);
		expect((await stored(pageId)).slug).toBe('summer-camp');
		const holder = await stored(ended);
		expect({ slug: holder.slug, state: holder.state }).toEqual({ slug: null, state: 'ended' });
		const [owned] = await db.select().from(form).where(eq(form.id, holder.formId));
		expect(owned?.status).toBe('draft');
	});

	it('is not taken by a save drawn from an older version, and the ended campaign keeps it', async () => {
		const ended = await campaign('Summer camp fund', 'summer-camp', 'ended');
		const pageId = await campaign('Summer camp 2027', 'summer-camp-2027', 'never_published');
		const drawn = await version(pageId);
		await db
			.update(page)
			.set({ updatedAt: new Date(Number(drawn) + 1) })
			.where(eq(page.id, pageId));

		const response = await post(
			pageId,
			'campaign-address',
			{ slug: 'summer-camp', takeover: 'on' },
			drawn
		);

		expect(response.status).toBe(409);
		expect((await stored(pageId)).slug).toBe('summer-camp-2027');
		expect((await stored(ended)).slug).toBe('summer-camp');
	});
});

describe('the name', () => {
	const rename = (pageId: string, name: string, drawn?: string) =>
		post(pageId, 'campaign-name', { name }, drawn);

	it('renames a never-published campaign in its row and its draft, and its address follows', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		const response = await rename(pageId, 'Warm hands winter');

		expect(response.status).toBe(200);
		const row = await stored(pageId);
		expect([row.name, JSON.parse(row.draft).name, row.slug]).toEqual([
			'Warm hands winter',
			'Warm hands winter',
			'warm-hands-winter'
		]);
	});

	it('takes the next free address when another campaign holds the one the name suggests', async () => {
		await campaign('Giving Tuesday', 'giving-tuesday', 'ended');
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		await rename(pageId, 'Giving Tuesday');

		expect((await stored(pageId)).slug).toBe('giving-tuesday-2');
	});

	it('leaves a published campaign’s address and live page where they are', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		const live = (await stored(pageId)).published;

		const response = await rename(pageId, 'Warm hands winter');

		expect(response.status).toBe(200);
		const row = await stored(pageId);
		expect([row.name, JSON.parse(row.draft).name, row.slug]).toEqual([
			'Warm hands winter',
			'Warm hands winter',
			'winter-coat-drive'
		]);
		expect(row.published).toBe(live);
	});

	it('refuses a rename drawn from an older version, keeping what was typed', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');
		const drawn = await version(pageId);
		await db
			.update(page)
			.set({ updatedAt: new Date(Number(drawn) + 1) })
			.where(eq(page.id, pageId));

		const response = await rename(pageId, 'Warm hands winter', drawn);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			form: { id: 'campaign-name', result: { initialValue: { name: 'Warm hands winter' } } }
		});
		expect((await stored(pageId)).name).toBe('Winter coat drive');
	});
});

describe('the donation settings', () => {
	/** the owned settings row as it stands: what /donate, the campaign's address and a gift read. */
	async function owned(pageId: string) {
		const [row] = await db
			.select()
			.from(form)
			.where(eq(form.id, (await stored(pageId)).formId));
		return row;
	}

	const settings = (pageId: string, fields: Record<string, string>, drawn?: string) =>
		post(pageId, 'page-settings', { program_mode: 'none', program_id: '', ...fields }, drawn);

	it('writes the draft’s settings, leaving the live page and the owned settings row as they were', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		const live = (await stored(pageId)).published;
		const row = await owned(pageId);

		const response = await settings(pageId, {
			min_minor: '10',
			max_minor: '500',
			'suggested_amounts[0]': '20',
			'suggested_amounts[1]': '40'
		});

		expect(response.status).toBe(200);
		const after = await stored(pageId);
		expect(JSON.parse(after.draft).settings).toEqual({
			...SETTINGS,
			minMinor: 1000,
			maxMinor: 50_000,
			suggestedAmounts: [2000, 4000]
		});
		expect(after.published).toBe(live);
		expect(await owned(pageId)).toEqual(row);
	});

	it('refuses a save drawn from an older version, keeping what was typed and writing nothing', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');
		const drawn = await version(pageId);
		await post(pageId, 'campaign-name', { name: 'Warm hands winter' });
		const draft = (await stored(pageId)).draft;

		const response = await settings(
			pageId,
			{ min_minor: '10', max_minor: '500', 'suggested_amounts[0]': '20' },
			drawn
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			form: {
				id: 'page-settings',
				result: {
					initialValue: { min_minor: '10', max_minor: '500', suggested_amounts: ['20'] },
					error: { '': [expect.stringContaining('has been saved since the editor was opened')] }
				}
			}
		});
		expect((await stored(pageId)).draft).toBe(draft);
	});

	it.each([
		[
			'bounds the wrong way round',
			{ min_minor: '500', max_minor: '10', 'suggested_amounts[0]': '20' },
			'max_minor',
			'must be larger than smallest gift'
		],
		[
			'an amount outside the bounds',
			{
				min_minor: '10',
				max_minor: '500',
				'suggested_amounts[0]': '20',
				'suggested_amounts[1]': '900'
			},
			'suggested_amounts[1]',
			expect.stringContaining('$500')
		],
		[
			'one program with none named',
			{ program_mode: 'pinned', min_minor: '10', max_minor: '500', 'suggested_amounts[0]': '20' },
			'program_id',
			expect.any(String)
		]
	])('refuses %s, naming the box, and writes nothing', async (_, fields, box, sentence) => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');
		const draft = (await stored(pageId)).draft;

		const response = await settings(pageId, fields);

		expect(response.status).toBe(400);
		const answer = (await response.json()) as {
			form: { result: { error: Record<string, string[]> } };
		};
		expect(answer.form.result.error[box]).toEqual([sentence]);
		expect((await stored(pageId)).draft).toBe(draft);
	});

	it('pins an active program, and refuses one no longer offered', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');
		const [coats, camp] = await db
			.insert(program)
			.values([
				{ name: 'Winter coats' },
				{ name: 'Summer camp', status: 'archived', archivedAt: new Date('2026-09-01T00:00:00Z') }
			])
			.returning({ id: program.id });
		const amounts = { min_minor: '10', max_minor: '500', 'suggested_amounts[0]': '20' };

		const retired = await settings(pageId, {
			...amounts,
			program_mode: 'pinned',
			program_id: camp?.id ?? ''
		});
		expect(retired.status).toBe(400);
		expect(await retired.json()).toMatchObject({
			form: { result: { error: { program_id: ['Choose an active program.'] } } }
		});

		const pinned = await settings(pageId, {
			...amounts,
			program_mode: 'pinned',
			program_id: coats?.id ?? ''
		});
		expect(pinned.status).toBe(200);
		expect(JSON.parse((await stored(pageId)).draft).settings).toMatchObject({
			programMode: 'pinned',
			programId: coats?.id
		});
	});
});

describe('the editor', () => {
	async function open(pageId: string) {
		return request(
			new Request(`${ORIGIN}/admin/campaigns/${pageId}`, { headers: { cookie: session } }),
			{ env }
		);
	}

	it('draws a live campaign renamed since its publish as changed, framing its draft', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		await post(pageId, 'campaign-name', { name: 'Warm hands winter' });

		const response = await open(pageId);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			name: 'Warm hands winter',
			state: 'changed',
			address: '/winter-coat-drive',
			host: 'donations.example.workers.dev/',
			preview: `/preview/${pageId}`,
			version: (await stored(pageId)).updatedAt.getTime()
		});
	});

	it.each([
		['never published', 'unpublished', 'never_published'],
		['live and unchanged', 'live', 'live'],
		['ended', 'ended', 'ended']
	] as const)('reads a campaign %s as %s', async (_, drawn, state) => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', state);

		expect(await (await open(pageId)).json()).toMatchObject({ state: drawn });
	});

	it('reads a live campaign past its published end date as ended, as End leaves one', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		await endedByDate(pageId);

		expect(await (await open(pageId)).json()).toMatchObject({ state: 'ended' });
	});

	it('reads the draft’s end date as the day it was chosen, in the zone it was chosen in', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');
		const row = await stored(pageId);
		const draft = {
			...JSON.parse(row.draft),
			endsAt: Date.parse('2027-01-01T05:00:00Z') - 1,
			endsZone: 'America/New_York'
		};
		await db
			.update(page)
			.set({ draft: JSON.stringify(draft) })
			.where(eq(page.id, pageId));

		expect(await (await open(pageId)).json()).toMatchObject({ endDate: '2026-12-31' });
	});

	/** a campaign made from the Campaigns list as `title`, with no "What's it for?". */
	async function created(title: string): Promise<string> {
		const made = await createCampaign(db, env, {
			title,
			line: '',
			timeZone: 'UTC',
			now: Date.now()
		});
		return made.pageId;
	}

	it('names the address a never-published campaign’s name asked for, where another campaign holds it', async () => {
		await campaign('Winter coat drive', 'winter-coat-drive', 'ended');
		const pageId = await created('Winter coat drive');

		expect(await (await open(pageId)).json()).toMatchObject({
			address: '/winter-coat-drive-2',
			asked: '/winter-coat-drive'
		});
	});

	it('names no address asked for where the name’s own is free', async () => {
		const pageId = await created('Winter coat drive');

		expect(await (await open(pageId)).json()).toMatchObject({
			address: '/winter-coat-drive',
			asked: null
		});
	});

	it('names no address asked for where the address was set by hand', async () => {
		const pageId = await created('Winter coat drive');
		await address(pageId, 'coats');

		expect(await (await open(pageId)).json()).toMatchObject({ address: '/coats', asked: null });
	});

	it('names no address asked for once the campaign has been published', async () => {
		await campaign('Winter coat drive', 'winter-coat-drive', 'ended');
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive-2', 'live');

		expect(await (await open(pageId)).json()).toMatchObject({
			address: '/winter-coat-drive-2',
			asked: null
		});
	});

	it('answers 404 for the Donation page and for an id no page has', async () => {
		const donationPage = await insertPage(db, 'donation_page');

		expect((await open(donationPage)).status).toBe(404);
		expect((await open('pg_nothing')).status).toBe(404);
	});
});

describe('Publish', () => {
	async function refusal(response: Response): Promise<unknown> {
		const answer = (await response.json()) as {
			form?: { result?: { error?: Record<string, string[]> } };
		};
		return answer.form?.result?.error?.[''];
	}

	it('puts a first Publish live from its confirm, gifts going to the program chosen there', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');
		const [coats] = await db
			.insert(program)
			.values({ name: 'Winter coats' })
			.returning({ id: program.id });

		const response = await post(pageId, 'page-first-publish', { gifts_go_to: coats?.id ?? '' });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ published: true, undoable: false });
		const live = await readServedCampaign(db, 'winter-coat-drive', Date.now());
		expect(live?.id).toBe(pageId);
		const [owned] = await db
			.select()
			.from(form)
			.where(eq(form.id, live?.formId ?? ''));
		expect(owned).toMatchObject({ status: 'live', programMode: 'pinned', programId: coats?.id });
	});

	it('keeps the draft’s own program where the confirm is left on it', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		const response = await post(pageId, 'page-first-publish', { gifts_go_to: 'none' });

		expect(response.status).toBe(200);
		const [owned] = await db
			.select()
			.from(form)
			.where(eq(form.id, (await stored(pageId)).formId));
		expect(owned).toMatchObject({ status: 'live', programMode: SETTINGS.programMode });
	});

	it('refuses a first Publish that skips its confirm, and nothing goes live', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		const response = await post(pageId, 'page-publish', {});

		expect(response.status).toBe(422);
		expect(await refusal(response)).toEqual([
			'Nothing was published: a campaign’s first Publish says where its gifts go. Publish it from its editor, choosing under “Gifts go to”.'
		]);
		expect((await stored(pageId)).state).toBe('never_published');
	});

	it('republishes a live campaign with no confirm, as a republish Undo can take back', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');

		const response = await post(pageId, 'page-publish', {});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ published: true, undoable: true });
	});

	it('has no Reset to default, and refuses one posted by hand, leaving the campaign as it was', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		const drawn = await stored(pageId);

		const response = await post(pageId, 'page-reset', {});

		expect(response.status).toBe(400);
		expect(await response.text()).toContain('names no form on this screen');
		expect(await stored(pageId)).toEqual(drawn);
	});

	it('answers 404 for an id no campaign has', async () => {
		const response = await post(
			'no-such-page',
			'page-publish',
			{},
			String(Date.parse('2026-09-28T00:00:00Z'))
		);

		expect(response.status).toBe(404);
		expect(await refusal(response)).toEqual([
			'no campaign has the id "no-such-page"; open it again from the Campaigns list.'
		]);
	});
});

describe('a block’s sheet and the layout pictures', () => {
	async function drawn(pageId: string) {
		const response = await request(
			new Request(`${ORIGIN}/admin/campaigns/${pageId}`, { headers: { cookie: session } }),
			{ env }
		);
		return (await response.json()) as {
			blocks: { id: string; summary: string; text: unknown }[];
			layout: string;
		};
	}

	it('writes a title’s words to the draft, drawn on the next load, and the live page stays', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'live');
		const published = (await stored(pageId)).published;

		const response = await post(pageId, 'block-title', {
			block_id: 'title',
			heading: 'Coats before the first frost',
			lede: ''
		});

		expect(response.status).toBe(200);
		expect((await drawn(pageId)).blocks.find(({ id }) => id === 'title')).toMatchObject({
			summary: 'Coats before the first frost',
			text: { kind: 'title', heading: 'Coats before the first frost', lede: '' }
		});
		expect((await stored(pageId)).published).toBe(published);
	});

	it('writes a layout picked, and refuses one off the list naming it', async () => {
		const pageId = await campaign('Winter coat drive', 'winter-coat-drive', 'never_published');

		expect((await post(pageId, 'page-layout', { layout: 'banner' })).status).toBe(200);
		expect((await drawn(pageId)).layout).toBe('banner');

		const refused = await post(pageId, 'page-layout', { layout: 'sideways' });
		expect(refused.status).toBe(400);
		expect(await refused.json()).toMatchObject({
			form: { result: { error: { layout: [expect.stringContaining('"sideways"')] } } }
		});
	});
});
