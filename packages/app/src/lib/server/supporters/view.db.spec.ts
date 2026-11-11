import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client } from '$lib/server/db/database.testing';
import { supporterPage } from '$lib/server/db/schema';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { gift, noteGift } from '$lib/server/pages/settled-gifts.testing';
import { emptySupporterTables, pendingPage, STARTED_AT } from './fundraiser.testing';
import { signInWithLink } from './links';
import { endOwnFundraiser } from './pages';
import { readFundraiserPreview, readPublicFundraiser } from './view';

// the public page at /f/<slug>: live, ended, or one indistinguishable not-found for a page that is
// hidden, pending or not there.

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await emptySupporterTables();
	await writeOrgRow(client, { tax_id: '12-3456789' });
});

const LIVE_AT = new Date(STARTED_AT.getTime() + 60_000);

async function livePage() {
	const started = await pendingPage(db);
	await signInWithLink(db, new Request('https://give.example/f/link'), started.token, LIVE_AT);
	const [row] = await db
		.select({ formId: supporterPage.formId, supporterId: supporterPage.supporterId })
		.from(supporterPage)
		.where(eq(supporterPage.id, started.pageId));
	if (!row) throw new Error('the page was not written');
	return { ...started, ...row };
}

describe('a live fundraiser’s public page', () => {
	it('shows the page, its total against its goal, and the form gifts are given through', async () => {
		const page = await livePage();
		await gift(db, page.formId, 10_000);
		expect(await readPublicFundraiser(db, page.slug)).toEqual({
			kind: 'live',
			title: 'Run for the shelter',
			story: 'I am running 10k.',
			name: 'Maya Rivera',
			startedAt: LIVE_AT,
			photoId: null,
			raisedMinor: 10_000,
			goalMinor: 50_000,
			currency: 'USD',
			gifts: 1,
			goalReached: false,
			messages: null,
			formId: page.formId
		});
	});

	it('says the goal is reached once the total meets it', async () => {
		const page = await livePage();
		await gift(db, page.formId, 50_000);
		expect(await readPublicFundraiser(db, page.slug)).toMatchObject({ goalReached: true });
	});

	it('lists the messages of its own gifts whose donors chose to show them', async () => {
		const page = await livePage();
		await noteGift(db, page.formId, { note: 'Go Maya!', noteOnPage: 'named' });
		await noteGift(db, page.formId, { note: 'Private', firstName: 'Ben' });
		const read = await readPublicFundraiser(db, page.slug);
		expect(read.kind === 'live' ? read.messages : 'not live').toMatchObject({
			messages: [{ name: 'Ada O.', note: 'Go Maya!' }],
			total: 1
		});
	});

	it('carries no donor email, address or payment method', async () => {
		const page = await livePage();
		await noteGift(db, page.formId, { note: 'Go!', noteOnPage: 'named', email: 'ada@example.org' });
		const text = JSON.stringify(await readPublicFundraiser(db, page.slug));
		expect(text).not.toContain('ada@example.org');
		expect(text).not.toMatch(/card|address|method|email|contact/i);
	});
});

describe('an ended fundraiser’s public page', () => {
	it('shows its title, name and final figures, and no form', async () => {
		const page = await livePage();
		await gift(db, page.formId, 10_000);
		await endOwnFundraiser(db, page.supporterId, page.pageId, LIVE_AT);
		expect(await readPublicFundraiser(db, page.slug)).toEqual({
			kind: 'ended',
			title: 'Run for the shelter',
			name: 'Maya Rivera',
			raisedMinor: 10_000,
			goalMinor: 50_000,
			currency: 'USD',
			gifts: 1
		});
	});
});

describe('a page the public may not see', () => {
	it('reads exactly as an address nobody holds, whether hidden, pending or unknown', async () => {
		const hidden = await livePage();
		await db
			.update(supporterPage)
			.set({ hiddenAt: LIVE_AT })
			.where(eq(supporterPage.id, hidden.pageId));
		const pending = await pendingPage(db, { title: 'Quiet run' });

		const unknown = await readPublicFundraiser(db, 'nobody-holds-this');
		expect(unknown).toEqual({ kind: 'not_found' });
		expect(await readPublicFundraiser(db, hidden.slug)).toEqual(unknown);
		expect(await readPublicFundraiser(db, pending.slug)).toEqual(unknown);
	});

	it('is still drawn for staff’s preview, saying why the public cannot see it', async () => {
		const hidden = await livePage();
		await db
			.update(supporterPage)
			.set({ hiddenAt: LIVE_AT, hiddenNote: 'spam' })
			.where(eq(supporterPage.id, hidden.pageId));
		expect(await readFundraiserPreview(db, hidden.pageId)).toMatchObject({
			title: 'Run for the shelter',
			status: 'live',
			hidden: true,
			hiddenNote: 'spam'
		});
		expect(await readFundraiserPreview(db, 'no-such-page')).toBeNull();
	});
});
