import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page as PageDocument } from '../../page/catalog';
import { defaultCampaign, defaultDonationPage } from '../../page/defaults';
import { endOfDay } from '../../page/end-date';
import { createDb, type Db } from '../db/client';
import { chatTurn, form, page, program } from '../db/schema';
import { readForm } from '../forms/queries';
import { insertPage, SETTINGS } from './page-row.testing';
import { discardChanges, publishPage, undoPublish } from './publish';
import { endCampaign } from './queries';

// Publish, Undo and Discard changes against the real D1 the pool binds: each is one `batch()` over
// the page and the settings row it owns, and what they leave is read back from both.

const NOW = Date.parse('2026-09-28T12:00:00Z');

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

async function stored(pageId: string) {
	const [row] = await db.select().from(page).where(eq(page.id, pageId));
	if (!row) throw new Error(`no page ${pageId}`);
	return row;
}

/** the owned row's settings, as a page document's `settings` holds them. */
async function ownedSettings(pageId: string) {
	const owned = await readForm(db, (await stored(pageId)).formId);
	if (owned === null) throw new Error(`page ${pageId}'s settings row is gone`);
	const { id: _id, name: _name, status: _status, updatedAt: _at, ...settings } = owned;
	return settings;
}

/** the row's settings columns written as `settings` says, and the status given. */
async function ownRow(pageId: string, settings: typeof SETTINGS, status: 'draft' | 'live') {
	await db
		.update(form)
		.set({
			minMinor: settings.minMinor,
			maxMinor: settings.maxMinor,
			suggestedAmounts: JSON.stringify(settings.suggestedAmounts),
			status
		})
		.where(eq(form.id, (await stored(pageId)).formId));
}

/** the draft replaced with `draft`, as an editor's write leaves it: a second later, so a new version. */
async function draftAs(pageId: string, draft: PageDocument) {
	const was = (await stored(pageId)).updatedAt.getTime();
	await db
		.update(page)
		.set({ draft: JSON.stringify(draft), updatedAt: new Date(was + 1_000) })
		.where(eq(page.id, pageId));
}

const LIVE_DONATION_PAGE: PageDocument = { ...defaultDonationPage(), settings: SETTINGS };

const CHANGED_SETTINGS = {
	...SETTINGS,
	minMinor: 1_000,
	maxMinor: 50_000,
	suggestedAmounts: [2_000, 4_000]
};

describe('Publish on the Donation page', () => {
	it('makes the draft live and its donation settings the owned row’s, keeping the page it replaced', async () => {
		const pageId = await insertPage(db, 'donation_page', LIVE_DONATION_PAGE);
		await ownRow(pageId, SETTINGS, 'live');
		const draft = {
			...LIVE_DONATION_PAGE,
			shareMessage: 'Keep Elm Street warm.',
			settings: CHANGED_SETTINGS
		};
		await draftAs(pageId, draft);
		const drawn = await stored(pageId);

		const outcome = await publishPage(db, { type: 'donation_page' }, drawn.updatedAt, { now: NOW });

		expect(outcome).toEqual({ kind: 'published', undoable: true });
		const after = await stored(pageId);
		expect(JSON.parse(after.published ?? 'null')).toEqual(draft);
		expect(after.draft).toBe(after.published);
		expect(JSON.parse(after.lastPublished ?? 'null')).toEqual(LIVE_DONATION_PAGE);
		expect(await ownedSettings(pageId)).toEqual(CHANGED_SETTINGS);
	});
});

