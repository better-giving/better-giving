import { env } from 'cloudflare:test';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { listContacts } from '../contacts/queries';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import { dispute, entryGroup, ledgerEntry, payment, zapierDelivery } from '../db/schema';
import type { EmailMessage, EmailProvider } from '../email/provider';
import {
	refusing,
	type PaymentResult,
	type RecurringGiftEnd,
	type Reversal,
	type ReversalRead,
	type Settlement
} from '../payments/provider';
import { soleProcessor } from '../payments/processors.testing';
import type { SettleDeps } from './delivery';
import { listDonations } from './queries';
import { recordDonation } from './record';
import { recordReversal } from './reverse';
import { settleDelivery, settleTransaction } from './settle';

// the refund half, against a real D1: what a refund or a dispute the port has read does to the gift
// it names.
//
// every case starts from a gift the settlement path itself put in the books, so what is reversed is
// the posting production writes rather than one drawn here. the reversal arrives through
// `recordReversal`, the seam below the processor's read — which processor reports one, and how,
// is each adapter's own spec.

const FORM_ID = 'frm_reversepath00001';
const SETTLED_AT = new Date('2026-08-03T12:00:00.000Z');
const REFUNDED_AT = new Date('2026-08-20T15:00:00.000Z');

let db: Db;
let fund: PostableAccountId;

beforeAll(() => {
	db = createDb(env.DB);
	fund = postableId('donationsDeductible');
});

