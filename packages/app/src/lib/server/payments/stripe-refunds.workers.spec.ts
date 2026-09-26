import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { listContacts } from '../contacts/queries';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import { dispute, entryGroup, payment, recurringPlan } from '../db/schema';
import type { EmailMessage, EmailProvider } from '../email/provider';
import type { SettleResult } from '../donations/delivery';
import { listDonations } from '../donations/queries';
import { recordAuthorizedGift, recordDonation } from '../donations/record';
import { settleDelivery } from '../donations/settle';
import { soleProcessor } from './processors.testing';
import { createStripeProvider } from './stripe';
import { recording, sign, type Recorded } from './stripe.testing';

// a Stripe refund or dispute reaching the books: the signed delivery, the adapter's fresh read of
// the refund or the dispute through the real SDK, and the writer (../donations/reverse.ts) against a
// real D1.
//
// what the writer does with each read is ../donations/reverse.workers.spec.ts's. what is here is
// the join between the two halves, which neither spec can see alone: that the refund Stripe reports
// finds the gift its charge settled, by the id the settlement recorded, and that what is posted is
// what the read returned rather than anything the delivery carried. every gift is put in the books
// by a Stripe delivery too, so both ids come out of the same adapter.

const CREDENTIALS = { secretKey: 'sk_test_notarealkey', webhookSecret: 'whsec_notarealsecret' };
const FORM_ID = 'frm_striperefunds001';
/** when the gift's charge settled, in Stripe's seconds. */
const SETTLED = 1_786_000_000;
/** when the refund was made. */
const REFUNDED = 1_787_000_000;

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
		'quickbooks_sync',
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

/** every mail sent since the case began, or since the case cleared it once its gift was in place. */
let sent: EmailMessage[] = [];
beforeEach(() => {
	sent = [];
});
const recordingMail: EmailProvider = {
	send: async (message) => {
		sent.push(message);
		return { ok: true };
	}
};

/** one Stripe answer, as the recording client hands it to the SDK. */
type Answer = { readonly status: number; readonly json: unknown };

/**
 * one delivery, signed as Stripe signs it, through the settlement path with the adapter answering
 * from `answers`. `object` is the delivery's own copy of the object, which nothing may act on.
 */
async function deliver(
	eventId: string,
	type: string,
	object: Record<string, unknown>,
	answers: readonly Answer[],
	created = REFUNDED
): Promise<{ result: SettleResult; calls: Recorded[] }> {
	const body = JSON.stringify({
		id: eventId,
		object: 'event',
		type,
		created,
		data: { object }
	});
	const { httpClient, calls } = recording(answers);
	const provider = createStripeProvider(CREDENTIALS, { httpClient });
	const result = await settleDelivery(
		{ db, provider, processors: soleProcessor(provider), email: recordingMail },
		{ body, headers: { 'stripe-signature': await sign(body, CREDENTIALS.webhookSecret) } }
	);
	return { result, calls };
}

/** a card charge that settled, as `readSettlement` retrieves it. */
function settledIntent(donationId: string, amount = 10_000) {
	return {
		id: 'pi_1',
		object: 'payment_intent',
		status: 'succeeded',
		amount,
		currency: 'usd',
		created: SETTLED,
		metadata: { donation_id: donationId },
		latest_charge: {
			id: 'ch_1',
			object: 'charge',
			amount,
			created: SETTLED,
			payment_method_details: { type: 'card' },
			balance_transaction: {
				id: 'txn_1',
				object: 'balance_transaction',
				currency: 'usd',
				fee: 320,
				exchange_rate: null,
				created: SETTLED
			}
		}
	};
}

/** a refund of `pi_1`, as the reversal read retrieves it. */
function refundOf(donationId: string, overrides: Record<string, unknown> = {}) {
	return {
		id: 're_1',
		object: 'refund',
		amount: 10_000,
		currency: 'usd',
		created: REFUNDED,
		status: 'succeeded',
		charge: 'ch_1',
		balance_transaction: 'txn_r1',
		metadata: {},
		reason: 'requested_by_customer',
		payment_intent: { id: 'pi_1', object: 'payment_intent', metadata: { donation_id: donationId } },
		...overrides
	};
}

