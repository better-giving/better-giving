import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOWPAYMENTS_IPN_PATH } from '@better-giving/operator/nowpayments/ipn-callback';
import { parseContact } from '$lib/server/contacts/contact-input';
import { createDb } from '$lib/server/db/client';
import { readPendingCryptoGifts } from '$lib/server/donations/pending-crypto-read';
import { listDonations } from '$lib/server/donations/queries';
import type { PostableAccountId } from '$lib/server/db/postable';
import { recordDonation } from '$lib/server/donations/record';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { mountRoutes } from '../route-request.testing';
import * as surface from './api.v1';
import * as giftStanding from './api.v1.forms.$id.donations.$donationId';
import * as webhook from './api.nowpayments.webhook';

// the endpoint's own decision: which status NOWPayments is told, and what a signed IPN leaves in the
// books. how a signature verifies is $lib/server/payments/nowpayments.spec.ts; what each settlement
// does in detail — the receipt, the fee split — is $lib/server/donations/settle.workers.spec.ts.
//
// driven through react router rather than by calling the `action`, so the bytes the signature is
// computed over are the bytes the pipeline handed the handler (../route-request.testing.ts). the calls
// leaving the isolate are `GET /v1/payment/:id` and `GET /v1/estimate`, answered by a stubbed `fetch`
// the way NOWPayments answers them: an IPN carries `actually_paid_at_fiat` as 0 and a read carries
// none, so every arrival is valued at the estimate. anything else answers 404, which the coin list
// reads as unreadable and names the coin by its code.

const ADDRESS = `https://give.example.workers.dev${NOWPAYMENTS_IPN_PATH}`;

const callback = mountRoutes([{ path: NOWPAYMENTS_IPN_PATH.slice(1), module: webhook }]);

const SECRET = 'notarealipnsecret';

const CONFIGURED = {
	NOWPAYMENTS_API_KEY: 'notarealnowpaymentskey',
	NOWPAYMENTS_OUTCOME_CURRENCY: 'usdttrc20',
	NOWPAYMENTS_IPN_SECRET: SECRET
};

const FORM_ID = 'frm_nowpaymentshook1';
const DONATION_ID = '01920000-0000-7000-8000-000000000001';
const PAYMENT_ID = '5745459419';
const CHILD_ID = '5745460001';

// an IPN as NOWPayments sends it, the fixture $lib/server/payments/nowpayments.spec.ts signs three ways.
const IPN = `{"payment_id":5745459419,"parent_payment_id":null,"invoice_id":null,"payment_status":"finished","pay_address":"rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY","payin_extra_id":"2918473650","price_amount":25,"price_currency":"usd","pay_amount":19.36121163,"actually_paid":19.36121163,"actually_paid_at_fiat":24.87,"pay_currency":"xrp","order_id":"${DONATION_ID}","order_description":null,"purchase_id":"5837122679","created_at":"2026-09-17T15:00:22.742Z","updated_at":"2026-09-17T15:21:40.120Z","outcome_amount":24.1,"outcome_currency":"usdttrc20","payment_extra_ids":["2918473650"],"fee":{"currency":"usdttrc20","depositFee":0.12,"withdrawalFee":0.5,"serviceFee":0.25}}`;

// `IPN` under `SECRET`, sorted at the top level alone and with its array sorted into an object —
// two ways of signing NOWPayments' documentation shows that verify nothing it sends.
const SIGNED_TOP_LEVEL =
	'97e60cd78d884f08add02a74241580584c5a72d02d7dc8573523a7aa1faa948f690187e387424c90292eedb70c6d5b1582b89e6a8891bfc3c7300672634f5332';
const SIGNED_ARRAY_FLATTENED =
	'0684b9ab794aa901756ba61c9b7a6764d407661904be0382ec98941f4e6ea34945bcda0cceb20bd169b210e404cc6110e80d2c409b20034fd2c15c8814d1f2f0';

const PAID: Record<string, unknown> = { ...JSON.parse(IPN), actually_paid_at_fiat: 0 };

/** a repeat deposit to the parent's address, as NOWPayments reports one: its own id, the parent's order. */
const REPEAT: Record<string, unknown> = {
	...PAID,
	payment_id: Number(CHILD_ID),
	parent_payment_id: Number(PAYMENT_ID),
	actually_paid: 4,
	created_at: '2026-09-18T10:00:00.000Z',
	updated_at: '2026-09-18T10:20:00.000Z'
};

