import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { createDb, type Db } from '$lib/server/db/client';
import { form, page } from '$lib/server/db/schema';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { readOrgProfile } from '$lib/server/org/queries';
import { ORIGIN, signIn } from '../program-routes.testing';
import { finishedDeployment } from '../page-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as editor from './_app.admin.donation-page';
import { client, stmt } from '$lib/server/db/database.testing';

// a db spec because the editor makes the Donation page on first need. the chain is mounted,
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
	state: string;
	preview: string;
	version: number;
	takingGifts: boolean;
	blocks: Record<string, unknown>[];
	settings: {
		summary: string;
		boxes: Record<string, unknown>;
		switches: Record<string, boolean>;
		monthlyOffered: boolean;
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

describe('whether the published Donation page is taking gifts', () => {
	it('is taking gifts while the published page would be drawn', async () => {
		expect(await open()).toMatchObject({ state: 'live', takingGifts: true });
	});

	it('is not taking gifts while the published page would be refused', async () => {
		// an account approved for no rail is the served-config refusal `loadPageView` returns
		// (`renderableConfig` in $lib/server/forms/published-config.ts). the page row is still live.
		await rails([]);

		expect(await open()).toMatchObject({ state: 'live', takingGifts: false });
	});
});

describe('the Donation page editor', () => {
	it('makes the Donation page on a fresh deployment and frames it, live from the start', async () => {
		const drawn = await open();

		const made = await donationPage();
		expect(made).not.toBeNull();
		expect(drawn).toMatchObject({ state: 'live', preview: `/preview/${made?.id}` });
	});

	it('sends the page as it is, with no chat and no marks on its blocks', async () => {
		const drawn = await open();

		expect(drawn).not.toHaveProperty('chat');
		expect(drawn).not.toHaveProperty('drafted');
		expect(drawn.blocks.length).toBeGreaterThan(0);
		for (const block of drawn.blocks) expect(block).not.toHaveProperty('illustration');
	});
});

describe('the donation settings', () => {
	async function save(fields: Record<string, string>, version: number) {
		const body = new FormData();
		body.set(WHICH_FORM, 'page-settings');
		body.set(RECORD_VERSION, String(version));
		body.set('program_mode', 'none');
		body.set('program_id', '');
		for (const [name, value] of Object.entries(fields)) body.set(name, value);
		return request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env: bindings }
		);
	}

	async function owned(formId: string) {
		const [row] = await db.select().from(form).where(eq(form.id, formId));
		return row;
	}

	it('draws the live row’s settings while the draft holds none of its own', async () => {
		const drawn = await open();

		const made = await donationPage();
		const row = await owned(made?.formId ?? '');
		expect(drawn.settings.boxes).toMatchObject({
			program_mode: row?.programMode,
			suggested_amounts: expect.any(Array)
		});
		expect(drawn.settings.summary).toMatch(/^No program, \$/);
	});

	it('writes the draft only: the live page and the settings row a gift is charged against stay', async () => {
		const drawn = await open();
		const made = await donationPage();
		if (made === null) throw new Error('the editor made no Donation page');
		const row = await owned(made.formId);

		const response = await save(
			{
				min_minor: '10',
				max_minor: '500',
				'suggested_amounts[0]': '20',
				'suggested_amounts[1]': '40'
			},
			drawn.version
		);

		expect(response.status).toBe(200);
		const after = await donationPage();
		expect(JSON.parse(after?.draft ?? '{}').settings).toEqual({
			revenueAccountId: row?.revenueAccountId,
			currency: row?.currency,
			allowedOrigins: [],
			programMode: 'none',
			programId: null,
			minMinor: 1000,
			maxMinor: 50_000,
			suggestedAmounts: [2000, 4000]
		});
		expect(after?.published).toBe(made.published);
		expect(await owned(made.formId)).toEqual(row);

		const redrawn = await open();
		expect(redrawn.version).not.toBe(drawn.version);
		expect(redrawn).toMatchObject({
			state: 'changed',
			settings: { summary: 'No program, $20, $40' }
		});
	});

	it('seeds each amount box grouped, as the box draws it', async () => {
		// the sheet's Done is armed by a box differing from its seed, and the box draws `20,000`.
		const drawn = await open();
		const amounts = {
			min_minor: '25',
			max_minor: '20000',
			'suggested_amounts[0]': '1000',
			'suggested_amounts[1]': '12345.50'
		};
		expect((await save(amounts, drawn.version)).status).toBe(200);

		expect((await open()).settings.boxes).toMatchObject({
			min_minor: '25',
			max_minor: '20,000',
			suggested_amounts: ['1,000', '12,345.50']
		});
	});
});

