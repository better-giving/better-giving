import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { client, run, stmt } from '../db/database.testing';
import type { EmailProvider } from '../email/provider';
import { DONOR, markFiled, nameEmployer, voidMatch } from './match';
import { sendOwedPack } from './pack';
import { filingDetailsText, readGiftPage, readStaffMatch } from './views';

// what the donor's gift page and the staff gift detail are read from, against a real database.

const CONTACT_ID = '019fba00-0000-7000-8000-000000000001';
const STAFF = '01HSTAFFMEMBER000000000001';
const T0 = new Date('2026-11-12T12:00:00.000Z');
const T1 = new Date('2026-11-16T12:00:00.000Z');

let db: Db;
let next = 0;
const fresh = () => `019fba00-0000-7000-8000-1000000000${String(++next).padStart(2, '0')}`;

const profile = (address: boolean) =>
	run(
		stmt(
			`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
			                          address_line2, city, region, postal_code, country, created_at, updated_at)
			 values ('default', 'Greenfield Food Bank Inc.', '12-3456789', 'No goods or services.',
			         ?, 'Suite 200', 'Cincinnati', 'OH', '45202', ?, 0, 0)`,
			address ? '1250 Mill Street' : null,
			address ? 'United States' : null
		)
	);

/** a gift with a match row; settled where `settled` says. answers its id and token. */
async function gift(settled = true): Promise<{ donationId: string; token: string }> {
	const donationId = fresh();
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, fee_minor, received_at, receipt_sent_at, created_at)
			 values (?, ?, 15000, 'USD', 0, ?, ?, 0)`,
			donationId,
			CONTACT_ID,
			T0.getTime(),
			T0.getTime()
		)
	);
	await run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
			 values (?, ?, 15000, 'USD', 'inbound', 'card', ?, ?, 0)`,
			fresh(),
			donationId,
			settled ? 'succeeded' : 'pending',
			T0.getTime()
		)
	);
	const token = `${String(next).padStart(4, '0')}abcdefghjkmnpqrstvwxyz012345`;
	await run(
		stmt(
			'insert into gift_match (id, donation_id, token, created_at) values (?, ?, ?, 0)',
			fresh(),
			donationId,
			token
		)
	);
	return { donationId, token };
}

beforeAll(async () => {
	db = createDb(client);
	await run(
		stmt(
			`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
			 values (?, 'individual', 'Maya Reyes', 'maya.reyes@example.com', 0, 0)`,
			CONTACT_ID
		)
	);
});

beforeEach(async () => {
	await run(stmt('delete from org_profile'));
	await profile(true);
});