/** the pool's env with a case's deploy-time values — `envWith` in ./api.chariot.webhook.workers.spec.ts. */
function envWith(values: Record<string, string>): Env {
	return new Proxy(env, {
		get(target, property) {
			if (typeof property === 'string' && property in values) return values[property];
			return Reflect.get(target, property);
		}
	}) as Env;
}

function sortedDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortedDeep);
	if (typeof value !== 'object' || value === null) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sortedDeep((value as Record<string, unknown>)[key])])
	);
}

/** HMAC-SHA512 over the body's keys sorted at every depth, as NOWPayments' SDK signs. */
async function signature(payment: unknown, secret = SECRET): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-512' },
		false,
		['sign']
	);
	const mac = await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(JSON.stringify(sortedDeep(payment)))
	);
	return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** what NOWPayments' estimate values each amount of XRP the fixtures send at, in dollars. */
const ESTIMATES: Readonly<Record<string, string>> = { '19.36121163': '24.87', '4': '5.14' };

/**
 * `GET /v1/payment/:id` answered from `payments` by id, with no dollar value on it, and
 * `GET /v1/estimate` from `ESTIMATES`; anything else is a 404.
 */
function nowpaymentsHolds(payments: readonly Record<string, unknown>[]): {
	readonly calls: string[];
} {
	const calls: string[] = [];
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		const url = new URL(request.url);
		calls.push(`${request.method} ${url.pathname}`);
		if (url.pathname === '/v1/estimate') {
			const dollars = ESTIMATES[url.searchParams.get('amount') ?? ''];
			return dollars === undefined
				? Response.json({ message: 'no estimate' }, { status: 400 })
				: Response.json({ estimated_amount: dollars });
		}
		const payment = payments.find((p) => url.pathname === `/v1/payment/${p.payment_id}`);
		if (payment === undefined) {
			return Response.json({ message: 'Payment not found' }, { status: 404 });
		}
		const { actually_paid_at_fiat: _read, ...read } = payment;
		return Response.json(read);
	});
	return { calls };
}

/** the pending crypto gift the donation endpoint records for `PAYMENT_ID`: $25.00, one line. */
async function recordedGift(): Promise<void> {
	const account = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!account) throw new Error('no 4110 account in the migrated chart of accounts');
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins, created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
	)
		.bind(FORM_ID, account.id)
		.run();
	const donor = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		primary_email: 'ada@example.org'
	});
	if (!donor.ok) throw new Error('the fixture donor did not parse');
	const result = await recordDonation(createDb(env.DB), {
		donationId: DONATION_ID,
		donor: donor.value,
		formId: FORM_ID,
		origin: 'https://acme.org',
		currency: 'USD',
		processor: 'nowpayments',
		totalMinor: 2500,
		feeMinor: 0,
		lines: [
			{ label: 'Donation', revenueAccountId: account.id as PostableAccountId, amountMinor: 2500 }
		],
		method: 'crypto',
		providerTxnId: PAYMENT_ID,
		deposit: { coin: 'xrp', network: 'xrp', validUntil: new Date('2026-09-24T15:00:22.742Z') },
		occurredAt: new Date('2026-09-17T15:00:22.742Z'),
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null
	});
	if (!result.ok) throw new Error(`the fixture gift was not recorded: ${result.detail}`);
}

async function postingGroups(): Promise<number> {
	const row = await env.DB.prepare('select count(*) as n from entry_group').first<{ n: number }>();
	return row?.n ?? 0;
}

type PaymentRow = {
	id: string;
	donation_id: string;
	status: string;
	amount_minor: number;
	coin: string | null;
	coin_amount: string | null;
	parent_payment_id: string | null;
};

async function paymentRow(providerTxnId = PAYMENT_ID): Promise<PaymentRow | null> {
	return env.DB.prepare(
		`select id, donation_id, status, amount_minor, coin, coin_amount, parent_payment_id
		 from payment where provider_txn_id = ?`
	)
		.bind(providerTxnId)
		.first<PaymentRow>();
}

/** one IPN, exactly as it arrives on the wire. */
async function deliver(
	payment: Record<string, unknown>,
	signing?: Readonly<Record<string, string>>,
	configEnv: Env = envWith(CONFIGURED)
): Promise<Response> {
	const body = JSON.stringify(payment);
	const headers = new Headers({
		'content-type': 'application/json',
		...(signing ?? { 'x-nowpayments-sig': await signature(payment) })
	});
	return callback(new Request(ADDRESS, { method: 'POST', headers, body }), { env: configEnv });
}

