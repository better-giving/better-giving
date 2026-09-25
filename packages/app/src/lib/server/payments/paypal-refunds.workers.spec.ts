import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { createPaypalProvider, PAYPAL_DEFAULT_API_URL } from './paypal';
import { soleProcessor } from './processors.testing';

// a PayPal or Venmo refund or dispute reaching the books: the verified delivery, the adapter's fresh
// read of the refund or the dispute and of the capture or sale it reverses through the real SDK and
// its own calls, and the writer (../donations/reverse.ts) against a real D1.
//
// what the writer does with each read is ../donations/reverse.workers.spec.ts's, and what the
// adapter reads off each of PayPal's shapes is ./paypal.spec.ts's. what is here is the join, which
// neither can see alone: that the refund PayPal reports finds the gift its order or sale settled, by
// the id the settlement recorded. every gift is put in the books by a PayPal delivery too, so both
// ids come out of the same adapter.
//
// PayPal is answered by path rather than in order: a delivery's reads cross three API generations
// and an order read that answers 404 is how a sale id reaches the sale read, so a script in order
// would restate the adapter's call sequence rather than PayPal's answers. every path not listed
// answers 404, as PayPal does for an id it does not hold. verification always vouches: what it
// refuses is the route's spec (../../../routes/api.paypal.webhook.workers.spec.ts).

const CREDENTIALS = {
	clientId: 'Aa-notarealclientid',
	clientSecret: 'EL-notarealsecret',
	apiUrl: PAYPAL_DEFAULT_API_URL,
	webhookId: '7YN47048TX2895013'
};
const SIGNED = {
	'paypal-transmission-id': 'b1c2d3e4-0000-4000-8000-000000000001',
	'paypal-transmission-time': '2026-08-20T09:12:44Z',
	'paypal-transmission-sig': 'deadbeef',
	'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT-notareal',
	'paypal-auth-algo': 'SHA256withRSA'
};
const FORM_ID = 'frm_paypalrefunds001';
const ORDER_ID = '5O190127TN364715T';
const CAPTURE_ID = '3C679366HH908993F';
const SALE_ID = '1KE4800513426762K';
const SUBSCRIPTION_ID = 'I-BW452GLLEP1G';
const SETTLED = '2026-08-16T22:21:19Z';
const REFUNDED = '2026-08-20T09:12:40Z';

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
	sent = [];
});

let sent: EmailMessage[] = [];
const recordingMail: EmailProvider = {
	send: async (message) => {
		sent.push(message);
		return { ok: true };
	}
};

/** what staff were sent, leaving out the donor's receipts. */
function toStaff() {
	return sent.filter((message) => message.to === 'ops@hope.example');
}

/** PayPal's answers, keyed `METHOD /path`. */
type Answers = Readonly<Record<string, unknown>>;

/**
 * one delivery through the settlement path, with PayPal answering from `answers`. `resource` is the
 * delivery's own copy of the object, which nothing may act on.
 */
async function deliver(
	eventId: string,
	type: string,
	resource: Record<string, unknown>,
	answers: Answers
): Promise<{ result: SettleResult; calls: string[] }> {
	const calls: string[] = [];
	// a transaction with no dispute on it lists none, which is what every refund read asks first.
	const answered: Answers = { 'GET /v1/customer/disputes': { items: [] }, ...answers };
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		const { pathname } = new URL(request.url);
		if (pathname === '/v1/oauth2/token') {
			return Response.json({
				access_token: 'A21AA-token',
				token_type: 'Bearer',
				expires_in: 32400
			});
		}
		if (pathname === '/v1/notifications/verify-webhook-signature') {
			return Response.json({ verification_status: 'SUCCESS' });
		}
		const route = `${request.method} ${pathname}`;
		calls.push(route);
		return route in answered
			? Response.json(answered[route])
			: Response.json(
					{ name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] },
					{ status: 404 }
				);
	});
	const body = JSON.stringify({
		id: eventId,
		event_version: '1.0',
		event_type: type,
		resource_type: 'refund',
		create_time: REFUNDED,
		resource
	});
	const provider = createPaypalProvider(CREDENTIALS);
	const result = await settleDelivery(
		{ db, provider, processors: soleProcessor(provider), email: recordingMail },
		{ body, headers: SIGNED }
	);
	return { result, calls };
}

/** a one-off gift quoted on {@link ORDER_ID} and not yet settled, as the donation endpoint records one. */
async function quotedGift(rail: 'paypal' | 'venmo' = 'paypal'): Promise<string> {
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
		processor: 'paypal',
		totalMinor: 10_000,
		feeMinor: 0,
		lines: [{ label: 'Donation', revenueAccountId: fund, amountMinor: 10_000 }],
		method: rail,
		providerTxnId: ORDER_ID,
		occurredAt: new Date(SETTLED),
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null
	});
	if (!recorded.ok) throw new Error(`the fixture gift was not recorded: ${recorded.detail}`);
	return donationId;
}