describe('a draft Publish refuses', () => {
	it('when the page has been written since the editor was drawn, and nothing goes live', async () => {
		const pageId = await insertPage(db, 'donation_page', LIVE_DONATION_PAGE);
		await ownRow(pageId, SETTINGS, 'live');
		const drawn = await stored(pageId);
		await draftAs(pageId, { ...LIVE_DONATION_PAGE, settings: CHANGED_SETTINGS });
		const written = await stored(pageId);

		const outcome = await publishPage(db, { type: 'donation_page' }, drawn.updatedAt, { now: NOW });

		expect(outcome).toEqual({ kind: 'stale' });
		expect(await stored(pageId)).toEqual(written);
		expect(await ownedSettings(pageId)).toEqual(SETTINGS);
	});

	it('names what fails the page rule, and nothing goes live', async () => {
		const pageId = await insertPage(db, 'donation_page', LIVE_DONATION_PAGE);
		await ownRow(pageId, SETTINGS, 'live');
		const failing = {
			...LIVE_DONATION_PAGE,
			settings: CHANGED_SETTINGS,
			blocks: LIVE_DONATION_PAGE.blocks.filter((block) => block.type !== 'donation-box')
		};
		await draftAs(pageId, failing);
		const drawn = await stored(pageId);

		const outcome = await publishPage(db, { type: 'donation_page' }, drawn.updatedAt, { now: NOW });

		expect(outcome).toEqual({
			kind: 'refused',
			text: 'Nothing was published: a page holds exactly one donation box, and this one holds none.'
		});
		expect(await stored(pageId)).toEqual(drawn);
		expect(await ownedSettings(pageId)).toEqual(SETTINGS);
	});

	it('names a donation setting the form rule refuses, and nothing goes live', async () => {
		const pageId = await insertPage(db, 'donation_page', LIVE_DONATION_PAGE);
		await ownRow(pageId, SETTINGS, 'live');
		await draftAs(pageId, {
			...LIVE_DONATION_PAGE,
			settings: { ...CHANGED_SETTINGS, minMinor: 60_000, suggestedAmounts: [] }
		});
		const drawn = await stored(pageId);

		const outcome = await publishPage(db, { type: 'donation_page' }, drawn.updatedAt, { now: NOW });

		expect(outcome).toEqual({
			kind: 'refused',
			text: 'Nothing was published: in Donation settings, Largest gift must be larger than smallest gift.'
		});
		expect(await stored(pageId)).toEqual(drawn);
		expect(await ownedSettings(pageId)).toEqual(SETTINGS);
	});
});

/** the end of `day` in New York, where the campaign's end was chosen. */
function endOf(day: string): number {
	const end = endOfDay({ day, timeZone: 'America/New_York', now: 0 });
	if (!end.ok) throw new Error(end.reason);
	return end.endsAt;
}

const CAMPAIGN: PageDocument = {
	...defaultCampaign(),
	name: 'Winter coat drive',
	settings: SETTINGS
};

describe('a campaign whose end date has passed', () => {
	const ended = { ...CAMPAIGN, endsAt: endOf('2026-09-27'), endsZone: 'America/New_York' };

	it('is refused, naming the date, and nothing goes live', async () => {
		const pageId = await insertPage(db, 'campaign', ended);
		const drawn = await stored(pageId);

		const outcome = await publishPage(db, { type: 'campaign', id: pageId }, drawn.updatedAt, {
			now: NOW
		});

		expect(outcome).toEqual({
			kind: 'refused',
			text: 'Nothing was published: the end date, Sep 27, 2026, has passed. Change or clear it in Settings, then publish.'
		});
		expect(await stored(pageId)).toEqual(drawn);
	});

	it.each([
		['changed', { ...ended, endsAt: endOf('2026-10-31') }],
		['cleared', CAMPAIGN]
	])('is published once the date is %s', async (_, draft) => {
		const pageId = await insertPage(db, 'campaign', ended);
		await draftAs(pageId, draft);
		const drawn = await stored(pageId);

		const outcome = await publishPage(db, { type: 'campaign', id: pageId }, drawn.updatedAt, {
			now: NOW,
			giftsGoTo: null
		});

		expect(outcome).toEqual({ kind: 'published', undoable: false });
		expect(JSON.parse((await stored(pageId)).published ?? 'null')).toEqual(draft);
	});
});

/** an active program called `name`, and its id. */
async function aProgram(name: string, archived = false): Promise<string> {
	const [made] = await db
		.insert(program)
		.values(archived ? { name, status: 'archived', archivedAt: new Date(NOW) } : { name })
		.returning({ id: program.id });
	if (!made) throw new Error('inserting the fixture program returned no row');
	return made.id;
}

