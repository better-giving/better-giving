import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCampaign } from '../../page/defaults';
import { SLUG_MAX_LENGTH } from '../../page/slug';
import { createDb, type Db } from '../db/client';
import { form, page, program } from '../db/schema';
import { readForms } from '../forms/queries';
import { createCampaign } from './campaign';
import { ensureDonationPage } from './donation-page';
import { readChat } from './draft';
import { answering, insertPage, SETTINGS } from './page-row.testing';

// a new campaign against the real D1: the Donation page it copies from, the owned settings row, the
// page row and its address. the model is the one stand-in, answering as ./page-row.testing.ts's
// `answering` stubs it.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.batch([
		env.DB.prepare('delete from chat_turn'),
		env.DB.prepare('delete from page'),
		env.DB.prepare('delete from form'),
		env.DB.prepare('delete from program')
	]);
});

const NOW = Date.parse('2026-09-28T16:00:00Z');
const ZONE = 'America/New_York';

function create(title: string, line = '', AI: { run: unknown } = { run: () => undefined }) {
	return createCampaign(db, { ...env, AI }, { title, line, timeZone: ZONE, now: NOW });
}

async function stored(pageId: string) {
	const [row] = await db.select().from(page).where(eq(page.id, pageId));
	if (!row) throw new Error(`no page ${pageId}`);
	return row;
}

describe('a fresh deployment’s first campaign', () => {
	it('makes the Donation page first, and the campaign beside it, never published', async () => {
		const { pageId } = await create('Winter coat drive');

		const [donationPage] = await db.select().from(page).where(eq(page.type, 'donation_page'));
		expect(donationPage?.state).toBe('live');
		const made = await stored(pageId);
		expect(made).toMatchObject({
			type: 'campaign',
			name: 'Winter coat drive',
			slug: 'winter-coat-drive',
			state: 'never_published',
			published: null
		});
	});
});

/** a campaign already holding `slug`, in `state`. */
async function holding(slug: string, state: 'never_published' | 'live' | 'ended') {
	const live = { ...defaultCampaign(), settings: SETTINGS };
	const pageId = await insertPage(db, 'campaign', live, state === 'never_published' ? null : live);
	await db.update(page).set({ slug, state }).where(eq(page.id, pageId));
}

describe('a new campaign’s address', () => {
	it.each([
		['a route', 'Admin', [], 'admin-2'],
		[
			'a live campaign',
			'Winter coat drive',
			[['winter-coat-drive', 'live']],
			'winter-coat-drive-2'
		],
		[
			'a campaign not yet published',
			'Winter coat drive',
			[['winter-coat-drive', 'never_published']],
			'winter-coat-drive-2'
		],
		[
			'an ended campaign’s held address',
			'Winter coat drive',
			[['winter-coat-drive', 'ended']],
			'winter-coat-drive-2'
		],
		[
			'the first suffix as well',
			'Winter coat drive',
			[
				['winter-coat-drive', 'live'],
				['winter-coat-drive-2', 'ended']
			],
			'winter-coat-drive-3'
		]
	] as const)(
		'takes the next free suffix where its name clashes with %s',
		async (_, title, held, expected) => {
			for (const [slug, state] of held) await holding(slug, state);

			const { pageId } = await create(title);

			expect((await stored(pageId)).slug).toBe(expected);
		}
	);

	it('goes to the next suffix when another create takes it first, and leaves no settings row behind', async () => {
		await ensureDonationPage(db);
		const batch = vi.spyOn(db, 'batch');

		const made = await Promise.all([create('Winter coat drive'), create('Winter coat drive')]);

		const slugs = await Promise.all(made.map(async ({ pageId }) => (await stored(pageId)).slug));
		expect(slugs.sort()).toEqual(['winter-coat-drive', 'winter-coat-drive-2']);
		// both read the same free address, so the index is what settled it rather than the order.
		expect(batch).toHaveBeenCalledTimes(3);
		const owners = await db.select({ formId: page.formId }).from(page);
		expect(await db.select({ id: form.id }).from(form)).toHaveLength(owners.length);
	});

	it('is the donation page’s own address suffixed where the name is “Donate”', async () => {
		const { pageId } = await create('Donate');

		expect((await stored(pageId)).slug).toBe('donate-2');
	});

	it('is `campaign` where the name holds no letter or digit to make one from', async () => {
		const { pageId } = await create('!!!');

		expect((await stored(pageId)).slug).toBe('campaign');
	});

	it('stays inside the length limit with its suffix', async () => {
		const long = 'word '.repeat(20).trim();
		await create(long);

		const { pageId } = await create(long);

		const slug = (await stored(pageId)).slug ?? '';
		expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
		expect(slug).toMatch(/^word(-word)*-2$/);
	});
});