/** {@link CAPTURE_ID} as Payments v2 answers for it, in the state `status` names. */
function captureOf(donationId: string, status = 'COMPLETED') {
	return {
		id: CAPTURE_ID,
		status,
		custom_id: JSON.stringify({ donation_id: donationId }),
		create_time: SETTLED,
		supplementary_data: { related_ids: { order_id: ORDER_ID } },
		seller_receivable_breakdown: {
			gross_amount: { currency_code: 'USD', value: '100.00' },
			paypal_fee: { currency_code: 'USD', value: '3.98' },
			net_amount: { currency_code: 'USD', value: '96.02' }
		}
	};
}

/** PayPal's answers to the settlement read of the order: the order, then its capture. */
function orderAnswers(donationId: string, rail: 'paypal' | 'venmo', captureStatus = 'COMPLETED') {
	return {
		[`GET /v2/checkout/orders/${ORDER_ID}`]: {
			id: ORDER_ID,
			status: 'COMPLETED',
			create_time: SETTLED,
			payment_source: { [rail]: { email_address: 'payer@example.org' } },
			purchase_units: [
				{
					custom_id: JSON.stringify({ donation_id: donationId }),
					amount: { currency_code: 'USD', value: '100.00' },
					payments: { captures: [{ id: CAPTURE_ID, status: captureStatus }] }
				}
			]
		},
		[`GET /v2/payments/captures/${CAPTURE_ID}`]: captureOf(donationId, captureStatus)
	};
}

/** the quoted gift settled by PayPal's own `PAYMENT.CAPTURE.COMPLETED`. */
async function settle(donationId: string, rail: 'paypal' | 'venmo' = 'paypal'): Promise<void> {
	const { result } = await deliver(
		'WH-SETTLE',
		'PAYMENT.CAPTURE.COMPLETED',
		{ id: CAPTURE_ID, supplementary_data: { related_ids: { order_id: ORDER_ID } } },
		orderAnswers(donationId, rail)
	);
	if (!result.ok || result.outcome !== 'posted') {
		throw new Error(`the fixture gift did not settle: ${JSON.stringify(result)}`);
	}
}

/** a one-off gift PayPal settled on `rail`. */
async function settledGift(rail: 'paypal' | 'venmo' = 'paypal'): Promise<string> {
	const donationId = await quotedGift(rail);
	await settle(donationId, rail);
	return donationId;
}

/** a Payments v2 refund of {@link CAPTURE_ID}, as the reversal read fetches it. */
function captureRefund(id: string, value: string, status = 'COMPLETED') {
	return {
		id,
		status,
		amount: { currency_code: 'USD', value },
		create_time: REFUNDED,
		update_time: REFUNDED,
		links: [
			{ rel: 'self', method: 'GET', href: `https://api-m.paypal.com/v2/payments/refunds/${id}` },
			{
				rel: 'up',
				method: 'GET',
				href: `https://api-m.paypal.com/v2/payments/captures/${CAPTURE_ID}`
			}
		]
	};
}

/**
 * one `PAYMENT.CAPTURE.REFUNDED` delivery of `refund`, with PayPal answering the refund and the
 * capture. the delivery's own copy claims a figure the read does not hold, and nothing acts on it.
 */