/** a gift quoted on `pi_1` and not yet settled, as the donation endpoint records one. */
async function quotedGift(totalMinor = 10_000): Promise<string> {
	const donationId = crypto.randomUUID();
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
		lines: [{ label: 'Donation', revenueAccountId: fund, amountMinor: totalMinor }],
		method: 'card',
		providerTxnId: 'pi_1',
		occurredAt: new Date(SETTLED * 1000),
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null
	});
	if (!recorded.ok) throw new Error(`the fixture gift was not recorded: ${recorded.detail}`);
	return donationId;
}

/** the quoted gift settled by Stripe's own delivery. */
async function settle(donationId: string, amount = 10_000): Promise<void> {
	const { result } = await deliver(
		'evt_settle',
		'payment_intent.succeeded',
		{ id: 'pi_1', object: 'payment_intent' },
		[{ status: 200, json: settledIntent(donationId, amount) }]
	);
	if (!result.ok || result.outcome !== 'posted') {
		throw new Error(`the fixture gift did not settle: ${result.detail}`);
	}
}

/** a card gift Stripe settled. */
async function settledGift(amount = 10_000): Promise<string> {
	const donationId = await quotedGift(amount);
	await settle(donationId, amount);
	return donationId;
}

/** a refund delivery of `re_1`, with the delivery's own copy of the refund carrying nothing read. */
function refundDelivery(eventId: string, type: string, answers: readonly Answer[]) {
	return deliver(eventId, type, { id: 're_1', object: 'refund' }, answers);
}

/** the gift as the dashboard reads it, and what the donor is counted as having given. */
async function asAdminReads(donationId: string) {
	const { donations } = await listDonations(db);
	const { contacts } = await listContacts(db, { sort: 'given', dir: 'desc', page: 1, view: 'all' });
	return {
		status: donations.find((d) => d.id === donationId)?.status,
		given: contacts[0]?.given
	};
}

/** the refund-direction rows, as `[refund id at Stripe, amount, status]`. */
async function refundRows() {
	const rows = await db
		.select()
		.from(payment)
		.where(eq(payment.direction, 'refund'))
		.orderBy(payment.createdAt);
	return rows.map((row) => [row.providerTxnId, row.amountMinor, row.status] as const);
}

/** how many entry groups a refund row posted. */
async function refundGroups() {
	const rows = await db.select().from(entryGroup).where(eq(entryGroup.sourceType, 'refund'));
	return rows.length;
}

describe('a Stripe refund of a settled card gift', () => {
	it('posts the refund against the gift, which reads refunded', async () => {
		const donationId = await settledGift();

		const { result } = await refundDelivery('evt_r1', 'refund.created', [
			{ status: 200, json: refundOf(donationId) }
		]);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([['re_1', 10_000, 'succeeded']]);
		expect(await refundGroups()).toBe(1);
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
	});
});

