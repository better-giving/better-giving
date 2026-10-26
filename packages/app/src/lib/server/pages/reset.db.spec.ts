import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page as PageDocument } from '../../page/catalog';
import { defaultDonationPage } from '../../page/defaults';
import { createDb, type Db } from '../db/client';
import { donation, page } from '../db/schema';
import { readForm } from '../forms/queries';
import { expectRecordedAsAForm } from './owned-settings-gift.testing';
import { insertPage, SETTINGS } from './page-row.testing';
import { resetDonationPage } from './reset';
import { client, stmt } from '$lib/server/db/database.testing';

// Reset to default against a real database: one write to the Donation page, read back
// from it and from the settings row it owns, which it leaves alone.

let db: Db;

beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	await client.batch([
		stmt('delete from payment'),
		stmt('delete from line_item'),
		stmt('delete from donation'),
		stmt('delete from page'),
		stmt('delete from form')
	]);
});

async function stored(pageId: string) {
	const [row] = await db.select().from(page).where(eq(page.id, pageId));
	if (!row) throw new Error(`no page ${pageId}`);
	return row;
}

const documentOf = (text: string | null): PageDocument => JSON.parse(text ?? 'null');

/** a Donation page edited every way Reset puts back, published, with an earlier page kept for Undo. */
const EDITED: PageDocument = {
	...defaultDonationPage(),
	heading: 'Keep Elm Street warm',
	shareMessage: 'Keep Elm Street warm.',
	settings: SETTINGS
};

/** the page as a Publish of `edited` leaves it: live and drafted alike, the default kept for Undo. */
async function publishedEdits(edited: PageDocument = EDITED) {
	const pageId = await insertPage(db, 'donation_page', edited);
	const was = (await stored(pageId)).updatedAt.getTime();
	await db
		.update(page)
		.set({
			lastPublished: JSON.stringify({ ...defaultDonationPage(), settings: SETTINGS }),
			updatedAt: new Date(was + 1_000)
		})
		.where(eq(page.id, pageId));
	return pageId;
}

describe('Reset to default', () => {
	it('puts the current default in the draft and the live page, with no heading or share message of its own and nothing to undo', async () => {
		const pageId = await publishedEdits();

		const outcome = await resetDonationPage(db, (await stored(pageId)).updatedAt);

		expect(outcome).toEqual({ kind: 'reset' });
		const after = await stored(pageId);
		const { settings: _settings, ...published } = documentOf(after.published);
		expect(published).toEqual(defaultDonationPage());
		expect(after.draft).toBe(after.published);
		expect(after.lastPublished).toBeNull();
	});
});

describe('the donation settings through a Reset', () => {
	const SWITCHED = { openOnMonthly: true, dedicationOn: true };

	it('keeps the live settings row and the live switches as they were', async () => {
		const pageId = await publishedEdits({ ...EDITED, switches: SWITCHED });
		const formId = (await stored(pageId)).formId;
		const row = await readForm(db, formId);

		await resetDonationPage(db, (await stored(pageId)).updatedAt);

		expect(await readForm(db, formId)).toEqual(row);
		expect(documentOf((await stored(pageId)).published).switches).toEqual(SWITCHED);
	});

	it('drops an unpublished settings or switch change, starting the draft again from the live ones', async () => {
		const pageId = await publishedEdits({ ...EDITED, switches: SWITCHED });
		const drawn = await stored(pageId);
		const live = await readForm(db, drawn.formId);
		await db
			.update(page)
			.set({
				draft: JSON.stringify({
					...EDITED,
					switches: { openOnMonthly: false, dedicationOn: false },
					settings: { ...SETTINGS, minMinor: 1_000, suggestedAmounts: [4_000] }
				}),
				updatedAt: new Date(drawn.updatedAt.getTime() + 1_000)
			})
			.where(eq(page.id, pageId));

		await resetDonationPage(db, (await stored(pageId)).updatedAt);

		const draft = documentOf((await stored(pageId)).draft);
		expect(draft.switches).toEqual(SWITCHED);
		expect(draft.settings).toEqual({
			revenueAccountId: live?.revenueAccountId,
			minMinor: live?.minMinor,
			maxMinor: live?.maxMinor,
			currency: live?.currency,
			programMode: live?.programMode,
			programId: live?.programId,
			suggestedAmounts: live?.suggestedAmounts,
			allowedOrigins: live?.allowedOrigins
		});
	});
});

