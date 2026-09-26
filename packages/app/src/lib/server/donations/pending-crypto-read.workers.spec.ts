import {
	createExecutionContext,
	createScheduledController,
	env,
	waitOnExecutionContext
} from 'cloudflare:test';
import { createHmac } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseContact } from '../contacts/contact-input';
import { createDb, type Db } from '../db/client';
import type { PostableAccountId } from '../db/postable';
import { entryGroup, payment } from '../db/schema';
import type { EmailMessage, EmailProvider } from '../email/provider';
import { createPaymentProviders } from '../payments/factory';
import { soleProcessor } from '../payments/processors.testing';
import type { PaymentProvider } from '../payments/provider';
import { readPendingCryptoGifts } from './pending-crypto-read';
import { recordDonation } from './record';
import { settleDelivery } from './settle';
import worker from '../../../worker';

// the scheduled read, against a real D1 and the real NOWPayments adapter over a `fetch` that answers
// by route — the seam ../payments/nowpayments.spec.ts takes, one level up, with that file's bodies.
//
// ./vitest.workers.config.ts sets `unstubGlobals` and `restoreMocks`, so a stubbed `fetch` is taken
// back before the next case.

const FORM_ID = 'frm_cryptoread00001';
const PAYMENT_ID = '5745459419';
/** the run's scheduled time, taken from the clock so the read's deadline is measured from it. */
const NOW = new Date();
const MINUTE = 60_000;

let db: Db;
let revenueAccountId: PostableAccountId;

beforeAll(async () => {
	db = createDb(env.DB);
	const row = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!row) throw new Error('no 4110 account in migrations/0000_initial_schema.sql');
	revenueAccountId = row.id as PostableAccountId;
});