function refundDelivery(
	eventId: string,
	donationId: string,
	refund: ReturnType<typeof captureRefund>,
	captureStatus = 'REFUNDED'
) {
	return deliver(
		eventId,
		'PAYMENT.CAPTURE.REFUNDED',
		{ ...refund, amount: { currency_code: 'USD', value: '0.01' }, status: 'COMPLETED' },
		{
			[`GET /v2/payments/refunds/${refund.id}`]: refund,
			[`GET /v2/payments/captures/${CAPTURE_ID}`]: captureOf(donationId, captureStatus)
		}
	);
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

/** the refund-direction rows, as `[refund id at PayPal, amount, status]`. */
async function refundRows() {
	const rows = await db
		.select()
		.from(payment)
		.where(eq(payment.direction, 'refund'))
		.orderBy(payment.createdAt);
	return rows.map((row) => [row.providerTxnId, row.amountMinor, row.status] as const);
}

/** the gift's own inbound rows, as `[order or sale id, amount, status]`. */
async function inboundRows() {
	const rows = await db.select().from(payment).where(eq(payment.direction, 'inbound'));
	return rows.map((row) => [row.providerTxnId, row.amountMinor, row.status] as const);
}

/** how many entry groups a refund row posted. */
async function refundGroups() {
	const rows = await db.select().from(entryGroup).where(eq(entryGroup.sourceType, 'refund'));
	return rows.length;
}

describe('a PayPal refund of a whole one-off gift', () => {
	it.each(['paypal', 'venmo'] as const)(
		'posts the refund against the %s gift, which reads refunded',
		async (rail) => {
			const donationId = await settledGift(rail);

			const { result } = await refundDelivery(
				'WH-R1',
				donationId,
				captureRefund('1JU08902781691411', '100.00')
			);

			expect(result).toMatchObject({ ok: true, outcome: 'posted' });
			expect(await refundRows()).toEqual([['1JU08902781691411', 10_000, 'succeeded']]);
			expect(await refundGroups()).toBe(1);
			expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
		}
	);
});

describe('PayPal refunds of part of a one-off gift', () => {
	it('posts each part as a row of its own, and the gift reads partly refunded', async () => {
		const donationId = await settledGift();

		const first = await refundDelivery(
			'WH-R1',
			donationId,
			captureRefund('1JU08902781691411', '25.00'),
			'PARTIALLY_REFUNDED'
		);
		const second = await refundDelivery(
			'WH-R2',
			donationId,
			captureRefund('8XE51235LP1826031', '30.00'),
			'PARTIALLY_REFUNDED'
		);

		expect(first.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(second.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([
			['1JU08902781691411', 2_500, 'succeeded'],
			['8XE51235LP1826031', 3_000, 'succeeded']
		]);
		expect(await asAdminReads(donationId)).toEqual({
			status: 'partially_refunded',
			given: 4_500
		});
	});
});

describe('a settlement read of a capture PayPal now reports as money gone back', () => {
	it.each(['REFUNDED', 'PARTIALLY_REFUNDED', 'REVERSED'])(
		'leaves the settled gift’s row as it stood when the capture reads %s',
		async (state) => {
			const donationId = await settledGift();
			sent = [];

			const { result } = await deliver(
				'WH-LATE',
				'PAYMENT.CAPTURE.COMPLETED',
				{ id: CAPTURE_ID, supplementary_data: { related_ids: { order_id: ORDER_ID } } },
				orderAnswers(donationId, 'paypal', state)
			);

			expect(result).toMatchObject({ ok: true, outcome: 'already_posted' });
			expect(await inboundRows()).toEqual([[ORDER_ID, 10_000, 'succeeded']]);
			expect(toStaff()).toEqual([]);
		}
	);

	it('posts a gift whose first read meets it already refunded, and the refund then takes it out', async () => {
		const donationId = await quotedGift();
		const refund = captureRefund('1JU08902781691411', '100.00');

		const early = await refundDelivery('WH-R1', donationId, refund);
		expect(early.result).toMatchObject({ ok: false, reason: 'incomplete' });

		const settled = await deliver(
			'WH-SETTLE',
			'PAYMENT.CAPTURE.COMPLETED',
			{ id: CAPTURE_ID, supplementary_data: { related_ids: { order_id: ORDER_ID } } },
			orderAnswers(donationId, 'paypal', 'REFUNDED')
		);
		const later = await refundDelivery('WH-R1', donationId, refund);

		expect(settled.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(later.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await inboundRows()).toEqual([[ORDER_ID, 10_000, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
	});
});

describe('a PayPal refund delivered twice', () => {
	it('posts once', async () => {
		const donationId = await settledGift();
		const refund = captureRefund('1JU08902781691411', '100.00');

		await refundDelivery('WH-R1', donationId, refund);
		const again = await refundDelivery('WH-R1', donationId, refund);

		expect(again.result).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(await refundRows()).toEqual([['1JU08902781691411', 10_000, 'succeeded']]);
		expect(await refundGroups()).toBe(1);
	});
});

describe('a PayPal refund that arrives before its gift is recorded', () => {
	it('is answered non-2xx, and posted by a delivery after the gift settles', async () => {
		const donationId = await quotedGift();
		const refund = captureRefund('1JU08902781691411', '100.00');

		const early = await refundDelivery('WH-R1', donationId, refund);

		expect(early.result).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await refundRows()).toEqual([]);

		await settle(donationId);
		const later = await refundDelivery('WH-R1', donationId, refund);

		expect(later.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
	});
});

describe('a PayPal refund of a capture this deployment never took', () => {
	it('answers 200 and writes nothing', async () => {
		await settledGift();
		const refund = {
			...captureRefund('6RB12930NJ5410443', '40.00'),
			links: [
				{
					rel: 'up',
					method: 'GET',
					href: 'https://api-m.paypal.com/v2/payments/captures/9TR48203KX1103725'
				}
			]
		};

		const { result } = await deliver('WH-R9', 'PAYMENT.CAPTURE.REFUNDED', refund, {
			'GET /v2/payments/refunds/6RB12930NJ5410443': refund,
			'GET /v2/payments/captures/9TR48203KX1103725': {
				id: '9TR48203KX1103725',
				status: 'REFUNDED',
				custom_id: 'INV-20260816-0042',
				supplementary_data: { related_ids: { order_id: '8DN05871WH4512003' } }
			}
		});

		expect(result).toMatchObject({ ok: true, outcome: 'unmatched' });
		expect(await refundRows()).toEqual([]);
		expect(await refundGroups()).toBe(0);
	});
});

describe('a PayPal refund still pending', () => {
	it('moves nothing and answers 200, and the delivery reporting it completed posts it', async () => {
		const donationId = await settledGift();

		const pending = await refundDelivery(
			'WH-R1',
			donationId,
			captureRefund('1JU08902781691411', '100.00', 'PENDING'),
			'COMPLETED'
		);

		expect(pending.result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(await refundRows()).toEqual([]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'completed', given: 10_000 });

		const completed = await refundDelivery(
			'WH-R2',
			donationId,
			captureRefund('1JU08902781691411', '100.00')
		);

		expect(completed.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
	});
});

const CONTACT_ID = '019fbb00-0000-7000-8000-000000000002';

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
		occurredAt: new Date(SETTLED)
	});
	if (!written.ok) throw new Error(`the authorized gift was not written: ${written.detail}`);
	return donationId;
}

/**
 * PayPal's answers about the monthly gift's one collection: the sale, and the subscription it was
 * collected under, carrying what `commitmentMetadata` in ./provider.ts writes.
 */
function collectionAnswers(donationId: string, saleState = 'completed') {
	return {
		[`GET /v1/payments/sale/${SALE_ID}`]: {
			id: SALE_ID,
			state: saleState,
			amount: { total: '25.00', currency: 'USD' },
			transaction_fee: { currency: 'USD', value: '1.18' },
			billing_agreement_id: SUBSCRIPTION_ID,
			create_time: SETTLED
		},
		[`GET /v1/billing/subscriptions/${SUBSCRIPTION_ID}`]: {
			id: SUBSCRIPTION_ID,
			plan_id: 'P-5ML4271244454362WXNWU5NQ',
			status: 'ACTIVE',
			start_time: SETTLED,
			custom_id: JSON.stringify({
				donation_id: donationId,
				interval: 'monthly',
				gift_minor: '2500',
				fee_covered: 'false'
			}),
			subscriber: { payer_id: 'QYR5Z8CTNNPXA' },
			billing_info: {
				outstanding_balance: { currency_code: 'USD', value: '0.00' },
				failed_payments_count: 0,
				next_billing_time: '2026-09-16T22:21:19Z'
			},
			plan: {
				billing_cycles: [
					{
						tenure_type: 'REGULAR',
						sequence: 1,
						frequency: { interval_unit: 'MONTH', interval_count: 1 }
					}
				]
			}
		}
	};
}

/** the monthly gift's first collection, settled by PayPal's own `PAYMENT.SALE.COMPLETED`. */
async function collect(donationId: string): Promise<void> {
	const { result } = await deliver(
		'WH-COLLECT',
		'PAYMENT.SALE.COMPLETED',
		{ id: SALE_ID },
		collectionAnswers(donationId)
	);
	if (!result.ok || result.outcome !== 'posted') {
		throw new Error(`the fixture collection did not settle: ${JSON.stringify(result)}`);
	}
}

/** a `PAYMENT.SALE.REFUNDED` delivery of the whole collection, with PayPal answering every read. */
function saleRefundDelivery(donationId: string) {
	const refund = {
		id: '0P209507D6694645N',
		state: 'completed',
		amount: { total: '25.00', currency: 'USD' },
		sale_id: SALE_ID,
		parent_payment: 'PAY-5YK922393D847794YKER7MUI',
		create_time: REFUNDED,
		update_time: REFUNDED
	};
	return deliver('WH-R1', 'PAYMENT.SALE.REFUNDED', refund, {
		'GET /v1/payments/refund/0P209507D6694645N': refund,
		...collectionAnswers(donationId, 'refunded')
	});
}

describe('a PayPal refund of one monthly charge', () => {
	it('posts against that charge’s gift and leaves the monthly gift running', async () => {
		const donationId = await authorizedMonthlyGift();
		await collect(donationId);

		const { result, calls } = await saleRefundDelivery(donationId);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([['0P209507D6694645N', 2_500, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
		const plans = await db.select({ status: recurringPlan.status }).from(recurringPlan);
		expect(plans).toEqual([{ status: 'active' }]);
		// read, and nothing asked of the commitment.
		expect(calls.every((call) => call.startsWith('GET '))).toBe(true);
	});
});

describe('a PayPal refund of a monthly charge not recorded yet', () => {
	it('is answered non-2xx on the commitment’s word, and posted by a delivery after the charge is', async () => {
		const donationId = await authorizedMonthlyGift();

		const early = await saleRefundDelivery(donationId);

		expect(early.result).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await refundRows()).toEqual([]);

		await collect(donationId);
		const later = await saleRefundDelivery(donationId);

		expect(later.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
	});
});

const DISPUTE_ID = 'PP-D-27803';
const DISPUTED = '2026-08-22T09:46:54.926Z';
const RESPOND_BY = '2026-09-01T09:46:54.926Z';
const DECIDED = '2026-09-03T11:00:00.000Z';

/**
 * a dispute over `transactionId` as `GET /v1/customer/disputes/{id}` answers for it (`dispute` in
 * customer_disputes_v1.json): a claim holding the whole $100.00 until a case overrides a field.
 */
function disputeOf(over: Record<string, unknown> = {}, transactionId = CAPTURE_ID) {
	const { transaction_status: status = 'HELD', ...rest } = over;
	return {
		dispute_id: DISPUTE_ID,
		create_time: DISPUTED,
		update_time: DISPUTED,
		disputed_transactions: [
			{
				seller_transaction_id: transactionId,
				transaction_status: status,
				gross_amount: { currency_code: 'USD', value: '100.00' }
			}
		],
		reason: 'UNAUTHORISED',
		status: 'WAITING_FOR_SELLER_RESPONSE',
		dispute_amount: { currency_code: 'USD', value: '100.00' },
		dispute_life_cycle_stage: 'CHARGEBACK',
		dispute_channel: 'INTERNAL',
		seller_response_due_date: RESPOND_BY,
		...rest
	};
}

/** {@link disputeOf} resolved under `outcome_code`, its transaction as `transaction_status` names. */
function resolvedDispute(outcome_code: string, transaction_status = 'COMPLETED') {
	return disputeOf({
		status: 'RESOLVED',
		update_time: DECIDED,
		transaction_status,
		dispute_outcome: { outcome_code }
	});
}

/**
 * one `CUSTOMER.DISPUTE.*` delivery, with PayPal answering the dispute as `disputed` and the
 * capture it names. the delivery's own copy names the dispute and nothing else is read off it.
 */
function disputeDelivery(
	eventId: string,
	type: string,
	donationId: string,
	disputed: Record<string, unknown>
) {
	return deliver(
		eventId,
		type,
		{ dispute_id: DISPUTE_ID, status: 'RESOLVED' },
		{
			[`GET /v1/customer/disputes/${DISPUTE_ID}`]: disputed,
			[`GET /v2/payments/captures/${CAPTURE_ID}`]: captureOf(donationId)
		}
	);
}

/** the disputes on record, as `[outcome, respond by]`. */
async function disputeRows() {
	const rows = await db.select().from(dispute);
	return rows.map((row) => [row.outcome, row.respondBy?.toISOString() ?? null] as const);
}

describe('a PayPal dispute holding a settled gift’s money', () => {
	it.each(['paypal', 'venmo'] as const)(
		'takes the %s gift’s money back, leaves the dispute open, and tells staff',
		async (rail) => {
			const donationId = await settledGift(rail);
			sent = [];

			const { result } = await disputeDelivery(
				'WH-D1',
				'CUSTOMER.DISPUTE.CREATED',
				donationId,
				disputeOf()
			);

			expect(result).toMatchObject({ ok: true, outcome: 'posted' });
			expect(await refundRows()).toEqual([[DISPUTE_ID, 10_000, 'succeeded']]);
			expect(await asAdminReads(donationId)).toEqual({ status: 'disputed', given: 0 });
			expect(await disputeRows()).toEqual([[null, RESPOND_BY]]);
			const alerts = toStaff();
			expect(alerts).toHaveLength(1);
			expect(alerts[0]?.text).toContain('10000 USD');
			expect(alerts[0]?.text).toContain(RESPOND_BY);
			expect(alerts[0]?.text).toContain('https://www.paypal.com/resolutioncenter');
		}
	);
});

describe('a PayPal dispute on one monthly charge', () => {
	it('stops the monthly gift and says so to staff', async () => {
		const donationId = await authorizedMonthlyGift();
		await collect(donationId);
		sent = [];

		const { result, calls } = await deliver(
			'WH-D1',
			'CUSTOMER.DISPUTE.CREATED',
			{ dispute_id: DISPUTE_ID },
			{
				[`GET /v1/customer/disputes/${DISPUTE_ID}`]: disputeOf(
					{ dispute_amount: { currency_code: 'USD', value: '25.00' } },
					SALE_ID
				),
				...collectionAnswers(donationId),
				[`POST /v1/billing/subscriptions/${SUBSCRIPTION_ID}/cancel`]: null
			}
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([[DISPUTE_ID, 2_500, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'disputed', given: 0 });
		expect(calls).toContain(`POST /v1/billing/subscriptions/${SUBSCRIPTION_ID}/cancel`);
		const plans = await db.select({ status: recurringPlan.status }).from(recurringPlan);
		expect(plans).toEqual([{ status: 'cancelled' }]);
		expect(toStaff()).toHaveLength(1);
		expect(toStaff()[0]?.text).toContain('Stopped: no further charges');
	});
});

describe('a PayPal dispute decided', () => {
	it('restores the gift when won', async () => {
		const donationId = await settledGift();
		await disputeDelivery('WH-D1', 'CUSTOMER.DISPUTE.CREATED', donationId, disputeOf());

		const { result } = await disputeDelivery(
			'WH-D2',
			'CUSTOMER.DISPUTE.RESOLVED',
			donationId,
			resolvedDispute('RESOLVED_SELLER_FAVOUR')
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([[DISPUTE_ID, 10_000, 'cancelled']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'completed', given: 10_000 });
		expect(await disputeRows()).toEqual([['won', RESPOND_BY]]);
	});

	it('leaves the gift reversed when lost', async () => {
		const donationId = await settledGift();
		await disputeDelivery('WH-D1', 'CUSTOMER.DISPUTE.CREATED', donationId, disputeOf());

		const { result } = await disputeDelivery(
			'WH-D2',
			'CUSTOMER.DISPUTE.RESOLVED',
			donationId,
			resolvedDispute('RESOLVED_BUYER_FAVOUR', 'REVERSED')
		);

		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		expect(await refundRows()).toEqual([[DISPUTE_ID, 10_000, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
		expect(await disputeRows()).toEqual([['lost', RESPOND_BY]]);
	});
});

describe('a PayPal inquiry that holds no funds', () => {
	it('moves nothing and answers 200', async () => {
		const donationId = await settledGift();
		sent = [];

		const { result } = await disputeDelivery(
			'WH-D1',
			'CUSTOMER.DISPUTE.CREATED',
			donationId,
			disputeOf({ dispute_life_cycle_stage: 'INQUIRY', transaction_status: 'COMPLETED' })
		);

		expect(result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(await refundRows()).toEqual([]);
		expect(await disputeRows()).toEqual([]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'completed', given: 10_000 });
		expect(toStaff()).toEqual([]);
	});
});

describe('each PayPal dispute event delivered twice', () => {
	it('posts once', async () => {
		const donationId = await settledGift();
		sent = [];

		const outcomes = [];
		for (const [eventId, type, disputed] of [
			['WH-D1', 'CUSTOMER.DISPUTE.CREATED', disputeOf()],
			['WH-D1', 'CUSTOMER.DISPUTE.CREATED', disputeOf()],
			['WH-D2', 'CUSTOMER.DISPUTE.UPDATED', disputeOf()],
			['WH-D2', 'CUSTOMER.DISPUTE.UPDATED', disputeOf()],
			['WH-D3', 'CUSTOMER.DISPUTE.RESOLVED', resolvedDispute('RESOLVED_SELLER_FAVOUR')],
			['WH-D3', 'CUSTOMER.DISPUTE.RESOLVED', resolvedDispute('RESOLVED_SELLER_FAVOUR')]
		] as const) {
			const { result } = await disputeDelivery(eventId, type, donationId, disputed);
			outcomes.push(result.ok && result.outcome);
		}

		expect(outcomes).toEqual([
			'posted',
			'already_posted',
			'already_posted',
			'already_posted',
			'posted',
			'already_posted'
		]);
		expect(await refundRows()).toEqual([[DISPUTE_ID, 10_000, 'cancelled']]);
		expect(await refundGroups()).toBe(1);
		expect(toStaff()).toHaveLength(1);
	});
});

describe('a PayPal dispute that arrives before its gift is recorded', () => {
	it('is answered non-2xx, and posted by a delivery after the gift settles', async () => {
		const donationId = await quotedGift();

		const early = await disputeDelivery(
			'WH-D1',
			'CUSTOMER.DISPUTE.CREATED',
			donationId,
			disputeOf()
		);

		expect(early.result).toMatchObject({ ok: false, reason: 'incomplete' });
		expect(await refundRows()).toEqual([]);

		await settle(donationId);
		const later = await disputeDelivery(
			'WH-D1',
			'CUSTOMER.DISPUTE.CREATED',
			donationId,
			disputeOf()
		);

		expect(later.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await asAdminReads(donationId)).toEqual({ status: 'disputed', given: 0 });
	});
});

/** PayPal's reversal of the whole capture: a Payments v2 refund, as `PAYMENT.CAPTURE.REVERSED` carries. */
const REVERSAL = captureRefund('4VD21843TJ104552R', '100.00');

/**
 * one `PAYMENT.CAPTURE.REVERSED` delivery, with PayPal answering the reversal, the capture, and the
 * disputes on the capture: none where `disputed` is null, else the one dispute, answered as it.
 */
function reversedDelivery(
	eventId: string,
	donationId: string,
	disputed: Record<string, unknown> | null
) {
	return deliver(eventId, 'PAYMENT.CAPTURE.REVERSED', REVERSAL, {
		[`GET /v2/payments/refunds/${REVERSAL.id}`]: REVERSAL,
		[`GET /v2/payments/captures/${CAPTURE_ID}`]: captureOf(donationId, 'REVERSED'),
		'GET /v1/customer/disputes': {
			items: disputed === null ? [] : [{ dispute_id: DISPUTE_ID, create_time: DISPUTED }]
		},
		...(disputed === null ? {} : { [`GET /v1/customer/disputes/${DISPUTE_ID}`]: disputed })
	});
}

describe('a PayPal capture reversed with no dispute behind it', () => {
	it('is a dispute lost at once: the gift reads refunded and staff are told', async () => {
		const donationId = await settledGift();
		sent = [];

		const { result } = await reversedDelivery('WH-V1', donationId, null);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([[REVERSAL.id, 10_000, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
		expect(await disputeRows()).toEqual([['lost', null]]);
		expect(toStaff()).toHaveLength(1);
		expect(toStaff()[0]?.subject).toMatch(/dispute was lost/);
	});
});

describe('a PayPal chargeback reported as a dispute and as a reversal', () => {
	const chargeback = () =>
		disputeOf({ dispute_channel: 'EXTERNAL', transaction_status: 'REVERSED' });

	it('withdraws the money once when the dispute arrives first', async () => {
		const donationId = await settledGift();

		const opened = await disputeDelivery(
			'WH-D1',
			'CUSTOMER.DISPUTE.CREATED',
			donationId,
			chargeback()
		);
		const reversed = await reversedDelivery('WH-V1', donationId, chargeback());

		expect(opened.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(reversed.result).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(await refundRows()).toEqual([[DISPUTE_ID, 10_000, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'disputed', given: 0 });
	});

	it('withdraws the money once when the reversal arrives first', async () => {
		const donationId = await settledGift();

		const reversed = await reversedDelivery('WH-V1', donationId, chargeback());
		const opened = await disputeDelivery(
			'WH-D1',
			'CUSTOMER.DISPUTE.CREATED',
			donationId,
			chargeback()
		);

		expect(reversed.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(opened.result).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(await refundRows()).toEqual([[DISPUTE_ID, 10_000, 'succeeded']]);
	});
});

describe('a PayPal claim the organisation accepted', () => {
	/**
	 * accepting a claim closes it for the buyer and PayPal refunds the capture from the merchant's
	 * account (https://docs.paypal.ai/reference/api/rest/disputes-actions/accept-claim). the dispute
	 * already took the money, so the refund is its close and never a second withdrawal.
	 */
	it('closes the dispute on the refund PayPal makes for it, and the gift never goes below nothing', async () => {
		const donationId = await settledGift();
		await disputeDelivery('WH-D1', 'CUSTOMER.DISPUTE.CREATED', donationId, disputeOf());
		const lost = resolvedDispute('RESOLVED_BUYER_FAVOUR', 'REFUNDED');

		const refunded = await deliver(
			'WH-R1',
			'PAYMENT.CAPTURE.REFUNDED',
			captureRefund('1JU08902781691411', '100.00'),
			{
				'GET /v2/payments/refunds/1JU08902781691411': captureRefund('1JU08902781691411', '100.00'),
				[`GET /v2/payments/captures/${CAPTURE_ID}`]: captureOf(donationId, 'REFUNDED'),
				'GET /v1/customer/disputes': { items: [{ dispute_id: DISPUTE_ID, create_time: DISPUTED }] },
				[`GET /v1/customer/disputes/${DISPUTE_ID}`]: lost
			}
		);
		const closed = await disputeDelivery('WH-D2', 'CUSTOMER.DISPUTE.RESOLVED', donationId, lost);

		expect(refunded.result).toMatchObject({ ok: true, outcome: 'updated' });
		expect(closed.result).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(await refundRows()).toEqual([[DISPUTE_ID, 10_000, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
		expect(await disputeRows()).toEqual([['lost', RESPOND_BY]]);
	});
});

describe('a PayPal inquiry the organisation settled with a refund', () => {
	/**
	 * the inquiry never held the money, so its close moves nothing: the $30 left as the refund,
	 * which its own delivery booked, and the buyer's win is not a second withdrawal.
	 */
	it('takes the refund out once, whichever way the inquiry closes', async () => {
		const donationId = await settledGift();
		const inquiry = { dispute_life_cycle_stage: 'INQUIRY', transaction_status: 'COMPLETED' };
		const refund = captureRefund('1JU08902781691411', '30.00');

		const refunded = await deliver('WH-R1', 'PAYMENT.CAPTURE.REFUNDED', refund, {
			[`GET /v2/payments/refunds/${refund.id}`]: refund,
			[`GET /v2/payments/captures/${CAPTURE_ID}`]: captureOf(donationId, 'PARTIALLY_REFUNDED'),
			'GET /v1/customer/disputes': { items: [{ dispute_id: DISPUTE_ID, create_time: DISPUTED }] },
			[`GET /v1/customer/disputes/${DISPUTE_ID}`]: disputeOf(inquiry)
		});
		const closed = await disputeDelivery(
			'WH-D2',
			'CUSTOMER.DISPUTE.RESOLVED',
			donationId,
			disputeOf({
				...inquiry,
				status: 'RESOLVED',
				update_time: DECIDED,
				dispute_outcome: {
					outcome_code: 'RESOLVED_BUYER_FAVOUR',
					amount_refunded: { currency_code: 'USD', value: '30.00' }
				}
			})
		);

		expect(refunded.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(closed.result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(await refundRows()).toEqual([['1JU08902781691411', 3_000, 'succeeded']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'partially_refunded', given: 7_000 });
	});
});

describe('a PayPal chargeback that replaces a claim PayPal closed undecided', () => {
	/**
	 * PayPal closes the claim `NONE` when a chargeback opens on the same capture. the claim's
	 * withdrawal is the chargeback's from then on: no second withdrawal, and the chargeback's win puts
	 * the one withdrawal back.
	 */
	it('carries the claim’s withdrawal, and the chargeback’s close settles it', async () => {
		const donationId = await settledGift();
		const chargebackId = 'PP-D-30001';
		const claimClosed = disputeOf({
			status: 'RESOLVED',
			update_time: '2026-08-29T09:59:00.000Z',
			transaction_status: 'REVERSED',
			dispute_outcome: { outcome_code: 'NONE' }
		});
		const chargeback = (over: Record<string, unknown>) => ({
			...disputeOf({ dispute_channel: 'EXTERNAL', transaction_status: 'REVERSED', ...over }),
			dispute_id: chargebackId,
			create_time: '2026-08-29T10:00:00.000Z'
		});
		const both = {
			[`GET /v2/payments/captures/${CAPTURE_ID}`]: captureOf(donationId, 'REVERSED'),
			'GET /v1/customer/disputes': {
				items: [
					{ dispute_id: DISPUTE_ID, create_time: DISPUTED },
					{ dispute_id: chargebackId, create_time: '2026-08-29T10:00:00.000Z' }
				]
			},
			[`GET /v1/customer/disputes/${DISPUTE_ID}`]: claimClosed
		};

		const opened = await disputeDelivery(
			'WH-D1',
			'CUSTOMER.DISPUTE.CREATED',
			donationId,
			disputeOf()
		);
		const superseded = await disputeDelivery(
			'WH-D2',
			'CUSTOMER.DISPUTE.RESOLVED',
			donationId,
			claimClosed
		);
		const replaced = await deliver(
			'WH-D3',
			'CUSTOMER.DISPUTE.CREATED',
			{ dispute_id: chargebackId },
			{
				...both,
				[`GET /v1/customer/disputes/${chargebackId}`]: chargeback({})
			}
		);
		const won = await deliver(
			'WH-D4',
			'CUSTOMER.DISPUTE.RESOLVED',
			{ dispute_id: chargebackId },
			{
				...both,
				[`GET /v1/customer/disputes/${chargebackId}`]: chargeback({
					status: 'RESOLVED',
					update_time: DECIDED,
					transaction_status: 'COMPLETED',
					dispute_outcome: { outcome_code: 'RESOLVED_SELLER_FAVOUR' }
				})
			}
		);

		expect(opened.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(superseded.result).toMatchObject({ ok: true, outcome: 'ignored' });
		expect(replaced.result).toMatchObject({ ok: true, outcome: 'already_posted' });
		expect(won.result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([[DISPUTE_ID, 10_000, 'cancelled']]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'completed', given: 10_000 });
		expect(await disputeRows()).toEqual([['won', RESPOND_BY]]);
	});
});

describe('a PayPal capture reversed beside an older dispute that was won', () => {
	it('is booked on its own rather than dropped under the won dispute', async () => {
		const donationId = await settledGift();
		await disputeDelivery('WH-D1', 'CUSTOMER.DISPUTE.CREATED', donationId, disputeOf());
		await disputeDelivery(
			'WH-D2',
			'CUSTOMER.DISPUTE.RESOLVED',
			donationId,
			resolvedDispute('RESOLVED_SELLER_FAVOUR')
		);

		const { result } = await reversedDelivery(
			'WH-V1',
			donationId,
			resolvedDispute('RESOLVED_SELLER_FAVOUR')
		);

		expect(result).toMatchObject({ ok: true, outcome: 'posted' });
		expect(await refundRows()).toEqual([
			[DISPUTE_ID, 10_000, 'cancelled'],
			[REVERSAL.id, 10_000, 'succeeded']
		]);
		expect(await asAdminReads(donationId)).toEqual({ status: 'refunded', given: 0 });
	});
});
