import { env } from 'cloudflare:test';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { listContacts } from '../contacts/queries';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import { entryGroup, ledgerEntry, payment, zapierDelivery } from '../db/schema';
import type { EmailMessage, EmailProvider } from '../email/provider';
import {
	refusing,
	type PaymentResult,
	type Reversal,
	type ReversalRead,
	type Settlement
} from '../payments/provider';
import type { SettleDeps } from './delivery';
import { listDonations } from './queries';
import { recordDonation } from './record';
import { recordReversal } from './reverse';
import { settleDelivery, settleTransaction } from './settle';

// the refund half, against a real D1: what a refund the port has read does to the gift it names.
//
// every case starts from a gift the settlement path itself put in the books, so what is reversed is
// the posting production writes rather than one drawn here. the refund arrives through
// `recordReversal`, the seam below the processor's read — which processor reports a refund, and how,
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

function deps(over: Partial<SettleDeps> = {}): SettleDeps {
	return {
		db,
		provider: refusing('stripe', 'unsupported', 'not part of the refund path'),
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
async function linesOf(sourceType: 'payment' | 'refund' | 'fee', sourceId: string) {
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
	it('queues nothing for QuickBooks and nothing for any Zap', async () => {
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

		expect(await owed()).toEqual(before);
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

	it('answers a refund that has moved no money yet with a 200, and writes nothing', async () => {
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
