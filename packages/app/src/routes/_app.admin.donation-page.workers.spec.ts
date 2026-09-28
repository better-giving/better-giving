import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { plainText, textDocument } from '$lib/rich-text/document';
import { createDb, type Db } from '$lib/server/db/client';
import { form, page } from '$lib/server/db/schema';
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
	version: number;
	askMission: boolean;
	storyVersion: string;
	settings: { summary: string; boxes: Record<string, unknown> };
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
		expect(drawn).toMatchObject({ state: 'live', preview: `/preview/${made?.id}` });
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