describe('the gift page', () => {
	it('shows the filing details with the nonprofit as filer', async () => {
		const { token } = await gift();

		const page = await readGiftPage(db, token, true);

		expect(page?.filing).toEqual({
			nonprofit: 'Greenfield Food Bank Inc.',
			ein: '12-3456789',
			mailingAddress: '1250 Mill Street, Suite 200, Cincinnati, OH 45202, United States',
			amountMinor: 15_000,
			givenMinor: 15_000,
			currency: 'USD',
			givenAt: T0,
			receiptSentAt: T0,
			receiptEmail: 'maya.reyes@example.com'
		});
		expect(page).toMatchObject({ status: null, employer: null, voidedAt: null, refundedAt: null });
	});

	it('is no gift for an unknown token', async () => {
		expect(await readGiftPage(db, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', true)).toBeNull();
	});

	it('is no gift until the gift reaches the books', async () => {
		const { token } = await gift(false);
		expect(await readGiftPage(db, token, true)).toBeNull();
	});

	it('leaves the mailing address out where the profile has none', async () => {
		await run(stmt('delete from org_profile'));
		await profile(false);
		const { token } = await gift();

		const page = await readGiftPage(db, token, true);

		expect(page?.filing.mailingAddress).toBeNull();
	});

	it('names the employer and the stamps, never the void reason or who voided it', async () => {
		const { donationId, token } = await gift();
		await nameEmployer(db, { donationId }, 'Northwind Logistics');
		await voidMatch(db, { donationId }, STAFF, 'Donor asked us to stop', T1);

		const page = await readGiftPage(db, token, true);

		expect(page).toMatchObject({ status: 'voided', employer: 'Northwind Logistics', voidedAt: T1 });
		const serialized = JSON.stringify(page);
		expect(serialized).not.toContain('Donor asked us to stop');
		expect(serialized).not.toContain(STAFF);
	});

	it('says when the gift was refunded whole', async () => {
		const { donationId, token } = await gift();
		await refunded(donationId, 5_000, T0);
		await refunded(donationId, 10_000, T1);

		const page = await readGiftPage(db, token, true);

		expect(page).toMatchObject({ refundedAt: T1, filing: { amountMinor: 0, givenMinor: 15_000 } });
	});

	it('shows what is left of a gift partly refunded, and calls it no refund', async () => {
		const { donationId, token } = await gift();
		await refunded(donationId, 5_000, T1);

		const page = await readGiftPage(db, token, true);

		expect(page).toMatchObject({
			refundedAt: null,
			filing: { amountMinor: 10_000, givenMinor: 15_000 }
		});
		expect(page?.copyText).toContain('Gift amount: USD 100.00 after refunds, of USD 150.00 given');
	});

	it('takes nothing off for a dispute still open, and calls a lost one no refund', async () => {
		const { donationId, token } = await gift();
		const withdrawal = await refunded(donationId, 15_000, T1);
		await run(
			stmt('insert into dispute (payment_id, created_at, updated_at) values (?, 0, 0)', withdrawal)
		);

		expect(await readGiftPage(db, token, true)).toMatchObject({
			refundedAt: null,
			filing: { amountMinor: 15_000 }
		});

		await run(stmt(`update dispute set outcome = 'lost', closed_at = ?`, T1.getTime()));

		expect(await readGiftPage(db, token, true)).toMatchObject({
			refundedAt: null,
			filing: { amountMinor: 0 }
		});
	});
});

describe('the reminder the gift page promises', () => {
	const ORIGIN = 'https://give.example.org';
	const email: EmailProvider = { send: async () => ({ ok: true }) };

	/** a gift with an employer named and its pack sent at `T0` on an origin pinned or not. */
	async function packed(pinned: boolean) {
		const named = await gift();
		await nameEmployer(db, { donationId: named.donationId }, 'Northwind Logistics');
		await sendOwedPack({ db, email, giftOrigin: { origin: ORIGIN, pinned } }, named.donationId, T0);
		return named;
	}

	it('is promised once the pack went on a pinned address, while a pinned sweep runs', async () => {
		const { token } = await packed(true);

		expect((await readGiftPage(db, token, true))?.reminderPromised).toBe(true);
		expect((await readGiftPage(db, token, false))?.reminderPromised).toBe(false);
	});

	it('is not promised where the pack went on the request’s host', async () => {
		const { token } = await packed(false);
		expect((await readGiftPage(db, token, true))?.reminderPromised).toBe(false);
	});

	it('is not promised before any pack, once it went, or once the gift is filed', async () => {
		const unsent = await gift();
		await nameEmployer(db, { donationId: unsent.donationId }, 'Northwind Logistics');
		const reminded = await packed(true);
		await run(
			stmt(
				'update gift_match set reminded_at = ? where donation_id = ?',
				T1.getTime(),
				reminded.donationId
			)
		);
		const filed = await packed(true);
		await markFiled(db, { donationId: filed.donationId }, DONOR, T1);

		for (const { token } of [unsent, reminded, filed]) {
			expect((await readGiftPage(db, token, true))?.reminderPromised).toBe(false);
		}
	});
});

/** `amountMinor` of `donationId` sent back at `at`, succeeded; answers the refund row's id. */
async function refunded(donationId: string, amountMinor: number, at: Date): Promise<string> {
	const id = fresh();
	await run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status, occurred_at, created_at)
			 values (?, ?, ?, 'USD', 'refund', 'card', 'succeeded', ?, 0)`,
			id,
			donationId,
			amountMinor,
			at.getTime()
		)
	);
	return id;
}

describe('the copied details', () => {
	const filing = {
		nonprofit: 'Greenfield Food Bank Inc.',
		ein: '12-3456789',
		mailingAddress: '1250 Mill Street, Cincinnati, OH 45202, United States',
		amountMinor: 15_000,
		givenMinor: 15_000,
		currency: 'USD',
		givenAt: T0,
		receiptSentAt: T0,
		receiptEmail: 'maya.reyes@example.com'
	};

	it('are every row as plain text', () => {
		expect(filingDetailsText(filing)).toBe(
			[
				'Nonprofit: Greenfield Food Bank Inc.',
				'EIN: 12-3456789',
				'Mailing address: 1250 Mill Street, Cincinnati, OH 45202, United States',
				'Gift amount: USD 150.00',
				'Gift date: November 12, 2026',
				'Receipt: Emailed to maya.reyes@example.com on November 12, 2026'
			].join('\n')
		);
	});

	it('drop the mailing address row where it is blank', () => {
		const text = filingDetailsText({ ...filing, mailingAddress: null });
		expect(text).not.toContain('Mailing address');
		expect(text.split('\n')).toHaveLength(5);
	});
});

describe('the staff gift detail', () => {
	it('carries the history with who and when, and the void reason', async () => {
		const { donationId } = await gift();
		await nameEmployer(db, { donationId }, 'Northwind Logistics');
		await run(
			stmt('update gift_match set pack_sent_at = ? where donation_id = ?', T0.getTime(), donationId)
		);
		await markFiled(db, { donationId }, DONOR, T1);
		await voidMatch(db, { donationId }, STAFF, 'Duplicate gift', new Date(T1.getTime() + 1));

		const detail = await readStaffMatch(db, donationId);

		expect(detail?.gift).toMatchObject({
			donorName: 'Maya Reyes',
			donorEmail: 'maya.reyes@example.com',
			amountMinor: 15_000,
			method: 'card',
			status: 'completed',
			receiptSentAt: T0
		});
		expect(detail?.match).toEqual({
			status: 'voided',
			employer: 'Northwind Logistics',
			history: [
				{ event: 'pack_sent', who: { kind: 'system' }, at: T0 },
				{ event: 'filed', who: { kind: 'donor' }, at: T1 },
				{
					event: 'voided',
					who: { kind: 'staff', userId: STAFF },
					at: new Date(T1.getTime() + 1),
					reason: 'Duplicate gift'
				}
			]
		});
		expect(detail?.mailingAddressMissing).toBe(false);
	});

	it('keeps the gift as given after a partial refund', async () => {
		const { donationId } = await gift();
		await refunded(donationId, 5_000, T1);

		expect((await readStaffMatch(db, donationId))?.gift).toMatchObject({
			amountMinor: 15_000,
			status: 'partially_refunded'
		});
	});

	it('says the mailing address is missing, and carries no match for a gift recorded before it', async () => {
		await run(stmt('delete from org_profile'));
		await profile(false);
		const { donationId } = await gift();
		await run(stmt('delete from gift_match where donation_id = ?', donationId));

		const detail = await readStaffMatch(db, donationId);

		expect(detail).toMatchObject({ match: null, mailingAddressMissing: true });
	});

	it('is no gift for an id nothing has', async () => {
		expect(await readStaffMatch(db, fresh())).toBeNull();
	});
});