beforeEach(async () => {
	for (const table of [
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
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
		.bind(FORM_ID, revenueAccountId)
		.run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.',
		         '1 Main St', 'Springfield', 'US', 'ops@hope.example', 0, 0)`
	).run();
});

/** a pending crypto gift as a quote leaves it, minted `ageMinutes` before `NOW`. */
async function pendingCrypto(
	over: { providerTxnId?: string; ageMinutes?: number; validUntil?: Date } = {}
): Promise<{ donationId: string; paymentId: string }> {
	const parsed = parseContact({
		kind: 'individual',
		first_name: 'Ada',
		last_name: 'Okafor',
		primary_email: 'ada@example.org'
	});
	if (!parsed.ok) throw new Error('the fixture donor did not parse');
	const donationId = crypto.randomUUID();
	const result = await recordDonation(db, {
		donationId,
		donor: parsed.value,
		formId: FORM_ID,
		origin: 'https://acme.org',
		currency: 'USD',
		processor: 'nowpayments',
		totalMinor: 2_500,
		feeMinor: 0,
		lines: [{ label: 'Donation', revenueAccountId, amountMinor: 2_500 }],
		method: 'crypto',
		providerTxnId: over.providerTxnId ?? PAYMENT_ID,
		deposit: {
			coin: 'xrp',
			network: 'xrp',
			validUntil: over.validUntil ?? new Date(NOW.getTime() - 5 * MINUTE)
		},
		occurredAt: NOW,
		consentedToContact: false,
		note: undefined,
		tribute: null,
		programId: null
	});
	if (!result.ok) throw new Error(`the fixture gift was not recorded: ${result.detail}`);
	const createdAt = NOW.getTime() - (over.ageMinutes ?? 60) * MINUTE;
	await env.DB.prepare('update payment set created_at = ? where id = ?')
		.bind(createdAt, result.value.paymentId)
		.run();
	return { donationId, paymentId: result.value.paymentId };
}

/** `GET /v1/payment/:id` as NOWPayments answers it for a payment still waiting. */
const READ = {
	payment_id: Number(PAYMENT_ID),
	invoice_id: null,
	payment_status: 'waiting',
	pay_address: 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY',
	payin_extra_id: '2918473650',
	price_amount: 25,
	price_currency: 'usd',
	pay_amount: 19.36121163,
	actually_paid: 0,
	actually_paid_at_fiat: 0,
	pay_currency: 'xrp',
	order_id: null,
	order_description: null,
	purchase_id: 5837122679,
	outcome_amount: 24.1,
	outcome_currency: 'usdttrc20',
	payout_hash: null,
	payin_hash: null,
	created_at: '2026-09-17T15:00:22.742Z',
	updated_at: '2026-09-17T15:40:10.120Z',
	burning_percent: 'null',
	type: 'crypto2crypto',
	payment_extra_ids: []
};

type Answer = { readonly status: number; readonly json?: unknown };

/** an account taking XRP and paid out in USDTTRC20, as `listPayableCoins` reads it. */
const XRP = {
	id: 22,
	code: 'XRP',
	name: 'Ripple',
	enable: true,
	network: 'xrp',
	ticker: 'xrp',
	smart_contract: null,
	precision: 8,
	network_precision: '6',
	extra_id_exists: true,
	extra_id_optional: true,
	extra_id_regex: '^([0-9]{1,19})$',
	available_for_payment: true,
	available_for_payout: true,
	is_maxlimit: false
};
const ACCOUNT: Readonly<Record<string, Answer>> = {
	'/v1/merchant/coins': { status: 200, json: { selectedCurrencies: ['XRP'] } },
	'/v1/full-currencies': {
		status: 200,
		json: {
			currencies: [
				XRP,
				{
					...XRP,
					id: 52,
					code: 'USDTTRC20',
					name: 'Tether USD (Tron)',
					network: 'trx',
					ticker: 'usdt'
				}
			]
		}
	}
};

/** a `fetch` answering `GET /v1/payment/:id` from `payments`, recording every path it was asked. */
function serving(payments: Readonly<Record<string, Answer>>): string[] {
	const asked: string[] = [];
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		const url = new URL(request.url);
		asked.push(`${request.method} ${url.pathname}`);
		const id = url.pathname.match(/^\/v1\/payment\/(\d+)$/)?.[1];
		const answer =
			request.method !== 'GET'
				? undefined
				: id !== undefined
					? payments[id]
					: ACCOUNT[url.pathname];
		if (answer === undefined) throw new Error(`unscripted request: ${request.method} ${url}`);
		return Response.json(answer.json ?? null, { status: answer.status });
	});
	return asked;
}

/** the payment read back with this donation named on it, in `payment_status`. */
function read(donationId: string, over: Record<string, unknown> = {}): Answer {
	return { status: 200, json: { ...READ, order_id: donationId, ...over } };
}

const NOWPAYMENTS_ENV = {
	NOWPAYMENTS_API_KEY: 'notarealnowpaymentskey',
	NOWPAYMENTS_OUTCOME_CURRENCY: 'usdttrc20',
	NOWPAYMENTS_IPN_SECRET: 'notarealipnsecret'
};

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

function deps(source: unknown = NOWPAYMENTS_ENV, email: EmailProvider = mailer().port) {
	return { db, processors: createPaymentProviders(source), email };
}

async function statusOf(paymentId: string) {
	const [row] = await db.select().from(payment).where(eq(payment.id, paymentId));
	return row?.status;
}

async function postings(paymentId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(entryGroup)
		.where(sql`${entryGroup.sourceType} = 'payment' and ${entryGroup.sourceId} = ${paymentId}`);
	return row?.n ?? 0;
}

describe('readPendingCryptoGifts()', () => {
	it('leaves a gift whose address expired with nothing sent not given', async () => {
		const gift = await pendingCrypto();
		serving({ [PAYMENT_ID]: read(gift.donationId, { payment_status: 'expired' }) });

		await readPendingCryptoGifts(deps(), NOW);

		expect(await statusOf(gift.paymentId)).toBe('cancelled');
		expect(await postings(gift.paymentId)).toBe(0);
	});

	it('settles what arrived at an address that expired part paid', async () => {
		const gift = await pendingCrypto();
		serving({
			[PAYMENT_ID]: read(gift.donationId, {
				payment_status: 'expired',
				actually_paid: 12.5,
				actually_paid_at_fiat: 16.14
			})
		});

		await readPendingCryptoGifts(deps(), NOW);

		const [row] = await db.select().from(payment).where(eq(payment.id, gift.paymentId));
		expect(row).toMatchObject({ status: 'succeeded', amountMinor: 1_614, coinAmount: '12.5' });
		expect(await postings(gift.paymentId)).toBe(1);
	});

	it('reads a gift minted thirty minutes ago whose IPN never came, and not one minted since', async () => {
		const older = await pendingCrypto({
			ageMinutes: 30,
			validUntil: new Date(NOW.getTime() + 60 * MINUTE)
		});
		const newer = await pendingCrypto({ providerTxnId: '5745459420', ageMinutes: 29 });
		const asked = serving({
			[PAYMENT_ID]: read(older.donationId, {
				payment_status: 'finished',
				actually_paid: 19.36121163,
				actually_paid_at_fiat: 25
			})
		});

		await readPendingCryptoGifts(deps(), NOW);

		expect(await statusOf(older.paymentId)).toBe('succeeded');
		expect(asked.filter((path) => path.startsWith('GET /v1/payment/'))).toEqual([
			`GET /v1/payment/${PAYMENT_ID}`
		]);
		expect(await statusOf(newer.paymentId)).toBe('pending');
	});

	it('receipts each gift by the coin’s name, reading the account’s coins once', async () => {
		const first = await pendingCrypto({ ageMinutes: 90 });
		const second = await pendingCrypto({ providerTxnId: '5745459420', ageMinutes: 60 });
		const arrived = {
			payment_status: 'finished',
			actually_paid: 19.36121163,
			actually_paid_at_fiat: 25
		};
		const asked = serving({
			[PAYMENT_ID]: read(first.donationId, arrived),
			'5745459420': read(second.donationId, { ...arrived, payment_id: 5745459420 })
		});
		const mail = mailer();

		await readPendingCryptoGifts(deps(NOWPAYMENTS_ENV, mail.port), NOW);

		const receipts = mail.sent.filter((m) => m.to === 'ada@example.org');
		expect(receipts).toHaveLength(2);
		expect(receipts.every((m) => m.text.includes('Ripple'))).toBe(true);
		expect(asked.filter((path) => path === 'GET /v1/merchant/coins')).toHaveLength(1);
	});

	it('posts a gift once when its IPN lands during the read', async () => {
		const gift = await pendingCrypto();
		const finished = {
			...READ,
			order_id: gift.donationId,
			payment_status: 'finished',
			actually_paid: 19.36121163,
			actually_paid_at_fiat: 25
		};
		serving({ [PAYMENT_ID]: { status: 200, json: finished } });
		const sorted = Object.fromEntries(
			Object.entries(finished).sort(([a], [b]) => (a < b ? -1 : 1))
		);
		const ipn = {
			body: JSON.stringify(finished),
			headers: {
				'x-nowpayments-sig': createHmac('sha512', NOWPAYMENTS_ENV.NOWPAYMENTS_IPN_SECRET)
					.update(JSON.stringify(sorted))
					.digest('hex')
			}
		};
		const mail = mailer();
		const both = deps(NOWPAYMENTS_ENV, mail.port);

		const [delivered] = await Promise.all([
			settleDelivery(
				{
					db,
					provider: both.processors.for('nowpayments'),
					processors: both.processors,
					email: both.email
				},
				ipn
			),
			readPendingCryptoGifts(both, NOW)
		]);

		expect(delivered.ok).toBe(true);
		expect(await statusOf(gift.paymentId)).toBe('succeeded');
		expect(await postings(gift.paymentId)).toBe(1);
		expect(mail.sent.filter((m) => m.to === 'ada@example.org')).toHaveLength(1);
	});

	it('leaves a gift the key cannot read as it is, and mails nobody', async () => {
		const gift = await pendingCrypto();
		const asked = serving({
			[PAYMENT_ID]: { status: 404, json: { message: 'Payment not found' } }
		});
		const mail = mailer();

		await readPendingCryptoGifts(deps(NOWPAYMENTS_ENV, mail.port), NOW);

		expect(asked).toEqual([`GET /v1/payment/${PAYMENT_ID}`]);
		expect(await statusOf(gift.paymentId)).toBe('pending');
		expect(mail.sent).toEqual([]);
	});

	it('stops reading a gift a day after its address closed', async () => {
		const closedADayAgo = await pendingCrypto({
			ageMinutes: 26 * 60,
			validUntil: new Date(NOW.getTime() - 24 * 60 * MINUTE)
		});
		const closedJustUnder = await pendingCrypto({
			providerTxnId: '5745459420',
			ageMinutes: 25 * 60,
			validUntil: new Date(NOW.getTime() - 24 * 60 * MINUTE + MINUTE)
		});
		const asked = serving({
			'5745459420': read(closedJustUnder.donationId, {
				payment_id: 5745459420,
				payment_status: 'expired'
			})
		});

		await readPendingCryptoGifts(deps(), NOW);

		expect(asked).toEqual(['GET /v1/payment/5745459420']);
		expect(await statusOf(closedADayAgo.paymentId)).toBe('pending');
		expect(await statusOf(closedJustUnder.paymentId)).toBe('cancelled');
	});

	it('tells an operator about a read NOWPayments refused for any other reason', async () => {
		const gift = await pendingCrypto();
		serving({ [PAYMENT_ID]: { status: 400, json: { message: 'Bad request' } } });
		const mail = mailer();

		await readPendingCryptoGifts(deps(NOWPAYMENTS_ENV, mail.port), NOW);

		expect(await statusOf(gift.paymentId)).toBe('pending');
		expect(mail.sent.filter((m) => m.to === 'ops@hope.example')).toHaveLength(1);
	});

	it('stops the run at the first read NOWPayments did not answer', async () => {
		await pendingCrypto({ ageMinutes: 90 });
		const next = await pendingCrypto({ providerTxnId: '5745459420', ageMinutes: 60 });
		const asked = serving({
			[PAYMENT_ID]: { status: 429, json: { message: 'Too many requests' } },
			'5745459420': read(next.donationId, { payment_id: 5745459420, payment_status: 'expired' })
		});

		await readPendingCryptoGifts(deps(), NOW);

		expect(asked).toEqual([`GET /v1/payment/${PAYMENT_ID}`]);
		expect(await statusOf(next.paymentId)).toBe('pending');
	});

	it('reads gifts whose address has closed before gifts whose address is open', async () => {
		const open = await pendingCrypto({
			ageMinutes: 90,
			validUntil: new Date(NOW.getTime() + 60 * MINUTE)
		});
		const closed = await pendingCrypto({ providerTxnId: '5745459420', ageMinutes: 60 });
		const asked = serving({
			[PAYMENT_ID]: read(open.donationId),
			'5745459420': read(closed.donationId, { payment_id: 5745459420, payment_status: 'expired' })
		});

		await readPendingCryptoGifts(deps(), NOW);

		expect(asked).toEqual(['GET /v1/payment/5745459420', `GET /v1/payment/${PAYMENT_ID}`]);
	});

	it('starts no read ten minutes after the run was scheduled', async () => {
		const gift = await pendingCrypto();
		const asked = serving({
			[PAYMENT_ID]: read(gift.donationId, { payment_status: 'expired' })
		});

		await readPendingCryptoGifts(deps(), new Date(NOW.getTime() - 10 * MINUTE));

		expect(asked).toEqual([]);
		expect(await statusOf(gift.paymentId)).toBe('pending');
	});

	it('reads a hundred gifts a run, oldest first', async () => {
		const ids = Array.from({ length: 101 }, (_, n) => String(6_000_000_000 + n));
		const answers: Record<string, Answer> = {};
		for (const [n, id] of ids.entries()) {
			const gift = await pendingCrypto({ providerTxnId: id, ageMinutes: 200 - n });
			answers[id] = read(gift.donationId, { payment_id: Number(id) });
		}
		const asked = serving(answers);

		await readPendingCryptoGifts(deps(), NOW);

		const reads = asked.filter((path) => path.startsWith('GET /v1/payment/'));
		expect(reads).toHaveLength(100);
		expect(reads[0]).toBe(`GET /v1/payment/${ids[0]}`);
		expect(reads).not.toContain(`GET /v1/payment/${ids[100]}`);
	});

	it('goes on to the next gift when one faults', async () => {
		const faulting = await pendingCrypto({ ageMinutes: 90 });
		const next = await pendingCrypto({ providerTxnId: '5745459420', ageMinutes: 60 });
		const nowpayments = createPaymentProviders(NOWPAYMENTS_ENV).for('nowpayments');
		serving({
			'5745459420': read(next.donationId, {
				payment_id: 5745459420,
				payment_status: 'expired'
			})
		});
		const port: PaymentProvider = {
			...nowpayments,
			async readSettlement(id) {
				if (id === PAYMENT_ID) throw new Error('the isolate went away');
				return nowpayments.readSettlement(id);
			}
		};

		await readPendingCryptoGifts(
			{ db, processors: soleProcessor(port), email: mailer().port },
			NOW
		);

		expect(await statusOf(faulting.paymentId)).toBe('pending');
		expect(await statusOf(next.paymentId)).toBe('cancelled');
	});
});

describe('readPendingCryptoGifts() on a deployment holding no NOWPayments key', () => {
	it('asks nobody and tells nobody', async () => {
		const gift = await pendingCrypto();
		const asked = serving({});
		const mail = mailer();

		await readPendingCryptoGifts(deps({}, mail.port), NOW);

		expect(asked).toEqual([]);
		expect(mail.sent).toEqual([]);
		expect(await statusOf(gift.paymentId)).toBe('pending');
	});
});

describe('the worker’s scheduled handler', () => {
	it('settles a pending crypto gift from the env the run was handed', async () => {
		const gift = await pendingCrypto();
		serving({ [PAYMENT_ID]: read(gift.donationId, { payment_status: 'expired' }) });
		const ctx = createExecutionContext();

		await worker.scheduled(
			createScheduledController({ scheduledTime: NOW, cron: '*/30 * * * *' }),
			{ ...env, ...NOWPAYMENTS_ENV },
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(await statusOf(gift.paymentId)).toBe('cancelled');
	});
});