describe('a gift made before a Reset', () => {
	it('still points at the same page and settings row', async () => {
		const pageId = await publishedEdits();
		const { formId } = await stored(pageId);
		await expectRecordedAsAForm(db, formId);

		await resetDonationPage(db, (await stored(pageId)).updatedAt);

		const after = await stored(pageId);
		expect(after.formId).toBe(formId);
		const gifts = await db.select({ formId: donation.formId }).from(donation);
		expect(gifts.filter((gift) => gift.formId === formId)).toHaveLength(1);
	});
});

describe('a Reset refused', () => {
	it('on a Donation page with no edits, and nothing moves', async () => {
		const pageId = await insertPage(db, 'donation_page', defaultDonationPage());
		const drawn = await stored(pageId);

		const outcome = await resetDonationPage(db, drawn.updatedAt);

		expect(outcome).toEqual({ kind: 'nothing' });
		expect(await stored(pageId)).toEqual(drawn);
	});

	it('when the page has been written since the editor was drawn, and nothing moves', async () => {
		const pageId = await publishedEdits();
		const drawn = await stored(pageId);
		await db
			.update(page)
			.set({
				draft: JSON.stringify({ ...EDITED, shareMessage: 'Warm coats.' }),
				updatedAt: new Date(drawn.updatedAt.getTime() + 1_000)
			})
			.where(eq(page.id, pageId));
		const written = await stored(pageId);

		const outcome = await resetDonationPage(db, drawn.updatedAt);

		expect(outcome).toEqual({ kind: 'stale' });
		expect(await stored(pageId)).toEqual(written);
	});
});

describe('a Donation page’s edits', () => {
	it('include a live page other than the default under a default draft', async () => {
		const pageId = await insertPage(db, 'donation_page', defaultDonationPage(), EDITED);

		const outcome = await resetDonationPage(db, (await stored(pageId)).updatedAt);

		expect(outcome).toEqual({ kind: 'reset' });
		expect(documentOf((await stored(pageId)).published).heading).toBe('');
	});

	it('include a share message a page chose, on a page that is otherwise the default', async () => {
		const pageId = await insertPage(db, 'donation_page', {
			...defaultDonationPage(),
			shareMessage: 'Join me?'
		});

		const outcome = await resetDonationPage(db, (await stored(pageId)).updatedAt);

		expect(outcome).toEqual({ kind: 'reset' });
		expect(documentOf((await stored(pageId)).draft).shareMessage).toBeUndefined();
	});

	it('include a heading a page chose, on a page that is otherwise the default', async () => {
		const pageId = await insertPage(db, 'donation_page', {
			...defaultDonationPage(),
			heading: 'Give to Elm Street'
		});

		const outcome = await resetDonationPage(db, (await stored(pageId)).updatedAt);

		expect(outcome).toEqual({ kind: 'reset' });
		expect(documentOf((await stored(pageId)).draft).heading).toBe('');
	});

	it('leave out a settings or switch change alone, which Discard changes answers', async () => {
		const pageId = await insertPage(db, 'donation_page', defaultDonationPage());
		const drawn = await stored(pageId);
		await db
			.update(page)
			.set({
				draft: JSON.stringify({
					...defaultDonationPage(),
					switches: { openOnMonthly: true, dedicationOn: false },
					settings: SETTINGS
				}),
				updatedAt: new Date(drawn.updatedAt.getTime() + 1_000)
			})
			.where(eq(page.id, pageId));

		const outcome = await resetDonationPage(db, (await stored(pageId)).updatedAt);

		expect(outcome).toEqual({ kind: 'nothing' });
	});
});