beforeEach(async () => {
	for (const table of [
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
		'contact',
		'form'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
});

describe('POST /api/nowpayments/webhook', () => {
	it.each(['finished', 'partially_paid'])(
		'settles a %s gift at the dollar value of what arrived, and answers 200',
		async (payment_status) => {
			await recordedGift();
			const payment = { ...PAID, payment_status };
			nowpaymentsHolds([payment]);

			const response = await deliver(payment);

			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ outcome: 'posted' });
			expect(await paymentRow()).toMatchObject({
				status: 'succeeded',
				amount_minor: 2487,
				coin: 'xrp',
				coin_amount: '19.36121163'
			});
			const gift = await env.DB.prepare('select total_minor from donation where id = ?')
				.bind(DONATION_ID)
				.first<{ total_minor: number }>();
			expect(gift?.total_minor).toBe(2487);
			expect(await postingGroups()).toBe(1);
		}
	);

	it('answers a redelivery 200 and posts it once', async () => {
		await recordedGift();
		nowpaymentsHolds([PAID]);
		await deliver(PAID);

		const again = await deliver(PAID);

		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ outcome: 'already_posted' });
		expect(await postingGroups()).toBe(1);
	});

	// the notification and the read value the same arrival, on the one adapter the request built.
	it('asks for one estimate for a redelivery of a posted payment', async () => {
		await recordedGift();
		const { calls } = nowpaymentsHolds([PAID]);
		await deliver(PAID);
		calls.length = 0;

		const again = await deliver(PAID);

		expect(await again.json()).toMatchObject({ outcome: 'already_posted' });
		expect(calls.filter((call) => call === 'GET /v1/estimate')).toHaveLength(1);
	});

	it('leaves a gift whose address expired with nothing sent not given, posting nothing', async () => {
		await recordedGift();
		const expired = { ...PAID, payment_status: 'expired', actually_paid: 0 };
		nowpaymentsHolds([expired]);

		const response = await deliver(expired);

		expect(response.status).toBe(200);
		expect(await paymentRow()).toMatchObject({ status: 'cancelled', amount_minor: 2500 });
		expect(await postingGroups()).toBe(0);
	});

	it('answers a notification in a status nobody documented 200, reading and writing nothing', async () => {
		await recordedGift();
		const nowpayments = nowpaymentsHolds([PAID]);

		const response = await deliver({ ...PAID, payment_status: 'wrong_asset_confirmed' });

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ outcome: 'ignored' });
		expect(nowpayments.calls).toEqual([]);
		expect(await paymentRow()).toMatchObject({ status: 'pending' });
		expect(await postingGroups()).toBe(0);
	});

	/**
	 * a repeat deposit NOWPayments minted itself, which the key may not read back: the IPN's own
	 * settlement is what records it.
	 */
	it('records a repeat deposit as a second gift from the same donor, leaving the first untouched', async () => {
		await recordedGift();
		nowpaymentsHolds([PAID]);
		await deliver(PAID);
		const parent = await paymentRow();

		const response = await deliver(REPEAT);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ outcome: 'posted' });
		expect(await paymentRow()).toEqual(parent);
		const child = await paymentRow(CHILD_ID);
		expect(child).toMatchObject({
			status: 'succeeded',
			amount_minor: 514,
			coin: 'xrp',
			coin_amount: '4',
			parent_payment_id: parent?.id
		});
		const gifts = await env.DB.prepare(
			'select id, contact_id, form_id, total_minor, received_at from donation order by received_at'
		).all<{
			id: string;
			contact_id: string;
			form_id: string;
			total_minor: number;
			received_at: number;
		}>();
		expect(gifts.results).toHaveLength(2);
		const [first, second] = gifts.results;
		expect(second).toMatchObject({
			id: child?.donation_id,
			contact_id: first?.contact_id,
			form_id: FORM_ID,
			total_minor: 514,
			received_at: Date.parse('2026-09-18T10:20:00.000Z')
		});
		expect(first?.total_minor).toBe(2487);
		expect(await postingGroups()).toBe(2);
	});

	it('posts a redelivered repeat deposit once', async () => {
		await recordedGift();
		nowpaymentsHolds([PAID]);
		await deliver(PAID);
		await deliver(REPEAT);

		const again = await deliver(REPEAT);

		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ outcome: 'already_posted' });
		expect(await postingGroups()).toBe(2);
	});

	/** a read that answers without naming the first payment: the verified IPN names it. */
	it('records a repeat deposit whose read does not name the first payment', async () => {
		await recordedGift();
		nowpaymentsHolds([PAID, { ...REPEAT, parent_payment_id: null }]);
		await deliver(PAID);
		const parent = await paymentRow();

		const response = await deliver(REPEAT);

		expect(await response.json()).toMatchObject({ outcome: 'posted' });
		expect(await paymentRow(CHILD_ID)).toMatchObject({ parent_payment_id: parent?.id });
	});

	/** the first payment's row is written before its address exists, so no redelivery finds it. */
	it('answers a repeat deposit to an address with no payment here 200, writing nothing', async () => {
		nowpaymentsHolds([]);

		const response = await deliver(REPEAT);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			outcome: 'unmatched',
			message: expect.stringContaining(PAYMENT_ID)
		});
		expect(await postingGroups()).toBe(0);
	});

	it('does not regress a settled gift on an older status arriving late', async () => {
		await recordedGift();
		nowpaymentsHolds([PAID]);
		await deliver(PAID);

		const response = await deliver({ ...PAID, payment_status: 'confirming' });

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ outcome: 'already_posted' });
		expect(await paymentRow()).toMatchObject({ status: 'succeeded', amount_minor: 2487 });
		expect(await postingGroups()).toBe(1);
	});

	it('does not regress a settled gift when the payment read itself reports an earlier state', async () => {
		await recordedGift();
		nowpaymentsHolds([PAID]);
		await deliver(PAID);
		const confirming = { ...PAID, payment_status: 'confirming' };
		nowpaymentsHolds([confirming]);

		const response = await deliver(confirming);

		expect(await response.json()).toMatchObject({ outcome: 'ignored' });
		expect(await paymentRow()).toMatchObject({ status: 'succeeded', amount_minor: 2487 });
		expect(await postingGroups()).toBe(1);
	});

	// its redelivery would be the identical body, so asking for one gains nothing.
	it.each([
		['status', 'payment_status'],
		['payment', 'payment_id']
	])(
		'acknowledges a signed notification naming no %s with a 200, writing nothing',
		async (_case, field) => {
			await recordedGift();
			const { [field]: _none, ...unnamed } = PAID;
			const { calls } = nowpaymentsHolds([PAID]);
			vi.spyOn(console, 'warn').mockImplementation(() => {});

			const response = await deliver(unnamed);

			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ outcome: 'ignored' });
			expect(calls).toEqual([]);
			expect(await paymentRow()).toMatchObject({ status: 'pending' });
			expect(await postingGroups()).toBe(0);
		}
	);

	/** a replaced key reads the payment as missing, and the verified IPN is all there is. */
	it.each([
		['confirming', {}],
		['expired', { actually_paid: 0 }],
		['failed', { actually_paid: 0 }]
	])(
		'does not regress a settled gift on a late %s the payment read cannot confirm',
		async (payment_status, figures) => {
			await recordedGift();
			nowpaymentsHolds([PAID]);
			await deliver(PAID);
			nowpaymentsHolds([]);

			const response = await deliver({ ...PAID, payment_status, ...figures });

			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ outcome: 'ignored' });
			expect(await paymentRow()).toMatchObject({ status: 'succeeded', amount_minor: 2487 });
			expect(await postingGroups()).toBe(1);
		}
	);

	it.each([
		['carrying no signature', {}],
		['signed under another secret', { 'x-nowpayments-sig': 'f'.repeat(128) }],
		['sorted at the top level only', { 'x-nowpayments-sig': SIGNED_TOP_LEVEL }],
		['sorted with its array turned into an object', { 'x-nowpayments-sig': SIGNED_ARRAY_FLATTENED }]
	])(
		'refuses a notification %s with a 400 naming the header, writing nothing',
		async (_case, signing) => {
			await recordedGift();
			const nowpayments = nowpaymentsHolds([PAID]);

			const headers = new Headers({ 'content-type': 'application/json', ...signing });
			const response = await callback(
				new Request(ADDRESS, { method: 'POST', headers, body: IPN }),
				{
					env: envWith(CONFIGURED)
				}
			);

			expect(response.status).toBe(400);
			// a 4xx body is read by agents, so it names the value to fix (CLAUDE.md).
			expect(await response.json()).toMatchObject({
				message: expect.stringContaining('x-nowpayments-sig')
			});
			expect(nowpayments.calls).toEqual([]);
			expect(await paymentRow()).toMatchObject({ status: 'pending' });
			expect(await postingGroups()).toBe(0);
		}
	);

	it('asks for the notification again when this deployment holds no IPN secret', async () => {
		const { NOWPAYMENTS_IPN_SECRET: _unset, ...noSecret } = CONFIGURED;

		const response = await deliver(PAID, undefined, envWith(noSecret));

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			message: expect.stringContaining('NOWPAYMENTS_IPN_SECRET')
		});
	});

	it('tells a browser what the address takes, and reads nothing off it', async () => {
		const nowpayments = nowpaymentsHolds([PAID]);

		const response = await callback(new Request(ADDRESS), { env: envWith(CONFIGURED) });

		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
		expect(nowpayments.calls).toEqual([]);
	});

	it('refuses a mutating method other than POST before verifying anything', async () => {
		const request = new Request(ADDRESS, { method: 'PUT', body: IPN });

		const response = await callback(request, { env: envWith(CONFIGURED) });

		expect(response.status).toBe(405);
		expect(request.bodyUsed).toBe(false);
	});
});

