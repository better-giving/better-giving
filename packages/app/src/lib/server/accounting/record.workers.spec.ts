import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chargeEntry, feeEntry, receivedInHandEntry } from '../donations/entries';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import { contact, donation, payment, type PaymentProviderName } from '../db/schema';
import { post, postingStatements, type Posting } from '../ledger/posting';
import type { Settlement } from '../payments/provider';
import { readSendable } from './record';

// what a queued entry group turns out to be, read out of a real D1.
//
// a workers spec because the whole of it is a read across four tables — the entry group, its lines,
// the fee group posted beside it, and the donor the payment reaches through. the entries are built
// by ../donations/entries.ts rather than written out here, so a change to how a gift is recognised
// is a failure here rather than a mapping that quietly stops matching.

let db: Db;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from quickbooks_sync').run();
	await env.DB.prepare('delete from ledger_entry').run();
	await env.DB.prepare('delete from entry_group').run();
	await env.DB.prepare('delete from payment').run();
	await env.DB.prepare('delete from donation').run();
	await env.DB.prepare('delete from contact').run();
});

const OCCURRED_AT = new Date('2026-03-01T22:30:00.000Z');

function settlement(over: Partial<Settlement> = {}): Settlement {
	return {
		providerTxnId: 'ch_notarealcharge',
		status: 'succeeded',
		method: 'card',
		amountMinor: 10_000,
		currency: 'USD',
		feeMinor: 320,
		metadata: {},
		occurredAt: OCCURRED_AT,
		arrival: null,
		...over
	};
}

/** a donor, their gift and the attempt that settled it, as the money path writes them. */
async function gift(
	over: { email?: string | null; displayName?: string; provider?: PaymentProviderName } = {}
) {
	const provider = over.provider ?? 'stripe';
	const contactId = uuidv7();
	const donationId = uuidv7();
	const paymentId = uuidv7();
	await db.batch([
		db.insert(contact).values({
			id: contactId,
			kind: 'individual',
			displayName: over.displayName ?? 'Ada Lovelace',
			primaryEmail: over.email === undefined ? 'ada@example.org' : over.email
		}),
		db.insert(donation).values({
			id: donationId,
			contactId,
			totalMinor: 10_000,
			currency: 'USD',
			receivedAt: OCCURRED_AT
		}),
		db.insert(payment).values({
			id: paymentId,
			donationId,
			amountMinor: 10_000,
			currency: 'USD',
			direction: 'inbound',
			method: provider === 'manual' ? 'check' : 'card',
			status: 'succeeded',
			provider,
			providerTxnId: provider === 'manual' ? null : `txn_${paymentId}`,
			occurredAt: OCCURRED_AT
		})
	]);
	return { contactId, donationId, paymentId };
}

/** the postings a settled charge makes, committed the way every poster commits them. */
async function postGift(
	ids: { donationId: string; paymentId: string },
	over: Partial<Settlement> = {}
) {
	const settled = settlement(over);
	const charged = {
		paymentId: ids.paymentId,
		donationId: ids.donationId,
		revenue: [{ accountId: postableId('donationsDeductible'), amountMinor: settled.amountMinor }]
	} as const;
	const charge = chargeEntry(charged, settled);
	const fee = feeEntry(charged, settled);
	await commit(fee === null ? [charge] : [charge, fee]);
	return { charge, fee };
}

async function commit(postings: readonly Posting[]): Promise<void> {
	const [first, ...rest] = postings.flatMap((posting) => postingStatements(db, posting));
	if (first === undefined) throw new Error('this fixture was handed nothing to write');
	await db.batch([first, ...rest]);
}