describe('what the new campaign is for', () => {
	it('is sent with the title as the chat’s first message, and the reply drafts the campaign', async () => {
		const AI = answering({
			say: 'Drafted your coat drive.',
			page: { kind: 'merge', doc: {} },
			set: { goalMinor: 1_500_000, endDate: '2026-12-31' }
		});

		const { pageId } = await create(
			'Winter coat drive',
			'coats for 300 kids, goal $15k by Dec 31',
			AI
		);

		expect(await readChat(db, pageId)).toMatchObject([
			{ role: 'operator', text: 'Winter coat drive\ncoats for 300 kids, goal $15k by Dec 31' },
			{ role: 'assistant' }
		]);
		const draft = JSON.parse((await stored(pageId)).draft);
		expect(draft.goalMinor).toBe(1_500_000);
		expect(draft.endsAt).toBe(Date.parse('2027-01-01T05:00:00Z') - 1);
	});

	it('left blank, sends no message and leaves the clean default campaign', async () => {
		const AI = answering();

		const { pageId } = await create('Winter coat drive', '   ', AI);

		expect(AI.run).not.toHaveBeenCalled();
		expect(await readChat(db, pageId)).toEqual([]);
		expect(JSON.parse((await stored(pageId)).draft)).toMatchObject({
			...defaultCampaign(),
			name: 'Winter coat drive'
		});
	});

	it('still makes the campaign when no model answers, and the chat says so', async () => {
		const AI = answering(new Error('Workers AI is down'), new Error('Workers AI is down'));

		const { pageId } = await create('Winter coat drive', 'coats for 300 kids', AI);

		expect((await stored(pageId)).state).toBe('never_published');
		const [, answer] = (await readChat(db, pageId)) ?? [];
		expect(answer?.text).toMatch(/^No model answered, so nothing changed\./);
	});
});

describe('a new campaign’s donation settings', () => {
	it('are the Donation page’s live ones, with the program left for the campaign to choose', async () => {
		await db.insert(program).values([{ name: 'Food bank' }, { name: 'Shelter' }]);
		const donationPage = await ensureDonationPage(db);
		await db
			.update(form)
			.set({ minMinor: 1_000, maxMinor: 50_000, suggestedAmounts: '[2000,4000,8000]' })
			.where(eq(form.id, donationPage.formId));

		const { pageId } = await create('Winter coat drive');

		const made = await stored(pageId);
		const [owned] = await db.select().from(form).where(eq(form.id, made.formId));
		expect(owned).toMatchObject({
			status: 'draft',
			minMinor: 1_000,
			maxMinor: 50_000,
			suggestedAmounts: '[2000,4000,8000]',
			programMode: 'none',
			programId: null
		});
		expect(JSON.parse(made.draft).settings).toMatchObject({
			minMinor: 1_000,
			maxMinor: 50_000,
			suggestedAmounts: [2000, 4000, 8000],
			programMode: 'none',
			programId: null
		});
	});

	it('are the campaign’s own row, which the Forms list never shows', async () => {
		await create('Winter coat drive');

		expect(await readForms(db)).toEqual([]);
	});
});
