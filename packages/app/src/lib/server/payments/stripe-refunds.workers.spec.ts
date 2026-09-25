import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { listContacts } from '../contacts/queries';
import { postableId } from '../db/accounts';
import { createDb, type Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import { entryGroup, payment, recurringPlan } from '../db/schema';
import type { EmailProvider } from '../email/provider';
import type { SettleResult } from '../donations/delivery';
import { listDonations } from '../donations/queries';
import { recordAuthorizedGift, recordDonation } from '../donations/record';
import { settleDelivery } from '../donations/settle';
import { soleProcessor } from './processors.testing';
import { createStripeProvider } from './stripe';
import { recording, sign, type Recorded } from './stripe.testing';

// a Stripe refund reaching the books: the signed delivery, the adapter's fresh read of the refund
// through the real SDK, and the writer (../donations/reverse.ts) against a real D1.
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

const quietMail: EmailProvider = { send: async () => ({ ok: true }) };

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
	answers: readonly Answer[]
): Promise<{ result: SettleResult; calls: Recorded[] }> {
	const body = JSON.stringify({
		id: eventId,
		object: 'event',
		type,
		created: REFUNDED,
		data: { object }
	});
	const { httpClient, calls } = recording(answers);
	const provider = createStripeProvider(CREDENTIALS, { httpClient });
	const result = await settleDelivery(
		{ db, provider, processors: soleProcessor(provider), email: quietMail },
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
async function collect(donationId: string): Promise<void> {
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
					latest_charge: { ...settledIntent('', 2_500).latest_charge, id: 'ch_7' }
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