describe('a gift', () => {
	it('carries the money at face value, the processor’s cut, and the donor', async () => {
		const ids = await gift();
		const { charge } = await postGift(ids);

		const sendable = await readSendable(db, charge.group.id ?? '');

		expect(sendable).toEqual({
			ok: true,
			value: {
				kind: 'gift',
				gift: {
					key: charge.group.id,
					occurredAt: OCCURRED_AT,
					currency: 'USD',
					donor: { displayName: 'Ada Lovelace', email: 'ada@example.org' },
					memo: `donation ${ids.donationId}`,
					incomeMinor: 10_000,
					feeMinor: 320,
					holding: 'stripeBalance'
				}
			}
		});
	});

	it('is held by PayPal where PayPal settled it', async () => {
		const ids = await gift({ provider: 'paypal' });
		const { charge } = await postGift(ids);

		expect(await readSendable(db, charge.group.id ?? '')).toMatchObject({
			ok: true,
			value: { gift: { holding: 'paypalBalance' } }
		});
	});

	it('is in undeposited funds where it was received in hand', async () => {
		const ids = await gift({ provider: 'manual' });
		const received = receivedInHandEntry({
			paymentId: ids.paymentId,
			donationId: ids.donationId,
			revenueAccountId: postableId('donationsDeductible'),
			amountMinor: 10_000,
			currency: 'USD',
			dated: OCCURRED_AT
		});
		await commit([received]);

		expect(await readSendable(db, received.group.id ?? '')).toMatchObject({
			ok: true,
			value: { gift: { holding: 'undepositedFunds', feeMinor: 0 } }
		});
	});

	it('refuses a gift in processor clearing that no processor settled', async () => {
		const ids = await gift({ provider: 'manual' });
		const { charge } = await postGift(ids, { feeMinor: null });

		expect(await readSendable(db, charge.group.id ?? '')).toMatchObject({
			ok: false,
			reason: 'unmapped_account'
		});
	});

	it('carries no fee where the processor reported none', async () => {
		const ids = await gift();
		const { charge, fee } = await postGift(ids, { feeMinor: null });

		const sendable = await readSendable(db, charge.group.id ?? '');

		// a cheque received in hand never has a fee sibling, and `feeEntry` returns none where the
		// processor reported no figure — so no fee is the ordinary case rather than a missing read.
		expect(fee).toBeNull();
		expect(sendable).toMatchObject({ ok: true, value: { gift: { feeMinor: 0 } } });
	});

	it('carries a donor who left no email', async () => {
		const ids = await gift({ email: null });
		const { charge } = await postGift(ids);

		const sendable = await readSendable(db, charge.group.id ?? '');

		expect(sendable).toMatchObject({
			ok: true,
			value: { gift: { donor: { displayName: 'Ada Lovelace', email: null } } }
		});
	});

	it('sums the funds a split gift credits into the one income figure', async () => {
		const ids = await gift();
		const settled = settlement({ feeMinor: null });
		const charge = chargeEntry(
			{
				paymentId: ids.paymentId,
				donationId: ids.donationId,
				revenue: [
					{ accountId: postableId('donationsDeductible'), amountMinor: 7_500 },
					{ accountId: postableId('donationsNonDeductible'), amountMinor: 2_500 }
				]
			},
			settled
		);
		await commit([charge]);

		// one company account holds what two of this deployment's funds hold, so the split is this
		// app's and the figure that goes over is the gift.
		expect(await readSendable(db, charge.group.id ?? '')).toMatchObject({
			ok: true,
			value: { gift: { incomeMinor: 10_000 } }
		});
	});
});

describe('a correction', () => {
	it('carries each side in the role its account maps to', async () => {
		const correction = post({
			sourceType: 'adjustment',
			sourceId: uuidv7(),
			currency: 'USD',
			occurredAt: new Date('2026-04-30T00:00:00.000Z'),
			memo: 'gift posted to the wrong fund',
			lines: [
				{ accountId: postableId('donationsDeductible'), amountMinor: 2_500 },
				{ accountId: postableId('bankCash'), amountMinor: -2_500 }
			]
		});
		await commit([correction]);

		expect(await readSendable(db, correction.group.id ?? '')).toEqual({
			ok: true,
			value: {
				kind: 'correction',
				correction: {
					key: correction.group.id,
					occurredAt: new Date('2026-04-30T00:00:00.000Z'),
					currency: 'USD',
					memo: 'gift posted to the wrong fund',
					lines: [
						{ role: 'income', posting: 'debit', amountMinor: 2_500 },
						{ role: 'undepositedFunds', posting: 'credit', amountMinor: 2_500 }
					]
				}
			}
		});
	});

	it('refuses one through processor clearing, which no payment says whose it is', async () => {
		const correction = post({
			sourceType: 'adjustment',
			sourceId: uuidv7(),
			currency: 'USD',
			occurredAt: new Date('2026-04-30T00:00:00.000Z'),
			memo: 'fee restated',
			lines: [
				{ accountId: postableId('processorFees'), amountMinor: 40 },
				{ accountId: postableId('undepositedFunds'), amountMinor: -40 }
			]
		});
		await commit([correction]);

		const sendable = await readSendable(db, correction.group.id ?? '');

		// 1020 holds every processor's money at once, and each has its own holding in QuickBooks.
		expect(sendable).toMatchObject({ ok: false, reason: 'unmapped_account', retryable: false });
		expect(sendable).toMatchObject({ detail: expect.stringContaining('Undeposited Funds') });
	});

	it('refuses one that names an account no QuickBooks account stands for', async () => {
		const correction = post({
			sourceType: 'adjustment',
			sourceId: uuidv7(),
			currency: 'USD',
			occurredAt: new Date('2026-04-30T00:00:00.000Z'),
			memo: 'tax owed, wrongly banked',
			lines: [
				{ accountId: postableId('salesTaxPayable'), amountMinor: 2_500 },
				{ accountId: postableId('undepositedFunds'), amountMinor: -2_500 }
			]
		});
		await commit([correction]);

		const sendable = await readSendable(db, correction.group.id ?? '');

		// three accounts are picked on the connection screen and this app's chart has nine, so an
		// entry outside the three has nowhere to land — named, rather than posted somewhere plausible.
		expect(sendable).toMatchObject({ ok: false, reason: 'unmapped_account', retryable: false });
		expect(sendable).toMatchObject({ detail: expect.stringContaining('Sales Tax Payable') });
	});
});

describe('an entry group the delivery should never have been handed', () => {
	it('refuses an id nothing in the books carries', async () => {
		expect(await readSendable(db, uuidv7())).toMatchObject({
			ok: false,
			reason: 'not_found',
			retryable: false
		});
	});

	it('refuses a processor’s cut on its own', async () => {
		const ids = await gift();
		const { fee } = await postGift(ids);

		const sendable = await readSendable(db, fee?.group.id ?? '');

		// the cut is a line on the gift it came with, and ../accounting/outbox.ts queues no row for
		// one — so a `fee` group arriving here is a defect rather than something to send.
		expect(sendable).toMatchObject({ ok: false, reason: 'internal_error', retryable: false });
	});
});