describe('Stripe refunds of part of a card gift', () => {
	it('posts each part as a row and a group of its own, and the gift reads partly refunded', async () => {
		const donationId = await settledGift();

		const first = await refundDelivery('evt_r1', 'refund.created', [
			{ status: 200, json: refundOf(donationId, { amount: 2_500 }) }
		]);
		const second = await deliver('evt_r2', 'refund.created', { id: 're_2', object: 'refund' }, [
			{ status: 200, json: refundOf(donationId, { id: 're_2', amount: 3_000 }) }
		]);

		expect(first.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(second.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([
			['re_1', 2_500, 'succeeded'],
			['re_2', 3_000, 'succeeded']
		]);
		expect(await refundGroups()).toBe(2);
		expect(await asAdminReads(donationId)).toEqual({
			status: 'partially_refunded',
			given: 4_500
		});
	});
});

describe('a Stripe refund still pending', () => {
	it('moves nothing and answers 200, and the delivery reporting it succeeded posts it', async () => {
		const donationId = await settledGift();

		const pending = await refundDelivery('evt_r1', 'refund.created', [
			{
				status: 200,
				json: refundOf(donationId, { status: 'pending', pending_reason: 'processing' })
			}
		]);

		expect(pending.result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(await refundRows()).toEqual([]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'completed', given: 10_000 });

		const succeeded = await refundDelivery('evt_r2', 'refund.updated', [
			{ status: 200, json: refundOf(donationId) }
		]);

		expect(succeeded.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
	});
});

describe('a Stripe refund that fails after it succeeded', () => {
	it('restores the gift', async () => {
		const donationId = await settledGift();
		await refundDelivery('evt_r1', 'refund.created', [{ status: 200, json: refundOf(donationId) }]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });

		const { result } = await refundDelivery('evt_r2', 'refund.failed', [
			{
				status: 200,
				json: refundOf(donationId, {
					status: 'failed',
					failure_reason: 'expired_or_canceled_card',
					failure_balance_transaction: {
						id: 'txn_f1',
						object: 'balance_transaction',
						created: REFUNDED + 86_400
					}
				})
			}
		]);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([['re_1', 10_000, 'cancelled']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'completed', given: 10_000 });
	});
});

describe('a Stripe refund delivered twice', () => {
	it('posts once', async () => {
		const donationId = await settledGift();
		const answer = { status: 200, json: refundOf(donationId) };

		await refundDelivery('evt_r1', 'refund.created', [answer]);
		const again = await refundDelivery('evt_r1', 'refund.created', [answer]);

		expect(again.result).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(await refundRows()).toEqual([['re_1', 10_000, 'succeeded']]);
		expect(await refundGroups()).toBe(1);
	});
});

describe('a Stripe refund that arrives before its gift is recorded', () => {
	it('is answered non-2xx, and posted by a delivery after the gift settles', async () => {
		const donationId = await quotedGift();
		const answer = { status: 200, json: refundOf(donationId) };

		const early = await refundDelivery('evt_r1', 'refund.created', [answer]);

		expect(early.result).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await refundRows()).toEqual([]);

		await settle(donationId);
		const later = await refundDelivery('evt_r1', 'refund.created', [answer]);

		expect(later.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
	});
});

describe('a Stripe refund of a charge this deployment never took', () => {
	it('answers 200 and writes nothing', async () => {
		await settledGift();

		const { result } = await deliver('evt_r1', 'refund.created', { id: 're_9', object: 'refund' }, [
			{
				status: 200,
				json: refundOf('', {
					id: 're_9',
					payment_intent: { id: 'pi_elsewhere', object: 'payment_intent', metadata: {} }
				})
			},
			{
				status: 200,
				json: { object: 'list', url: '/v1/invoice_payments', has_more: false, data: [] }
			}
		]);

		expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
		expect(await refundRows()).toEqual([]);
		expect(await refundGroups()).toBe(0);
	});
});

describe('a Stripe refund delivery replayed in an old body shape', () => {
	it('is acted on only through the fresh read', async () => {
		const donationId = await settledGift();

		// the body claims a finished refund of a figure the read does not hold, on an intent that is
		// not the gift's; the read says the refund is still pending.
		const { result } = await deliver(
			'evt_old',
			'refund.updated',
			{
				id: 're_1',
				object: 'refund',
				amount: 99,
				status: 'succeeded',
				charge: 'ch_1',
				payment_intent: 'pi_other'
			},
			[{ status: 200, json: refundOf(donationId, { status: 'pending' }) }]
		);

		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(await refundRows()).toEqual([]);
	});
});

const CONTACT_ID = '019fbb00-0000-7000-8000-000000000001';

/** what `commitmentMetadata` in ./provider.ts writes on the commitment of a monthly gift. */
function commitmentOf(donationId: string) {
	return { donation_id: donationId, interval: 'monthly', gift_minor: '2500', fee_covered: 'false' };
}

/** a monthly gift the donor authorized, which its first collection claims. */
async function authorizedMonthlyGift(): Promise<string> {
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
		 values (?, 'individual', 'Ada Okafor', 'ada@example.org', 0, 0)`
	)
		.bind(CONTACT_ID)
		.run();
	const donationId = crypto.randomUUID();
	const written = await recordAuthorizedGift(db, {
		donationId,
		contactId: CONTACT_ID,
		formId: FORM_ID,
		origin: 'https://acme.org',
		currency: 'USD',
		totalMinor: 2_500,
		feeMinor: 0,
		lines: [{ label: 'Donation', revenueAccountId: fund, amountMinor: 2_500 }],
		note: undefined,
		tribute: null,
		programId: null,
		occurredAt: new Date(SETTLED * 1000)
	});
	if (!written.ok) throw new Error(`the authorized gift was not written: ${written.detail}`);
	return donationId;
}

/** the monthly gift's first collection, settled by Stripe's own `invoice.paid` on `pi_7`. */
async function collect(donationId: string, rail = 'card'): Promise<void> {
	const commitment = commitmentOf(donationId);
	const { result } = await deliver(
		'evt_collect',
		'invoice.paid',
		{ id: 'in_1', object: 'invoice' },
		[
			{
				status: 200,
				json: {
					id: 'in_1',
					object: 'invoice',
					status: 'paid',
					currency: 'usd',
					created: SETTLED,
					parent: {
						type: 'subscription_details',
						subscription_details: {
							metadata: commitment,
							subscription: {
								id: 'sub_1',
								object: 'subscription',
								customer: 'cus_1',
								status: 'active',
								start_date: SETTLED,
								created: SETTLED,
								metadata: commitment,
								items: {
									object: 'list',
									url: '/v1/subscription_items',
									has_more: false,
									data: [
										{
											id: 'si_1',
											object: 'subscription_item',
											current_period_end: SETTLED + 2_592_000,
											price: {
												id: 'price_1',
												object: 'price',
												recurring: { interval: 'month', interval_count: 1 }
											}
										}
									]
								}
							}
						}
					},
					payments: {
						object: 'list',
						url: '/v1/invoice_payments',
						has_more: false,
						data: [invoicePayment()]
					}
				}
			},
			{
				status: 200,
				json: {
					...settledIntent('', 2_500),
					id: 'pi_7',
					metadata: {},
					latest_charge: {
						...settledIntent('', 2_500).latest_charge,
						id: 'ch_7',
						payment_method_details: { type: rail }
					}
				}
			}
		]
	);
	if (!result.ok || result.outcome !== 'posted') {
		throw new Error(`the fixture collection did not settle: ${result.detail}`);
	}
}

/** the attempt that paid `in_1`, as the invoice payments list carries it. */
function invoicePayment(invoice: unknown = 'in_1') {
	return {
		id: 'inpay_1',
		object: 'invoice_payment',
		invoice,
		is_default: true,
		created: SETTLED,
		status: 'paid',
		payment: { type: 'payment_intent', payment_intent: 'pi_7' }
	};
}

/**
 * Stripe's answers to the reversal read of a refund of `pi_7`: the refund, then the invoice payment
 * that says which commitment raised the charge.
 */
function collectionRefund(donationId: string): Answer[] {
	return [
		{
			status: 200,
			json: refundOf(donationId, {
				amount: 2_500,
				charge: 'ch_7',
				payment_intent: { id: 'pi_7', object: 'payment_intent', metadata: {} }
			})
		},
		{
			status: 200,
			json: {
				object: 'list',
				url: '/v1/invoice_payments',
				has_more: false,
				data: [
					invoicePayment({
						id: 'in_1',
						object: 'invoice',
						parent: {
							type: 'subscription_details',
							subscription_details: { metadata: commitmentOf(donationId), subscription: 'sub_1' }
						}
					})
				]
			}
		}
	];
}

describe('a Stripe refund of one monthly charge', () => {
	it('posts against that charge’s gift and leaves the monthly gift collecting', async () => {
		const donationId = await authorizedMonthlyGift();
		await collect(donationId);

		const { result, calls } = await refundDelivery(
			'evt_r1',
			'refund.created',
			collectionRefund(donationId)
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([['re_1', 2_500, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
		const plans = await db.select({ status: recurringPlan.status }).from(recurringPlan);
		expect(plans).toEqual([{ status: 'active' }]);
		// read, and nothing asked of the commitment.
		expect(calls.map((call) => call.method)).toEqual(['GET', 'GET']);
	});
});

describe('a Stripe refund of a monthly charge not recorded yet', () => {
	it('is answered non-2xx on the commitment’s word, and posted by a delivery after the charge is', async () => {
		const donationId = await authorizedMonthlyGift();

		const early = await refundDelivery('evt_r1', 'refund.created', collectionRefund(donationId));

		expect(early.result).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await refundRows()).toEqual([]);

		await collect(donationId);
		const later = await refundDelivery('evt_r1', 'refund.created', collectionRefund(donationId));

		expect(later.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
	});
});

/** when the dispute withdrew the money. */
const DISPUTED = 1_787_500_000;
/** Stripe's deadline to answer it by. */
const RESPOND_BY = 1_788_500_000;
/** when a won dispute's money came back. */
const REINSTATED = 1_789_000_000;
/** when a lost dispute closed: its `charge.dispute.closed` event's `created`. */
const CLOSED = 1_789_500_000;

/** the balance transaction a dispute withdrew `amount` on, with Stripe's dispute fee. */
function withdrawnOn(amount = 10_000, fee = 1_500) {
	return {
		id: 'txn_d1',
		object: 'balance_transaction',
		amount: -amount,
		currency: 'usd',
		fee,
		net: -amount - fee,
		exchange_rate: null,
		created: DISPUTED,
		reporting_category: 'dispute',
		type: 'adjustment'
	};
}

/** the balance transaction a won dispute put `amount` back on, giving back `feeReturned`. */
function reinstatedOn(amount = 10_000, feeReturned = 0) {
	return {
		id: 'txn_d2',
		object: 'balance_transaction',
		amount,
		currency: 'usd',
		fee: -feeReturned,
		net: amount + feeReturned,
		exchange_rate: null,
		created: REINSTATED,
		reporting_category: 'dispute_reversal',
		type: 'adjustment'
	};
}

/**
 * a dispute of `pi_1`'s card charge as the reversal read retrieves it, the charge and the intent
 * expanded: opened, its money withdrawn, unless `overrides` walks it on.
 */
function disputeOf(donationId: string, overrides: Record<string, unknown> = {}) {
	return {
		id: 'du_1',
		object: 'dispute',
		amount: 10_000,
		currency: 'usd',
		created: DISPUTED,
		livemode: true,
		reason: 'fraudulent',
		status: 'needs_response',
		is_charge_refundable: false,
		metadata: {},
		balance_transactions: [withdrawnOn()],
		evidence_details: {
			due_by: RESPOND_BY,
			has_evidence: false,
			past_due: false,
			submission_count: 0
		},
		payment_method_details: { type: 'card', card: { brand: 'visa' } },
		charge: {
			id: 'ch_1',
			object: 'charge',
			amount: 10_000,
			payment_method_details: { type: 'card' }
		},
		payment_intent: { id: 'pi_1', object: 'payment_intent', metadata: { donation_id: donationId } },
		...overrides
	};
}

/**
 * a dispute delivery of `du_1`. the delivery's own copy claims the dispute won, and nothing acts on
 * it: the fresh read decides.
 */
function disputeDelivery(
	eventId: string,
	type: string,
	answers: readonly Answer[],
	created = DISPUTED
) {
	return deliver(eventId, type, { id: 'du_1', object: 'dispute', status: 'won' }, answers, created);
}

/**
 * Stripe's answer to listing the balance transactions sourced to `du_1`: a fee booked on a
 * transaction of its own, beside the dispute's withdrawal and reinstatement, or nothing.
 */
function sourcedTo(...transactions: readonly object[]): Answer {
	return {
		status: 200,
		json: { object: 'list', url: '/v1/balance_transactions', has_more: false, data: transactions }
	};
}

/** the countered fee Stripe charges for answering a dispute, on a transaction of its own. */
function counteredFee(fee = 1_500) {
	return {
		id: 'txn_d3',
		object: 'balance_transaction',
		amount: -fee,
		currency: 'usd',
		fee: 0,
		net: -fee,
		exchange_rate: null,
		created: RESPOND_BY - 86_400,
		reporting_category: 'fee',
		type: 'stripe_fee',
		source: 'du_1'
	};
}

/** the disputes on record, as `[outcome, respond by]`. */
async function disputeRows() {
	const rows = await db.select().from(dispute);
	return rows.map((row) => [row.outcome, row.respondBy] as const);
}

/** what the books hold as processor fees, net, across every group. */
async function processorFees() {
	const row = await env.DB.prepare(
		'select coalesce(sum(amount_minor), 0) as net from ledger_entry where account_id = ?'
	)
		.bind(postableId('processorFees'))
		.first<{ net: number }>();
	return row?.net;
}

/** what staff were sent, leaving out the donor's receipts. */
function toStaff() {
	return sent.filter((message) => message.to === 'ops@hope.example');
}

describe('a Stripe dispute opened on a settled card gift', () => {
	it('reverses the money, books the dispute fee, leaves the dispute open, and tells staff', async () => {
		const donationId = await settledGift();
		sent = [];

		const { result } = await disputeDelivery('evt_d1', 'charge.dispute.funds_withdrawn', [
			{ status: 200, json: disputeOf(donationId) },
			sourcedTo()
		]);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([['du_1', 10_000, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'disputed', given: 0 });
		expect(await processorFees()).toBe(320 + 1_500);
		expect(await disputeRows()).toEqual([[null, new Date(RESPOND_BY * 1000)]]);
		const alerts = toStaff();
		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.text).toContain('10000 USD');
		expect(alerts[0]?.text).toContain(new Date(RESPOND_BY * 1000).toISOString());
		expect(alerts[0]?.text).toContain('https://dashboard.stripe.com/disputes/du_1');
	});
});

/**
 * Stripe's answers to the reversal read of a dispute of `pi_7` — the dispute, then the invoice
 * payment that says which commitment raised the charge — and to the stop of `sub_1` that follows.
 */
function collectionDispute(
	donationId: string,
	overrides: Record<string, unknown> = {},
	rail = 'card'
): Answer[] {
	return [
		{
			status: 200,
			json: disputeOf(donationId, {
				amount: 2_500,
				balance_transactions: [withdrawnOn(2_500)],
				charge: {
					id: 'ch_7',
					object: 'charge',
					amount: 2_500,
					payment_method_details: { type: rail }
				},
				payment_intent: { id: 'pi_7', object: 'payment_intent', metadata: {} },
				...overrides
			})
		},
		sourcedTo(),
		collectionRefund(donationId)[1] as Answer,
		{
			status: 200,
			json: {
				id: 'sub_1',
				object: 'subscription',
				customer: 'cus_1',
				status: 'canceled',
				created: SETTLED,
				canceled_at: DISPUTED,
				ended_at: DISPUTED,
				metadata: commitmentOf(donationId)
			}
		}
	];
}

describe('a Stripe dispute opened on one monthly charge', () => {
	it('stops the monthly gift and says so to staff', async () => {
		const donationId = await authorizedMonthlyGift();
		await collect(donationId);
		sent = [];

		const { result, calls } = await disputeDelivery(
			'evt_d1',
			'charge.dispute.created',
			collectionDispute(donationId)
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await asAdminReads(donationId)).toEqual({ status: 'disputed', given: 0 });
		const plans = await db.select({ status: recurringPlan.status }).from(recurringPlan);
		expect(plans).toEqual([{ status: 'cancelled' }]);
		expect(calls.map((call) => [call.method, call.path.split('?')[0]])).toContainEqual([
			'DELETE',
			'/v1/subscriptions/sub_1'
		]);
		expect(toStaff()).toHaveLength(1);
		expect(toStaff()[0]?.text).toContain('Stopped: no further charges');
	});
});

describe('a Stripe dispute won', () => {
	it('restores the gift and books back the fee Stripe gave back', async () => {
		const donationId = await settledGift();
		await disputeDelivery('evt_d1', 'charge.dispute.funds_withdrawn', [
			{ status: 200, json: disputeOf(donationId) },
			sourcedTo()
		]);

		const { result } = await disputeDelivery('evt_d2', 'charge.dispute.funds_reinstated', [
			{
				status: 200,
				json: disputeOf(donationId, {
					status: 'won',
					balance_transactions: [withdrawnOn(), reinstatedOn(10_000, 1_500)]
				})
			},
			sourcedTo()
		]);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([['du_1', 10_000, 'cancelled']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'completed', given: 10_000 });
		expect(await processorFees()).toBe(320);
		expect((await disputeRows()).map(([outcome]) => outcome)).toEqual(['won']);
	});

	it('keeps the fee booked where Stripe gave none back', async () => {
		const donationId = await settledGift();
		await disputeDelivery('evt_d1', 'charge.dispute.funds_withdrawn', [
			{ status: 200, json: disputeOf(donationId) },
			sourcedTo()
		]);

		await disputeDelivery('evt_d2', 'charge.dispute.closed', [
			{
				status: 200,
				json: disputeOf(donationId, {
					status: 'won',
					balance_transactions: [withdrawnOn(), reinstatedOn()]
				})
			},
			sourcedTo()
		]);

		expect(await asAdminReads(donationId)).toEqual({ status: 'completed', given: 10_000 });
		expect(await processorFees()).toBe(320 + 1_500);
	});
});

describe('a Stripe dispute lost', () => {
	it('books the fee Stripe charged for answering it, and closes the dispute when it closed', async () => {
		const donationId = await settledGift();
		await disputeDelivery('evt_d1', 'charge.dispute.funds_withdrawn', [
			{ status: 200, json: disputeOf(donationId) },
			sourcedTo(withdrawnOn())
		]);

		const { result } = await disputeDelivery(
			'evt_d2',
			'charge.dispute.closed',
			[
				{ status: 200, json: disputeOf(donationId, { status: 'lost' }) },
				sourcedTo(withdrawnOn(), counteredFee())
			],
			CLOSED
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await processorFees()).toBe(320 + 1_500 + 1_500);
		const [closed] = await db.select({ closedAt: dispute.closedAt }).from(dispute);
		expect(closed?.closedAt).toEqual(new Date(CLOSED * 1000));
	});

	it('leaves the gift reversed and closes the dispute', async () => {
		const donationId = await settledGift();
		await disputeDelivery('evt_d1', 'charge.dispute.funds_withdrawn', [
			{ status: 200, json: disputeOf(donationId) },
			sourcedTo()
		]);

		const { result } = await disputeDelivery(
			'evt_d2',
			'charge.dispute.closed',
			[{ status: 200, json: disputeOf(donationId, { status: 'lost' }) }, sourcedTo()],
			CLOSED
		);

		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		expect(await refundRows()).toEqual([['du_1', 10_000, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
		expect(await processorFees()).toBe(320 + 1_500);
		expect((await disputeRows()).map(([outcome]) => outcome)).toEqual(['lost']);
	});
});

describe('a Stripe inquiry that has withdrawn nothing', () => {
	it('moves nothing and answers 200', async () => {
		const donationId = await settledGift();
		sent = [];

		const { result } = await disputeDelivery('evt_d1', 'charge.dispute.created', [
			{
				status: 200,
				json: disputeOf(donationId, {
					status: 'warning_needs_response',
					balance_transactions: [],
					is_charge_refundable: true
				})
			}
		]);

		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(await refundRows()).toEqual([]);
		expect(await disputeRows()).toEqual([]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'completed', given: 10_000 });
		expect(toStaff()).toEqual([]);
	});
});

describe('each Stripe dispute event delivered twice', () => {
	it('posts once', async () => {
		const donationId = await settledGift();
		const opened = { status: 200, json: disputeOf(donationId) };
		const won = {
			status: 200,
			json: disputeOf(donationId, {
				status: 'won',
				balance_transactions: [withdrawnOn(), reinstatedOn(10_000, 1_500)]
			})
		};
		sent = [];

		const outcomes = [];
		for (const [eventId, type, answer] of [
			['evt_d1', 'charge.dispute.created', opened],
			['evt_d1', 'charge.dispute.created', opened],
			['evt_d2', 'charge.dispute.funds_withdrawn', opened],
			['evt_d2', 'charge.dispute.funds_withdrawn', opened],
			['evt_d3', 'charge.dispute.closed', won],
			['evt_d3', 'charge.dispute.closed', won],
			['evt_d4', 'charge.dispute.funds_reinstated', won],
			['evt_d4', 'charge.dispute.funds_reinstated', won]
		] as const) {
			const { result } = await disputeDelivery(eventId, type, [answer, sourcedTo()]);
			outcomes.push(result.ok && result.outcome);
		}

		expect(outcomes).toEqual([
			'posted',
			'already_posted',
			'already_posted',
			'already_posted',
			'posted',
			'already_posted',
			'already_posted',
			'already_posted'
		]);
		expect(await refundRows()).toEqual([['du_1', 10_000, 'cancelled']]);
		expect(await refundGroups()).toBe(1);
		expect(await processorFees()).toBe(320);
		expect(toStaff()).toHaveLength(1);
	});

	it('closes a lost dispute once', async () => {
		const donationId = await settledGift();
		await disputeDelivery('evt_d1', 'charge.dispute.created', [
			{ status: 200, json: disputeOf(donationId) },
			sourcedTo()
		]);
		const lost = { status: 200, json: disputeOf(donationId, { status: 'lost' }) };

		const first = await disputeDelivery('evt_d2', 'charge.dispute.closed', [lost, sourcedTo()]);
		const again = await disputeDelivery('evt_d2', 'charge.dispute.closed', [lost, sourcedTo()]);

		expect(first.result).toMatchObject({ ok: true, outcome: 'updated' });
		expect(again.result).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(await refundRows()).toEqual([['du_1', 10_000, 'succeeded']]);
		expect(await refundGroups()).toBe(1);
	});
});

describe('a Stripe dispute that arrives before its gift is recorded', () => {
	it('is answered non-2xx, and posted by a delivery after the gift settles', async () => {
		const donationId = await quotedGift();
		const answer = { status: 200, json: disputeOf(donationId) };

		const early = await disputeDelivery('evt_d1', 'charge.dispute.created', [answer, sourcedTo()]);

		expect(early.result).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await refundRows()).toEqual([]);

		await settle(donationId);
		const later = await disputeDelivery('evt_d1', 'charge.dispute.created', [answer, sourcedTo()]);

		expect(later.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await asAdminReads(donationId)).toEqual({ status: 'disputed', given: 0 });
	});
});

describe('a Stripe bank debit returned after it settled', () => {
	it('reads as a dispute lost: the gift is refunded, the fee booked, the monthly gift stopped, staff told once', async () => {
		const donationId = await authorizedMonthlyGift();
		await collect(donationId, 'us_bank_account');
		sent = [];

		const { result } = await disputeDelivery(
			'evt_d1',
			'charge.dispute.funds_withdrawn',
			collectionDispute(
				donationId,
				{
					reason: 'insufficient_funds',
					payment_method_details: { type: 'us_bank_account' },
					balance_transactions: [withdrawnOn(2_500, 400)]
				},
				'us_bank_account'
			)
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([['du_1', 2_500, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
		expect(await processorFees()).toBe(320 + 400);
		expect((await disputeRows()).map(([outcome]) => outcome)).toEqual(['lost']);
		const plans = await db.select({ status: recurringPlan.status }).from(recurringPlan);
		expect(plans).toEqual([{ status: 'cancelled' }]);
		const alerts = toStaff();
		expect(alerts).toHaveLength(1);
		expect(alerts[0]?.subject).toMatch(/dispute was lost/);
	});
});
