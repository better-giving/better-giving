import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { donation, form, lineItem, page, payment } from '../db/schema';
import { recordDonation, type RecordDonationInput } from '../donations/record';
import { ensureDonationPage } from './donation-page';

// a gift against a page's owned donation-settings row records exactly as a gift through a form.
//
// the page owns a `form` row and nothing in `donation`, `line_item` or `payment` knows a page
// exists, so the claim is that the existing quote-time write takes the owned row's id unchanged.
// the two gifts below differ in their form and their own ids and in nothing else they store.

const FUND = postableId('donationsDeductible');

let db: Db;
let formId: string;
let ownedId: string;

async function settingsRow(name: string): Promise<string> {
	const [row] = await db
		.insert(form)
		.values({ name, revenueAccountId: FUND, currency: 'USD', status: 'live' })
		.returning({ id: form.id });
	if (!row) throw new Error('inserting the fixture form returned no row');
	return row.id;
}

beforeAll(async () => {
	db = createDb(env.DB);
	formId = await settingsRow('embedded appeal');
	ownedId = await settingsRow('winter coat drive');
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

let sequence = 0;

function gift(through: string): RecordDonationInput {
	sequence += 1;
	const donor = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		primary_email: 'ada@example.org'
	});
	if (!donor.ok) throw new Error(`the fixture donor did not parse: ${JSON.stringify(donor)}`);
	return {
		donationId: `019fc700-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
		donor: donor.value,
		formId: through,
		origin: null,
		currency: 'USD',
		processor: 'stripe',
		totalMinor: 5_000,
		feeMinor: 175,
		lines: [{ label: 'Donation', revenueAccountId: FUND, amountMinor: 5_000 }],
		method: 'card',
		providerTxnId: `pi_owned_${sequence}`,
		occurredAt: new Date('2026-09-28T12:00:00.000Z'),
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null
	};
}

/** what one recorded gift stored, minus the ids and write times that tell any two gifts apart. */
async function stored(donationId: string) {
	const [gift] = await db.select().from(donation).where(eq(donation.id, donationId));
	const lines = await db.select().from(lineItem).where(eq(lineItem.donationId, donationId));
	const payments = await db.select().from(payment).where(eq(payment.donationId, donationId));
	if (!gift) throw new Error(`gift ${donationId} was not written`);
	const { id: _id, formId: _form, createdAt: _at, ...rest } = gift;
	return {
		gift: rest,
		lines: lines.map(({ id: _l, donationId: _d, ...line }) => line),
		payments: payments.map(
			({ id: _p, donationId: _d, providerTxnId: _t, createdAt: _c, ...p }) => p
		)
	};
}

/** a gift against `owned` and one through the plain form, stored alike but for the form. */
async function expectRecordedAsAForm(owned: string) {
	const throughForm = await recordDonation(db, gift(formId));
	const throughPage = await recordDonation(db, gift(owned));
	if (!throughForm.ok || !throughPage.ok) {
		throw new Error(`expected both gifts recorded: ${JSON.stringify([throughForm, throughPage])}`);
	}

	const [row] = await db
		.select({ formId: donation.formId })
		.from(donation)
		.where(eq(donation.id, throughPage.value.donationId));
	expect(row).toEqual({ formId: owned });
	expect(await stored(throughPage.value.donationId)).toEqual(
		await stored(throughForm.value.donationId)
	);
}

describe('a gift against a page-owned settings row', () => {
	it('records against the owned row, exactly as a gift through a form', async () => {
		await expectRecordedAsAForm(ownedId);
	});

	it('records against the Donation page made on first need, exactly as a gift through a form', async () => {
		await expectRecordedAsAForm((await ensureDonationPage(db)).formId);
	});
});
