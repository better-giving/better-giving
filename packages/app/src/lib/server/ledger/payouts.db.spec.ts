import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { POSTING_ACCOUNTS } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { client } from '../db/database.testing';
import { rejectionCode } from '../db/rejection.testing';
import { entryGroup, ledgerEntry } from '../db/schema';
import {
	type PayoutReturned,
	type PayoutSettled,
	payoutReturnedPosting,
	payoutSettledPosting
} from './payouts';
import { PostingError, type Posting, postingStatements } from './posting';

const SETTLED: PayoutSettled = {
	payout_id: 'po_1',
	amount: 125_000,
	currency: 'USD',
	settled_at: '2026-11-02T15:00:00Z',
	payment_ids: ['pay_a', 'pay_b']
};

const RETURNED: PayoutReturned = {
	return_id: 'ret_1',
	payout_id: 'po_1',
	amount: 20_000,
	currency: 'USD',
	returned_at: '2026-11-09T09:30:00Z'
};

/** each line's account and signed amount, in posting order. */
const lines = (posting: Posting) => posting.lines.map((l) => [l.accountId, l.amountMinor]);

describe('the posting a payout makes', () => {
	let db: Db;
	beforeAll(() => {
		db = createDb(client);
	});

	async function rowCounts() {
		const [groups] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
		const [entries] = await db.select({ n: sql<number>`count(*)` }).from(ledgerEntry);
		return { groups: groups!.n, entries: entries!.n };
	}

	it('books a settled payout as bank cash against grant income, for its amount alone', async () => {
		const posting = payoutSettledPosting(SETTLED);
		expect(posting.group.sourceType).toBe('payout');
		expect(posting.group.sourceId).toBe('settled:po_1');
		expect(posting.group.occurredAt).toEqual(new Date('2026-11-02T15:00:00Z'));
		expect(lines(posting)).toEqual([
			[POSTING_ACCOUNTS.bankCash.id, 125_000],
			[POSTING_ACCOUNTS.grantIncome.id, -125_000]
		]);
		expect(posting.lines.reduce((t, l) => t + l.amountMinor, 0)).toBe(0);
		// the payments a payout names are the sponsor's bookkeeping, never a second figure.
		expect(lines(payoutSettledPosting({ ...SETTLED, payment_ids: [] }))).toEqual(lines(posting));

		const before = await rowCounts();
		await db.batch(postingStatements(db, posting));
		expect(await rowCounts()).toEqual({ groups: before.groups + 1, entries: before.entries + 2 });
	});

	it('refuses the same payout settling twice and writes nothing', async () => {
		const settled = { ...SETTLED, payout_id: 'po_twice' };
		await db.batch(postingStatements(db, payoutSettledPosting(settled)));

		const before = await rowCounts();
		expect(
			await rejectionCode(() => db.batch(postingStatements(db, payoutSettledPosting(settled))))
		).toContain('SQLITE_CONSTRAINT_UNIQUE');
		expect(await rowCounts()).toEqual(before);
	});

	it('reverses a return out of grant income, once per return id', async () => {
		const posting = payoutReturnedPosting(RETURNED);
		expect(posting.group.sourceType).toBe('payout');
		expect(posting.group.sourceId).toBe('returned:ret_1');
		expect(posting.group.occurredAt).toEqual(new Date('2026-11-09T09:30:00Z'));
		expect(lines(posting)).toEqual([
			[POSTING_ACCOUNTS.grantIncome.id, 20_000],
			[POSTING_ACCOUNTS.bankCash.id, -20_000]
		]);

		const second = { ...RETURNED, return_id: 'ret_2', amount: 30_000 };
		const before = await rowCounts();
		await db.batch(postingStatements(db, posting));
		await db.batch(postingStatements(db, payoutReturnedPosting(second)));
		expect(await rowCounts()).toEqual({ groups: before.groups + 2, entries: before.entries + 4 });

		const after = await rowCounts();
		expect(
			await rejectionCode(() => db.batch(postingStatements(db, payoutReturnedPosting(second))))
		).toContain('SQLITE_CONSTRAINT_UNIQUE');
		expect(await rowCounts()).toEqual(after);
	});

	it('keeps a payout id and a return id that share a string apart', async () => {
		const before = await rowCounts();
		await db.batch(postingStatements(db, payoutSettledPosting({ ...SETTLED, payout_id: 'same' })));
		await db.batch(
			postingStatements(db, payoutReturnedPosting({ ...RETURNED, return_id: 'same' }))
		);
		expect((await rowCounts()).groups).toBe(before.groups + 2);
	});

	it('posts a lowercase currency uppercase', () => {
		expect(payoutSettledPosting({ ...SETTLED, currency: 'usd' }).group.currency).toBe('USD');
		expect(payoutReturnedPosting({ ...RETURNED, currency: 'usd' }).group.currency).toBe('USD');
	});

	it('refuses a negative amount, which would invert the entry', () => {
		expect(() => payoutSettledPosting({ ...SETTLED, amount: -100 })).toThrow(RangeError);
		expect(() => payoutReturnedPosting({ ...RETURNED, amount: -100 })).toThrow(RangeError);
	});

	it('refuses an empty payout or return id, whose prefixed key would still be non-empty', () => {
		expect(() => payoutSettledPosting({ ...SETTLED, payout_id: '' })).toThrow(
			expect.objectContaining({ code: 'empty_source_id' })
		);
		expect(() => payoutReturnedPosting({ ...RETURNED, return_id: '' })).toThrow(
			expect.objectContaining({ code: 'empty_source_id' })
		);
	});

	it('refuses a zero amount as the ledger does', () => {
		for (const make of [
			() => payoutSettledPosting({ ...SETTLED, amount: 0 }),
			() => payoutReturnedPosting({ ...RETURNED, amount: 0 })
		]) {
			expect(make).toThrow(PostingError);
			expect(make).toThrow(expect.objectContaining({ code: 'zero_amount' }));
		}
	});
});