describe('the two switches in the donation settings', () => {
	/** the cadences the deployment's processor offers, kept where the served config reads them. */
	async function offering(cadences: string[]) {
		await edgeCache().put(
			new Request(`${ORIGIN}/__recurring-cadences`),
			new Response(JSON.stringify(cadences), {
				headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
			})
		);
	}

	async function done(ticked: Record<string, string>, version: number) {
		const body = new FormData();
		body.set(WHICH_FORM, 'page-settings');
		body.set(RECORD_VERSION, String(version));
		body.set('program_mode', 'none');
		body.set('program_id', '');
		body.set('min_minor', '5');
		body.set('max_minor', '500');
		for (const [name, value] of Object.entries(ticked)) body.set(name, value);
		return request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env: bindings }
		);
	}

	it('seeds both unticked on a fresh page, and each as the draft holds it after a Done', async () => {
		const drawn = await open();
		expect(drawn.settings.switches).toEqual({ open_on_monthly: false, dedication_on: false });

		expect((await done({ dedication_on: 'on' }, drawn.version)).status).toBe(200);

		expect((await open()).settings.switches).toEqual({
			open_on_monthly: false,
			dedication_on: true
		});
	});

	it('unticks a switch a Done no longer carries', async () => {
		const drawn = await open();
		await done({ open_on_monthly: 'on', dedication_on: 'on' }, drawn.version);

		await done({ dedication_on: 'on' }, (await open()).version);

		expect((await open()).settings.switches).toEqual({
			open_on_monthly: false,
			dedication_on: true
		});
	});

	it('names each switch that is on in the Settings row’s line, by its own name', async () => {
		const drawn = await open();
		await done({ 'suggested_amounts[0]': '20', open_on_monthly: 'on' }, drawn.version);
		expect((await open()).settings.summary).toBe('No program, $20, Open on monthly');

		await done(
			{ 'suggested_amounts[0]': '20', open_on_monthly: 'on', dedication_on: 'on' },
			(await open()).version
		);
		expect((await open()).settings.summary).toBe(
			'No program, $20, Open on monthly, Dedication on by default'
		);
	});

	it('says whether this deployment offers monthly, which Open on monthly waits on', async () => {
		await offering(['one_time', 'yearly']);
		expect((await open()).settings.monthlyOffered).toBe(false);

		await offering(['one_time', 'monthly', 'yearly']);
		expect((await open()).settings.monthlyOffered).toBe(true);
	});
});

describe('the mission', () => {
	it.each([['mission-save'], ['mission-skip']])(
		'is no form on this screen: %s is refused unknown, and nothing is written',
		async (which) => {
			await open();
			const body = new FormData();
			body.set(WHICH_FORM, which);
			body.set('mission', 'We keep Riverbank families warm.');

			const response = await request(
				new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
				{ env: bindings }
			);

			expect(response.status).toBe(400);
			expect(await response.text()).toContain('names no form on this screen');
			expect((await readOrgProfile(db))?.mission).toBeNull();
		}
	);
});

