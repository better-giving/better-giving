import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { client } from '$lib/server/db/database.testing';
import { supporterPage } from '$lib/server/db/schema';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { gift } from '$lib/server/pages/settled-gifts.testing';
import { hideFundraiser, listAllFundraisers, showFundraiser } from './admin';
import { emptySupporterTables, pendingPage, STARTED_AT } from './fundraiser.testing';
import { signInWithLink } from './links';
import { readPublicFundraiser } from './view';

// staff's supporter fundraisers: every page, and hiding one or showing it again.

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await emptySupporterTables();
	await writeOrgRow(client, { tax_id: '12-3456789' });
});

const LIVE_AT = new Date(STARTED_AT.getTime() + 60_000);
const LATER = new Date(STARTED_AT.getTime() + 3_600_000);

async function livePage(email = 'maya@example.org', title = 'Run for the shelter') {
	const started = await pendingPage(db, { email, title });
	await signInWithLink(db, new Request('https://give.example/f/link'), started.token, LIVE_AT);
	const [row] = await db
		.select({ formId: supporterPage.formId })
		.from(supporterPage)
		.where(eq(supporterPage.id, started.pageId));
	return { ...started, formId: row?.formId ?? '' };
}

describe('every fundraiser, for staff', () => {
	it('lists each with its supporter, address, goal, total and standing, newest first', async () => {
		const first = await livePage();
		const second = await pendingPage(db, {
			email: 'ben@example.org',
			name: 'Ben Ito',
			title: 'Bake sale'
		});
		await gift(db, first.formId, 10_000);
		await hideFundraiser(db, first.pageId, 'spam', LATER);

		expect(await listAllFundraisers(db)).toEqual([
			{
				id: second.pageId,
				supporterName: 'Ben Ito',
				supporterEmail: 'ben@example.org',
				title: 'Bake sale',
				slug: 'bake-sale',
				goalMinor: 50_000,
				currency: 'USD',
				raisedMinor: 0,
				gifts: 0,
				status: 'pending',
				hidden: false,
				hiddenNote: null,
				published: false,
				createdAt: STARTED_AT
			},
			{
				id: first.pageId,
				supporterName: 'Maya Rivera',
				supporterEmail: 'maya@example.org',
				title: 'Run for the shelter',
				slug: 'run-for-the-shelter',
				goalMinor: 50_000,
				currency: 'USD',
				raisedMinor: 10_000,
				gifts: 1,
				status: 'live',
				hidden: true,
				hiddenNote: 'spam',
				published: true,
				createdAt: STARTED_AT
			}
		]);
	});
});

describe('hiding a fundraiser', () => {
	it('takes it off its address, and showing it again puts it back', async () => {
		const page = await livePage();
		expect(await hideFundraiser(db, page.pageId, null, LATER)).toBe('hidden');
		expect(await readPublicFundraiser(db, page.slug)).toEqual({ kind: 'not_found' });
		expect(await showFundraiser(db, page.pageId)).toBe('shown');
		expect(await readPublicFundraiser(db, page.slug)).toMatchObject({ kind: 'live' });
	});

	it('keeps the first hide’s time on a second, and takes the newer note', async () => {
		const page = await livePage();
		await hideFundraiser(db, page.pageId, 'first look', LATER);
		await hideFundraiser(db, page.pageId, 'spam', new Date(LATER.getTime() + 1));
		const [row] = await db
			.select({ at: supporterPage.hiddenAt, note: supporterPage.hiddenNote })
			.from(supporterPage)
			.where(eq(supporterPage.id, page.pageId));
		expect(row).toEqual({ at: LATER, note: 'spam' });
	});

	it('clears the note when shown again', async () => {
		const page = await livePage();
		await hideFundraiser(db, page.pageId, 'spam', LATER);
		await showFundraiser(db, page.pageId);
		const [row] = await db
			.select({ at: supporterPage.hiddenAt, note: supporterPage.hiddenNote })
			.from(supporterPage)
			.where(eq(supporterPage.id, page.pageId));
		expect(row).toEqual({ at: null, note: null });
	});

	it('answers not found for a page that is not there', async () => {
		expect(await hideFundraiser(db, 'no-such-page', null, LATER)).toBe('not_found');
		expect(await showFundraiser(db, 'no-such-page')).toBe('not_found');
	});
});