describe('a campaign’s first Publish', () => {
	it('makes it live with the program chosen, which its settings row then carries', async () => {
		const pageId = await insertPage(db, 'campaign', CAMPAIGN);
		await ownRow(pageId, SETTINGS, 'draft');
		const coats = await aProgram('Winter coats');
		const drawn = await stored(pageId);

		const outcome = await publishPage(db, { type: 'campaign', id: pageId }, drawn.updatedAt, {
			now: NOW,
			giftsGoTo: coats
		});

		expect(outcome).toEqual({ kind: 'published', undoable: false });
		const after = await stored(pageId);
		const pinned = { ...SETTINGS, programMode: 'pinned', programId: coats };
		expect(after.state).toBe('live');
		expect(JSON.parse(after.published ?? 'null')).toEqual({ ...CAMPAIGN, settings: pinned });
		expect(after.draft).toBe(after.published);
		expect(after.lastPublished).toBeNull();
		const owned = await readForm(db, after.formId);
		expect(owned).toMatchObject({ status: 'live', programMode: 'pinned', programId: coats });
	});

	it('keeps the program the draft holds where none is chosen', async () => {
		const pageId = await insertPage(db, 'campaign', CAMPAIGN);
		const drawn = await stored(pageId);

		const outcome = await publishPage(db, { type: 'campaign', id: pageId }, drawn.updatedAt, {
			now: NOW,
			giftsGoTo: null
		});

		expect(outcome).toEqual({ kind: 'published', undoable: false });
		expect(await ownedSettings(pageId)).toMatchObject({ programMode: 'none', programId: null });
	});

	it('is refused without saying where gifts go, and nothing goes live', async () => {
		const pageId = await insertPage(db, 'campaign', CAMPAIGN);
		const drawn = await stored(pageId);

		const outcome = await publishPage(db, { type: 'campaign', id: pageId }, drawn.updatedAt, {
			now: NOW
		});

		expect(outcome).toEqual({
			kind: 'refused',
			text: 'Nothing was published: a campaign’s first Publish says where its gifts go. Publish it from its editor, choosing under “Gifts go to”.'
		});
		expect(await stored(pageId)).toEqual(drawn);
	});

	it('refuses a program no longer offered, and nothing goes live', async () => {
		const pageId = await insertPage(db, 'campaign', CAMPAIGN);
		const retired = await aProgram('Summer camp', true);
		const drawn = await stored(pageId);

		const outcome = await publishPage(db, { type: 'campaign', id: pageId }, drawn.updatedAt, {
			now: NOW,
			giftsGoTo: retired
		});

		expect(outcome).toEqual({
			kind: 'refused',
			text: 'Nothing was published: the program chosen for gifts is no longer offered. Choose another.'
		});
		expect(await stored(pageId)).toEqual(drawn);
	});
});

describe('an ended campaign published again', () => {
	/** a campaign published live at its own address, then ended. */
	async function endedCampaign(): Promise<string> {
		const pageId = await insertPage(db, 'campaign', CAMPAIGN, CAMPAIGN);
		await db.update(page).set({ slug: 'winter-coat-drive' }).where(eq(page.id, pageId));
		await ownRow(pageId, SETTINGS, 'live');
		if (!(await endCampaign(db, pageId))) throw new Error('the fixture campaign did not end');
		return pageId;
	}

	it('is live again at its address, taking gifts through its settings row', async () => {
		const pageId = await endedCampaign();
		const drawn = await stored(pageId);

		const outcome = await publishPage(db, { type: 'campaign', id: pageId }, drawn.updatedAt, {
			now: NOW
		});

		expect(outcome).toEqual({ kind: 'published', undoable: true });
		const after = await stored(pageId);
		expect(after).toMatchObject({ state: 'live', slug: 'winter-coat-drive' });
		expect(await readForm(db, after.formId)).toMatchObject({ status: 'live' });
	});

	it('takes the next free address where its own was taken meanwhile', async () => {
		const pageId = await endedCampaign();
		const taker = await insertPage(db, 'campaign');
		await db.batch([
			db.update(page).set({ slug: null }).where(eq(page.id, pageId)),
			db.update(page).set({ slug: 'winter-coat-drive' }).where(eq(page.id, taker))
		]);
		const drawn = await stored(pageId);

		const outcome = await publishPage(db, { type: 'campaign', id: pageId }, drawn.updatedAt, {
			now: NOW
		});

		expect(outcome).toEqual({ kind: 'published', undoable: true });
		expect(await stored(pageId)).toMatchObject({ state: 'live', slug: 'winter-coat-drive-2' });
		expect((await stored(taker)).slug).toBe('winter-coat-drive');
	});
});