beforeEach(async () => {
	for (const table of [
		'dispute',
		'zapier_delivery',
		'zapier_subscription',
		'quickbooks_sync',
		'quickbooks_connection',
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
		'recurring_plan',
		'contact',
		'form',
		'org_profile'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(FORM_ID, fund)
		.run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.',
		         '1 Main St', 'Springfield', 'US', 'ops@hope.example', 0, 0)`
	).run();
});

/** the mail transport, recording what it was handed. */
function mailer() {
	const sent: EmailMessage[] = [];
	const port: EmailProvider = {
		async send(message) {
			sent.push(message);
			return { ok: true };
		}
	};
	return { port, sent };
}

/** the processor's read of the gift's own charge, which is all the settlement path asks of it. */
function charged(settlement: Settlement): SettleDeps['provider'] {
	return {
		...refusing('stripe', 'unsupported', 'not part of the refund path'),
		readSettlement: async () => ({ ok: true, value: settlement })
	};
}

/** the deps a delivery arrives with; the processors a stop is made through hold `provider` alone. */
function deps(over: Partial<SettleDeps> = {}): SettleDeps {
	const provider =
		over.provider ?? refusing('stripe', 'unsupported', 'not part of the refund path');
	return {
		db,
		provider,
		processors: soleProcessor(provider),
		email: mailer().port,
		...over
	};
}

type GiftOptions = {
	/** what the gift is made of. the total follows from it. */
	readonly lines?: readonly { revenueAccountId: PostableAccountId; amountMinor: number }[];
	/** where the settlement stops: `pending` leaves the gift as the quote wrote it. */
	readonly settles?: boolean;
	/** the processor's fee on the charge. */
	readonly feeMinor?: number | null;
	/** what the processor says settled, where it is not what the lines add up to. */
	readonly settledMinor?: number;
};

/** a gift the settlement path has put in the books, on transaction `pi_1`. */
async function settledGift(options: GiftOptions = {}) {
	const donationId = crypto.randomUUID();
	const lines = (options.lines ?? [{ revenueAccountId: fund, amountMinor: 10_000 }]).map(
		(line) => ({ label: 'Donation', ...line })
	);
	const totalMinor = lines.reduce((total, line) => total + line.amountMinor, 0);
	const donor = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		primary_email: 'ada@example.org'
	});
	if (!donor.ok) throw new Error('the fixture donor did not parse');
	const recorded = await recordDonation(db, {
		donationId,
		donor: donor.value,
		formId: FORM_ID,
		origin: 'https://acme.org',
		currency: 'USD',
		processor: 'stripe',
		totalMinor,
		feeMinor: 0,
		lines,
		method: 'card',
		providerTxnId: 'pi_1',
		occurredAt: new Date('2026-08-01T09:00:00.000Z'),
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null
	});
	if (!recorded.ok) throw new Error(`the fixture gift was not recorded: ${recorded.detail}`);
	if (options.settles !== false) {
		const settled = await settleTransaction(
			deps({
				provider: charged({
					providerTxnId: 'pi_1',
					status: 'succeeded',
					method: 'card',
					amountMinor: options.settledMinor ?? totalMinor,
					currency: 'USD',
					feeMinor: options.feeMinor === undefined ? 320 : options.feeMinor,
					metadata: { donation_id: donationId },
					occurredAt: SETTLED_AT,
					arrival: null
				})
			}),
			{ providerTxnId: 'pi_1', eventId: 'evt_settle' }
		);
		if (!settled.ok || (settled.outcome !== 'posted' && options.settledMinor === undefined)) {
			throw new Error(`the fixture gift did not settle: ${settled.detail}`);
		}
	}
	return { donationId, paymentId: recorded.value.paymentId, contactId: recorded.value.contactId };
}

/** a refund the processor has read back, of the whole `pi_1` charge unless told otherwise. */
function refund(over: Partial<Extract<Reversal, { kind: 'refund' }>> = {}): Reversal {
	return {
		kind: 'refund',
		reversedTxnId: 'pi_1',
		providerReversalId: 're_1',
		amountMinor: 10_000,
		currency: 'USD',
		occurredAt: REFUNDED_AT,
		reversedMetadata: { donation_id: 'named-by-the-charge' },
		feeReturnedMinor: null,
		...over
	};
}

/** the refund-direction rows, oldest first. */
async function refundRows() {
	return db
		.select()
		.from(payment)
		.where(eq(payment.direction, 'refund'))
		.orderBy(payment.createdAt);
}

/** one entry group's lines as `[account, amount]`, sorted, or null where there is no such group. */
async function linesOf(sourceType: 'payment' | 'refund' | 'fee' | 'adjustment', sourceId: string) {
	const [group] = await db
		.select()
		.from(entryGroup)
		.where(and(eq(entryGroup.sourceType, sourceType), eq(entryGroup.sourceId, sourceId)));
	if (!group) return null;
	const lines = await db.select().from(ledgerEntry).where(eq(ledgerEntry.entryGroupId, group.id));
	return lines.map((l) => [l.accountId, l.amountMinor] as const).sort();
}

describe('recordReversal() — a full refund of a settled gift', () => {
	it('writes the refund as its own row, pointing at the payment it reverses', async () => {
		const gift = await settledGift();

		const result = await recordReversal(deps(), refund(), 'evt_r1');

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([
			expect.objectContaining({
				donationId: gift.donationId,
				direction: 'refund',
				status: 'succeeded',
				provider: 'stripe',
				providerTxnId: 're_1',
				amountMinor: 10_000,
				currency: 'USD',
				method: 'card',
				occurredAt: REFUNDED_AT,
				parentPaymentId: gift.paymentId
			})
		]);
	});
});

describe('recordReversal() — the books after a full refund', () => {
	it('posts a refund group that exactly negates the gift’s own lines', async () => {
		const gift = await settledGift();

		await recordReversal(deps(), refund(), 'evt_r1');

		const [row] = await refundRows();
		const charge = (await linesOf('payment', gift.paymentId)) ?? [];
		expect(await linesOf('refund', row?.id ?? '')).toEqual(
			charge.map(([account, amount]) => [account, -amount] as const).sort()
		);
	});
});

/** the gift's status word and the donor's given, as /admin reads them. */
async function asAdminReads(donationId: string) {
	const { donations } = await listDonations(db);
	const { contacts } = await listContacts(db, { sort: 'given', dir: 'desc', page: 1, view: 'all' });
	return {
		status: donations.find((d) => d.id === donationId)?.status,
		given: contacts[0]?.given
	};
}

describe('recordReversal() — what a refund does to the gift and the donor', () => {
	it('reads a gift refunded in full as refunded, and takes it off the donor’s given', async () => {
		const gift = await settledGift();
		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'completed', given: 10_000 });

		await recordReversal(deps(), refund(), 'evt_r1');

		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'refunded', given: 0 });
	});

	it('reads a gift refunded in part as partly refunded, and takes the part off', async () => {
		const gift = await settledGift();

		await recordReversal(deps(), refund({ amountMinor: 2_500 }), 'evt_r1');

		expect(await asAdminReads(gift.donationId)).toEqual({
			status: 'partially_refunded',
			given: 7_500
		});
	});

	it('takes a refund of the whole charge, where the processor names no figure, off the whole gift', async () => {
		const gift = await settledGift();

		await recordReversal(deps(), refund({ amountMinor: null }), 'evt_r1');

		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'refunded', given: 0 });
	});
});

describe('recordReversal() — a partial refund', () => {
	it('comes off every fund the gift credited in proportion, each side summing to the refund', async () => {
		const other = postableId('donationsNonDeductible');
		await settledGift({
			lines: [
				{ revenueAccountId: fund, amountMinor: 6_000 },
				{ revenueAccountId: other, amountMinor: 4_000 }
			]
		});

		await recordReversal(deps(), refund({ amountMinor: 2_500 }), 'evt_r1');

		const [row] = await refundRows();
		expect(await linesOf('refund', row?.id ?? '')).toEqual(
			[
				[postableId('undepositedFunds'), -2_500],
				[fund, 1_500],
				[other, 1_000]
			].sort()
		);
	});

	it('comes out of the account a card gift went into, and leaves the processor’s fee booked', async () => {
		const gift = await settledGift({ feeMinor: 320 });
		const fee = await linesOf('fee', gift.paymentId);

		await recordReversal(deps(), refund({ amountMinor: 4_000 }), 'evt_r1');

		const [row] = await refundRows();
		const refunded = await linesOf('refund', row?.id ?? '');
		expect(refunded).toContainEqual([postableId('undepositedFunds'), -4_000]);
		expect(await linesOf('fee', gift.paymentId)).toEqual(fee);
		expect(fee).toContainEqual([postableId('processorFees'), 320]);
	});
});

/** minor units: what every group in the books nets to on one account. */
async function netOn(accountId: PostableAccountId) {
	const [row] = await db
		.select({ net: sql<number>`coalesce(sum(${ledgerEntry.amountMinor}), 0)` })
		.from(ledgerEntry)
		.where(eq(ledgerEntry.accountId, accountId));
	return row?.net ?? 0;
}

describe('recordReversal() — a refund that gives back part of the gift’s fee', () => {
	it('books what came back inside the refund’s group, so fees and 1020 net to what the processor kept and moved', async () => {
		await settledGift({ feeMinor: 320 });

		await recordReversal(deps(), refund({ feeReturnedMinor: 260 }), 'evt_r1');

		const [row] = await refundRows();
		expect(await linesOf('refund', row?.id ?? '')).toEqual(
			[
				[postableId('undepositedFunds'), -10_000],
				[fund, 10_000],
				[postableId('undepositedFunds'), 260],
				[postableId('processorFees'), -260]
			].sort()
		);
		expect(await netOn(postableId('processorFees'))).toBe(60);
		// the charge put 9,680 in and the refund took 9,740 out of the processor's balance.
		expect(await netOn(postableId('undepositedFunds'))).toBe(9_680 - 9_740);
	});

	it('gives back no more of the fee over two refunds than the gift booked, logging the cap and telling nobody', async () => {
		await settledGift({ feeMinor: 320 });
		const mail = mailer();
		const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await recordReversal(deps(), refund({ amountMinor: 5_000, feeReturnedMinor: 200 }), 'evt_r1');
		await recordReversal(
			deps({ email: mail.port }),
			refund({ providerReversalId: 're_2', amountMinor: 5_000, feeReturnedMinor: 200 }),
			'evt_r2'
		);

		const [, second] = await refundRows();
		expect(await linesOf('refund', second?.id ?? '')).toContainEqual([
			postableId('processorFees'),
			-120
		]);
		expect(await netOn(postableId('processorFees'))).toBe(0);
		expect(logged).toHaveBeenCalledTimes(1);
		expect(mail.sent).toEqual([]);
		logged.mockRestore();
	});

	it('books none of a fee given back on a gift whose fee was never booked, and logs it', async () => {
		const gift = await settledGift({ feeMinor: null });
		const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await recordReversal(deps(), refund({ feeReturnedMinor: 260 }), 'evt_r1');

		const [row] = await refundRows();
		const charge = (await linesOf('payment', gift.paymentId)) ?? [];
		expect(await linesOf('refund', row?.id ?? '')).toEqual(
			charge.map(([account, amount]) => [account, -amount] as const).sort()
		);
		expect(logged).toHaveBeenCalledTimes(1);
		logged.mockRestore();
	});

	it('takes the fee given back again when the refund does not stand', async () => {
		await settledGift({ feeMinor: 320 });
		await recordReversal(deps(), refund({ feeReturnedMinor: 260 }), 'evt_r1');

		await recordReversal(
			deps(),
			{
				kind: 'refund_failed',
				reversedTxnId: 'pi_1',
				providerReversalId: 're_1',
				occurredAt: new Date('2026-08-25T10:00:00.000Z'),
				reversedMetadata: { donation_id: 'named-by-the-charge' }
			},
			'evt_r2'
		);

		const [row] = await refundRows();
		expect(await linesOf('payment', row?.id ?? '')).toEqual(
			[
				[postableId('undepositedFunds'), 10_000],
				[fund, -10_000],
				[postableId('undepositedFunds'), -260],
				[postableId('processorFees'), 260]
			].sort()
		);
		expect(await netOn(postableId('processorFees'))).toBe(320);
	});

	it('books nothing of the fee where the processor reports none given back', async () => {
		const gift = await settledGift({ feeMinor: 320 });

		await recordReversal(deps(), refund({ feeReturnedMinor: 0 }), 'evt_r1');

		const [row] = await refundRows();
		const charge = (await linesOf('payment', gift.paymentId)) ?? [];
		expect(await linesOf('refund', row?.id ?? '')).toEqual(
			charge.map(([account, amount]) => [account, -amount] as const).sort()
		);
		expect(await netOn(postableId('processorFees'))).toBe(320);
	});

	it('refuses a fee given back that is not whole, writing nothing and telling an operator', async () => {
		await settledGift({ feeMinor: 320 });
		const mail = mailer();

		const result = await recordReversal(
			deps({ email: mail.port }),
			refund({ feeReturnedMinor: 12.5 }),
			'evt_r1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		expect(await refundRows()).toEqual([]);
		expect(mail.sent).toHaveLength(1);
	});
});

describe('recordReversal() — a refund delivered twice', () => {
	it('posts once, and answers the second as already posted', async () => {
		await settledGift();
		await recordReversal(deps(), refund(), 'evt_r1');

		const again = await recordReversal(deps(), refund(), 'evt_r2');

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(await refundRows()).toHaveLength(1);
		const [groups] = await db
			.select({ n: sql<number>`count(*)` })
			.from(entryGroup)
			.where(eq(entryGroup.sourceType, 'refund'));
		expect(groups?.n).toBe(1);
	});
});

describe('recordReversal() — a refund of the whole charge, with no figure, delivered twice', () => {
	it('answers the second as already posted and tells nobody', async () => {
		await settledGift();
		await recordReversal(deps(), refund({ amountMinor: null }), 'evt_r1');
		const mail = mailer();

		const again = await recordReversal(
			deps({ email: mail.port }),
			refund({ amountMinor: null }),
			'evt_r2'
		);

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(mail.sent).toEqual([]);
	});
});

describe('recordReversal() — a refund that arrives before its gift', () => {
	it('holds a refund of a gift not recorded yet open, and writes nothing', async () => {
		const result = await recordReversal(deps(), refund(), 'evt_r1');

		expect(result).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await refundRows()).toEqual([]);
	});

	it('holds a refund of a gift not settled yet open, and posts it once the gift settles', async () => {
		const gift = await settledGift({ settles: false });

		const early = await recordReversal(deps(), refund(), 'evt_r1');

		expect(early).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await refundRows()).toEqual([]);

		await settleTransaction(
			deps({
				provider: charged({
					providerTxnId: 'pi_1',
					status: 'succeeded',
					method: 'card',
					amountMinor: 10_000,
					currency: 'USD',
					feeMinor: 320,
					metadata: { donation_id: gift.donationId },
					occurredAt: SETTLED_AT,
					arrival: null
				})
			}),
			{ providerTxnId: 'pi_1', eventId: 'evt_settle' }
		);
		const redelivered = await recordReversal(deps(), refund(), 'evt_r1');

		expect(redelivered).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toHaveLength(1);
	});
});

describe('recordReversal() — a refund of a monthly charge that arrives before the charge', () => {
	it('holds it open on the commitment’s word that the charge is this deployment’s', async () => {
		const result = await recordReversal(
			deps(),
			refund({ reversedTxnId: 'pi_collection_1', reversedMetadata: { interval: 'monthly' } }),
			'evt_r1'
		);

		expect(result).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await refundRows()).toEqual([]);
	});
});

describe('recordReversal() — a refund of a charge this deployment never took', () => {
	it('answers it with a 200 and writes nothing', async () => {
		const result = await recordReversal(deps(), refund({ reversedMetadata: {} }), 'evt_r1');

		expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
		expect(await refundRows()).toEqual([]);
		expect(await db.select().from(entryGroup)).toEqual([]);
	});
});

describe('recordReversal() — a refund of a settled gift the books do not hold', () => {
	/** a gift that settled for less than its lines add up to, which the books could not take. */
	const unposted = () => settledGift({ settledMinor: 9_000 });

	it('writes the refund row alone, posts nothing, and tells an operator', async () => {
		const gift = await unposted();
		const mail = mailer();

		const result = await recordReversal(
			deps({ email: mail.port }),
			refund({ amountMinor: 9_000 }),
			'evt_r1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		expect(await refundRows()).toEqual([
			expect.objectContaining({ status: 'succeeded', parentPaymentId: gift.paymentId })
		]);
		expect(await db.select().from(entryGroup)).toEqual([]);
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
	});

	it('answers the refund delivered again as already posted, and tells nobody twice', async () => {
		await unposted();
		await recordReversal(deps(), refund({ amountMinor: 9_000 }), 'evt_r1');
		const mail = mailer();

		const again = await recordReversal(
			deps({ email: mail.port }),
			refund({ amountMinor: 9_000 }),
			'evt_r2'
		);

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(mail.sent).toEqual([]);
	});
});

describe('recordReversal() — a refund the books cannot take', () => {
	it('refuses a refund in another currency than the gift, writing nothing and telling an operator', async () => {
		const gift = await settledGift();
		const mail = mailer();

		const result = await recordReversal(
			deps({ email: mail.port }),
			refund({ currency: 'EUR', amountMinor: 9_000 }),
			'evt_r1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		expect(await refundRows()).toEqual([]);
		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'completed', given: 10_000 });
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(mail.sent[0]?.text).toContain('EUR');
	});

	it.each([
		['no money at all', { amountMinor: 0 }],
		['an amount that is not whole', { amountMinor: 25.5 }],
		['a currency the ledger will not hold', { currency: 'usd' }],
		['no time it happened', { occurredAt: new Date('nonsense') }],
		['a blank refund id', { providerReversalId: '  ' }],
		['a blank id for the charge it reverses', { reversedTxnId: '' }]
	] as const)(
		'answers a refund with %s rather than throwing, and writes nothing',
		async (_, over) => {
			await settledGift();
			const mail = mailer();

			const result = await recordReversal(deps({ email: mail.port }), refund(over), 'evt_r1');

			expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
			expect(await refundRows()).toEqual([]);
			expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		}
	);
});

describe('recordReversal() — a refund that did not stand', () => {
	/** the processor reporting refund `re_1` failed after it had gone out. */
	const failed = (): Reversal => ({
		kind: 'refund_failed',
		reversedTxnId: 'pi_1',
		providerReversalId: 're_1',
		occurredAt: new Date('2026-08-25T10:00:00.000Z'),
		reversedMetadata: { donation_id: 'named-by-the-charge' }
	});

	it('flips the refund row to cancelled and posts the refund’s exact mirror', async () => {
		await settledGift();
		await recordReversal(deps(), refund({ amountMinor: 2_500 }), 'evt_r1');

		const result = await recordReversal(deps(), failed(), 'evt_r2');

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [row] = await refundRows();
		expect(row?.status).toBe('cancelled');
		const withdrawn = (await linesOf('refund', row?.id ?? '')) ?? [];
		expect(await linesOf('payment', row?.id ?? '')).toEqual(
			withdrawn.map(([account, amount]) => [account, -amount] as const).sort()
		);
	});

	it('gives the gift back its status and the donor back their total', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), refund(), 'evt_r1');

		await recordReversal(deps(), failed(), 'evt_r2');

		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'completed', given: 10_000 });
	});

	it('answers the failure delivered again as already posted, and puts nothing back twice', async () => {
		await settledGift();
		await recordReversal(deps(), refund(), 'evt_r1');
		await recordReversal(deps(), failed(), 'evt_r2');

		const again = await recordReversal(deps(), failed(), 'evt_r3');

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		const [groups] = await db
			.select({ n: sql<number>`count(*)` })
			.from(entryGroup)
			.where(eq(entryGroup.sourceType, 'payment'));
		// the gift's own charge, and one mirror.
		expect(groups?.n).toBe(2);
	});

	it('tells staff once, and writes to nobody else', async () => {
		await settledGift();
		await env.DB.prepare(
			`insert into zapier_subscription (id, trigger, hook_url, created_at, updated_at)
			 values ('019fb6ff-0000-7000-8000-000000000003', 'gift_refunded',
			         'https://hooks.zapier.com/hooks/standard/1/refund/', 0, 0),
			        ('019fb6ff-0000-7000-8000-000000000004', 'new_gift',
			         'https://hooks.zapier.com/hooks/standard/1/gift/', 0, 0)`
		).run();
		await env.DB.prepare('delete from zapier_delivery').run();
		await recordReversal(deps(), refund(), 'evt_r1');
		const mail = mailer();

		await recordReversal(deps({ email: mail.port }), failed(), 'evt_r2');
		await recordReversal(deps({ email: mail.port }), failed(), 'evt_r3');

		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(mail.sent[0]?.text).toContain('re_1');
		const [zaps] = await db.select({ n: sql<number>`count(*)` }).from(zapierDelivery);
		expect(zaps?.n).toBe(0);
	});

	it('answers a failure with no time it happened rather than throwing, and changes nothing', async () => {
		await settledGift();
		await recordReversal(deps(), refund(), 'evt_r1');
		const mail = mailer();

		const result = await recordReversal(
			deps({ email: mail.port }),
			{ ...failed(), occurredAt: new Date('nonsense') },
			'evt_r2'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		const [row] = await refundRows();
		expect(row?.status).toBe('succeeded');
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
	});

	it('answers a failure of a refund never recorded here with a 200, and writes nothing', async () => {
		await settledGift();

		const result = await recordReversal(deps(), failed(), 'evt_r2');

		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(await refundRows()).toEqual([]);
	});

	it('flips a refund the books never held, alone, once', async () => {
		await settledGift({ settledMinor: 9_000 });
		await recordReversal(deps(), refund({ amountMinor: 9_000 }), 'evt_r1');

		const first = await recordReversal(deps(), failed(), 'evt_r2');
		const again = await recordReversal(deps(), failed(), 'evt_r3');

		expect(first).toMatchObject({ ok: true, outcome: 'updated' });
		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		const [row] = await refundRows();
		expect(row?.status).toBe('cancelled');
		expect(await linesOf('payment', row?.id ?? '')).toBeNull();
	});
});

describe('recordReversal() — a refund of one monthly charge', () => {
	it('leaves the monthly gift collecting, and asks the processor to stop nothing', async () => {
		const gift = await settledGift();
		const planId = '019fb900-0000-7000-8000-000000000001';
		await env.DB.prepare(
			`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
			                             status, provider, provider_subscription_id,
			                             provider_customer_id, started_at, next_charge_at,
			                             created_at, updated_at)
			 values (?, ?, ?, 10000, 'USD', 'monthly', 'active', 'stripe', 'sub_1', 'cus_1', ?, ?, 0, 0)`
		)
			.bind(planId, gift.contactId, FORM_ID, SETTLED_AT.getTime(), Date.UTC(2026, 8, 3))
			.run();
		await env.DB.prepare('update donation set recurring_id = ? where id = ?')
			.bind(planId, gift.donationId)
			.run();
		const stops: string[] = [];
		const provider = {
			...refusing('stripe', 'unsupported', 'not part of the refund path'),
			cancelRecurringGift: async (id: string) => {
				stops.push(id);
				return { ok: false, reason: 'unsupported', detail: 'not part of the refund path' } as const;
			}
		};

		const result = await recordReversal(
			deps({ provider }),
			refund({ amountMinor: 10_000 }),
			'evt_r1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const plan = await env.DB.prepare('select status, ended_at from recurring_plan where id = ?')
			.bind(planId)
			.first<{ status: string; ended_at: number | null }>();
		expect(plan).toEqual({ status: 'active', ended_at: null });
		expect(stops).toEqual([]);
	});
});

describe('recordReversal() — what a refund owes QuickBooks and the Zaps', () => {
	it('queues one QuickBooks row for the refund of a queued gift, and nothing for any Zap', async () => {
		await env.DB.prepare(
			`insert into quickbooks_connection (id, realm_id, access_token, access_token_expires_at,
			                                    refresh_token, start_at, created_at, updated_at)
			 values ('quickbooks', '4620816365', 'access', 0, 'refresh', ?, 0, 0)`
		)
			.bind(Date.parse('2026-01-01T00:00:00.000Z'))
			.run();
		await env.DB.prepare(
			`insert into zapier_subscription (id, trigger, hook_url, created_at, updated_at)
			 values ('019fb6ff-0000-7000-8000-000000000005', 'gift_refunded',
			         'https://hooks.zapier.com/hooks/standard/1/refund/', 0, 0),
			        ('019fb6ff-0000-7000-8000-000000000006', 'new_gift',
			         'https://hooks.zapier.com/hooks/standard/1/gift/', 0, 0)`
		).run();
		const gift = await settledGift();
		const owed = async () => ({
			quickbooks: (await env.DB.prepare('select entry_group_id from quickbooks_sync').all())
				.results,
			zaps: (await env.DB.prepare('select payment_id from zapier_delivery').all()).results
		});
		const before = await owed();
		// the read is live: the gift's own settlement owed both.
		expect(before.quickbooks).toHaveLength(1);
		expect(before.zaps).toEqual([{ payment_id: gift.paymentId }]);

		await recordReversal(deps(), refund(), 'evt_r1');

		const after = await owed();
		const refundGroup = await env.DB.prepare(
			`select id as entry_group_id from entry_group where source_type = 'refund'`
		).first();
		expect(after.quickbooks).toHaveLength(2);
		expect(after.quickbooks).toEqual(expect.arrayContaining([...before.quickbooks, refundGroup]));
		expect(after.zaps).toEqual(before.zaps);
	});
});

describe('settleDelivery() — a delivery about a refund', () => {
	/** a verified refund delivery, and the processor's read of the refund it names. */
	function refundDelivery(read: PaymentResult<ReversalRead>): SettleDeps['provider'] {
		return {
			...refusing('stripe', 'unsupported', 'not part of the refund path'),
			verifyEvent: async () => ({
				ok: true,
				value: {
					id: 'evt_r1',
					kind: 'reversal',
					type: 'refund.created',
					providerNoticeId: 're_1',
					occurredAt: REFUNDED_AT
				}
			}),
			readReversal: async () => read
		};
	}
	const DELIVERY = { body: '{"id":"evt_r1"}', headers: { 'stripe-signature': 't=1,v1=abc' } };

	it('reads the refund it names and records it against the gift', async () => {
		const gift = await settledGift();

		const result = await settleDelivery(
			deps({ provider: refundDelivery({ ok: true, value: refund({ amountMinor: 2_500 }) }) }),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await asAdminReads(gift.donationId)).toEqual({
			status: 'partially_refunded',
			given: 7_500
		});
	});

	it('answers a refund, or a dispute that is an inquiry, that has moved no money yet with a 200, and writes nothing', async () => {
		await settledGift();

		const result = await settleDelivery(
			deps({
				provider: refundDelivery({
					ok: true,
					value: { kind: 'nothing_moved', providerReversalId: 're_1' }
				})
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(await refundRows()).toEqual([]);
	});

	it('holds the delivery open where the refund could not be read for now', async () => {
		await settledGift();

		const result = await settleDelivery(
			deps({
				provider: refundDelivery({ ok: false, reason: 'rate_limited', detail: 'slow down' })
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await refundRows()).toEqual([]);
	});

	it('answers a refund that cannot be read at all with a 200, and tells an operator', async () => {
		await settledGift();
		const mail = mailer();

		const result = await settleDelivery(
			deps({
				email: mail.port,
				provider: refundDelivery({ ok: false, reason: 'not_found', detail: 'no such refund' })
			}),
			DELIVERY
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(mail.sent[0]?.text).toContain('re_1');
	});
});

describe('recordReversal() — an alert whose transport faults', () => {
	it('answers as it would have, with the refund recorded, rather than throwing', async () => {
		await settledGift({ settledMinor: 9_000 });
		const faulting: EmailProvider = {
			async send() {
				throw new Error('the socket went away');
			}
		};

		const result = await recordReversal(
			deps({ email: faulting }),
			refund({ amountMinor: 9_000 }),
			'evt_r1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		expect(await refundRows()).toHaveLength(1);
	});
});

describe('recordReversal() — refunds that add up to the whole gift', () => {
	it('take every fund back exactly to nothing', async () => {
		const [second, third] = [postableId('donationsNonDeductible'), postableId('bankCash')];
		await settledGift({
			lines: [
				{ revenueAccountId: fund, amountMinor: 3_334 },
				{ revenueAccountId: second, amountMinor: 3_333 },
				{ revenueAccountId: third, amountMinor: 3_333 }
			]
		});

		await recordReversal(deps(), refund({ amountMinor: 5_000 }), 'evt_r1');
		await recordReversal(
			deps(),
			refund({ providerReversalId: 're_2', amountMinor: 5_000 }),
			'evt_r2'
		);

		const { results } = await env.DB.prepare(
			`select l.account_id, sum(l.amount_minor) as net from ledger_entry l
			 join entry_group g on g.id = l.entry_group_id
			 where g.source_type in ('payment', 'refund') group by l.account_id`
		).all<{ account_id: string; net: number }>();
		expect(results.map((r) => r.net)).toEqual([0, 0, 0, 0]);
	});

	it('takes a refund of the whole charge with no figure as whatever is left of it', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), refund({ amountMinor: 2_500 }), 'evt_r1');

		await recordReversal(
			deps(),
			refund({ providerReversalId: 're_2', amountMinor: null }),
			'evt_r2'
		);

		expect((await refundRows()).map((r) => r.amountMinor)).toEqual([2_500, 7_500]);
		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'refunded', given: 0 });
	});
});

const DISPUTED_AT = new Date('2026-08-22T08:00:00.000Z');
const RESPOND_BY = new Date('2026-09-05T23:59:59.000Z');

/** a dispute of the whole `pi_1` charge the processor has read back as opened, unless told otherwise. */
function opened(over: Partial<Extract<Reversal, { kind: 'dispute_opened' }>> = {}): Reversal {
	return {
		kind: 'dispute_opened',
		reversedTxnId: 'pi_1',
		providerReversalId: 'dp_1',
		amountMinor: 10_000,
		currency: 'USD',
		occurredAt: DISPUTED_AT,
		reversedMetadata: { donation_id: 'named-by-the-charge' },
		feeMinor: 1_500,
		respondBy: RESPOND_BY,
		reason: 'fraudulent',
		dashboardUrl: 'https://dashboard.stripe.com/disputes/dp_1',
		...over
	};
}

/** every dispute row, with the fields a case reads. */
async function disputeRows() {
	return db
		.select({
			paymentId: dispute.paymentId,
			outcome: dispute.outcome,
			respondBy: dispute.respondBy,
			reason: dispute.reason,
			closedAt: dispute.closedAt
		})
		.from(dispute);
}

describe('recordReversal() — a dispute opened on a settled gift', () => {
	it('withdraws the disputed money as a row of its own with an open dispute on it', async () => {
		const gift = await settledGift();

		const result = await recordReversal(deps(), opened({ amountMinor: 4_000 }), 'evt_d1');

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const rows = await refundRows();
		expect(rows).toEqual([
			expect.objectContaining({
				donationId: gift.donationId,
				direction: 'refund',
				status: 'succeeded',
				providerTxnId: 'dp_1',
				amountMinor: 4_000,
				currency: 'USD',
				occurredAt: DISPUTED_AT,
				parentPaymentId: gift.paymentId
			})
		]);
		expect(await disputeRows()).toEqual([
			{
				paymentId: rows[0]?.id,
				outcome: null,
				respondBy: RESPOND_BY,
				reason: 'fraudulent',
				closedAt: null
			}
		]);
	});

	it('reverses the gift pro rata and books the dispute fee as a processor fee out of 1020', async () => {
		const other = postableId('donationsNonDeductible');
		await settledGift({
			lines: [
				{ revenueAccountId: fund, amountMinor: 6_000 },
				{ revenueAccountId: other, amountMinor: 4_000 }
			]
		});

		await recordReversal(deps(), opened({ amountMinor: 2_500, feeMinor: 1_500 }), 'evt_d1');

		const [row] = await refundRows();
		expect(await linesOf('refund', row?.id ?? '')).toEqual(
			[
				[postableId('undepositedFunds'), -2_500],
				[fund, 1_500],
				[other, 1_000],
				[postableId('processorFees'), 1_500],
				[postableId('undepositedFunds'), -1_500]
			].sort()
		);
	});

	it('takes the disputed money off the donor’s given', async () => {
		const gift = await settledGift();

		await recordReversal(deps(), opened({ amountMinor: 4_000 }), 'evt_d1');

		expect((await asAdminReads(gift.donationId)).given).toBe(6_000);
	});

	it('reads the gift as disputed while the dispute is open, never as refunded', async () => {
		const gift = await settledGift();

		await recordReversal(deps(), opened(), 'evt_d1');

		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'disputed', given: 0 });
	});

	it('reads a gift refunded in part and then disputed as disputed', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), refund({ amountMinor: 3_000 }), 'evt_r1');

		await recordReversal(deps(), opened({ amountMinor: 4_000 }), 'evt_d1');

		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'disputed', given: 3_000 });
	});
});

const PLAN_ID = '019fb900-0000-7000-8000-000000000001';

/** a settled gift collected under monthly plan `sub_1`, still collecting. */
async function monthlyGift() {
	const gift = await settledGift();
	await env.DB.prepare(
		`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
		                             status, provider, provider_subscription_id,
		                             provider_customer_id, started_at, next_charge_at,
		                             created_at, updated_at)
		 values (?, ?, ?, 10000, 'USD', 'monthly', 'active', 'stripe', 'sub_1', 'cus_1', ?, ?, 0, 0)`
	)
		.bind(PLAN_ID, gift.contactId, FORM_ID, SETTLED_AT.getTime(), Date.UTC(2026, 8, 3))
		.run();
	await env.DB.prepare('update donation set recurring_id = ? where id = ?')
		.bind(PLAN_ID, gift.donationId)
		.run();
	return gift;
}

/** the plan's status as the row holds it. */
async function planStatus() {
	return (
		await env.DB.prepare('select status from recurring_plan where id = ?')
			.bind(PLAN_ID)
			.first<{ status: string }>()
	)?.status;
}

/** a processor answering each cancel with the next of `answers`, recording what it was asked to stop. */
function cancelling(...answers: PaymentResult<RecurringGiftEnd>[]) {
	const stops: string[] = [];
	const provider: SettleDeps['provider'] = {
		...refusing('stripe', 'unsupported', 'not part of the dispute path'),
		cancelRecurringGift: async (id) => {
			stops.push(id);
			return (
				answers.shift() ?? { ok: false, reason: 'internal_error', detail: 'asked once too often' }
			);
		}
	};
	return { provider, stops };
}

const CANCELLED: PaymentResult<RecurringGiftEnd> = {
	ok: true,
	value: { providerGiftId: 'sub_1', endedAt: DISPUTED_AT }
};

describe('recordReversal() — a dispute opened on a monthly gift', () => {
	it('stops the monthly plan the gift was collected under', async () => {
		await monthlyGift();
		const processor = cancelling(CANCELLED);

		const result = await recordReversal(deps({ provider: processor.provider }), opened(), 'evt_d1');

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(processor.stops).toEqual(['sub_1']);
		expect(await planStatus()).toBe('cancelled');
	});

	it('holds the delivery open when the stop is refused for now, and stops the plan on the redelivery', async () => {
		await monthlyGift();
		const processor = cancelling(
			{ ok: false, reason: 'rate_limited', detail: 'slow down' },
			CANCELLED
		);

		const first = await recordReversal(deps({ provider: processor.provider }), opened(), 'evt_d1');

		expect(first).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await refundRows()).toHaveLength(1);
		expect(await planStatus()).toBe('active');

		const again = await recordReversal(deps({ provider: processor.provider }), opened(), 'evt_d1');

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(processor.stops).toEqual(['sub_1', 'sub_1']);
		expect(await planStatus()).toBe('cancelled');
		expect(await refundRows()).toHaveLength(1);
	});

	it('tells staff on its own when the stop is refused for good, and still answers 200', async () => {
		await monthlyGift();
		const processor = cancelling({
			ok: false,
			reason: 'invalid_request',
			detail: 'No such subscription owner: acct_9'
		});
		const mail = mailer();

		const result = await recordReversal(
			deps({ provider: processor.provider, email: mail.port }),
			opened(),
			'evt_d1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await planStatus()).toBe('active');
		const stopAlerts = mail.sent.filter((m) => /could not be stopped/i.test(m.subject));
		expect(stopAlerts).toHaveLength(1);
		expect(stopAlerts[0]?.text).toContain('acct_9');
	});
});

describe('recordReversal() — what staff are told when a dispute opens', () => {
	it('tells them once: the amount, when to respond by, where to respond, and how the stop ended', async () => {
		await monthlyGift();
		const processor = cancelling(CANCELLED);
		const mail = mailer();

		await recordReversal(
			deps({ provider: processor.provider, email: mail.port }),
			opened({ amountMinor: 4_000 }),
			'evt_d1'
		);

		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		const text = mail.sent[0]?.text ?? '';
		expect(text).toContain('4000 USD');
		expect(text).toContain('2026-09-05');
		expect(text).toContain('https://dashboard.stripe.com/disputes/dp_1');
		expect(text).toContain('Stopped: no further charges');
	});

	it('answers the dispute delivered again as already posted, and tells nobody twice', async () => {
		await monthlyGift();
		const processor = cancelling(CANCELLED);
		const mail = mailer();
		const delivered = deps({ provider: processor.provider, email: mail.port });
		await recordReversal(delivered, opened(), 'evt_d1');

		const again = await recordReversal(delivered, opened(), 'evt_d2');

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(mail.sent).toHaveLength(1);
		expect(await refundRows()).toHaveLength(1);
		expect(await disputeRows()).toHaveLength(1);
		const [row] = await refundRows();
		expect(await linesOf('refund', row?.id ?? '')).not.toBeNull();
	});
});

/** the processor reporting dispute `dp_1` won. */
function won(over: Partial<Extract<Reversal, { kind: 'dispute_won' }>> = {}): Reversal {
	return {
		kind: 'dispute_won',
		reversedTxnId: 'pi_1',
		providerReversalId: 'dp_1',
		occurredAt: new Date('2026-09-20T10:00:00.000Z'),
		reversedMetadata: { donation_id: 'named-by-the-charge' },
		feeReturnedMinor: null,
		...over
	};
}

describe('recordReversal() — a dispute won', () => {
	it('closes the dispute won, flips the withdrawal to cancelled, and mirrors back its lines but the fee', async () => {
		const other = postableId('donationsNonDeductible');
		await settledGift({
			lines: [
				{ revenueAccountId: fund, amountMinor: 6_000 },
				{ revenueAccountId: other, amountMinor: 4_000 }
			]
		});
		await recordReversal(deps(), opened({ amountMinor: 2_500, feeMinor: 1_500 }), 'evt_d1');

		const result = await recordReversal(deps(), won(), 'evt_d2');

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [row] = await refundRows();
		expect(row?.status).toBe('cancelled');
		expect(await disputeRows()).toEqual([
			expect.objectContaining({ outcome: 'won', closedAt: new Date('2026-09-20T10:00:00.000Z') })
		]);
		expect(await linesOf('payment', row?.id ?? '')).toEqual(
			[
				[postableId('undepositedFunds'), 2_500],
				[fund, -1_500],
				[other, -1_000]
			].sort()
		);
	});

	it('puts the dispute fee back as well where the processor returned it', async () => {
		await settledGift();
		await recordReversal(deps(), opened({ amountMinor: 10_000, feeMinor: 1_500 }), 'evt_d1');

		await recordReversal(deps(), won({ feeReturnedMinor: 1_500 }), 'evt_d2');

		const [row] = await refundRows();
		expect(await linesOf('payment', row?.id ?? '')).toEqual(
			[
				[postableId('undepositedFunds'), 10_000],
				[fund, -10_000],
				[postableId('processorFees'), -1_500],
				[postableId('undepositedFunds'), 1_500]
			].sort()
		);
	});

	it('gives the donor back their given', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), opened({ amountMinor: 4_000 }), 'evt_d1');
		expect((await asAdminReads(gift.donationId)).given).toBe(6_000);

		await recordReversal(deps(), won(), 'evt_d2');

		expect((await asAdminReads(gift.donationId)).given).toBe(10_000);
	});

	it('reads the gift as it read before the dispute', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), opened(), 'evt_d1');

		await recordReversal(deps(), won(), 'evt_d2');

		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'completed', given: 10_000 });
	});

	it('answers the win delivered again as already posted, and puts nothing back twice', async () => {
		await settledGift();
		await recordReversal(deps(), opened(), 'evt_d1');
		await recordReversal(deps(), won(), 'evt_d2');

		const again = await recordReversal(deps(), won(), 'evt_d3');

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		const [groups] = await db
			.select({ n: sql<number>`count(*)` })
			.from(entryGroup)
			.where(eq(entryGroup.sourceType, 'payment'));
		// the gift's own charge, and one mirror.
		expect(groups?.n).toBe(2);
	});

	it('answers a win whose opening was never recorded with a 200, writes nothing, and tells staff the fee', async () => {
		await settledGift();
		const groups = await groupCount();
		const mail = mailer();

		const result = await recordReversal(
			deps({ email: mail.port }),
			won({ feeReturnedMinor: 1_500 }),
			'evt_d2'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		expect(await refundRows()).toEqual([]);
		expect(await disputeRows()).toEqual([]);
		expect(await groupCount()).toBe(groups);
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(mail.sent[0]?.text).toMatch(/dp_1/);
		expect(mail.sent[0]?.text).toMatch(/1500 USD/);
	});

	it('tells staff of a win whose opening was never recorded once per delivery, each answered 200', async () => {
		await settledGift();
		const mail = mailer();

		const first = await recordReversal(deps({ email: mail.port }), won(), 'evt_d2');
		const later = await recordReversal(deps({ email: mail.port }), won(), 'evt_d3');

		expect([first.ok, later.ok]).toEqual([true, true]);
		expect(mail.sent).toHaveLength(2);
		expect(mail.sent[1]?.text).toMatch(/none given back/i);
		expect(await refundRows()).toEqual([]);
	});
});

/** the processor reporting dispute `dp_1` lost, of the whole `pi_1` charge unless told otherwise. */
function lost(over: Partial<Extract<Reversal, { kind: 'dispute_lost' }>> = {}): Reversal {
	return {
		kind: 'dispute_lost',
		reversedTxnId: 'pi_1',
		providerReversalId: 'dp_1',
		amountMinor: 10_000,
		currency: 'USD',
		occurredAt: new Date('2026-09-18T10:00:00.000Z'),
		reversedMetadata: { donation_id: 'named-by-the-charge' },
		feeMinor: 1_500,
		reason: 'fraudulent',
		dashboardUrl: 'https://dashboard.stripe.com/disputes/dp_1',
		...over
	};
}

/** how many entry groups the books hold. */
async function groupCount() {
	const [row] = await db.select({ n: sql<number>`count(*)` }).from(entryGroup);
	return row?.n;
}

describe('recordReversal() — a dispute lost after it opened', () => {
	it('closes the dispute lost and moves no money, leaving the gift reversed', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), opened(), 'evt_d1');
		const groups = await groupCount();

		const result = await recordReversal(deps(), lost(), 'evt_d2');

		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		expect(await disputeRows()).toEqual([
			expect.objectContaining({ outcome: 'lost', closedAt: new Date('2026-09-18T10:00:00.000Z') })
		]);
		expect((await refundRows()).map((r) => r.status)).toEqual(['succeeded']);
		expect(await groupCount()).toBe(groups);
		expect((await asAdminReads(gift.donationId)).given).toBe(0);
	});

	it('reads the gift as refunded', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), opened(), 'evt_d1');

		await recordReversal(deps(), lost(), 'evt_d2');

		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'refunded', given: 0 });
	});

	it('answers the loss delivered again as already posted', async () => {
		await settledGift();
		await recordReversal(deps(), opened(), 'evt_d1');
		await recordReversal(deps(), lost(), 'evt_d2');

		const again = await recordReversal(deps(), lost(), 'evt_d3');

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
	});
});

describe('recordReversal() — a dispute lost after it opened, settling up at the close', () => {
	it('books a fee charged at the close that the opening did not book, out of 1020', async () => {
		await settledGift();
		await recordReversal(deps(), opened({ feeMinor: null }), 'evt_d1');

		const result = await recordReversal(deps(), lost({ feeMinor: 2_000 }), 'evt_d2');

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await disputeRows()).toEqual([expect.objectContaining({ outcome: 'lost' })]);
		const [row] = await refundRows();
		expect(await linesOf('adjustment', row?.id ?? '')).toEqual(
			[
				[postableId('processorFees'), 2_000],
				[postableId('undepositedFunds'), -2_000]
			].sort()
		);
	});

	it('puts back pro rata to the gift’s funds what the close took less than the opening withdrew', async () => {
		const other = postableId('donationsNonDeductible');
		await settledGift({
			lines: [
				{ revenueAccountId: fund, amountMinor: 6_000 },
				{ revenueAccountId: other, amountMinor: 4_000 }
			]
		});
		await recordReversal(deps(), opened({ amountMinor: 10_000 }), 'evt_d1');

		const result = await recordReversal(deps(), lost({ amountMinor: 6_000 }), 'evt_d2');

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [row] = await refundRows();
		expect(await linesOf('adjustment', row?.id ?? '')).toEqual(
			[
				[postableId('undepositedFunds'), 4_000],
				[fund, -2_400],
				[other, -1_600]
			].sort()
		);
	});

	it('lowers the withdrawal to what the close took, so the gift reads partly refunded and the donor gave the rest', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), opened({ amountMinor: 10_000 }), 'evt_d1');
		const [opening] = await refundRows();

		await recordReversal(deps(), lost({ amountMinor: 6_000 }), 'evt_d2');

		expect((await refundRows()).map((r) => r.amountMinor)).toEqual([6_000]);
		expect(await linesOf('refund', opening?.id ?? '')).toContainEqual([
			postableId('undepositedFunds'),
			-10_000
		]);
		expect(await asAdminReads(gift.donationId)).toEqual({
			status: 'partially_refunded',
			given: 4_000
		});
	});

	it('leaves a later dispute of the whole charge only what the close left, taking every fund to nothing', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), opened({ amountMinor: 10_000, feeMinor: null }), 'evt_d1');
		await recordReversal(deps(), lost({ amountMinor: 6_000, feeMinor: null }), 'evt_d2');

		await recordReversal(
			deps(),
			opened({ providerReversalId: 'dp_2', amountMinor: 10_000, feeMinor: null }),
			'evt_d3'
		);

		expect((await refundRows()).map((r) => r.amountMinor)).toEqual([6_000, 4_000]);
		expect(await netByAccount()).toEqual({ [fund]: 0, [postableId('undepositedFunds')]: 0 });
		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'disputed', given: 0 });
	});

	it('changes nothing when a close that lowered the withdrawal is delivered again', async () => {
		await settledGift();
		await recordReversal(deps(), opened({ amountMinor: 10_000 }), 'evt_d1');
		await recordReversal(deps(), lost({ amountMinor: 6_000 }), 'evt_d2');
		const groups = await groupCount();

		const again = await recordReversal(deps(), lost({ amountMinor: 5_000 }), 'evt_d3');

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect((await refundRows()).map((r) => r.amountMinor)).toEqual([6_000]);
		expect(await groupCount()).toBe(groups);
	});

	it('leaves the withdrawal’s amount alone when a win closes the dispute between the loss’s reads and its batch', async () => {
		await settledGift();
		await recordReversal(deps(), opened({ amountMinor: 10_000 }), 'evt_d1');
		let raced = false;
		const racing = new Proxy(db, {
			get(target, property, receiver) {
				if (property !== 'batch' || raced) return Reflect.get(target, property, receiver);
				return async (writes: Parameters<Db['batch']>[0]) => {
					raced = true;
					await recordReversal(deps(), won(), 'evt_d2');
					return target.batch(writes);
				};
			}
		});

		await recordReversal(deps({ db: racing }), lost({ amountMinor: 6_000 }), 'evt_d3');

		expect(await refundRows()).toEqual([
			expect.objectContaining({ amountMinor: 10_000, status: 'cancelled' })
		]);
		expect(await disputeRows()).toEqual([expect.objectContaining({ outcome: 'won' })]);
	});

	it('never raises a withdrawal capped at what a refund left when the close names more', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), refund({ amountMinor: 3_000 }), 'evt_r1');
		await recordReversal(deps(), opened({ amountMinor: 10_000 }), 'evt_d1');

		await recordReversal(deps(), lost({ amountMinor: 10_000 }), 'evt_d2');

		expect((await refundRows()).map((r) => r.amountMinor)).toEqual([3_000, 7_000]);
		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'refunded', given: 0 });
	});

	it('settles the fee and the difference in one group when the close carries both', async () => {
		await settledGift();
		await recordReversal(deps(), opened({ feeMinor: null }), 'evt_d1');

		await recordReversal(deps(), lost({ amountMinor: 6_000, feeMinor: 2_000 }), 'evt_d2');

		const [row] = await refundRows();
		expect(await linesOf('adjustment', row?.id ?? '')).toEqual(
			[
				[postableId('undepositedFunds'), 4_000],
				[fund, -4_000],
				[postableId('processorFees'), 2_000],
				[postableId('undepositedFunds'), -2_000]
			].sort()
		);
	});

	it('posts once when the close is delivered again', async () => {
		await settledGift();
		await recordReversal(deps(), opened({ feeMinor: null }), 'evt_d1');
		await recordReversal(deps(), lost({ feeMinor: 2_000 }), 'evt_d2');
		const groups = await groupCount();

		const again = await recordReversal(deps(), lost({ feeMinor: 2_000 }), 'evt_d3');

		expect(again).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(await groupCount()).toBe(groups);
	});

	it('posts once when two deliveries of the close race, the second refused by its key', async () => {
		await settledGift();
		await recordReversal(deps(), opened({ feeMinor: null }), 'evt_d1');
		let raced = false;
		// the other delivery commits between this delivery's reads and its batch.
		const racing = new Proxy(db, {
			get(target, property, receiver) {
				if (property !== 'batch' || raced) return Reflect.get(target, property, receiver);
				return async (writes: Parameters<Db['batch']>[0]) => {
					raced = true;
					await recordReversal(deps(), lost({ feeMinor: 2_000 }), 'evt_d2');
					return target.batch(writes);
				};
			}
		});

		const second = await recordReversal(deps({ db: racing }), lost({ feeMinor: 2_000 }), 'evt_d3');

		expect(second).toMatchObject({ ok: true, outcome: 'already_posted' });
		const settleUps = await db
			.select({ sourceId: entryGroup.sourceId })
			.from(entryGroup)
			.where(eq(entryGroup.sourceType, 'adjustment'));
		const [row] = await refundRows();
		expect(settleUps).toEqual([{ sourceId: row?.id }]);
		expect(await linesOf('adjustment', row?.id ?? '')).toEqual(
			[
				[postableId('processorFees'), 2_000],
				[postableId('undepositedFunds'), -2_000]
			].sort()
		);
	});

	it('refuses a close in another currency than the gift, writing nothing and telling an operator', async () => {
		await settledGift();
		await recordReversal(deps(), opened({ feeMinor: null }), 'evt_d1');
		const groups = await groupCount();
		const mail = mailer();

		const result = await recordReversal(
			deps({ email: mail.port }),
			lost({ currency: 'EUR', feeMinor: 2_000 }),
			'evt_d2'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		expect(await groupCount()).toBe(groups);
		expect(await disputeRows()).toEqual([expect.objectContaining({ outcome: null })]);
		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]?.text).toMatch(/EUR/);
	});

	it('posts no settle-up where the close carries the opening’s own figures', async () => {
		await settledGift();
		await recordReversal(deps(), opened({ amountMinor: 10_000, feeMinor: 1_500 }), 'evt_d1');

		await recordReversal(deps(), lost({ amountMinor: 10_000, feeMinor: 1_500 }), 'evt_d2');

		const [row] = await refundRows();
		expect(await linesOf('adjustment', row?.id ?? '')).toBeNull();
		expect(await disputeRows()).toEqual([expect.objectContaining({ outcome: 'lost' })]);
	});
});

describe('recordReversal() — a dispute lost with no opening recorded', () => {
	it('writes the opening’s batch with the dispute already lost, and tells staff once', async () => {
		const gift = await settledGift();
		const mail = mailer();

		const result = await recordReversal(
			deps({ email: mail.port }),
			lost({ amountMinor: 4_000 }),
			'evt_d2'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		const [row] = await refundRows();
		expect(row).toMatchObject({ providerTxnId: 'dp_1', amountMinor: 4_000, status: 'succeeded' });
		expect(await disputeRows()).toEqual([
			expect.objectContaining({
				paymentId: row?.id,
				outcome: 'lost',
				closedAt: new Date('2026-09-18T10:00:00.000Z')
			})
		]);
		expect(await linesOf('refund', row?.id ?? '')).toContainEqual([
			postableId('processorFees'),
			1_500
		]);
		expect((await asAdminReads(gift.donationId)).given).toBe(6_000);
		expect(mail.sent.map((m) => m.subject)).toEqual([expect.stringMatching(/dispute was lost/)]);
	});

	it('holds a loss that races the opening open, and closes the dispute on the next delivery', async () => {
		await settledGift();
		let raced = false;
		// the opening's delivery commits between this delivery's reads and its batch.
		const racing = new Proxy(db, {
			get(target, property, receiver) {
				if (property !== 'batch' || raced) return Reflect.get(target, property, receiver);
				return async (writes: Parameters<Db['batch']>[0]) => {
					raced = true;
					await recordReversal(deps(), opened(), 'evt_d1');
					return target.batch(writes);
				};
			}
		});

		const first = await recordReversal(deps({ db: racing }), lost(), 'evt_d2');

		expect(first).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await disputeRows()).toEqual([expect.objectContaining({ outcome: null })]);

		const next = await recordReversal(deps(), lost(), 'evt_d2');

		expect(next).toMatchObject({ ok: true, outcome: 'updated' });
		expect(await disputeRows()).toEqual([expect.objectContaining({ outcome: 'lost' })]);
		expect(await refundRows()).toHaveLength(1);
	});
});

describe('recordReversal() — a dispute won after it was lost', () => {
	it('answers it with a 200, changes nothing, and tells staff', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), opened(), 'evt_d1');
		await recordReversal(deps(), lost(), 'evt_d2');
		const groups = await groupCount();
		const mail = mailer();

		const result = await recordReversal(deps({ email: mail.port }), won(), 'evt_d3');

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		expect(await disputeRows()).toEqual([expect.objectContaining({ outcome: 'lost' })]);
		expect(await groupCount()).toBe(groups);
		expect((await asAdminReads(gift.donationId)).given).toBe(0);
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(mail.sent[0]?.text).toContain('dp_1');
	});
});

describe('recordReversal() — a dispute whose after-steps fault', () => {
	it('answers as it would have when the alert’s transport faults', async () => {
		await monthlyGift();
		const faulting: EmailProvider = {
			async send() {
				throw new Error('the socket went away');
			}
		};

		const result = await recordReversal(
			deps({ provider: cancelling(CANCELLED).provider, email: faulting }),
			opened(),
			'evt_d1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await planStatus()).toBe('cancelled');
	});

	it('answers as it would have when the processor throws on the stop, and tells staff it did not stop', async () => {
		await monthlyGift();
		const provider: SettleDeps['provider'] = {
			...refusing('stripe', 'unsupported', 'not part of the dispute path'),
			cancelRecurringGift: async () => {
				throw new Error('the connection reset');
			}
		};
		const mail = mailer();

		const result = await recordReversal(deps({ provider, email: mail.port }), opened(), 'evt_d1');

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await planStatus()).toBe('active');
		expect(mail.sent.filter((m) => /could not be stopped/i.test(m.subject))).toHaveLength(1);
	});
});

describe('SettleDeps — the processors a disputed gift’s plan is stopped through', () => {
	// refused by `tsc --noEmit` first, which gates CI: the `@ts-expect-error` is the assertion, and
	// one that stopped being needed would itself fail the type check.
	it('does not type-check without them, so a webhook route cannot forget them', () => {
		// @ts-expect-error `processors` is required
		const forgotten: SettleDeps = {
			db,
			provider: refusing('stripe', 'unsupported', 'x'),
			email: mailer().port
		};

		expect(Object.keys(forgotten)).not.toContain('processors');
	});
});

describe('recordReversal() — a dispute lost after it was won', () => {
	it('answers it with a 200, changes nothing, and tells staff', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), opened(), 'evt_d1');
		await recordReversal(deps(), won(), 'evt_d2');
		const groups = await groupCount();
		const mail = mailer();

		const result = await recordReversal(deps({ email: mail.port }), lost(), 'evt_d3');

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		expect(await disputeRows()).toEqual([expect.objectContaining({ outcome: 'won' })]);
		expect(await groupCount()).toBe(groups);
		expect((await asAdminReads(gift.donationId)).given).toBe(10_000);
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
		expect(mail.sent[0]?.text).toContain('dp_1');
	});
});

describe('recordReversal() — a dispute whose details are not usable', () => {
	it('records a respond-by that is no date as none, and still tells staff once', async () => {
		await settledGift();
		const mail = mailer();

		const result = await recordReversal(
			deps({ email: mail.port }),
			opened({ respondBy: new Date('nonsense') }),
			'evt_d1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await disputeRows()).toEqual([expect.objectContaining({ respondBy: null })]);
		expect(mail.sent.map((m) => m.to)).toEqual(['ops@hope.example']);
	});

	it('records a blank reason as none', async () => {
		await settledGift();

		const result = await recordReversal(deps(), opened({ reason: '  ' }), 'evt_d1');

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await disputeRows()).toEqual([expect.objectContaining({ reason: null })]);
	});
});

describe('recordReversal() — a dispute of a settled gift the books do not hold', () => {
	it('writes its row and the dispute alone, tells staff once with what the books hold, and answers a later win', async () => {
		await settledGift({ settledMinor: 9_000 });
		const mail = mailer();

		const result = await recordReversal(
			deps({ email: mail.port }),
			opened({ amountMinor: 9_000 }),
			'evt_d1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		const [row] = await refundRows();
		expect(row).toMatchObject({ providerTxnId: 'dp_1', amountMinor: 9_000 });
		expect(await disputeRows()).toEqual([expect.objectContaining({ outcome: null })]);
		expect(await linesOf('refund', row?.id ?? '')).toBeNull();
		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]?.text).toContain('never posted');

		const win = await recordReversal(deps(), won(), 'evt_d2');

		expect(win).toMatchObject({ ok: true, outcome: 'updated' });
		expect((await refundRows())[0]?.status).toBe('cancelled');
		expect(await linesOf('payment', row?.id ?? '')).toBeNull();
	});
});

describe('recordReversal() — a dispute after a partial refund', () => {
	it('is apportioned against what the refund already took, so the two take every fund back exactly', async () => {
		const [second, third] = [postableId('donationsNonDeductible'), postableId('bankCash')];
		await settledGift({
			lines: [
				{ revenueAccountId: fund, amountMinor: 3_334 },
				{ revenueAccountId: second, amountMinor: 3_333 },
				{ revenueAccountId: third, amountMinor: 3_333 }
			]
		});
		await recordReversal(deps(), refund({ amountMinor: 5_000 }), 'evt_r1');

		const result = await recordReversal(
			deps(),
			opened({ amountMinor: null, feeMinor: null }),
			'evt_d1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect((await refundRows()).map((r) => r.amountMinor)).toEqual([5_000, 5_000]);
		const { results } = await env.DB.prepare(
			`select l.account_id, sum(l.amount_minor) as net from ledger_entry l
			 join entry_group g on g.id = l.entry_group_id
			 where g.source_type in ('payment', 'refund') group by l.account_id`
		).all<{ account_id: string; net: number }>();
		expect(results.map((r) => r.net)).toEqual([0, 0, 0, 0]);
	});
});

/** every account's net over the gift's own groups, every reversal of it, and every settle-up. */
async function netByAccount() {
	const { results } = await env.DB.prepare(
		`select l.account_id, sum(l.amount_minor) as net from ledger_entry l
		 join entry_group g on g.id = l.entry_group_id
		 where g.source_type in ('payment', 'refund', 'adjustment') group by l.account_id`
	).all<{ account_id: string; net: number }>();
	return Object.fromEntries(results.map((r) => [r.account_id, r.net]));
}

describe('recordReversal() — a dispute of the whole charge after a partial refund', () => {
	it('withdraws only what the refund left, so a loss takes every fund to nothing and staff hear of the cap', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), refund({ amountMinor: 3_000 }), 'evt_r1');
		const mail = mailer();

		const result = await recordReversal(
			deps({ email: mail.port }),
			lost({ amountMinor: 10_000, feeMinor: 1_500 }),
			'evt_d1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect((await refundRows()).map((r) => r.amountMinor)).toEqual([3_000, 7_000]);
		expect(await netByAccount()).toEqual({
			[fund]: 0,
			[postableId('undepositedFunds')]: -1_500,
			[postableId('processorFees')]: 1_500
		});
		expect(await asAdminReads(gift.donationId)).toEqual({ status: 'refunded', given: 0 });
		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]?.text).toContain('7000 USD');
		expect(mail.sent[0]?.text).toMatch(/10000 USD.*capped at what was left/s);
	});

	it('puts back, when won, exactly what it took, leaving the gift as the refund left it', async () => {
		const gift = await settledGift();
		await recordReversal(deps(), refund({ amountMinor: 3_000 }), 'evt_r1');
		const afterRefund = await netByAccount();
		await recordReversal(deps(), opened({ amountMinor: 10_000, feeMinor: 1_500 }), 'evt_d1');

		const result = await recordReversal(deps(), won({ feeReturnedMinor: 1_500 }), 'evt_d2');

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await netByAccount()).toEqual({ ...afterRefund, [postableId('processorFees')]: 0 });
		expect(await asAdminReads(gift.donationId)).toEqual({
			status: 'partially_refunded',
			given: 7_000
		});
	});

	it('refuses a dispute of a gift earlier refunds took whole, writing nothing and naming the fee to staff', async () => {
		await settledGift();
		await recordReversal(deps(), refund({ amountMinor: 10_000 }), 'evt_r1');
		const groups = await groupCount();
		const mail = mailer();

		const result = await recordReversal(
			deps({ email: mail.port }),
			opened({ amountMinor: 10_000, feeMinor: 1_500 }),
			'evt_d1'
		);

		expect(result).toMatchObject({ ok: true, outcome: 'unactionable' });
		expect(await refundRows()).toHaveLength(1);
		expect(await groupCount()).toBe(groups);
		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0]?.text).toMatch(/took the whole gift.*1500 USD/s);
	});
});
