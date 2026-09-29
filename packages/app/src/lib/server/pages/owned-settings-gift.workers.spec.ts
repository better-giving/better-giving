import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultDonationPage } from '../../page/defaults';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { donation, form, page } from '../db/schema';
import { ensureDonationPage } from './donation-page';
import { expectRecordedAsAForm } from './owned-settings-gift.testing';

// a gift against a page's owned donation-settings row records exactly as a gift through a form.
//
// the page owns a `form` row and nothing in `donation`, `line_item` or `payment` knows a page
// exists, so the claim is that the existing quote-time write takes the owned row's id unchanged.
// ./owned-settings-gift.testing.ts holds the comparison.

let db: Db;
let ownedId: string;

beforeAll(async () => {
	db = createDb(env.DB);
	const [row] = await db
		.insert(form)
		.values({
			name: 'winter coat drive',
			revenueAccountId: postableId('donationsDeductible'),
			currency: 'USD',
			status: 'live'
		})
		.returning({ id: form.id });
	if (!row) throw new Error('inserting the fixture form returned no row');
	ownedId = row.id;
	await db.insert(page).values({
		type: 'campaign',
		name: 'Winter coat drive',
		slug: 'winter-coat-drive',
		state: 'live',
		formId: ownedId,
		draft: '{}',
		published: '{}'
	});
});

describe('a gift against a page-owned settings row', () => {
	it('records against the owned row, exactly as a gift through a form', async () => {
		await expectRecordedAsAForm(db, ownedId);
	});

	it('records against the Donation page made on first need, exactly as a gift through a form', async () => {
		await expectRecordedAsAForm(db, (await ensureDonationPage(db)).formId);
	});

	it('records a dedication through a page with Dedication on by default, kind and honoree as a form’s', async () => {
		const made = await ensureDonationPage(db);
		const published = {
			...defaultDonationPage(),
			switches: { openOnMonthly: false, dedicationOn: true }
		};
		await db
			.update(page)
			.set({ published: JSON.stringify(published) })
			.where(eq(page.id, made.id));

		const donationId = await expectRecordedAsAForm(db, made.formId, {
			kind: 'memory',
			honoree: 'Grace Okafor',
			notify: null
		});

		const [row] = await db
			.select({ kind: donation.tributeKind, honoree: donation.tributeHonoree })
			.from(donation)
			.where(eq(donation.id, donationId));
		expect(row).toEqual({ kind: 'memory', honoree: 'Grace Okafor' });
	});
});
