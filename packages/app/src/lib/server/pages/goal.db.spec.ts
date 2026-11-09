import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { form, page } from '../db/schema';
import { postCorrection } from '../books/correct';
import { recordGiftInHand } from '../donations/record-in-hand';
import { parseContact } from '../contacts/contact-input';
import { writeOrgRow } from '../org/org-row.testing';
import { ensureDonationPage } from './donation-page';
import { campaignRaised, organisationRaised } from './goal';
import { insertPage } from './page-row.testing';
import { gift, refund, repeatingGift } from './settled-gifts.testing';
import { client, run, stmt } from '$lib/server/db/database.testing';

// what a campaign's goal bar says it has raised, against the real database. every gift reaches the books
// through ./settled-gifts.testing.ts, the writers production posts by, so what is summed is what
// they post rather than rows drawn for the read.

let db: Db;

beforeAll(() => {
	db = createDb(client);
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
		'page',
		'form',
		'org_profile'
	]) {
		await run(stmt(`delete from ${table}`));
	}
	await writeOrgRow(client, { tax_id: '12-3456789' });
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

describe('organisationRaised()', () => {
	it('is a settled gift at its face value, counted once', async () => {
		const donationPage = (await ensureDonationPage(db)).formId;
		await gift(db, donationPage, 10_000);

		expect(await organisationRaised(db, 'USD')).toEqual({ raisedMinor: 10_000, gifts: 1 });
	});

	it('is nothing from no gifts', async () => {
		expect(await organisationRaised(db, 'USD')).toEqual({ raisedMinor: 0, gifts: 0 });
	});

	it('sums and counts every settled gift through every page and form, a refund taken off', async () => {
		const donationPage = (await ensureDonationPage(db)).formId;
		const campaign = await campaignForm();
		await gift(db, donationPage, 10_000);
		await gift(db, campaign, 2_500);
		await refund(db, await gift(db, campaign, 4_000), 1_000);
		await repeatingGift(db, donationPage, 1_500, 2);

		expect(await organisationRaised(db, 'USD')).toEqual({ raisedMinor: 18_500, gifts: 5 });
	});

	it('counts no gift still pending and none given back in full', async () => {
		const donationPage = (await ensureDonationPage(db)).formId;
		await gift(db, donationPage, 10_000);
		await gift(db, donationPage, 5_000, false);
		await refund(db, await gift(db, donationPage, 3_000), 3_000);

		expect(await organisationRaised(db, 'USD')).toEqual({ raisedMinor: 10_000, gifts: 1 });
	});

	it('is read again on every ask, so the next gift moves it', async () => {
		const donationPage = (await ensureDonationPage(db)).formId;
		await gift(db, donationPage, 10_000);
		expect(await organisationRaised(db, 'USD')).toEqual({ raisedMinor: 10_000, gifts: 1 });

		await gift(db, donationPage, 2_000);

		expect(await organisationRaised(db, 'USD')).toEqual({ raisedMinor: 12_000, gifts: 2 });
	});

	it('adds no gift in another currency', async () => {
		await gift(db, (await ensureDonationPage(db)).formId, 10_000);

		expect(await organisationRaised(db, 'EUR')).toEqual({ raisedMinor: 0, gifts: 0 });
	});

	it('adds only the gifts in the asked currency, and leaves the other currency out of the sum', async () => {
		const donationPage = (await ensureDonationPage(db)).formId;
		await gift(db, donationPage, 10_000);
		await gift(db, donationPage, 7_000, true, 'EUR');

		expect(await organisationRaised(db, 'USD')).toEqual({ raisedMinor: 10_000, gifts: 1 });
		expect(await organisationRaised(db, 'EUR')).toEqual({ raisedMinor: 7_000, gifts: 1 });
	});

	it('adds a hand correction into the donation accounts to no figure', async () => {
		const donationPage = (await ensureDonationPage(db)).formId;
		await gift(db, donationPage, 10_000);
		const posted = await postCorrection(db, {
			sourceId: crypto.randomUUID(),
			occurredAt: new Date('2026-09-15T00:00:00.000Z'),
			amountMinor: 2_500,
			outOf: postableId('undepositedFunds'),
			into: postableId('donationsDeductible'),
			note: 'a gift that never posted'
		});
		expect(posted).toEqual({ ok: true });

		expect(await organisationRaised(db, 'USD')).toEqual({ raisedMinor: 10_000, gifts: 1 });
	});

	it('adds a gift entered in hand', async () => {
		const donationPage = (await ensureDonationPage(db)).formId;
		await gift(db, donationPage, 10_000);
		const donor = parseContact({
			kind: 'individual',
			first_name: 'Bo',
			last_name: 'Hand',
			primary_email: 'bo@example.org'
		});
		if (!donor.ok) throw new Error('the fixture donor did not parse');
		const recorded = await recordGiftInHand(db, {
			donationId: '019fb600-0000-7000-8000-000000000001',
			paymentId: '019fb601-0000-7000-8000-000000000001',
			donor: { kind: 'new', contact: donor.value },
			amountMinor: 3_000,
			dated: new Date('2026-09-12T12:00:00.000Z'),
			method: 'check',
			programId: null,
			source: null
		});
		expect(recorded.ok).toBe(true);

		expect(await organisationRaised(db, 'USD')).toEqual({ raisedMinor: 13_000, gifts: 2 });
	});
});
