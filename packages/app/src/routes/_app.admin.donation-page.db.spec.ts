import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { createDb, type Db } from '$lib/server/db/client';
import { form, page } from '$lib/server/db/schema';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { finishedDeployment } from '../page-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as editor from './_app.admin.donation-page';
import { client, stmt } from '$lib/server/db/database.testing';

// a db spec because the edit page makes the Donation page on first need. what each card's save
// checks is $lib/server/pages/section-saves.db.spec.ts's; this holds the route's wiring. the chain is mounted,
// for ../route-request.testing.ts's reason: the session gate is a `middleware` on ./_app.tsx.

const EDITOR = '/admin/donation-page';

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(client);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donation-page', module: editor }
	]);
	session = await signIn(db);
});

beforeEach(async () => {
	await client.batch([stmt('delete from page'), stmt('delete from form')]);
});

type Drawn = {
	version: number;
	takingGifts: boolean;
	unreadable: boolean;
	hasEdits: boolean;
	banner: { state: string; preview: string; address: string | null; unpublishable: boolean };
	seeds: {
		general: { boxes: { heading: string } };
		giving: { boxes: Record<string, unknown>; currency: string };
		settings: { boxes: Record<string, unknown>; monthlyOffered: boolean };
	};
};

async function open(): Promise<Drawn> {
	const response = await request(
		new Request(`${ORIGIN}${EDITOR}`, { headers: { cookie: session } }),
		{
			env: bindings
		}
	);
	expect(response.status).toBe(200);
	return response.json();
}

async function donationPage() {
	const [row] = await db.select().from(page).where(eq(page.type, 'donation_page'));
	return row ?? null;
}

/** a deployment whose set-up is finished. */
let bindings: Env;

