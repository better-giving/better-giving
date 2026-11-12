import { sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { donation } from '../db/schema';
import { postCorrection } from '../books/correct';
import { recordGiftInHand } from '../donations/record-in-hand';
import { writeOrgRow } from '../org/org-row.testing';
import { ensureDonationPage } from '../pages/donation-page';
import { dispute, noteGift, refund, repeatingGift } from '../pages/settled-gifts.testing';
import { giftNetRaised } from './queries';
import { client, run, stmt } from '$lib/server/db/database.testing';

// what one gift still stands at in the books, read through the scalar subquery the donate page's
// message filter embeds, against the real database. every gift reaches the books through
// ../pages/settled-gifts.testing.ts, the writers production posts by.

let db: Db;
let formId: string;

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
	({ formId } = await ensureDonationPage(db));
});

async function netOf(donationId: string): Promise<number> {
	const [row] = await db.all<{ net: number }>(
		sql`select ${giftNetRaised()} as net from ${donation} where ${donation.id} = ${donationId}`
	);
	if (!row) throw new Error(`donation ${donationId} was not written`);
	return row.net;
}

describe('giftNetRaised()', () => {
	it('is a settled USD gift at its face amount, not net of the processor fee', async () => {
		const { donationId } = await noteGift(db, formId, { amountMinor: 10_000 });

		expect(await netOf(donationId)).toBe(10_000);
	});

	it('is a settled gift in another currency at its face amount in that currency', async () => {
		const { donationId } = await noteGift(db, formId, { amountMinor: 7_000, currency: 'EUR' });

		expect(await netOf(donationId)).toBe(7_000);
	});

	// a guard with no producer: every writer posts in the gift's currency, so only a hand-edited row
	// reaches it. the live other-currency path is the case above.
	it('guard: leaves out a payment whose entries are in a currency other than the gift’s', async () => {
		const { donationId } = await noteGift(db, formId, { amountMinor: 10_000 });
		expect(await netOf(donationId)).toBe(10_000);
		await run(stmt(`update entry_group set currency = 'EUR'`));

		expect(await netOf(donationId)).toBe(0);
	});

	it('is nothing for a gift still pending', async () => {
		const { donationId } = await noteGift(db, formId, { settles: false });

		expect(await netOf(donationId)).toBe(0);
	});

	it('is nothing for a gift refunded in full', async () => {
		const { txn, donationId } = await noteGift(db, formId, { amountMinor: 5_000 });
		await refund(db, txn, 5_000);

		expect(await netOf(donationId)).toBe(0);
	});

	it('is what remains of a gift refunded in part', async () => {
		const { txn, donationId } = await noteGift(db, formId, { amountMinor: 5_000 });
		await refund(db, txn, 1_000);

		expect(await netOf(donationId)).toBe(4_000);
	});

	it('is nothing for a gift withdrawn by a dispute not yet won', async () => {
		const { txn, donationId } = await noteGift(db, formId);
		await dispute(db, txn);

		expect(await netOf(donationId)).toBe(0);
	});

	it('is nothing for a gift withdrawn by a dispute lost', async () => {
		const { txn, donationId } = await noteGift(db, formId);
		await dispute(db, txn, null, 'lost');

		expect(await netOf(donationId)).toBe(0);
	});

	it('is the whole gift again once the dispute over it is won', async () => {
		const { txn, donationId } = await noteGift(db, formId, { amountMinor: 5_000 });
		await dispute(db, txn, null, 'won');

		expect(await netOf(donationId)).toBe(5_000);
	});

	it('is unchanged by a staff correction into the donation accounts', async () => {
		const { donationId } = await noteGift(db, formId, { amountMinor: 10_000 });
		const posted = await postCorrection(db, {
			sourceId: '019fb602-0000-7000-8000-000000000001',
			occurredAt: new Date('2026-09-11T12:00:00.000Z'),
			amountMinor: 2_500,
			outOf: postableId('undepositedFunds'),
			into: postableId('donationsDeductible'),
			note: 'a gift taken in person, never entered.'
		});
		expect(posted).toEqual({ ok: true });
		const [moved] = await db.all<{ total: number }>(
			sql`select sum(amount_minor) as total from ledger_entry where account_id = ${postableId('donationsDeductible')}`
		);
		expect(moved?.total).toBe(-7_500);

		expect(await netOf(donationId)).toBe(10_000);
	});

	it('leaves out the processor fee entry beside the gift in the same entry group', async () => {
		const { donationId } = await noteGift(db, formId, { amountMinor: 10_000 });
		const [fee] = await db.all<{ n: number; total: number }>(
			sql`select count(*) as n, sum(amount_minor) as total from ledger_entry where account_id = ${postableId('processorFees')}`
		);

		expect(fee).toEqual({ n: 1, total: 150 });
		expect(await netOf(donationId)).toBe(10_000);
	});

	it('is each collected charge of a repeating gift at its own amount, none carrying another’s', async () => {
		await repeatingGift(db, formId, 2_000, 3);
		const gifts = await db.all<{ id: string }>(sql`select id from donation`);
		const nets = await Promise.all(gifts.map((gift) => netOf(gift.id)));

		expect(nets).toEqual([2_000, 2_000, 2_000]);
	});

	it('takes only the part disputed while the dispute is open or lost, and all of it back once won', async () => {
		const open = await noteGift(db, formId, { amountMinor: 5_000 });
		await dispute(db, open.txn, 2_000);
		const lost = await noteGift(db, formId, { amountMinor: 5_000 });
		await dispute(db, lost.txn, 2_000, 'lost');
		const won = await noteGift(db, formId, { amountMinor: 5_000 });
		await dispute(db, won.txn, 2_000, 'won');

		expect(await netOf(open.donationId)).toBe(3_000);
		expect(await netOf(lost.donationId)).toBe(3_000);
		expect(await netOf(won.donationId)).toBe(5_000);
	});

	it('is what a refund leaves of a gift whose dispute was won', async () => {
		const { txn, donationId } = await noteGift(db, formId, { amountMinor: 5_000 });
		await dispute(db, txn, null, 'won');
		await refund(db, txn, 1_000);

		expect(await netOf(donationId)).toBe(4_000);
	});

	it('is what two refunds leave of one gift', async () => {
		const { txn, donationId } = await noteGift(db, formId, { amountMinor: 5_000 });
		await refund(db, txn, 1_000);
		await refund(db, txn, 1_500);

		expect(await netOf(donationId)).toBe(2_500);
	});

	it('counts a gift entered in hand at its own amount', async () => {
		const donor = parseContact({
			kind: 'individual',
			first_name: 'Bo',
			last_name: 'Hand',
			primary_email: 'bo@example.org'
		});
		if (!donor.ok) throw new Error('the fixture donor did not parse');
		const handId = '019fb600-0000-7000-8000-000000000001';
		const recorded = await recordGiftInHand(db, {
			donationId: handId,
			paymentId: '019fb601-0000-7000-8000-000000000001',
			donor: { kind: 'new', contact: donor.value },
			amountMinor: 3_000,
			dated: new Date('2026-09-12T12:00:00.000Z'),
			method: 'check',
			programId: null,
			source: null
		});
		expect(recorded.ok).toBe(true);
		expect(await netOf(handId)).toBe(3_000);
	});
});
