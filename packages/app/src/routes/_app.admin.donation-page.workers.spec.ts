import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { createDb, type Db } from '$lib/server/db/client';
import { chatTurn, form, page } from '$lib/server/db/schema';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { readOrgProfile } from '$lib/server/org/queries';
import { draftTurn, openTurn } from '$lib/server/pages/draft';
import { answering } from '$lib/server/pages/page-row.testing';
import { ORIGIN, signIn } from '../program-routes.testing';
import { finishedDeployment } from '../page-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as editor from './_app.admin.donation-page';

// a workers spec because the editor makes the Donation page on first need. the chain is mounted,
// for ../route-request.testing.ts's reason: the session gate is a `middleware` on ./_app.tsx.
//
// the set-up this screen is served on stores an EIN, which a chat's opening looks up: the lookup
// finds nothing here, so no case reaches the live nonprofit API.

vi.mock(import('$lib/server/nonprofits/filing'), async (importOriginal) => ({
	...(await importOriginal()),
	lookUpFiling: async () => null
}));

const EDITOR = '/admin/donation-page';

let db: Db;
let request: RouteRequester;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donation-page', module: editor }
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

type Drawn = {
	state: string;
	preview: string;
	chat: string;
	version: number;
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

/** a deployment whose set-up is finished, which the layout's set-up gate serves this screen on. */
let bindings: Env;

beforeEach(async () => {
	bindings = await finishedDeployment();
});

describe('the Donation page editor', () => {
	it('makes the Donation page on a fresh deployment and frames it, live from the start', async () => {
		const drawn = await open();

		const made = await donationPage();
		expect(made).not.toBeNull();
		expect(drawn).toMatchObject({
			state: 'live',
			preview: `/preview/${made?.id}`,
			chat: `/admin/pages/${made?.id}/chat`
		});
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
		expect(drawn.settings.summary).toMatch(/^No program · \$/);
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
			settings: { summary: 'No program · $20, $40' }
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
		expect((await open()).settings.summary).toBe('No program · $20 · Open on monthly');

		await done(
			{ 'suggested_amounts[0]': '20', open_on_monthly: 'on', dedication_on: 'on' },
			(await open()).version
		);
		expect((await open()).settings.summary).toBe(
			'No program · $20 · Open on monthly · Dedication on by default'
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

	/** the Donation page's draft laid out and palette'd its own way, as the chat leaves it. */
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
			'Nothing was reset: the Donation page is already the default, with no chat.'
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

describe('whether the page has been drafted', () => {
	const QUESTION = { id: 'who', kind: 'text', prompt: 'Who do you help?' };

	it('reads not drafted on the Donation page made on first need', async () => {
		expect(await open()).toMatchObject({ drafted: false });
	});

	it('reads not drafted after the chat has asked its opening questions alone', async () => {
		await open();
		const made = await donationPage();
		const asked = await openTurn(
			db,
			{ ...env, AI: answering({ say: 'First, a question.', ask: [QUESTION] }) },
			{ pageId: made?.id ?? '', timeZone: 'UTC', now: Date.now(), origin: ORIGIN }
		);
		expect(asked).toMatchObject({ ok: true, outcome: 'asked' });

		expect(await open()).toMatchObject({ drafted: false });
	});

	it('reads drafted once a chat turn has changed the page', async () => {
		await open();
		const made = await donationPage();
		const turned = await draftTurn(
			db,
			{
				...env,
				AI: answering({ say: 'Two-tone now.', page: { kind: 'merge', doc: { palette: 'duo' } } })
			},
			{
				pageId: made?.id ?? '',
				message: 'make it two-tone',
				imageIds: [],
				timeZone: 'UTC',
				now: Date.now()
			}
		);
		expect(turned).toMatchObject({ ok: true, outcome: 'accepted' });

		expect(await open()).toMatchObject({ drafted: true });
	});

	it.each([
		['fell-back', true],
		['refused', false],
		['unanswered', false]
	] as const)('counts a reply noted %s as drafting the page: %s', async (note, changed) => {
		await open();
		const made = await donationPage();
		await db.insert(chatTurn).values({
			pageId: made?.id ?? '',
			seq: 1,
			author: 'assistant',
			text: 'A reply.',
			model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
			note
		});

		expect(await open()).toMatchObject({ drafted: changed });
	});

	it('reads drafted once a block is edited by hand', async () => {
		const { version } = await open();
		const body = new FormData();
		body.set(WHICH_FORM, 'block-variant');
		body.set(RECORD_VERSION, String(version));
		body.set('block_id', 'about');
		body.set('variant', 'statement');
		const saved = await request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env: bindings }
		);
		expect(saved.status).toBe(200);

		expect(await open()).toMatchObject({ drafted: true });
	});
});