describe('Publish, Undo and Discard changes', () => {
	async function press(which: string, version: number) {
		const body = new FormData();
		body.set(WHICH_FORM, which);
		body.set(RECORD_VERSION, String(version));
		return request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env: bindings }
		);
	}

	/** the Donation page's draft with a share message of its own, as a write leaves it. */
	async function changeDraft(message: string) {
		const made = await donationPage();
		if (made === null) throw new Error('the editor made no Donation page');
		await db
			.update(page)
			.set({
				draft: JSON.stringify({ ...JSON.parse(made.draft), shareMessage: message }),
				updatedAt: new Date(made.updatedAt.getTime() + 1_000)
			})
			.where(eq(page.id, made.id));
	}

	/** the message a refused press is answered with. */
	async function refusal(response: Response): Promise<unknown> {
		const answer = (await response.json()) as {
			form?: { result?: { error?: Record<string, string[]> } };
		};
		return answer.form?.result?.error?.[''];
	}

	it('publishes with no confirm, as a republish Undo can take back', async () => {
		await open();
		await changeDraft('Keep Elm Street warm.');

		const response = await press('page-publish', (await open()).version);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ published: true, undoable: true });
		expect((await open()).state).toBe('live');
	});

	it('undoes the republish, leaving the draft as it was published', async () => {
		await open();
		await changeDraft('Keep Elm Street warm.');
		await press('page-publish', (await open()).version);

		const response = await press('page-undo', (await open()).version);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ undone: true });
		expect((await open()).state).toBe('changed');
	});

	it('refuses Undo where no Publish has replaced anything, saying so', async () => {
		const response = await press('page-undo', (await open()).version);

		expect(response.status).toBe(409);
		expect(await refusal(response)).toEqual([
			'Nothing was undone: no earlier version of this page was published.'
		]);
	});

	it('refuses a Publish of a draft the page rule refuses, naming why', async () => {
		await open();
		const made = await donationPage();
		if (made === null) throw new Error('the editor made no Donation page');
		const draft = JSON.parse(made.draft) as { blocks: { type: string }[] };
		await db
			.update(page)
			.set({
				draft: JSON.stringify({
					...draft,
					blocks: draft.blocks.filter((block) => block.type !== 'donation-box')
				})
			})
			.where(eq(page.id, made.id));
		const written = await donationPage();

		const response = await press('page-publish', written?.updatedAt.getTime() ?? 0);

		expect(response.status).toBe(422);
		expect(await refusal(response)).toEqual([
			'Nothing was published: a page holds exactly one donation box, and this one holds none.'
		]);
		expect((await donationPage())?.published).toBe(made.published);
	});

	it('takes no “Gifts go to”, which is a campaign’s first Publish alone', async () => {
		const body = new FormData();
		body.set(WHICH_FORM, 'page-first-publish');
		body.set(RECORD_VERSION, String((await open()).version));
		body.set('gifts_go_to', 'none');

		const response = await request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env: bindings }
		);

		expect(response.status).toBe(400);
		expect(await response.text()).toContain('names no form on this screen');
	});

	it('discards changes: the draft is the live page again', async () => {
		await open();
		await changeDraft('Keep Elm Street warm.');

		const response = await press('page-discard', (await open()).version);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ discarded: true });
		expect((await open()).state).toBe('live');
	});

	it('refuses a press drawn before the page last moved, and nothing changes', async () => {
		const { version } = await open();
		await changeDraft('Keep Elm Street warm.');

		const response = await press('page-publish', version);

		expect(response.status).toBe(409);
		expect(await refusal(response)).toEqual([
			'Nothing was changed: this page has been saved since the editor was opened. Reload it, then try again.'
		]);
		expect((await open()).state).toBe('changed');
	});
});

describe('a draft the page rule refuses', () => {
	/** the Donation page's `column` with its donation box taken out, as a narrowed rule reads it. */
	async function unreadable(column: 'draft' | 'published') {
		const made = await donationPage();
		if (made === null) throw new Error('the editor made no Donation page');
		const document = JSON.parse(made[column] ?? '{}');
		const blocks = document.blocks.filter(
			(block: { type: string }) => block.type !== 'donation-box'
		);
		await db
			.update(page)
			.set({ [column]: JSON.stringify({ ...document, blocks }) })
			.where(eq(page.id, made.id));
	}

	async function press(which: string, version: number) {
		const body = new FormData();
		body.set(WHICH_FORM, which);
		body.set(RECORD_VERSION, String(version));
		return request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env: bindings }
		);
	}

	it('opens the editor saying so, offering Discard changes and Reset to default', async () => {
		await open();
		await unreadable('draft');

		expect(await open()).toMatchObject({
			unreadable: true,
			discardable: true,
			hasEdits: true,
			state: 'changed'
		});
	});

	it('is repaired by Reset to default where the live page fails the rule too', async () => {
		await open();
		await unreadable('published');
		await unreadable('draft');
		const drawn = await open();
		expect(drawn).toMatchObject({ unreadable: true, discardable: false });

		const response = await press('page-reset', drawn.version);

		expect(response.status).toBe(200);
		expect(await open()).toMatchObject({ unreadable: false, state: 'live', hasEdits: false });
	});
});

