import { eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { postableId } from '../db/accounts';
import type { Db } from '../db/client';
import { donation, form, lineItem, payment } from '../db/schema';
import { recordDonation, type RecordDonationInput } from '../donations/record';

// the claim ./owned-settings-gift.workers.spec.ts makes, for any spec holding a page's owned
// settings row: a gift against it records exactly as a gift through a plain form. nothing in
// `donation`, `line_item` or `payment` knows a page exists, so the two gifts differ in their form
// and their own ids and in nothing else they store.
//
// the `.testing.ts` suffix matches no pool's `include` glob (CONTRIBUTING.md → Tests).

const FUND = postableId('donationsDeductible');

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
async function stored(db: Db, donationId: string) {
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

/** a gift against `owned` and one through a plain form made for it, stored alike but for the form. */
export async function expectRecordedAsAForm(db: Db, owned: string): Promise<void> {
	const [plain] = await db
		.insert(form)
		.values({ name: 'embedded appeal', revenueAccountId: FUND, currency: 'USD', status: 'live' })
		.returning({ id: form.id });
	if (!plain) throw new Error('inserting the fixture form returned no row');

	const throughForm = await recordDonation(db, gift(plain.id));
	const throughPage = await recordDonation(db, gift(owned));
	if (!throughForm.ok || !throughPage.ok) {
		throw new Error(`expected both gifts recorded: ${JSON.stringify([throughForm, throughPage])}`);
	}

	const [row] = await db
		.select({ formId: donation.formId })
		.from(donation)
		.where(eq(donation.id, throughPage.value.donationId));
	expect(row).toEqual({ formId: owned });
	expect(await stored(db, throughPage.value.donationId)).toEqual(
		await stored(db, throughForm.value.donationId)
	);
}
