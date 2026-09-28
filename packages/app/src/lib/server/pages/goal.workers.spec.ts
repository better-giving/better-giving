import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { form, page } from '../db/schema';
import { writeOrgRow } from '../org/org-row.testing';
import { ensureDonationPage } from './donation-page';
import { campaignRaised } from './goal';
import { insertPage } from './page-row.testing';
import { gift, refund, repeatingGift } from './settled-gifts.testing';

// what a campaign's goal bar says it has raised, against the real D1. every gift reaches the books
// through ./settled-gifts.testing.ts, the writers production posts by, so what is summed is what
// they post rather than rows drawn for the read.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	for (const table of [
		'dispute',
		'zapier_delivery',
		'quickbooks_sync',
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
		'recurring_plan',
		'contact',
		'chat_turn',
		'page',
		'form',
		'org_profile'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	await writeOrgRow(env.DB, { tax_id: '12-3456789' });
});

/** a campaign's owned settings row, as `insertPage` makes it. */
async function campaignForm(): Promise<string> {
	const id = await insertPage(db, 'campaign');
	const [row] = await db.select({ formId: page.formId }).from(page).where(eq(page.id, id));
	if (!row) throw new Error(`page ${id} was not written`);
	return row.formId;
}

describe('campaignRaised()', () => {
	it('is a settled gift through the campaign, at its face value, in its currency', async () => {
		const campaign = await campaignForm();
		await gift(db, campaign, 10_000);

		expect(await campaignRaised(db, campaign)).toEqual({ raisedMinor: 10_000, currency: 'USD' });
	});

	it('adds nothing for a gift still pending', async () => {
		const campaign = await campaignForm();
		await gift(db, campaign, 10_000);
		await gift(db, campaign, 5_000, false);

		expect((await campaignRaised(db, campaign)).raisedMinor).toBe(10_000);
	});

	it('takes a refund back off it', async () => {
		const campaign = await campaignForm();
		const refunded = await gift(db, campaign, 10_000);
		await gift(db, campaign, 2_500);
		await refund(db, refunded, 4_000);

		expect((await campaignRaised(db, campaign)).raisedMinor).toBe(8_500);
	});

	it('counts every charge of a repeating gift made through the campaign', async () => {
		const campaign = await campaignForm();
		await repeatingGift(db, campaign, 2_500, 2);

		expect((await campaignRaised(db, campaign)).raisedMinor).toBe(5_000);
	});

	it('is moved by no gift through a form, the Donation page or another campaign', async () => {
		const campaign = await campaignForm();
		const another = await campaignForm();
		const donationPage = (await ensureDonationPage(db)).formId;
		const [embedded] = await db
			.insert(form)
			.values({
				name: 'embedded appeal',
				revenueAccountId: postableId('donationsDeductible'),
				currency: 'USD'
			})
			.returning({ id: form.id });
		if (!embedded) throw new Error('inserting the fixture form returned no row');

		await gift(db, campaign, 1_000);
		for (const elsewhere of [another, donationPage, embedded.id]) {
			await gift(db, elsewhere, 7_000);
			await refund(db, await gift(db, elsewhere, 3_000), 3_000);
			await repeatingGift(db, elsewhere, 2_500, 1);
		}

		expect((await campaignRaised(db, campaign)).raisedMinor).toBe(1_000);
		expect((await campaignRaised(db, another)).raisedMinor).toBe(9_500);
	});
});