describe('a block’s sheet', () => {
	it('writes a variant picked to the draft, drawn on the next load, and the live page stays', async () => {
		const { version } = await open();
		const before = await donationPage();

		const body = new FormData();
		body.set(WHICH_FORM, 'block-variant');
		body.set(RECORD_VERSION, String(version));
		body.set('block_id', 'about');
		body.set('variant', 'statement');
		const response = await request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env: bindings }
		);

		expect(response.status).toBe(200);
		const redrawn = (await open()) as Drawn & { blocks: { id: string; variant: string }[] };
		expect(redrawn.blocks.find(({ id }) => id === 'about')?.variant).toBe('statement');
		expect((await donationPage())?.published).toBe(before?.published);
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

	/** the Donation page's draft laid out and palette'd its own way. */
	async function editDraft() {
		const made = await donationPage();
		if (made === null) throw new Error('the editor made no Donation page');
		await db
			.update(page)
			.set({
				draft: JSON.stringify({ ...JSON.parse(made.draft), palette: 'bold', layout: 'banner' }),
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

	it('brings the default back after edits and a Publish, with nothing left to undo', async () => {
		await open();
		await editDraft();
		await press('page-publish', (await open()).version);

		const response = await press('page-reset', (await open()).version);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ reset: true });
		expect(await open()).toMatchObject({ state: 'live', hasEdits: false });
		const undo = await press('page-undo', (await open()).version);
		expect(undo.status).toBe(409);
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

describe('the look and the sharing', () => {
	/** a press on the editor, drawn at `version`; a field named twice is posted twice. */
	async function press(which: string, fields: [string, string][], version: number) {
		const body = new FormData();
		body.set(WHICH_FORM, which);
		body.set(RECORD_VERSION, String(version));
		for (const [name, value] of fields) body.append(name, value);
		return request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env: bindings }
		);
	}

	/** the Donation page saved since the editor was drawn, as another tab's save leaves it. */
	async function moved() {
		const made = await donationPage();
		if (made === null) throw new Error('the editor made no Donation page');
		await db
			.update(page)
			.set({ updatedAt: new Date(made.updatedAt.getTime() + 1_000) })
			.where(eq(page.id, made.id));
		return made;
	}

	type Looked = Drawn & {
		look: { shade: string; corners: string; palette: string };
		share: { message: string; channels: string[] };
	};

	it('writes a shade picked to the draft alone, drawn on the next load', async () => {
		const { version } = await open();
		const before = await donationPage();

		const response = await press('page-shade', [['shade', 'warm']], version);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ saved: 'page-shade' });
		expect(((await open()) as Looked).look).toEqual({
			shade: 'warm',
			corners: 'soft',
			palette: 'tint'
		});
		expect((await donationPage())?.published).toBe(before?.published);
	});

	it('writes corners and a palette picked, each keeping what the other pictures set', async () => {
		const { version } = await open();
		expect((await press('page-shade', [['shade', 'cool']], version)).status).toBe(200);

		const cornered = await press('page-corners', [['corners', 'round']], (await open()).version);
		expect(await cornered.json()).toEqual({ saved: 'page-corners' });
		const painted = await press('page-palette', [['palette', 'bold']], (await open()).version);
		expect(await painted.json()).toEqual({ saved: 'page-palette' });

		expect(((await open()) as Looked).look).toEqual({
			shade: 'cool',
			corners: 'round',
			palette: 'bold'
		});
	});

	it.each([
		['page-shade', 'shade', 'dusk', 'light, warm or cool'],
		['page-corners', 'corners', 'bevelled', 'square, soft or round'],
		['page-palette', 'palette', 'neon', 'plain, tint, duo, bright or bold']
	])(
		'refuses a %s off the list under its box, naming the list',
		async (which, box, value, list) => {
			const { version } = await open();

			const response = await press(which, [[box, value]], version);

			expect(response.status).toBe(400);
			const error = (
				(await response.json()) as { form: { result: { error: Record<string, string[]> } } }
			).form.result.error[box];
			expect(error).toEqual([expect.stringContaining(`"${value}"`)]);
			expect(error?.[0]).toContain(list);
			expect(((await open()) as Looked).look).toEqual({
				shade: 'light',
				corners: 'soft',
				palette: 'tint'
			});
		}
	);

	it.each([
		['page-shade', [['shade', 'warm']]],
		['page-corners', [['corners', 'round']]],
		['page-palette', [['palette', 'bold']]]
	] as [string, [string, string][]][])(
		'refuses %s drawn before the page last moved at 409, writing nothing',
		async (which, fields) => {
			const { version } = await open();
			const before = await moved();

			const response = await press(which, fields, version);

			expect(response.status).toBe(409);
			expect((await donationPage())?.draft).toBe(before?.draft);
		}
	);

	/** the stored draft, as the page rule's own keys hold it. */
	async function storedDraft(): Promise<Record<string, unknown>> {
		return JSON.parse((await donationPage())?.draft ?? '{}');
	}

	function errorUnder(answer: unknown, box: string): string[] | undefined {
		return (answer as { form: { result: { error: Record<string, string[]> } } }).form.result.error[
			box
		];
	}

	it('sets a share message, changes it, and an emptied box removes it', async () => {
		expect(((await open()) as Looked).share.message).toBe('');

		const set = await press(
			'page-share-message',
			[['share_message', ' Keep Elm Street warm. ']],
			(await open()).version
		);
		expect(await set.json()).toEqual({ saved: 'page-share-message' });
		expect(((await open()) as Looked).share.message).toBe('Keep Elm Street warm.');

		await press(
			'page-share-message',
			[['share_message', 'Coats for all.']],
			(await open()).version
		);
		expect(((await open()) as Looked).share.message).toBe('Coats for all.');

		const cleared = await press(
			'page-share-message',
			[['share_message', '']],
			(await open()).version
		);
		expect(cleared.status).toBe(200);
		expect(((await open()) as Looked).share.message).toBe('');
		expect(await storedDraft()).not.toHaveProperty('shareMessage');
	});

	it('refuses a share message past its limit under its box, writing nothing', async () => {
		const { version } = await open();
		const before = await donationPage();

		const response = await press(
			'page-share-message',
			[['share_message', 'x'.repeat(281)]],
			version
		);

		expect(response.status).toBe(400);
		expect(errorUnder(await response.json(), 'share_message')).toEqual([
			'a share message holds at most 280 characters'
		]);
		expect((await donationPage())?.draft).toBe(before?.draft);
	});

	it('offers the default share buttons until some are chosen, then those, in the order sent', async () => {
		expect(((await open()) as Looked).share.channels).toEqual(['facebook', 'email', 'copy-link']);

		const response = await press(
			'page-share-channels',
			[
				['share_channels', 'whatsapp'],
				['share_channels', 'x']
			],
			(await open()).version
		);

		expect(await response.json()).toEqual({ saved: 'page-share-channels' });
		expect(((await open()) as Looked).share.channels).toEqual(['whatsapp', 'x']);
	});

	it('refuses an empty set of share buttons, naming the list to choose from', async () => {
		const { version } = await open();

		const response = await press('page-share-channels', [], version);

		expect(response.status).toBe(400);
		expect(errorUnder(await response.json(), 'share_channels')).toEqual([
			'choose at least one share button: facebook, whatsapp, email, copy-link, linkedin or x'
		]);
	});

	it('refuses a share button off the list under its box, naming the list', async () => {
		const { version } = await open();

		const response = await press(
			'page-share-channels',
			[
				['share_channels', 'email'],
				['share_channels', 'myspace']
			],
			version
		);

		expect(response.status).toBe(400);
		const [said] = errorUnder(await response.json(), 'share_channels') ?? [];
		expect(said).toContain('"myspace"');
		expect(said).toContain('facebook, whatsapp, email, copy-link, linkedin or x');
		expect(((await open()) as Looked).share.channels).toEqual(['facebook', 'email', 'copy-link']);
	});

	it.each([
		['page-share-message', [['share_message', 'Coats for all.']]],
		['page-share-channels', [['share_channels', 'x']]]
	] as [string, [string, string][]][])(
		'refuses %s drawn before the page last moved at 409, writing nothing',
		async (which, fields) => {
			const { version } = await open();
			const before = await moved();

			const response = await press(which, fields, version);

			expect(response.status).toBe(409);
			expect((await donationPage())?.draft).toBe(before.draft);
		}
	);
});

describe('the blocks', () => {
	async function press(which: string, fields: [string, string][], version: number) {
		const body = new FormData();
		body.set(WHICH_FORM, which);
		body.set(RECORD_VERSION, String(version));
		for (const [name, value] of fields) body.append(name, value);
		return request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env: bindings }
		);
	}

	type Listed = Drawn & {
		blocks: {
			id: string;
			type: string;
			variant: string | null;
			background: string;
			removable: boolean;
			movesUp: boolean;
			movesDown: boolean;
		}[];
		addable: { value: string; label: string }[];
	};

	const listed = async () => (await open()) as Listed;

	it.each([
		['title', 'left'],
		['story', 'plain'],
		['impact-tiers', 'cards'],
		['faq', 'accordion'],
		['about-us', 'stacked'],
		['org-info', 'footer'],
		['share', 'buttons'],
		['hero', 'wide'],
		['image', 'column'],
		['program-chooser', 'cards']
	])(
		'adds %s above the organisation details closing the page, in its first variant',
		async (type, variant) => {
			const { version } = await open();

			const response = await press('block-add', [['block_type', type]], version);

			expect(response.status).toBe(200);
			const answer = (await response.json()) as { saved: string; blockId: string };
			expect(answer.saved).toBe('block-add');
			const { blocks } = await listed();
			expect(blocks.map(({ id }) => id).slice(-2)).toEqual([answer.blockId, 'footer']);
			expect(blocks.at(-2)).toMatchObject({ type, variant, background: 'none' });
		}
	);

	it('gives a second block of a type an id of its own', async () => {
		await press('block-add', [['block_type', 'story']], (await open()).version);
		const second = await press('block-add', [['block_type', 'story']], (await open()).version);

		expect(await second.json()).toEqual({ saved: 'block-add', blockId: 'story-2' });
		expect((await listed()).blocks.filter(({ type }) => type === 'story')).toHaveLength(2);
	});

	it('offers every block the Donation page takes but the donation box, each named', async () => {
		expect((await listed()).addable).toEqual([
			{ value: 'title', label: 'Title' },
			{ value: 'story', label: 'Story' },
			{ value: 'impact-tiers', label: 'Impact tiers' },
			{ value: 'faq', label: 'Questions' },
			{ value: 'about-us', label: 'About us' },
			{ value: 'org-info', label: 'Organisation details' },
			{ value: 'share', label: 'Share buttons' },
			{ value: 'hero', label: 'Cover photo' },
			{ value: 'image', label: 'Photo' },
			{ value: 'program-chooser', label: 'Program choice' }
		]);
	});

	it.each([['goal-bar'], ['donation-box'], ['carousel']])(
		'refuses adding a %s, naming the blocks it can add, and writes nothing',
		async (type) => {
			const { version } = await open();
			const before = await donationPage();

			const response = await press('block-add', [['block_type', type]], version);

			expect(response.status).toBe(400);
			const answer = (await response.json()) as {
				form: { result: { error: Record<string, string[]> } };
			};
			expect(answer.form.result.error.block_type).toEqual([
				`"${type}" is no block the Donation page can add; it adds title, story, impact-tiers, faq, about-us, org-info, share, hero, image or program-chooser`
			]);
			expect((await donationPage())?.draft).toBe(before?.draft);
		}
	);

	const order = async () => (await listed()).blocks.map(({ id }) => id);

	function refused(answer: unknown, box = ''): string[] | undefined {
		return (answer as { form: { result: { error: Record<string, string[]> } } }).form.result.error[
			box
		];
	}

	it('sets a block’s background, and refuses one the block does not take, naming those it does', async () => {
		const set = await press(
			'block-background',
			[
				['block_id', 'about'],
				['background', 'strong']
			],
			(await open()).version
		);
		expect(await set.json()).toEqual({ saved: 'block-background' });
		expect((await listed()).blocks.find(({ id }) => id === 'about')?.background).toBe('strong');

		const off = await press(
			'block-background',
			[
				['block_id', 'share'],
				['background', 'strong']
			],
			(await open()).version
		);
		expect(off.status).toBe(400);
		expect(refused(await off.json(), 'background')).toEqual([
			'"strong" is not a background share takes; it takes none, soft or tint'
		]);
	});

	it('removes a block, and draws the page without it', async () => {
		const response = await press('block-remove', [['block_id', 'about']], (await open()).version);

		expect(await response.json()).toEqual({ saved: 'block-remove' });
		expect(await order()).toEqual(['title', 'programs', 'donate', 'share', 'footer']);
	});

	it('refuses removing the donation box, which every page holds once, and writes nothing', async () => {
		const { version } = await open();
		const before = await donationPage();

		const response = await press('block-remove', [['block_id', 'donate']], version);

		expect(response.status).toBe(400);
		expect(refused(await response.json())).toEqual([
			'the donation box is on every page exactly once and cannot be removed'
		]);
		expect((await donationPage())?.draft).toBe(before?.draft);
	});

	it('refuses removing a block the page does not hold, naming those it does', async () => {
		const response = await press('block-remove', [['block_id', 'gallery']], (await open()).version);

		expect(response.status).toBe(400);
		expect(refused(await response.json())).toEqual([
			'`block_id` names no block on this page: "gallery"; its blocks are "title", "programs", "donate", "about", "share", "footer"'
		]);
	});

	it('moves a block one step up and one step down', async () => {
		const up = await press(
			'block-move',
			[
				['block_id', 'about'],
				['direction', 'up']
			],
			(await open()).version
		);
		expect(await up.json()).toEqual({ saved: 'block-move' });
		expect(await order()).toEqual(['title', 'programs', 'about', 'donate', 'share', 'footer']);

		await press(
			'block-move',
			[
				['block_id', 'title'],
				['direction', 'down']
			],
			(await open()).version
		);
		expect(await order()).toEqual(['programs', 'title', 'about', 'donate', 'share', 'footer']);
	});

	it.each([
		['title', 'up', 'block "title" is first and moves no further up'],
		['footer', 'down', 'block "footer" is last and moves no further down']
	])('refuses moving %s %s off the end of the page', async (id, direction, sentence) => {
		const { version } = await open();
		const before = await donationPage();

		const response = await press(
			'block-move',
			[
				['block_id', id],
				['direction', direction]
			],
			version
		);

		expect(response.status).toBe(400);
		expect(refused(await response.json())).toEqual([sentence]);
		expect((await donationPage())?.draft).toBe(before?.draft);
	});

	it('refuses a move that is neither up nor down, naming both', async () => {
		const response = await press(
			'block-move',
			[
				['block_id', 'about'],
				['direction', 'left']
			],
			(await open()).version
		);

		expect(response.status).toBe(400);
		expect(refused(await response.json(), 'direction')).toEqual([
			'"left" is not a direction; a block moves up or down'
		]);
	});

	it('says which blocks can be removed and which way each can move', async () => {
		const { blocks } = await listed();

		expect(
			blocks.map(({ id, removable, movesUp, movesDown }) => [id, removable, movesUp, movesDown])
		).toEqual([
			['title', true, false, true],
			['programs', true, true, true],
			['donate', false, true, true],
			['about', true, true, true],
			['share', true, true, true],
			['footer', true, true, false]
		]);
	});

	it.each([
		['block-add', [['block_type', 'story']]],
		['block-remove', [['block_id', 'about']]],
		[
			'block-move',
			[
				['block_id', 'about'],
				['direction', 'up']
			]
		],
		[
			'block-background',
			[
				['block_id', 'about'],
				['background', 'none']
			]
		]
	] as [string, [string, string][]][])(
		'refuses %s drawn before the page last moved at 409, writing nothing',
		async (which, fields) => {
			const { version } = await open();
			const made = await donationPage();
			if (made === null) throw new Error('the editor made no Donation page');
			await db
				.update(page)
				.set({ updatedAt: new Date(made.updatedAt.getTime() + 1_000) })
				.where(eq(page.id, made.id));

			const response = await press(which, fields, version);

			expect(response.status).toBe(409);
			expect((await donationPage())?.draft).toBe(made.draft);
		}
	);
});
