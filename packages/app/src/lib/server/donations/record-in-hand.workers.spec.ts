import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { donation, entryGroup, ledgerEntry } from '../db/schema';
import { parseContact, type ParsedContact } from '../contacts/contact-input';
import { listContacts, readDonorSummary } from '../contacts/queries';
import { findEntryGroup } from '../ledger/queries';
import { listDonations, readGiftsByMonth } from './queries';
import { recordGiftInHand, type GiftInHand } from './record-in-hand';

// the hand-entry write, against a real D1 and read back through the screens' own reads.
//
// every assertion goes through a read some screen already makes — the gifts list, the monthly
// figures, the donor file, the books — because the claim is that the one payment row this writes
// makes each of them correct without a change to any. per-file storage, so writes accumulate down
// the file; every case keys its reads to its own ids or to a month no other case dates a gift in.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

/** a donor, through the parser rather than around it — `ParsedContact` is branded. */
function newDonor(firstName: string, email: string | null): ParsedContact {
	const parsed = parseContact({
		kind: 'individual',
		first_name: firstName,
		last_name: 'Okafor',
		primary_email: email ?? ''
	});
	if (!parsed.ok) throw new Error(`the fixture donor did not parse: ${JSON.stringify(parsed)}`);
	return parsed.value;
}

let sequence = 0;

/** one gift in hand, with whatever this case needs replaced. */
function gift(over: Partial<GiftInHand> = {}): GiftInHand {
	sequence += 1;
	const n = String(sequence).padStart(12, '0');
	return {
		donationId: `019fb600-0000-7000-8000-${n}`,
		paymentId: `019fb601-0000-7000-8000-${n}`,
		donor: { kind: 'new', contact: newDonor('Ada', `hand${sequence}@example.org`) },
		amountMinor: 5_000,
		dated: new Date('2026-09-10T12:00:00.000Z'),
		method: 'check',
		programId: null,
		source: null,
		...over
	};
}

describe('recordGiftInHand() — what the screens read back', () => {
	it('reads as completed on the gifts list rather than pending', async () => {
		const input = gift();

		const result = await recordGiftInHand(db, input);

		expect(result.ok).toBe(true);
		const { donations } = await listDonations(db);
		expect(donations.find((row) => row.id === input.donationId)?.status).toBe('completed');
	});

	it('counts in the month the gift is dated, not the month it was entered', async () => {
		const input = gift({ dated: new Date('2019-03-15T09:00:00.000Z') });

		await recordGiftInHand(db, input);

		const months = await readGiftsByMonth(db);
		expect(months.find((row) => row.month === '2019-03')?.gifts).toBe(1);
	});
});

describe('recordGiftInHand() — the books', () => {
	it('debits Bank / Cash and credits deductible revenue by the one figure, dated as the gift', async () => {
		const input = gift({ amountMinor: 7_500, dated: new Date('2020-06-01T00:00:00.000Z') });

		await recordGiftInHand(db, input);

		const group = await findEntryGroup(db, 'payment', input.paymentId);
		expect(group?.occurredAt).toEqual(input.dated);
		const lines = await db
			.select({ accountId: ledgerEntry.accountId, amountMinor: ledgerEntry.amountMinor })
			.from(ledgerEntry)
			.where(eq(ledgerEntry.entryGroupId, group?.id ?? ''));
		expect(lines).toHaveLength(2);
		expect(lines).toEqual(
			expect.arrayContaining([
				{ accountId: postableId('bankCash'), amountMinor: 7_500 },
				{ accountId: postableId('donationsDeductible'), amountMinor: -7_500 }
			])
		);
	});

	it('records no fee, on the gift or in the books', async () => {
		const input = gift();

		await recordGiftInHand(db, input);

		expect(await findEntryGroup(db, 'fee', input.paymentId)).toBeNull();
		const [stored] = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(stored?.feeMinor).toBe(0);
	});
});

describe('recordGiftInHand() — one press is one gift', () => {
	it('records the same ids once, and says the second was already recorded', async () => {
		const input = gift();

		await recordGiftInHand(db, input);
		const again = await recordGiftInHand(db, input);

		expect(again).toEqual({ ok: false, reason: 'already_recorded' });
		const rows = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(rows).toHaveLength(1);
		const groups = await db
			.select()
			.from(entryGroup)
			.where(eq(entryGroup.sourceId, input.paymentId));
		expect(groups).toHaveLength(1);
	});
});

describe('recordGiftInHand() — the donor', () => {
	it('creates a new donor, who then counts in the donor file and its monthly figures', async () => {
		const input = gift({
			amountMinor: 12_300,
			dated: new Date('2021-02-14T12:00:00.000Z'),
			donor: { kind: 'new', contact: newDonor('Grace', 'grace.hand@example.org') }
		});

		const result = await recordGiftInHand(db, input);

		if (!result.ok) throw new Error(`expected the gift to be recorded: ${JSON.stringify(result)}`);
		expect(result.donorWasCreated).toBe(true);
		const row = await donorRow(result.contactId);
		expect(row).toMatchObject({ displayName: 'Grace Okafor', gifts: 1, given: 12_300 });
		const summary = await readDonorSummary(db, new Date('2021-02-20T00:00:00.000Z'));
		expect(summary.thisMonth).toBe(1);
	});

	it('files the gift under a donor the operator picked', async () => {
		const first = await recordGiftInHand(
			db,
			gift({ donor: { kind: 'new', contact: newDonor('Lin', 'lin.hand@example.org') } })
		);
		if (!first.ok) throw new Error('expected the first gift to be recorded');

		const second = await recordGiftInHand(
			db,
			gift({ amountMinor: 1_000, donor: { kind: 'existing', contactId: first.contactId } })
		);

		expect(second).toEqual({ ok: true, contactId: first.contactId, donorWasCreated: false });
		expect(await donorRow(first.contactId)).toMatchObject({ gifts: 2, given: 6_000 });
	});

	it('writes the operator’s words to the source, never to the donor’s note', async () => {
		const input = gift({ source: 'gala envelope', programId: null });

		await recordGiftInHand(db, input);

		const [stored] = await db.select().from(donation).where(eq(donation.id, input.donationId));
		expect(stored).toMatchObject({ source: 'gala envelope', note: null, formId: null });
	});
});

/** one donor's row in the donor file, read the way the donor screen reads it. */
async function donorRow(contactId: string) {
	for (let page = 1; ; page += 1) {
		const read = await listContacts(db, { sort: 'name', dir: 'asc', page, view: 'all' });
		const found = read.contacts.find((row) => row.id === contactId);
		if (found || page >= read.pages) return found;
	}
}
