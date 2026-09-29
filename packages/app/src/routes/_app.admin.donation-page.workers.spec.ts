import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { plainText, textDocument } from '$lib/rich-text/document';
import { createDb, type Db } from '$lib/server/db/client';
import { form, page } from '$lib/server/db/schema';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { readOrgStory, updateOrgStory } from '$lib/server/org/queries';
import { ORIGIN, signIn } from '../program-routes.testing';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as editor from './_app.admin.donation-page';

// a workers spec because the editor makes the Donation page on first need and the mission ask
// writes the Organisation's story. the chain is mounted, for ../route-request.testing.ts's reason:
// the session gate is a `middleware` on ./_app.tsx.

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
		env.DB.prepare('delete from form'),
		env.DB.prepare('delete from org_presentation')
	]);
});

type Drawn = {
	state: string;
	preview: string;
	chat: string;
	version: number;
	askMission: boolean;
	storyVersion: string;
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
			env
		}
	);
	expect(response.status).toBe(200);
	return response.json();
}

async function donationPage() {
	const [row] = await db.select().from(page).where(eq(page.type, 'donation_page'));
	return row ?? null;
}

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
			{ env }
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
			{ env }
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

describe('the mission ask', () => {
	async function press(form: string, fields: Record<string, string>, version?: string) {
		const body = new FormData();
		body.set(WHICH_FORM, form);
		if (version !== undefined) body.set(RECORD_VERSION, version);
		for (const [name, value] of Object.entries(fields)) body.set(name, value);
		return request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env }
		);
	}

	it('is asked on the first visit while the Organisation’s mission is empty', async () => {
		expect((await open()).askMission).toBe(true);
	});

	it('saves an answer verbatim to the Organisation’s story, and is not asked again', async () => {
		const typed = 'We keep Riverbank families warm.\n\nFed, and in school.';
		const { storyVersion } = await open();

		const response = await press('mission-save', { mission: typed }, storyVersion);

		expect(response.status).toBe(200);
		const { story } = await readOrgStory(db);
		expect(story.mission === null ? null : plainText(story.mission)).toBe(typed);
		expect((await open()).askMission).toBe(false);
	});

	it('is not asked again once skipped, and the story is left as it was', async () => {
		await open();

		const response = await press('mission-skip', {});

		expect(response.status).toBe(200);
		expect((await readOrgStory(db)).story.mission).toBeNull();
		expect((await open()).askMission).toBe(false);
	});

	it('is not asked while the Organisation already has a mission', async () => {
		const { storyVersion } = await open();
		await updateOrgStory(db, storyVersion, {
			mission: textDocument('We keep Riverbank families warm.'),
			vision: null
		});

		expect((await open()).askMission).toBe(false);
	});

	it('refuses a save drawn before the story last moved, keeping what was typed, and asks again', async () => {
		const { storyVersion } = await open();
		await updateOrgStory(db, storyVersion, { mission: null, vision: textDocument('A warm town.') });

		const response = await press('mission-save', { mission: 'Fed, and in school.' }, storyVersion);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			form: { id: 'mission-save', result: { initialValue: { mission: 'Fed, and in school.' } } }
		});
		expect((await readOrgStory(db)).story.mission).toBeNull();
		expect((await open()).askMission).toBe(true);
	});
});

describe('Publish, Undo and Discard changes', () => {
	async function press(which: string, version: number) {
		const body = new FormData();
		body.set(WHICH_FORM, which);
		body.set(RECORD_VERSION, String(version));
		return request(
			new Request(`${ORIGIN}${EDITOR}`, { method: 'POST', headers: { cookie: session }, body }),
			{ env }
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
			{ env }
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
			{ env }
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
			{ env }
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
			{ env }
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
			{ env }
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