/** `PAID` after NOWPayments sent its coin back to the donor. */
const REFUNDED: Record<string, unknown> = {
	...PAID,
	payment_status: 'refunded',
	updated_at: '2026-09-19T09:30:00.000Z'
};

type RefundRow = {
	provider_txn_id: string;
	amount_minor: number;
	status: string;
	parent_payment_id: string | null;
};

async function refundRows(): Promise<RefundRow[]> {
	const rows = await env.DB.prepare(
		`select provider_txn_id, amount_minor, status, parent_payment_id
		 from payment where direction = 'refund' order by created_at`
	).all<RefundRow>();
	return rows.results;
}

/** each ledger account's balance that is not zero: what the books still hold, across every group. */
async function standingBalances(): Promise<{ account_id: string; balance: number }[]> {
	const rows = await env.DB.prepare(
		`select account_id, sum(amount_minor) as balance from ledger_entry
		 group by account_id having sum(amount_minor) <> 0`
	).all<{ account_id: string; balance: number }>();
	return rows.results;
}

async function giftStatus(donationId = DONATION_ID): Promise<string | undefined> {
	const { donations } = await listDonations(createDb(env.DB));
	return donations.find((gift) => gift.id === donationId)?.status;
}

describe('POST /api/nowpayments/webhook — a refunded payment', () => {
	it('reverses a settled gift at the value it was booked at, and the gift reads refunded', async () => {
		await recordedGift();
		nowpaymentsHolds([PAID]);
		await deliver(PAID);
		const settled = await paymentRow();
		expect(await standingBalances()).not.toEqual([]);
		nowpaymentsHolds([REFUNDED]);

		const response = await deliver(REFUNDED);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ outcome: 'posted' });
		expect(await refundRows()).toEqual([
			{
				provider_txn_id: `${PAYMENT_ID}:refunded`,
				amount_minor: 2487,
				status: 'succeeded',
				parent_payment_id: settled?.id
			}
		]);
		expect(await postingGroups()).toBe(2);
		expect(await standingBalances()).toEqual([]);
		expect(await giftStatus()).toBe('refunded');
	});

	it('posts a refund delivered twice once, under one id that is not the payment’s', async () => {
		await recordedGift();
		nowpaymentsHolds([PAID]);
		await deliver(PAID);
		nowpaymentsHolds([REFUNDED]);
		await deliver(REFUNDED);

		const again = await deliver(REFUNDED);

		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ outcome: 'already_posted' });
		expect((await refundRows()).map((row) => row.provider_txn_id)).toEqual([
			`${PAYMENT_ID}:refunded`
		]);
		expect(await postingGroups()).toBe(2);
		expect(await giftStatus()).toBe('refunded');
	});

	/** an address that saw no coin: nothing settled, so nothing is there to reverse, now or later. */
	it('answers a refund of a payment nothing arrived on 200, writing nothing', async () => {
		await recordedGift();
		const unpaid = { ...REFUNDED, actually_paid: 0 };
		nowpaymentsHolds([unpaid]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const response = await deliver(unpaid);

		expect(warn).toHaveBeenCalledOnce();
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ outcome: 'ignored' });
		expect(await refundRows()).toEqual([]);
		expect(await paymentRow()).toMatchObject({ status: 'pending' });
		expect(await postingGroups()).toBe(0);
	});

	/**
	 * notifications carry no order, and once the refund is made the payment reads `refunded`: the
	 * settlement delivered after it books the gift at what arrived, and the refund delivered again
	 * takes it back out.
	 */
	it('posts a refund that outruns its settlement once the settlement delivered after it books the gift', async () => {
		await recordedGift();
		nowpaymentsHolds([REFUNDED]);

		const early = await deliver(REFUNDED);

		expect(early.status).toBe(503);
		expect(await refundRows()).toEqual([]);

		const settlement = await deliver(PAID);
		const again = await deliver(REFUNDED);

		expect(await settlement.json()).toMatchObject({ outcome: 'posted' });
		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ outcome: 'posted' });
		expect(await refundRows()).toEqual([
			expect.objectContaining({ provider_txn_id: `${PAYMENT_ID}:refunded`, amount_minor: 2487 })
		]);
		expect(await standingBalances()).toEqual([]);
		expect(await giftStatus()).toBe('refunded');
	});

	/**
	 * a deposit held and sent back sends no settlement notification: the scheduled read finds the
	 * payment still pending here, books it at what arrived, and the refund delivered again reverses it.
	 */
	it('posts a refund of a deposit that never settled once the scheduled read books it', async () => {
		await recordedGift();
		const now = new Date();
		await env.DB.prepare(
			`update payment set created_at = ?, valid_until = ? where provider_txn_id = ?`
		)
			.bind(now.getTime() - 60 * 60_000, now.getTime() + 24 * 60 * 60_000, PAYMENT_ID)
			.run();
		nowpaymentsHolds([REFUNDED]);

		const early = await deliver(REFUNDED);

		expect(early.status).toBe(503);

		await readPendingCryptoGifts(
			{
				db: createDb(env.DB),
				processors: createPaymentProviders(envWith(CONFIGURED)),
				email: { send: async () => ({ ok: true }) }
			},
			now
		);
		const again = await deliver(REFUNDED);

		expect(await paymentRow()).toMatchObject({ status: 'succeeded', amount_minor: 2487 });
		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ outcome: 'posted' });
		expect(await refundRows()).toHaveLength(1);
		expect(await standingBalances()).toEqual([]);
		expect(await giftStatus()).toBe('refunded');
	});

	/**
	 * a repeat deposit the key cannot read back settles and is refunded from its signed notifications,
	 * so its refund, held open until the deposit is recorded, is posted by the delivery after.
	 */
	it('asks again for a refund that outruns its repeat deposit, and posts it once the deposit is recorded', async () => {
		await recordedGift();
		nowpaymentsHolds([PAID]);
		await deliver(PAID);
		const refunded = { ...REPEAT, payment_status: 'refunded' };

		const early = await deliver(refunded);

		expect(early.status).toBe(503);
		expect(await refundRows()).toEqual([]);

		await deliver(REPEAT);
		const child = await paymentRow(CHILD_ID);
		const later = await deliver(refunded);

		expect(later.status).toBe(200);
		expect(await later.json()).toMatchObject({ outcome: 'posted' });
		expect(await refundRows()).toEqual([
			{
				provider_txn_id: `${CHILD_ID}:refunded`,
				amount_minor: 514,
				status: 'succeeded',
				parent_payment_id: child?.id
			}
		]);
		expect(await giftStatus(child?.donation_id)).toBe('refunded');
		expect(await giftStatus()).toBe('completed');
	});

	/** the waiting screen says the coin arrived, and a refund afterwards is not the donor's to be shown. */
	it('leaves the donation form’s poll answering as it did before the refund', async () => {
		await recordedGift();
		nowpaymentsHolds([PAID]);
		await deliver(PAID);
		const before = await pollAnswer();
		nowpaymentsHolds([REFUNDED]);

		await deliver(REFUNDED);

		expect(await refundRows()).toHaveLength(1);
		expect(before).toEqual({ status: 200, body: { state: 'received' } });
		expect(await pollAnswer()).toEqual(before);
	});
});

const poll = mountRoutes([
	{ path: 'api/v1', module: surface },
	{ path: 'forms/:id/donations/:donationId', module: giftStanding }
]);

/** `GET /api/v1/forms/:id/donations/:donationId`, the read the form's waiting screen polls. */
async function pollAnswer(): Promise<{ status: number; body: unknown }> {
	const response = await poll(
		new Request(
			`https://give.example.workers.dev/api/v1/forms/${FORM_ID}/donations/${DONATION_ID}`,
			{
				headers: { 'cf-connecting-ip': '203.0.113.77' }
			}
		),
		{ env }
	);
	return { status: response.status, body: await response.json() };
}
