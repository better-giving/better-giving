import { describe, expect, it } from 'vitest';
import { postableId } from '../db/accounts';
import type { PostingLine } from '../ledger/posting';
import { reinstatementEntry, reversalEntry } from './entries';

// the two entries a refund makes, as pure arithmetic over the gift's own posted lines. the writer
// that reads those lines and commits the result is ./reverse.ts, and ./reverse.workers.spec.ts is
// where the whole path is held against a real D1; this file is the rounding, which is where a
// cent goes missing without anything reading wrong.

const UNDEPOSITED = postableId('undepositedFunds');
const FUND_A = postableId('donationsDeductible');
const FUND_B = postableId('donationsNonDeductible');

/** a gift's own charge group: one debit for what settled, a credit per fund its lines name. */
function charged(...credits: number[]): PostingLine[] {
	const funds = [FUND_A, FUND_B, postableId('bankCash')];
	return [
		{ accountId: UNDEPOSITED, amountMinor: credits.reduce((a, b) => a + b, 0) },
		...credits.map((c, i) => ({ accountId: funds[i] ?? FUND_A, amountMinor: -c }))
	];
}

const REFUND = { currency: 'USD', occurredAt: new Date('2026-09-01T00:00:00.000Z') } as const;

function refundOf(original: readonly PostingLine[], amountMinor: number, alreadyRefundedMinor = 0) {
	return reversalEntry(
		{ refundPaymentId: 'r-1', donationId: 'd-1', original, alreadyRefundedMinor },
		{ ...REFUND, amountMinor }
	);
}

/** the lines of an entry as `[account, amount]`, in the order they were built. */
function linesOf(entry: ReturnType<typeof refundOf>) {
	return entry.lines.map((l) => [l.accountId, l.amountMinor]);
}

describe('reversalEntry()', () => {
	it('negates the gift’s own lines exactly on a full refund', () => {
		const entry = refundOf(charged(6_000, 4_000), 10_000);

		expect(linesOf(entry)).toEqual([
			[UNDEPOSITED, -10_000],
			[FUND_A, 6_000],
			[FUND_B, 4_000]
		]);
	});

	it('is keyed to the refund’s own payment row, on the refund’s date', () => {
		const entry = refundOf(charged(10_000), 2_500);

		expect(entry.group).toMatchObject({
			sourceType: 'refund',
			sourceId: 'r-1',
			currency: 'USD',
			occurredAt: REFUND.occurredAt
		});
	});

	it('takes a partial refund off every fund in proportion', () => {
		const entry = refundOf(charged(6_000, 4_000), 2_500);

		expect(linesOf(entry)).toEqual([
			[UNDEPOSITED, -2_500],
			[FUND_A, 1_500],
			[FUND_B, 1_000]
		]);
	});

	it('gives the cent a share left over to the fund with the largest remainder', () => {
		// 30% and 70% of one cent: the second fund's claim to it is larger, whatever the order.
		const entry = refundOf(charged(3_000, 7_000), 1);

		expect(linesOf(entry)).toEqual([
			[UNDEPOSITED, -1],
			[FUND_B, 1]
		]);
	});

	it('gives a tied cent to the earlier line', () => {
		// a third each of a dollar: 33 apiece and one cent over, which no fund has a larger claim to.
		const entry = refundOf(charged(1_000, 1_000, 1_000), 100);

		expect(linesOf(entry)).toEqual([
			[UNDEPOSITED, -100],
			[FUND_A, 34],
			[FUND_B, 33],
			[postableId('bankCash'), 33]
		]);
	});
});

describe('reversalEntry() — refunds that add up to the whole gift', () => {
	it('takes each fund back exactly to nothing, however the cents fell on the way', () => {
		const gift = charged(3_334, 3_333, 3_333);

		const first = refundOf(gift, 5_000);
		const second = refundOf(gift, 5_000, 5_000);

		const net = new Map<string, number>();
		for (const line of [...gift, ...first.lines, ...second.lines]) {
			net.set(line.accountId, (net.get(line.accountId) ?? 0) + line.amountMinor);
		}
		expect([...net.values()]).toEqual([0, 0, 0, 0]);
	});

	it('takes the second of two halves off where the first left it', () => {
		const second = refundOf(charged(3_334, 3_333, 3_333), 5_000, 5_000);

		// the first half took 1667, 1667 and 1666; what is left of each fund is the second half.
		expect(linesOf(second)).toEqual([
			[UNDEPOSITED, -5_000],
			[FUND_A, 1_667],
			[FUND_B, 1_666],
			[postableId('bankCash'), 1_667]
		]);
	});
});

describe('reinstatementEntry()', () => {
	it('mirrors the refund’s own lines under the refund row’s payment group', () => {
		const withdrawal = refundOf(charged(6_000, 4_000), 2_500);

		const entry = reinstatementEntry(
			{ refundPaymentId: 'r-1', donationId: 'd-1', withdrawn: withdrawal.lines },
			REFUND
		);

		expect(entry.group).toMatchObject({ sourceType: 'payment', sourceId: 'r-1' });
		expect(linesOf(entry)).toEqual([
			[UNDEPOSITED, 2_500],
			[FUND_A, -1_500],
			[FUND_B, -1_000]
		]);
	});
});