describe('Undo', () => {
	it('puts back the page a republish replaced, and its donation settings', async () => {
		const pageId = await insertPage(db, 'donation_page', LIVE_DONATION_PAGE);
		await ownRow(pageId, SETTINGS, 'live');
		const republished = {
			...LIVE_DONATION_PAGE,
			shareMessage: 'Warm coats.',
			settings: CHANGED_SETTINGS
		};
		await draftAs(pageId, republished);
		await publishPage(db, { type: 'donation_page' }, (await stored(pageId)).updatedAt, {
			now: NOW
		});
		const drawn = await stored(pageId);

		const outcome = await undoPublish(db, { type: 'donation_page' }, drawn.updatedAt);

		expect(outcome).toEqual({ kind: 'undone' });
		const after = await stored(pageId);
		expect(JSON.parse(after.published ?? 'null')).toEqual(LIVE_DONATION_PAGE);
		expect(JSON.parse(after.lastPublished ?? 'null')).toEqual(republished);
		expect(await ownedSettings(pageId)).toEqual(SETTINGS);
	});

	it('is refused where nothing was replaced, and nothing moves', async () => {
		const pageId = await insertPage(db, 'campaign', CAMPAIGN);
		await publishPage(db, { type: 'campaign', id: pageId }, (await stored(pageId)).updatedAt, {
			now: NOW,
			giftsGoTo: null
		});
		const drawn = await stored(pageId);

		const outcome = await undoPublish(db, { type: 'campaign', id: pageId }, drawn.updatedAt);

		expect(outcome).toEqual({ kind: 'nothing' });
		expect(await stored(pageId)).toEqual(drawn);
	});
});

/** two turns of chat on the page, as the drafting chat leaves them. */
async function chatOn(pageId: string) {
	await db.insert(chatTurn).values([
		{ pageId, seq: 1, author: 'operator', text: 'Make it about winter coats.' },
		{ pageId, seq: 2, author: 'assistant', text: 'Done.', model: '@cf/meta/llama' }
	]);
}

const turnsOn = async (pageId: string) =>
	(await db.select().from(chatTurn).where(eq(chatTurn.pageId, pageId))).length;

describe('the chat', () => {
	it('is kept by Publish', async () => {
		const pageId = await insertPage(db, 'donation_page', LIVE_DONATION_PAGE);
		await chatOn(pageId);
		await draftAs(pageId, { ...LIVE_DONATION_PAGE, shareMessage: 'Warm coats.' });

		const outcome = await publishPage(
			db,
			{ type: 'donation_page' },
			(await stored(pageId)).updatedAt,
			{
				now: NOW
			}
		);

		expect(outcome).toMatchObject({ kind: 'published' });
		expect(await turnsOn(pageId)).toBe(2);
	});
});

describe('Discard changes', () => {
	it('returns the draft to the live page and empties the chat', async () => {
		const pageId = await insertPage(db, 'donation_page', LIVE_DONATION_PAGE);
		const other = await insertPage(db, 'campaign');
		await chatOn(pageId);
		await chatOn(other);
		await draftAs(pageId, { ...LIVE_DONATION_PAGE, shareMessage: 'Warm coats.' });
		const drawn = await stored(pageId);

		const outcome = await discardChanges(db, { type: 'donation_page' }, drawn.updatedAt);

		expect(outcome).toEqual({ kind: 'discarded' });
		const after = await stored(pageId);
		expect(after.draft).toBe(drawn.published);
		expect(after.published).toBe(drawn.published);
		expect(await turnsOn(pageId)).toBe(0);
		expect(await turnsOn(other)).toBe(2);
	});

	it('is refused when the page has been written since the editor was drawn, and nothing moves', async () => {
		const pageId = await insertPage(db, 'donation_page', LIVE_DONATION_PAGE);
		await chatOn(pageId);
		const drawn = await stored(pageId);
		await draftAs(pageId, { ...LIVE_DONATION_PAGE, shareMessage: 'Warm coats.' });
		const written = await stored(pageId);

		const outcome = await discardChanges(db, { type: 'donation_page' }, drawn.updatedAt);

		expect(outcome).toEqual({ kind: 'stale' });
		expect(await stored(pageId)).toEqual(written);
		expect(await turnsOn(pageId)).toBe(2);
	});

	it('is refused on a campaign never published, which has no live page to return to', async () => {
		const pageId = await insertPage(db, 'campaign', CAMPAIGN);
		await chatOn(pageId);
		const drawn = await stored(pageId);

		const outcome = await discardChanges(db, { type: 'campaign', id: pageId }, drawn.updatedAt);

		expect(outcome).toEqual({ kind: 'nothing' });
		expect(await stored(pageId)).toEqual(drawn);
		expect(await turnsOn(pageId)).toBe(2);
	});
});
