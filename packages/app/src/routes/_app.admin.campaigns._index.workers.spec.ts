import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { defaultCampaign } from '$lib/page/defaults';
import { slugFromTitle } from '$lib/page/slug';
import { createDb, type Db } from '$lib/server/db/client';
import { form, page } from '$lib/server/db/schema';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { readChat } from '$lib/server/pages/draft';
import { answering, insertPage, SETTINGS } from '$lib/server/pages/page-row.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { finishedDeployment } from '../page-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as campaignPage from './$slug';
import * as layout from './_app';
import * as campaigns from './_app.admin.campaigns._index';

// a workers spec because the list reads pages and New campaign writes one. the chain is mounted, for
// ../route-request.testing.ts's reason: the session gate is a `middleware` on ./_app.tsx. what a
// create writes is ../lib/server/pages/campaign.workers.spec.ts's; here, what the edge takes and
// what it answers.

const LIST = '/admin/campaigns';

let db: Db;
let request: RouteRequester;
/** a campaign's own address, which End and Publish move. */
let served: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/campaigns', module: campaigns }
	]);
	served = mountRoutes([{ path: ':slug', module: campaignPage }]);
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
	body.set(WHICH_FORM, 'campaign-create');
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	return request(
		new Request(`${ORIGIN}${LIST}?new`, { method: 'POST', headers: { cookie: session }, body }),
		// the stand-in answers `run` alone, which is all `generate` calls.
		{ env: { ...bindings, AI } as unknown as Env }
	);
}

const CREATE = {
	title: 'Winter coat drive',
	purpose: '',
	time_zone: 'America/New_York'
};

type Row = {
	id: string;
	version: number;
	name: string;
	address: string | null;
	state: string;
	goal: string | null;
	ends: string | null;
};