/** the rails the served config reads, so the editor's page view does not ask Stripe. */
async function rails(methods: readonly string[]) {
	await edgeCache().put(
		new Request(`${ORIGIN}/__offered-rails`),
		new Response(JSON.stringify(methods), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
}

beforeEach(async () => {
	// the webhook secret is what `servedProcessors` requires before a published page is drawn
	// (`settlementReady` in $lib/server/payments/factory.ts). finishedDeployment does not set it.
	bindings = { ...(await finishedDeployment()), STRIPE_WEBHOOK_SECRET: 'whsec_spec' };
	await rails(['card']);
});

/** a press on the edit page, posting `fields` under the form `which`, drawn at `version`. */
async function post(which: string, version: number, fields: Record<string, string> = {}) {
	const body = new FormData();
	body.set(WHICH_FORM, which);
	body.set(RECORD_VERSION, String(version));
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	return request(
		new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
		{ env: bindings }
	);
}

/** the sentence a refused press carries under `box`, `''` for the form's own. */
async function refusedUnder(response: Response, box: string): Promise<unknown> {
	const answer = (await response.json()) as {
		form?: { result?: { error?: Record<string, string[]> } };
	};
	return answer.form?.result?.error?.[box];
}

describe('whether the published Donation page is taking gifts', () => {
	it('is taking gifts while the published page would be drawn', async () => {
		expect(await open()).toMatchObject({ banner: { state: 'public' }, takingGifts: true });
	});

	it('is not taking gifts while the published page would be refused', async () => {
		// an account approved for no rail is the served-config refusal `loadPageView` returns
		// (`renderableConfig` in $lib/server/forms/published-config.ts). the page row is still live.
		await rails([]);

		expect(await open()).toMatchObject({ banner: { state: 'public' }, takingGifts: false });
	});
});

describe('the Donation page edit page', () => {
	it('makes the Donation page on a fresh deployment, public from the start, with no Unpublish', async () => {
		const drawn = await open();

		const made = await donationPage();
		expect(made).not.toBeNull();
		expect(drawn).toMatchObject({
			unreadable: false,
			banner: {
				state: 'public',
				address: '/donate',
				preview: `/preview/${made?.id}`,
				unpublishable: false
			},
			seeds: { general: { boxes: { heading: '' } } }
		});
	});
});

describe('a section’s Save', () => {
	it('writes a title to the draft alone, and the banner says changes are not public yet', async () => {
		const { version } = await open();
		const live = (await donationPage())?.published;

		const saved = await post('donation-page-general', version, { heading: 'Give to Elm Street' });

		expect(saved.status).toBe(200);
		expect(await saved.json()).toEqual({ saved: 'donation-page-general' });
		expect((await donationPage())?.published).toBe(live);
		expect(await open()).toMatchObject({
			banner: { state: 'changed' },
			seeds: { general: { boxes: { heading: 'Give to Elm Street' } } }
		});
	});

	it('writes the donation settings to the draft, the settings row a gift is charged against staying', async () => {
		const { version } = await open();
		const made = await donationPage();
		const [before] = await db
			.select()
			.from(form)
			.where(eq(form.id, made?.formId ?? ''));

		const saved = await post('donation-page-giving', version, {
			program_mode: 'none',
			program_id: '',
			min_minor: '5',
			max_minor: '5,000',
			'suggested_amounts[0]': '1,000'
		});

		expect(saved.status).toBe(200);
		const [after] = await db
			.select()
			.from(form)
			.where(eq(form.id, made?.formId ?? ''));
		expect(after).toEqual(before);
		expect(await open()).toMatchObject({
			seeds: { giving: { boxes: { suggested_amounts: ['1,000'] } } }
		});
	});

	it('ticks and unticks the switches, and sets and clears the share message', async () => {
		let { version } = await open();

		await post('donation-page-settings', version, {
			open_on_monthly: 'on',
			share_message: 'I gave to Elm Street.'
		});
		const ticked = await open();
		expect(ticked.seeds.settings.boxes).toMatchObject({
			open_on_monthly: true,
			dedication_on: false,
			share_message: 'I gave to Elm Street.'
		});

		version = ticked.version;
		await post('donation-page-settings', version, { share_message: '' });
		expect((await open()).seeds.settings.boxes).toMatchObject({
			open_on_monthly: false,
			share_message: ''
		});
	});

	it('refuses a campaign’s card, which the Donation page does not carry, writing nothing', async () => {
		const { version } = await open();
		const before = await donationPage();

		const refused = await post('campaign-goal', version, { goal_mode: 'none' });

		expect(refused.status).toBe(400);
		expect(await donationPage()).toEqual(before);
	});

	it('refuses a save drawn before the page last moved, at 409, writing nothing', async () => {
		const { version } = await open();
		await post('donation-page-general', version, { heading: 'First' });
		const between = await donationPage();

		const refused = await post('donation-page-general', version, { heading: 'Second' });

		expect(refused.status).toBe(409);
		expect(await donationPage()).toEqual(between);
	});
});

describe('Publish changes and Discard changes', () => {
	it('makes saved changes live at Publish changes', async () => {
		await post('donation-page-general', (await open()).version, { heading: 'Give to Elm Street' });

		const published = await post('page-publish', (await open()).version);

		expect(published.status).toBe(200);
		const row = await donationPage();
		expect(row?.published).toBe(row?.draft);
		expect(await open()).toMatchObject({ banner: { state: 'public' } });
	});

	it('discards changes: the draft is the live page again', async () => {
		await post('donation-page-general', (await open()).version, { heading: 'Give to Elm Street' });

		const discarded = await post('page-discard', (await open()).version);

		expect(discarded.status).toBe(200);
		const row = await donationPage();
		expect(row?.draft).toBe(row?.published);
	});

	it('refuses Unpublish, which the Donation page does not have', async () => {
		const refused = await post('page-unpublish', (await open()).version);

		expect(refused.status).toBe(400);
		expect((await donationPage())?.state).toBe('live');
	});
});

describe('a draft the page rule refuses', () => {
	/** the Donation page's `column` with a key the rule no longer knows, as a narrowed rule reads it. */
	async function unreadable(column: 'draft' | 'published') {
		const made = await donationPage();
		if (made === null) throw new Error('the edit page made no Donation page');
		const document = JSON.parse(made[column] ?? '{}');
		await db
			.update(page)
			.set({ [column]: JSON.stringify({ ...document, blocks: [] }) })
			.where(eq(page.id, made.id));
	}

	it('opens the page saying so, offering Discard changes and Reset to default', async () => {
		await open();
		await unreadable('draft');

		expect(await open()).toMatchObject({ unreadable: true, hasEdits: true });
		expect(await refusedUnder(await post('page-discard', (await open()).version), '')).toBe(
			undefined
		);
		expect(await open()).toMatchObject({ unreadable: false });
	});

	it('is repaired by Reset to default where the live page fails the rule too', async () => {
		await open();
		await unreadable('published');
		await unreadable('draft');

		const reset = await post('page-reset', (await open()).version);

		expect(reset.status).toBe(200);
		expect(await open()).toMatchObject({ unreadable: false, hasEdits: false });
	});
});

describe('Reset to default', () => {
	async function press(which: string, version: number) {
		const body = new FormData();
		body.set(WHICH_FORM, which);
		body.set(RECORD_VERSION, String(version));
		return request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env: bindings }
		);
	}

	/** the Donation page's draft given a heading of its own. */
	async function editDraft() {
		const made = await donationPage();
		if (made === null) throw new Error('the editor made no Donation page');
		await db
			.update(page)
			.set({
				draft: JSON.stringify({ ...JSON.parse(made.draft), heading: 'Give to Elm Street' }),
				updatedAt: new Date(made.updatedAt.getTime() + 1_000)
			})
			.where(eq(page.id, made.id));
	}

	const refusal = async (response: Response) =>
		((await response.json()) as { form?: { result?: { error?: Record<string, string[]> } } }).form
			?.result?.error?.[''];

	it('is not offered on a Donation page with no edits, and is offered once it has some', async () => {
		expect(await open()).toMatchObject({ hasEdits: false });

		await editDraft();

		expect(await open()).toMatchObject({ hasEdits: true });
	});

	it('brings the default back after edits and a Publish', async () => {
		await open();
		await editDraft();
		await press('page-publish', (await open()).version);

		const response = await press('page-reset', (await open()).version);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ reset: true });
		expect(await open()).toMatchObject({ banner: { state: 'public' }, hasEdits: false });
	});

	it('is refused on a Donation page with no edits, saying so', async () => {
		const response = await press('page-reset', (await open()).version);

		expect(response.status).toBe(422);
		expect(await refusal(response)).toEqual([
			'Nothing was reset: the Donation page is already the default.'
		]);
	});

	it('answers a press carrying no version 400, naming the box, and nothing changes', async () => {
		await open();
		await editDraft();
		const written = await donationPage();
		const body = new FormData();
		body.set(WHICH_FORM, 'page-reset');

		const response = await request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env: bindings }
		);

		expect(response.status).toBe(400);
		expect(await response.text()).toContain(`\`${RECORD_VERSION}\` carries no version`);
		expect(await donationPage()).toEqual(written);
	});

	it('is refused when pressed on a page drawn before it last moved, and nothing changes', async () => {
		const { version } = await open();
		await editDraft();
		const written = await donationPage();

		const response = await press('page-reset', version);

		expect(response.status).toBe(409);
		expect(await refusal(response)).toEqual([
			'Nothing was changed: this page has been saved since the editor was opened. Reload it, then try again.'
		]);
		expect(await donationPage()).toEqual(written);
	});
});
