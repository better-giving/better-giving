import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { form, page } from '../db/schema';
import type { PageState, PageType } from '../../page/keys';
import { createImage, stored as imageStored } from '../images/image.testing';
import { heroShowing, insertPage } from './page-row.testing';
import { deleteNeverPublishedCampaign, endCampaign, readPage } from './queries';
import { client, run, stmt } from '$lib/server/db/database.testing';

// the one delete of a page: a campaign that has never been live, with its owned settings row, in
// one `batch()`. everything that has been live is refused, and so is the Donation page.
// and a campaign's end: a live campaign to `ended` with its owned settings row out of service, in one
// `batch()`, and every other page refused with its row untouched. and an address taken from a
// campaign past its end date, which a Publish of it landing mid-way leaves where it was.

let db: Db;

beforeAll(() => {
	db = createDb(client);
});

let sequence = 0;

/**
 * a page of the given type and state, owning a fresh settings row. there is one Donation page, so a
 * new one replaces any other.
 */
async function pageOwningRow(type: PageType, state: PageState) {
	if (type === 'donation_page') {
		await run(stmt("delete from page where type = 'donation_page'"));
	}
	sequence += 1;
	const [owned] = await db
		.insert(form)
		.values({
			name: `settings ${sequence}`,
			revenueAccountId: postableId('donationsDeductible'),
			currency: 'USD'
		})
		.returning({ id: form.id });
	if (!owned) throw new Error('inserting the fixture form returned no row');
	const campaign = type === 'campaign';
	const [row] = await db
		.insert(page)
		.values({
			type,
			name: campaign ? `Campaign ${sequence}` : null,
			slug: campaign ? `campaign-${sequence}` : null,
			state,
			formId: owned.id,
			draft: '{}',
			published: state === 'never_published' ? null : '{}'
		})
		.returning({ id: page.id });
	if (!row) throw new Error('inserting the fixture page returned no row');
	return { pageId: row.id, formId: owned.id };
}

/** the version the page `pageId` stands at, as a list drawn now would carry it. */
async function versionOf(pageId: string): Promise<Date> {
	const row = await readPage(db, pageId);
	if (row === null) throw new Error(`the fixture page ${pageId} is not there`);
	return row.updatedAt;
}

/** a version earlier than any the page has stood at, as a list drawn before its last write carries. */
const EARLIER = new Date(0);

async function remaining({ pageId, formId }: { pageId: string; formId: string }) {
	const pages = await db.select({ id: page.id }).from(page).where(eq(page.id, pageId));
	const forms = await db.select({ id: form.id }).from(form).where(eq(form.id, formId));
	return { pages: pages.length, forms: forms.length };
}

describe('deleteNeverPublishedCampaign()', () => {
	it('removes a never-published campaign with its owned settings row', async () => {
		const made = await pageOwningRow('campaign', 'never_published');
		expect(await deleteNeverPublishedCampaign(db, made.pageId, await versionOf(made.pageId))).toBe(
			true
		);
		expect(await remaining(made)).toEqual({ pages: 0, forms: 0 });
	});

	it('frees the photo only its draft placed, and keeps one a page left standing places', async () => {
		const upload = () =>
			createImage(
				db,
				{ kind: 'photo', contentType: 'image/webp', width: 4, height: 3, alt: null },
				new Uint8Array([1, 2, 3])
			);
		const [alone, shared] = [await upload(), await upload()];
		const pageId = await insertPage(db, 'campaign', heroShowing(alone));
		await insertPage(db, 'campaign', heroShowing(shared));
		const both = await insertPage(db, 'campaign', heroShowing(shared));

		expect(await deleteNeverPublishedCampaign(db, pageId, await versionOf(pageId))).toBe(true);
		expect(await deleteNeverPublishedCampaign(db, both, await versionOf(both))).toBe(true);
		expect(await imageStored(db, alone)).toEqual({ row: false, bytes: false });
		expect(await imageStored(db, shared)).toEqual({ row: true, bytes: true });
	});

	it('refuses a campaign written since the version it was drawn at', async () => {
		const made = await pageOwningRow('campaign', 'never_published');
		expect(await deleteNeverPublishedCampaign(db, made.pageId, EARLIER)).toBe(false);
		expect(await remaining(made)).toEqual({ pages: 1, forms: 1 });
	});

	it.each([['live'], ['ended']] as const)('refuses a campaign that is %s', async (state) => {
		const made = await pageOwningRow('campaign', state);
		expect(await deleteNeverPublishedCampaign(db, made.pageId, await versionOf(made.pageId))).toBe(
			false
		);
		expect(await remaining(made)).toEqual({ pages: 1, forms: 1 });
	});

	it('refuses the Donation page', async () => {
		const made = await pageOwningRow('donation_page', 'live');
		expect(await deleteNeverPublishedCampaign(db, made.pageId, await versionOf(made.pageId))).toBe(
			false
		);
		expect(await remaining(made)).toEqual({ pages: 1, forms: 1 });
	});

	it('refuses a page that does not exist', async () => {
		expect(
			await deleteNeverPublishedCampaign(db, '019fc800-0000-7000-8000-000000000000', EARLIER)
		).toBe(false);
	});
});

describe('endCampaign()', () => {
	/** a page as `pageOwningRow` leaves it, its owned settings row taking gifts. */
	async function servingPage(type: PageType, state: PageState) {
		const made = await pageOwningRow(type, state);
		await db.update(form).set({ status: 'live' }).where(eq(form.id, made.formId));
		return made;
	}

	async function standing({ pageId, formId }: { pageId: string; formId: string }) {
		const [row] = await db.select({ state: page.state }).from(page).where(eq(page.id, pageId));
		const [owned] = await db.select({ status: form.status }).from(form).where(eq(form.id, formId));
		return { state: row?.state, status: owned?.status };
	}

	it('ends a live campaign and takes its owned settings row out of service with it', async () => {
		const made = await servingPage('campaign', 'live');
		expect(await endCampaign(db, made.pageId, await versionOf(made.pageId))).toBe(true);
		expect(await standing(made)).toEqual({ state: 'ended', status: 'draft' });
	});

	it('refuses a campaign written since the version it was drawn at, leaving its row serving', async () => {
		const made = await servingPage('campaign', 'live');
		expect(await endCampaign(db, made.pageId, EARLIER)).toBe(false);
		expect(await standing(made)).toEqual({ state: 'live', status: 'live' });
	});

	// each owned row is live here, so a row the batch touched without ending its page shows.
	it.each([
		['a campaign never published', 'campaign', 'never_published'],
		['a campaign already ended', 'campaign', 'ended'],
		['the Donation page', 'donation_page', 'live']
	] as const)('refuses %s and leaves its owned row serving', async (_, type, state) => {
		const made = await servingPage(type, state);
		expect(await endCampaign(db, made.pageId, await versionOf(made.pageId))).toBe(false);
		expect(await standing(made)).toEqual({ state, status: 'live' });
	});

	it('refuses a page that does not exist', async () => {
		expect(await endCampaign(db, '019fc800-0000-7000-8000-000000000000', EARLIER)).toBe(false);
	});
});