async function load(): Promise<{ campaigns: Row[]; ended: Row[] }> {
	const response = await request(
		new Request(`${ORIGIN}${LIST}`, { headers: { cookie: session } }),
		{
			env: bindings
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

/** one of a row's presses, as its form posts it: which press, the row's version, the page. */
function press(which: string, row: Pick<Row, 'id' | 'version'>, at = LIST) {
	const body = new FormData();
	body.set(WHICH_FORM, which);
	body.set(RECORD_VERSION, String(row.version));
	body.set('page_id', row.id);
	return request(
		new Request(`${ORIGIN}${at}`, { method: 'POST', headers: { cookie: session }, body }),
		{ env: bindings }
	);
}

/** a deployment whose Stripe pair is set, so a live campaign's page is drawn rather than refused. */
const STRIPE = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
};

/** what the campaign's address answers with. */
async function visit(slug: string): Promise<{ kind: string }> {
	// a campaign's page is refused where the organisation has no legal identity.
	await env.DB.prepare('delete from org_profile').run();
	await writeOrgRow(env.DB, { tax_id: '12-3456789' });
	// the served cadences, warmed so the page never sends the fixture key to Stripe
	// ($lib/server/forms/cadence-cache.ts).
	await edgeCache().put(
		new Request(`${ORIGIN}/__recurring-cadences`),
		new Response(JSON.stringify(['one_time']), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
	const response = await served(new Request(`${ORIGIN}/${slug}`), {
		env: { ...env, ...STRIPE } as Env
	});
	return response.json();
}

/** the one listed row named `name`, in either group. */
async function listed(name: string): Promise<Row> {
	const { campaigns: live, ended } = await load();
	const row = [...live, ...ended].find((each) => each.name === name);
	if (!row) throw new Error(`${name} is not on the list`);
	return row;
}

const DAY = 86_400_000;
const NOW = Date.now();

/** a deployment whose set-up is finished, which the layout's set-up gate serves this screen on. */
let bindings: Env;

beforeEach(async () => {
	bindings = await finishedDeployment();
});

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

	it('shows a campaign’s goal and the day its end was chosen for, in the zone it was chosen in', async () => {
		// the end of 31 December 2099 in los angeles, already 1 January in new york and in UTC
		await campaign('Winter coat drive', 'live', NOW, {
			goalMinor: 1_500_000,
			endsAt: Date.parse('2100-01-01T08:00:00Z') - 1,
			endsZone: 'America/Los_Angeles'
		});
		await campaign('Spring gala appeal', 'never_published', NOW - DAY);

		const { campaigns: listed } = await load();

		expect(listed.map(({ goal, ends }) => ({ goal, ends }))).toEqual([
			{ goal: '$15,000', ends: 'Dec 31, 2099' },
			{ goal: null, ends: null }
		]);
	});

	it('gives an ended campaign no end date where it was ended before it', async () => {
		await campaign('Flood relief', 'ended', NOW - 9 * DAY, {
			endsAt: NOW + DAY,
			endsZone: 'America/New_York'
		});
		await campaign('Summer camp fund', 'ended', NOW - 10 * DAY, {
			endsAt: Date.parse('2026-01-01T05:00:00Z') - 1,
			endsZone: 'America/New_York'
		});

		const { ended } = await load();

		expect(ended.map(({ name, ends }) => [name, ends])).toEqual([
			['Flood relief', null],
			['Summer camp fund', 'Dec 31, 2025']
		]);
	});

	it('lists a campaign whose draft its rule refuses by name, address and state alone', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const broken = await campaign('Winter coat drive', 'live', NOW, {
			goalMinor: 1_500_000,
			endsAt: NOW + DAY,
			endsZone: 'America/New_York'
		});
		await env.DB.prepare(`update page set draft = '{}' where id = ?`).bind(broken).run();
		await campaign('Spring gala appeal', 'live', NOW - DAY, { goalMinor: 500_000 });

		const { campaigns: listed } = await load();

		expect(listed).toEqual([
			{
				id: broken,
				version: expect.any(Number),
				name: 'Winter coat drive',
				address: '/winter-coat-drive',
				state: 'live',
				goal: null,
				ends: null
			},
			expect.objectContaining({ name: 'Spring gala appeal', goal: '$5,000' })
		]);
		expect(errors).toHaveBeenCalledWith(
			expect.stringContaining(`page ${broken}`),
			expect.anything()
		);
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

	it('opens the editor on its chat when it was made with a line', async () => {
		const response = await post({ ...CREATE, purpose: 'coats for 300 kids' });

		const [made] = await db.select().from(page).where(eq(page.type, 'campaign'));
		expect(response.headers.get('Location')).toBe(`${LIST}/${made?.id}?chat`);
	});

	it('refuses a blank title at its box, and makes nothing', async () => {
		const response = await post({ ...CREATE, title: '   ' });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			form: { id: 'campaign-create', result: { error: { title: ['required'] } } }
		});
		expect(await db.select().from(page)).toEqual([]);
	});
});

/** an hour from now, well inside the signed-in session: the instant a campaign's end comes. */
const ENDS_AT = NOW + 3_600_000;
const ENDING = { endsAt: ENDS_AT, endsZone: 'America/New_York' };

/** the clock the loader and the presses take their `now` from. */
function clockAt(now: number) {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(now);
}

describe('a live campaign at its published end date', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('is listed live up to its end instant, and from it in the Ended group as End leaves one', async () => {
		await campaign('Winter coat drive', 'live', ENDS_AT - 2 * DAY, ENDING);
		await campaign('Summer camp fund', 'ended', ENDS_AT - 9 * DAY);

		clockAt(ENDS_AT - 1);
		const before = await load();
		expect(before.campaigns.map((row) => [row.name, row.state])).toEqual([
			['Winter coat drive', 'live']
		]);

		clockAt(ENDS_AT);
		const { campaigns: live, ended } = await load();
		expect(live).toEqual([]);
		expect(ended.map((row) => [row.name, row.state])).toEqual([
			['Winter coat drive', 'ended'],
			['Summer camp fund', 'ended']
		]);
	});

	it.each([
		['later', 7 * DAY],
		['earlier', -3 * DAY]
	])('dates it by the end it ended on, its draft’s end since moved %s', async (_, moved) => {
		const pageId = await campaign('Winter coat drive', 'live', NOW, ENDING);
		await db
			.update(page)
			.set({
				draft: JSON.stringify({
					...defaultCampaign(),
					settings: SETTINGS,
					...ENDING,
					endsAt: ENDS_AT + moved
				})
			})
			.where(eq(page.id, pageId));
		clockAt(ENDS_AT);

		const day = new Intl.DateTimeFormat('en-US', {
			timeZone: 'America/New_York',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(ENDS_AT);
		expect((await load()).ended.map(({ name, ends }) => [name, ends])).toEqual([
			['Winter coat drive', day]
		]);
	});

	it('stays live for an end date only its draft holds, however long past', async () => {
		const pageId = await campaign('Winter coat drive', 'live', NOW);
		await db
			.update(page)
			.set({ draft: JSON.stringify({ ...defaultCampaign(), settings: SETTINGS, ...ENDING }) })
			.where(eq(page.id, pageId));
		clockAt(ENDS_AT + DAY);

		expect((await listed('Winter coat drive')).state).toBe('live');
	});

	it('is published again from the Ended group once its draft ends later, back live at its address', async () => {
		const pageId = await campaign('Winter coat drive', 'live', NOW, ENDING);
		await db
			.update(page)
			.set({
				draft: JSON.stringify({
					...defaultCampaign(),
					settings: SETTINGS,
					...ENDING,
					endsAt: ENDS_AT + 7 * DAY
				})
			})
			.where(eq(page.id, pageId));
		clockAt(ENDS_AT);

		const response = await press('campaign-publish', await listed('Winter coat drive'));

		expect(response.status).toBe(303);
		expect((await listed('Winter coat drive')).state).toBe('live');
		expect(await visit('winter-coat-drive')).toMatchObject({ kind: 'page' });
	});
});

describe('End', () => {
	it('moves a live campaign to the Ended group, its address saying it has ended, its pages kept', async () => {
		const pageId = await campaign('Winter coat drive', 'live', NOW);
		const [before] = await db.select().from(page).where(eq(page.id, pageId));

		const response = await press(
			'campaign-end',
			await listed('Winter coat drive'),
			`${LIST}?end=${pageId}`
		);

		expect(response.status).toBe(303);
		expect(response.headers.get('Location')).toBe(LIST);
		const { campaigns: live, ended } = await load();
		expect(live).toEqual([]);
		expect(ended.map((row) => [row.name, row.state])).toEqual([['Winter coat drive', 'ended']]);
		expect(await visit('winter-coat-drive')).toMatchObject({ kind: 'ended' });
		const [after] = await db.select().from(page).where(eq(page.id, pageId));
		expect({ draft: after?.draft, published: after?.published }).toEqual({
			draft: before?.draft,
			published: before?.published
		});
	});
});

describe('Publish from the Ended group', () => {
	it('brings an ended campaign back live at its address, taking gifts again', async () => {
		const pageId = await campaign('Summer camp fund', 'ended', NOW);

		const response = await press('campaign-publish', await listed('Summer camp fund'));

		expect(response.status).toBe(303);
		expect(response.headers.get('Location')).toBe(LIST);
		const { campaigns: live, ended } = await load();
		expect(live.map((row) => [row.name, row.state])).toEqual([['Summer camp fund', 'live']]);
		expect(ended).toEqual([]);
		expect(await visit('summer-camp-fund')).toMatchObject({ kind: 'page' });
		const [row] = await db.select().from(page).where(eq(page.id, pageId));
		const [owned] = await db
			.select()
			.from(form)
			.where(eq(form.id, row?.formId ?? ''));
		expect(owned?.status).toBe('live');
	});

	it('refuses a campaign whose end date has passed, naming the date, for the row pressed', async () => {
		await campaign('Summer camp fund', 'ended', NOW, {
			endsAt: Date.parse('2026-01-01T05:00:00Z') - 1,
			endsZone: 'America/New_York'
		});
		const row = await listed('Summer camp fund');

		const response = await press('campaign-publish', row);

		expect(response.status).toBe(422);
		const refused = await response.json();
		expect(refused).toMatchObject({ pageId: row.id, form: { id: 'campaign-publish' } });
		expect(JSON.stringify(refused)).toContain('the end date, Dec 31, 2025, has passed');
		expect((await listed('Summer camp fund')).state).toBe('ended');
	});
});

describe('Delete', () => {
	it('removes a never-published campaign and the settings row it owns', async () => {
		const pageId = await campaign('Spring gala appeal', 'never_published', NOW);
		const [row] = await db.select().from(page).where(eq(page.id, pageId));

		const response = await press(
			'campaign-delete',
			await listed('Spring gala appeal'),
			`${LIST}?delete=${pageId}`
		);

		expect(response.status).toBe(303);
		expect(response.headers.get('Location')).toBe(LIST);
		expect(await load()).toMatchObject({ campaigns: [], ended: [] });
		expect(
			await db
				.select()
				.from(form)
				.where(eq(form.id, row?.formId ?? ''))
		).toEqual([]);
	});

	it('is asked about a never-published campaign and no campaign that has been live', async () => {
		const never = await campaign('Spring gala appeal', 'never_published', NOW);
		const live = await campaign('Winter coat drive', 'live', NOW - DAY);
		const ended = await campaign('Summer camp fund', 'ended', NOW - 2 * DAY);

		const asked = async (pageId: string) => {
			const response = await request(
				new Request(`${ORIGIN}${LIST}?delete=${pageId}`, { headers: { cookie: session } }),
				{ env: bindings }
			);
			return ((await response.json()) as { deleting: { id: string } | null }).deleting?.id ?? null;
		};

		expect(await asked(never)).toBe(never);
		expect(await asked(live)).toBeNull();
		expect(await asked(ended)).toBeNull();
	});

	it.each([['live'], ['ended']] as const)(
		'refuses a campaign that is %s, keeping it',
		async (state) => {
			await campaign('Winter coat drive', state, NOW);

			const response = await press('campaign-delete', await listed('Winter coat drive'));

			expect(response.status).toBe(409);
			expect(JSON.stringify(await response.json())).toContain('has been published');
			expect((await listed('Winter coat drive')).state).toBe(state);
		}
	);
});

describe('the Donation page', () => {
	it.each([
		['campaign-end', 'ended'],
		['campaign-delete', 'deleted']
	])('is no campaign to a press of %s, and is left as it was', async (which, done) => {
		const pageId = await insertPage(db, 'donation_page');
		const [before] = await db.select().from(page).where(eq(page.id, pageId));

		const response = await press(which, { id: pageId, version: before?.updatedAt.getTime() ?? 0 });

		expect(response.status).toBe(404);
		expect(JSON.stringify(await response.json())).toContain(
			`Nothing was ${done}: \`page_id\` ${pageId} names no campaign`
		);
		expect(await db.select().from(page).where(eq(page.id, pageId))).toEqual([before]);
	});
});

describe('a stale press', () => {
	it.each([
		['campaign-end', 'live'],
		['campaign-delete', 'never_published'],
		['campaign-publish', 'ended']
	] as const)(
		'%s drawn before the campaign was last saved is refused, and moves nothing',
		async (which, state) => {
			const pageId = await campaign('Winter coat drive', state, NOW);
			const drawn = await listed('Winter coat drive');
			// a save in the editor, after the list was drawn.
			await db.update(page).set({ name: 'Winter coat drive 2026' }).where(eq(page.id, pageId));

			const response = await press(which, drawn);

			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({
				pageId,
				form: { id: which, result: { error: { '': [expect.stringContaining('Reload the page')] } } }
			});
			expect((await listed('Winter coat drive 2026')).state).toBe(state);
		}
	);
});

describe('what a landed press tells the list it lands on', () => {
	/** the list drawn with the flash a press's redirect set, beside the session. */
	async function landedOn(pressed: Response) {
		const flash = pressed.headers.getSetCookie().map((cookie) => cookie.split(';', 1)[0]);
		const response = await request(
			new Request(`${ORIGIN}${LIST}`, { headers: { cookie: [session, ...flash].join('; ') } }),
			{ env: bindings }
		);
		const body = (await response.json()) as { landed: unknown };
		return { landed: body.landed, clears: response.headers.getSetCookie().join('\n') };
	}

	it.each([
		['End', 'campaign-end', 'live', 'ended', true],
		['Publish', 'campaign-publish', 'ended', 'published', true],
		['Delete', 'campaign-delete', 'never_published', 'deleted', false]
	] as const)(
		'says %s landed, and on which row while it is still listed',
		async (_, which, state, outcome, listedAfter) => {
			const pageId = await campaign('Winter coat drive', state, NOW);

			const pressed = await press(which, await listed('Winter coat drive'));
			expect(pressed.status).toBe(303);
			const { landed, clears } = await landedOn(pressed);

			expect(landed).toEqual({ outcome, pageId: listedAfter ? pageId : null });
			// one-shot: the answer that reports it is the one that burns it.
			expect(clears).toMatch(/Max-Age=0/);
		}
	);

	it('says nothing on a list drawn without a press behind it', async () => {
		await campaign('Winter coat drive', 'live', NOW);

		const { landed } = await landedOn(new Response());

		expect(landed).toBeNull();
	});
});
