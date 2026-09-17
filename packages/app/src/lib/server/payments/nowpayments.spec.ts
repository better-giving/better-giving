import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createNowpaymentsProvider } from './nowpayments';
import { DONATION_METADATA_KEY, isRetryable, type IntentRequest } from './provider';

// the adapter, exercised through a `fetch` that answers by route.
//
// by route rather than by script, because the coin reads run side by side and their order is not
// the adapter's contract. `fetch` is where this adapter's transport bottoms out — no SDK sits between
// it and NOWPayments — so what is recorded is what NOWPayments would receive.
//
// every body below is the shape the live API answered on 2026-09-17 (read-only `GET`s against this
// deployment's key), not the shape the docs print: `min_amount` is a number, `estimated_amount` a
// string, merchant codes uppercase. `POST /v1/payment` was never called live; its answer is the
// Postman collection's example.
//
// ./vitest.config.ts sets `unstubGlobals` and `restoreMocks`, so a stub installed here is taken back
// before the next test runs.

type Recorded = {
	readonly method: string;
	readonly url: URL;
	readonly key: string | null;
	readonly body: string;
};

type Answer = { readonly status: number; readonly json?: unknown; readonly text?: string };

/**
 * a `fetch` that answers each request from `route`, and remembers what it was asked.
 *
 * a route answering `undefined` is an unscripted request and throws: a case that made a call it did
 * not script is a case whose subject did something it was not asked to.
 */
function serving(route: (method: string, url: URL) => Answer | undefined): Recorded[] {
	const calls: Recorded[] = [];
	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		const url = new URL(request.url);
		calls.push({
			method: request.method,
			url,
			key: request.headers.get('x-api-key'),
			body: await request.clone().text()
		});
		const answer = route(request.method, url);
		if (answer === undefined) throw new Error(`unscripted request: ${request.method} ${url}`);
		if (answer.text !== undefined) return new Response(answer.text, { status: answer.status });
		return Response.json(answer.json ?? null, { status: answer.status });
	});
	return calls;
}

const CREDENTIALS = {
	apiKey: 'notarealnowpaymentskey',
	outcomeCurrency: 'usdttrc20',
	ipnSecret: 'notarealipnsecret'
};

const BTC = {
	id: 1,
	code: 'BTC',
	name: 'Bitcoin',
	enable: true,
	network: 'btc',
	ticker: 'btc',
	smart_contract: null,
	precision: 8,
	network_precision: '8',
	extra_id_exists: false,
	extra_id_optional: false,
	extra_id_regex: null,
	available_for_payment: true,
	available_for_payout: true,
	is_maxlimit: false
};
const XRP = {
	...BTC,
	id: 22,
	code: 'XRP',
	name: 'Ripple',
	network: 'xrp',
	ticker: 'xrp',
	network_precision: '6',
	extra_id_exists: true,
	extra_id_optional: true,
	extra_id_regex: '^([0-9]{1,19})$'
};
const USDTTRC20 = {
	...BTC,
	id: 52,
	code: 'USDTTRC20',
	name: 'Tether USD (Tron)',
	network: 'trx',
	ticker: 'usdt',
	smart_contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
	precision: 6
};
const EOS = {
	...BTC,
	id: 9,
	code: 'EOS',
	name: 'EOS',
	network: 'eos',
	ticker: 'eos',
	extra_id_exists: true,
	extra_id_optional: false,
	available_for_payment: false
};
const LUNA = {
	...BTC,
	id: 90,
	code: 'LUNA',
	name: 'Terra',
	network: 'luna',
	ticker: 'luna',
	extra_id_exists: true,
	extra_id_optional: false
};
const SOL = { ...BTC, id: 70, code: 'SOL', name: 'Solana', network: 'sol', ticker: 'sol' };

const MIN_AMOUNTS: Record<string, unknown> = {
	btc: {
		currency_from: 'btc',
		currency_to: 'usdttrc20',
		min_amount: 0.0001701,
		fiat_equivalent: 12.9010644
	},
	xrp: {
		currency_from: 'xrp',
		currency_to: 'usdttrc20',
		min_amount: 9.277067,
		fiat_equivalent: 11.93551831
	},
	usdttrc20: {
		currency_from: 'usdttrc20',
		currency_to: 'usdttrc20',
		min_amount: 11.413953,
		fiat_equivalent: 11.41045951
	},
	luna: { currency_from: 'luna', currency_to: 'usdttrc20', min_amount: 3.5, fiat_equivalent: 1.2 },
	sol: { currency_from: 'sol', currency_to: 'usdttrc20', min_amount: 0.07, fiat_equivalent: 12.1 }
};

/**
 * an account that enabled BTC, XRP, USDTTRC20, EOS and LUNA, where SOL is listed but not enabled, EOS
 * is enabled but not payable, and LUNA's minimum does not answer.
 */
function account(method: string, url: URL): Answer | undefined {
	if (method !== 'GET') return undefined;
	if (url.pathname === '/v1/merchant/coins') {
		return {
			status: 200,
			json: { selectedCurrencies: ['BTC', 'XRP', 'USDTTRC20', 'EOS', 'LUNA'] }
		};
	}
	if (url.pathname === '/v1/full-currencies') {
		return { status: 200, json: { currencies: [BTC, XRP, USDTTRC20, EOS, LUNA, SOL] } };
	}
	if (url.pathname === '/v1/min-amount') {
		const from = url.searchParams.get('currency_from') ?? '';
		const found = MIN_AMOUNTS[from];
		if (from === 'luna' || found === undefined) {
			return {
				status: 400,
				json: {
					status: false,
					statusCode: 400,
					code: 'BAD_REQUEST',
					message: `Currency ${from} is not convertable to usdttrc20 now`
				}
			};
		}
		return { status: 200, json: found };
	}
	return undefined;
}

describe('listPayableCoins — the coins the account takes', () => {
	it('offers the coins the account enabled and NOWPayments takes payment in', async () => {
		serving(account);

		const result = await createNowpaymentsProvider(CREDENTIALS).listPayableCoins();

		expect(result).toEqual({
			ok: true,
			value: [
				{ coin: 'btc', name: 'Bitcoin', network: 'btc', ticker: 'btc', memoRequired: false },
				{ coin: 'xrp', name: 'Ripple', network: 'xrp', ticker: 'xrp', memoRequired: false },
				{
					coin: 'usdttrc20',
					name: 'Tether USD (Tron)',
					network: 'trx',
					ticker: 'usdt',
					memoRequired: false
				},
				{ coin: 'luna', name: 'Terra', network: 'luna', ticker: 'luna', memoRequired: true }
			]
		});
	});

	it('carries the ticker lowercased, and drops a coin whose ticker cannot be read', async () => {
		serving((method, url) => {
			if (url.pathname === '/v1/merchant/coins') {
				return { status: 200, json: { selectedCurrencies: ['USDTTRC20', 'BTC'] } };
			}
			if (url.pathname === '/v1/full-currencies') {
				const { ticker: _dropped, ...untickered } = BTC;
				return {
					status: 200,
					json: { currencies: [{ ...USDTTRC20, ticker: 'USDT' }, untickered] }
				};
			}
			return account(method, url);
		});

		const result = await createNowpaymentsProvider(CREDENTIALS).listPayableCoins();

		expect(result).toEqual({
			ok: true,
			value: [
				{
					coin: 'usdttrc20',
					name: 'Tether USD (Tron)',
					network: 'trx',
					ticker: 'usdt',
					memoRequired: false
				}
			]
		});
	});

	// the list is read by a public config boot; a minimum per coin would be hundreds of subrequests on
	// one cold read, so a coin's floor is asked only when a donor picks it (`createIntent`).
	it('reads the account’s two coin lists and asks no minimum', async () => {
		const calls = serving(account);

		await createNowpaymentsProvider(CREDENTIALS).listPayableCoins();

		expect(calls.map((call) => call.url.pathname).sort()).toEqual([
			'/v1/full-currencies',
			'/v1/merchant/coins'
		]);
		expect(calls.every((call) => call.key === 'notarealnowpaymentskey')).toBe(true);
	});

	it('refuses as unconfigured where NOWPayments rejects the key, naming it', async () => {
		serving(() => ({
			status: 403,
			json: { status: false, statusCode: 403, code: 'INVALID_API_KEY', message: 'Invalid api key' }
		}));

		const result = await createNowpaymentsProvider(CREDENTIALS).listPayableCoins();

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false ? result.detail : '').toContain('NOWPAYMENTS_API_KEY');
		expect(result.ok === false ? result.detail : '').not.toContain('notarealnowpaymentskey');
	});

	// served, crypto would fail every quote at the last step (`createIntent`'s own check).
	it('refuses as unconfigured where the payout coin is one NOWPayments does not know', async () => {
		serving(account);

		const result = await createNowpaymentsProvider({
			...CREDENTIALS,
			outcomeCurrency: 'usdtrc20'
		}).listPayableCoins();

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false ? result.detail : '').toContain('NOWPAYMENTS_OUTCOME_CURRENCY');
	});

	// the rails read and the coin list are one config load on one provider, built per request.
	it('reads the account’s selection once across a config load', async () => {
		const calls = serving(account);
		const provider = createNowpaymentsProvider(CREDENTIALS);

		await Promise.all([
			provider.readAccountChargeability(),
			provider.readRailSwitchboard(),
			provider.listPayableCoins()
		]);

		expect(calls.filter((call) => call.url.pathname === '/v1/merchant/coins')).toHaveLength(1);
	});

	// a crypto quote reads the config, then mints: the create's own coin check asks nothing again.
	it('reads each coin list once across a config load and the payment it mints', async () => {
		const calls = serving(minting());
		const provider = createNowpaymentsProvider(CREDENTIALS);

		await provider.listPayableCoins();
		await provider.createIntent(REQUEST);

		const paths = calls.map((call) => call.url.pathname);
		expect(paths.filter((path) => path === '/v1/merchant/coins')).toHaveLength(1);
		expect(paths.filter((path) => path === '/v1/full-currencies')).toHaveLength(1);
	});
});

// the adapter reads no rail off the request: every payment it mints is paid in a coin.
const RAIL = 'crypto' as unknown as IntentRequest['method'];

const DONATION_ID = '01920000-0000-7000-8000-000000000001';

const REQUEST: IntentRequest = {
	amountMinor: 2500,
	currency: 'USD',
	method: RAIL,
	idempotencyKey: DONATION_ID,
	deploymentOrigin: 'https://donate.example.org',
	coin: 'xrp',
	metadata: { [DONATION_METADATA_KEY]: DONATION_ID, gift_minor: '2475' }
};

const CREATED = {
	payment_id: '5745459419',
	payment_status: 'waiting',
	pay_address: 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY',
	price_amount: 25,
	price_currency: 'usd',
	pay_amount: 19.36121163,
	pay_currency: 'xrp',
	order_id: DONATION_ID,
	ipn_callback_url: 'https://donate.example.org/api/nowpayments/webhook',
	created_at: '2026-09-17T15:00:22.742Z',
	updated_at: '2026-09-17T15:00:22.742Z',
	purchase_id: '5837122679',
	amount_received: null,
	payin_extra_id: '2918473650',
	smart_contract: '',
	network: 'xrp',
	network_precision: 6,
	time_limit: null,
	burning_percent: null,
	expiration_estimate_date: '2026-09-18T15:00:22.742Z',
	is_fixed_rate: false,
	is_fee_paid_by_user: false,
	valid_until: '2026-09-24T15:00:22.742Z',
	type: 'crypto2crypto'
};

/** the account above, pricing $25 at 19.36121163 XRP and minting `created` for the payment. */
function minting(created: Answer = { status: 201, json: CREATED }, estimate = '19.36121163') {
	return (method: string, url: URL): Answer | undefined => {
		if (method === 'GET' && url.pathname === '/v1/estimate') {
			return {
				status: 200,
				json: {
					currency_from: 'usd',
					amount_from: Number(url.searchParams.get('amount')),
					currency_to: url.searchParams.get('currency_to'),
					estimated_amount: estimate
				}
			};
		}
		if (method === 'POST' && url.pathname === '/v1/payment') return created;
		return account(method, url);
	};
}

describe('createIntent — a payment minted to an address', () => {
	it('mints a floating-rate payment carrying the gift and this deployment’s callback', async () => {
		const calls = serving(minting());

		await createNowpaymentsProvider(CREDENTIALS).createIntent(REQUEST);

		const created = calls.filter((call) => call.method === 'POST');
		expect(created).toHaveLength(1);
		expect(created[0]?.url.href).toBe('https://api.nowpayments.io/v1/payment');
		expect(created[0]?.key).toBe('notarealnowpaymentskey');
		expect(JSON.parse(created[0]?.body ?? '')).toStrictEqual({
			price_amount: 25,
			price_currency: 'usd',
			pay_currency: 'xrp',
			order_id: DONATION_ID,
			ipn_callback_url: 'https://donate.example.org/api/nowpayments/webhook',
			is_fixed_rate: false,
			is_fee_paid_by_user: false
		});
	});

	it('answers the address, the coin amount, the memo and the expiry', async () => {
		serving(minting());

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result).toEqual({
			ok: true,
			value: {
				providerTxnId: '5745459419',
				paymentToken: DONATION_ID,
				deposit: {
					address: 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY',
					memo: '2918473650',
					coin: 'xrp',
					network: 'xrp',
					coinAmount: '19.36121163',
					validUntil: new Date('2026-09-24T15:00:22.742Z')
				}
			}
		});
	});

	it('reads an expiry from the time created where the payment names none', async () => {
		const { valid_until: _, ...undated } = CREATED;
		serving(minting({ status: 201, json: { ...undated, payin_extra_id: null } }));

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok && result.value.deposit?.validUntil).toEqual(
			new Date('2026-09-24T15:00:22.742Z')
		);
		expect(result.ok && result.value.deposit?.memo).toBeNull();
	});

	// a wei-scale figure is past what a double holds; the donor is shown the digits NOWPayments sent.
	it('carries the coin amount as the digits NOWPayments sent', async () => {
		serving(
			minting({
				status: 201,
				text: JSON.stringify({ ...CREATED, pay_amount: 0 }).replace(
					'"pay_amount":0',
					'"pay_amount":19.361211630000000001'
				)
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok && result.value.deposit?.coinAmount).toBe('19.361211630000000001');
	});

	// the coin arrived from a browser, so it is checked against the account before anything is priced.
	it('creates nothing in a coin the account does not take', async () => {
		const calls = serving(minting());

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent({
			...REQUEST,
			coin: 'sol'
		});

		expect(result.ok === false && result.reason).toBe('coin_not_accepted');
		expect(result.ok === false ? result.detail : '').toContain('sol');
		expect(calls.some((call) => call.method === 'POST')).toBe(false);
	});

	// NOWPayments takes a deposit under the floor and lands it as failed or part-paid, never as a gift.
	it('creates nothing where the gift converts to less than the coin’s minimum, naming it in dollars', async () => {
		const calls = serving(minting(undefined, '0.38722423'));

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent({
			...REQUEST,
			amountMinor: 50
		});

		expect(result.ok === false && result.reason).toBe('below_minimum');
		expect(result.ok === false ? result.detail : '').toContain('$11.94');
		expect(calls.some((call) => call.method === 'POST')).toBe(false);
		const estimate = calls.find((call) => call.url.pathname === '/v1/estimate');
		expect(Object.fromEntries(estimate?.url.searchParams ?? [])).toEqual({
			amount: '0.50',
			currency_from: 'usd',
			currency_to: 'xrp'
		});
		const minimum = calls.find((call) => call.url.pathname === '/v1/min-amount');
		expect(minimum?.url.searchParams.get('currency_from')).toBe('xrp');
		expect(minimum?.url.searchParams.get('currency_to')).toBe('usdttrc20');
		expect(minimum?.url.searchParams.get('fiat_equivalent')).toBe('usd');
	});

	// $11.93551831 is under $11.94; a figure rounded down would be refused again.
	it('states the minimum as a charge in whole cents, rounded up', async () => {
		serving(minting(undefined, '0.38722423'));

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent({
			...REQUEST,
			amountMinor: 50
		});

		expect(result.ok === false && result.minimumMinor).toBe(1194);
	});

	// compared as decimals, where text would put 10.1 under 9.277067.
	it.each(['9.277067', '10.1'])(
		'mints where the gift converts to %s, at or over the minimum',
		async (estimate) => {
			serving(minting(undefined, estimate));

			const result = await createNowpaymentsProvider(CREDENTIALS).createIntent(REQUEST);

			expect(result.ok).toBe(true);
		}
	);

	// offered off the account's lists, a coin can still be one NOWPayments prices nothing in today.
	it('creates nothing in a coin whose minimum NOWPayments will not answer', async () => {
		const calls = serving(minting());

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent({
			...REQUEST,
			coin: 'luna'
		});

		expect(result.ok === false && result.reason).toBe('coin_not_accepted');
		expect(calls.some((call) => call.method === 'POST')).toBe(false);
	});

	const { coin: _, ...COINLESS } = REQUEST;

	it.each([
		['no coin', COINLESS],
		['a currency other than USD', { ...REQUEST, currency: 'GBP' }],
		['no donation to join the payment back to', { ...REQUEST, metadata: {} }],
		['an amount that is not whole cents', { ...REQUEST, amountMinor: 12.5 }]
	])('sends nothing for a request with %s', async (_label, request) => {
		const calls = serving(minting());

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent(request);

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(calls).toHaveLength(0);
	});

	it('answers NOWPayments’ own minimum refusal as below the minimum', async () => {
		serving(
			minting({
				status: 400,
				json: {
					status: false,
					statusCode: 400,
					code: 'AMOUNT_MINIMAL_ERROR',
					message: 'Amount is less than minimal'
				}
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok === false && result.reason).toBe('below_minimum');
		expect(result.ok === false ? result.detail : '').toContain('$25.00');
	});

	// the refusal names no figure, and none is invented from the estimate.
	it('states no minimum where NOWPayments’ own refusal names none', async () => {
		serving(
			minting({
				status: 400,
				json: { code: 'AMOUNT_MINIMAL_ERROR', message: 'Amount is less than minimal' }
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok === false && result.reason).toBe('below_minimum');
		expect(result).not.toHaveProperty('minimumMinor');
	});

	// no call reports a coin's ceiling; the refusal to create is the only place one surfaces.
	it('answers NOWPayments’ refusal of an amount over the coin’s maximum as above the maximum', async () => {
		serving(
			minting({
				status: 400,
				json: {
					status: false,
					statusCode: 400,
					code: 'AMOUNT_MAXIMAL_ERROR',
					message: 'Amount is greater than maximal'
				}
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok === false && result.reason).toBe('above_maximum');
		expect(result.ok === false ? result.detail : '').toContain('$25.00');
	});

	it('refuses as unconfigured where NOWPayments rejects the key on creating', async () => {
		serving(
			minting({
				status: 403,
				json: {
					status: false,
					statusCode: 403,
					code: 'INVALID_API_KEY',
					message: 'Invalid api key'
				}
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok === false && result.reason).toBe('not_configured');
	});

	it('answers a create that got no answer as unreachable', async () => {
		serving((method, url) => {
			if (method === 'POST') throw new TypeError('network connection lost');
			return minting()(method, url);
		});

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok === false && result.reason).toBe('unreachable');
	});

	it.each([
		['another coin', { pay_currency: 'btc' }],
		['another gift', { order_id: '01920000-0000-7000-8000-00000000ffff' }]
	])('refuses a created payment in %s than the one asked for', async (_label, over) => {
		serving(minting({ status: 201, json: { ...CREATED, ...over } }));

		const result = await createNowpaymentsProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok === false && result.reason).toBe('provider_error');
	});

	// a mistyped payout coin makes every minimum refuse, which would read as every donor's coin refused.
	it('refuses as unconfigured where the payout coin is no code NOWPayments knows, naming the variable', async () => {
		const calls = serving(minting());

		const result = await createNowpaymentsProvider({
			...CREDENTIALS,
			outcomeCurrency: 'usdt-trc20'
		}).createIntent(REQUEST);

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false ? result.detail : '').toContain('NOWPAYMENTS_OUTCOME_CURRENCY');
		expect(result.ok === false ? result.detail : '').toContain('usdt-trc20');
		expect(calls.some((call) => call.method === 'POST')).toBe(false);
	});
});

/** `GET /v1/payment/:id` as NOWPayments answers it: `payment_id` a number here, where the create sent text. */
const READ = {
	payment_id: 5745459419,
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
	order_id: DONATION_ID,
	order_description: null,
	purchase_id: 5837122679,
	outcome_amount: 24.1,
	outcome_currency: 'usdttrc20',
	payout_hash: null,
	payin_hash: null,
	created_at: '2026-09-17T15:00:22.742Z',
	updated_at: '2026-09-17T15:04:10.120Z',
	burning_percent: 'null',
	type: 'crypto2crypto',
	payment_extra_ids: []
};

function reading(payment: Answer) {
	return (method: string, url: URL): Answer | undefined =>
		method === 'GET' && url.pathname === '/v1/payment/5745459419' ? payment : undefined;
}

describe('readSettlement — a payment read back', () => {
	it('reads a payment still waiting on its deposit as pending, at the amount asked', async () => {
		serving(reading({ status: 200, json: READ }));

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result).toEqual({
			ok: true,
			value: {
				providerTxnId: '5745459419',
				status: 'pending',
				method: 'crypto',
				amountMinor: 2500,
				currency: 'USD',
				feeMinor: null,
				metadata: { [DONATION_METADATA_KEY]: DONATION_ID },
				occurredAt: new Date('2026-09-17T15:04:10.120Z'),
				arrival: null
			}
		});
	});

	it.each(['confirming', 'confirmed', 'sending', 'refunded', 'a_status_nobody_documented'])(
		'reads %s as pending',
		async (payment_status) => {
			serving(reading({ status: 200, json: { ...READ, payment_status } }));

			const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

			expect(result.ok && result.value.status).toBe('pending');
		}
	);

	it.each(['finished', 'partially_paid'])(
		'settles a %s payment at the dollar value of what arrived',
		async (payment_status) => {
			serving(
				reading({
					status: 200,
					json: { ...READ, payment_status, actually_paid: 12.5, actually_paid_at_fiat: 16.14 }
				})
			);

			const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

			expect(result.ok && result.value).toMatchObject({
				status: 'succeeded',
				amountMinor: 1614,
				arrival: { coin: 'xrp', coinAmount: '12.5', valuedBy: 'arrival_rate', repeatOf: null }
			});
		}
	);

	// a repeat deposit inherits its parent's `order_id`; read as the parent's gift, it would settle it twice.
	it('reads a repeat deposit as its own payment, pointing at its parent and at no gift', async () => {
		serving(
			reading({
				status: 200,
				json: {
					...READ,
					payment_status: 'finished',
					actually_paid: 5,
					actually_paid_at_fiat: 6.4,
					parent_payment_id: 4409187012
				}
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result.ok && result.value.metadata).toEqual({});
		expect(result.ok && result.value.arrival?.repeatOf).toBe('4409187012');
	});

	/** the payment as `reading` answers it, and NOWPayments pricing what arrived at `dollars`. */
	function valuing(payment: unknown, dollars: Answer) {
		return (method: string, url: URL): Answer | undefined =>
			method === 'GET' && url.pathname === '/v1/estimate'
				? dollars
				: reading({ status: 200, json: payment })(method, url);
	}

	// the collection's own `GET /v1/payment/:id` example: finished, and no `actually_paid_at_fiat` on it.
	const DOCS_READ = {
		payment_id: 6249365965,
		invoice_id: null,
		payment_status: 'finished',
		pay_address: 'address',
		payin_extra_id: null,
		price_amount: 1,
		price_currency: 'usd',
		pay_amount: 11.8,
		actually_paid: 12,
		pay_currency: 'trx',
		order_id: null,
		order_description: null,
		purchase_id: 5312822613,
		outcome_amount: 11.8405,
		outcome_currency: 'trx',
		payout_hash: 'hash',
		payin_hash: 'hash',
		created_at: '2023-07-28T15:06:09.932Z',
		updated_at: '2023-07-28T15:09:40.535Z',
		burning_percent: 'null',
		type: 'crypto2crypto',
		payment_extra_ids: [5513339153]
	};

	it('values an arrival carrying no dollar figure at NOWPayments’ estimate for what arrived', async () => {
		const calls = serving(
			(method, url) =>
				(method === 'GET' && url.pathname === '/v1/payment/6249365965'
					? { status: 200, json: DOCS_READ }
					: undefined) ??
				valuing(DOCS_READ, {
					status: 200,
					json: {
						currency_from: 'trx',
						amount_from: 12,
						currency_to: 'usd',
						estimated_amount: '3.28510000'
					}
				})(method, url)
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('6249365965');

		expect(result.ok && result.value).toMatchObject({
			status: 'succeeded',
			amountMinor: 329,
			arrival: { coin: 'trx', coinAmount: '12', valuedBy: 'processor_estimate', repeatOf: null }
		});
		const estimate = calls.find((call) => call.url.pathname === '/v1/estimate');
		expect(Object.fromEntries(estimate?.url.searchParams ?? [])).toEqual({
			amount: '12',
			currency_from: 'trx',
			currency_to: 'usd'
		});
	});

	it('values an arrival whose dollar figure is zero at the estimate too', async () => {
		const payment = {
			...READ,
			payment_status: 'finished',
			actually_paid: 12.5,
			actually_paid_at_fiat: 0
		};
		serving(
			valuing(payment, {
				status: 200,
				json: {
					currency_from: 'xrp',
					amount_from: 12.5,
					currency_to: 'usd',
					estimated_amount: '16.24230373'
				}
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result.ok && result.value).toMatchObject({
			amountMinor: 1624,
			arrival: { valuedBy: 'processor_estimate' }
		});
	});

	// never a $0 settlement.
	it('settles nothing for an arrival worth under a cent even at the estimate', async () => {
		const payment = {
			...READ,
			payment_status: 'finished',
			actually_paid: 0.00001,
			actually_paid_at_fiat: 0
		};
		serving(
			valuing(payment, {
				status: 200,
				json: {
					currency_from: 'xrp',
					amount_from: 0.00001,
					currency_to: 'usd',
					estimated_amount: '0.00001299'
				}
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result.ok).toBe(false);
	});

	// the IPN is sent again, so an estimate that could not be read is worth the same read later.
	it('refuses retryably where the estimate for what arrived cannot be read', async () => {
		const payment = {
			...READ,
			payment_status: 'finished',
			actually_paid: 12.5,
			actually_paid_at_fiat: 0
		};
		serving(
			valuing(payment, {
				status: 400,
				json: {
					status: false,
					statusCode: 400,
					code: 'BAD_REQUEST',
					message: 'Currency xrp is not convertable to usd now'
				}
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result.ok === false && isRetryable(result.reason)).toBe(true);
	});

	it('refuses an expired payment whose amount arrived cannot be read, rather than calling it not given', async () => {
		serving(
			reading({
				status: 200,
				json: { ...READ, payment_status: 'expired', actually_paid: 'about three' }
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result.ok === false && result.reason).toBe('provider_error');
	});

	it('reads an address that expired with nothing sent as cancelled', async () => {
		serving(reading({ status: 200, json: { ...READ, payment_status: 'expired' } }));

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result.ok && result.value).toMatchObject({ status: 'cancelled', arrival: null });
	});

	// a deposit that reached an expired address is money that moved, and is never marked not given.
	it('settles an address that expired with something sent at what arrived', async () => {
		serving(
			reading({
				status: 200,
				json: { ...READ, payment_status: 'expired', actually_paid: 3, actually_paid_at_fiat: 3.87 }
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result.ok && result.value).toMatchObject({ status: 'succeeded', amountMinor: 387 });
	});

	// money that moved is never marked not given, whatever NOWPayments calls the payment.
	it('settles a failed payment with something sent at what arrived', async () => {
		serving(
			reading({
				status: 200,
				json: { ...READ, payment_status: 'failed', actually_paid: 3, actually_paid_at_fiat: 3.87 }
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result.ok && result.value).toMatchObject({
			status: 'succeeded',
			amountMinor: 387,
			arrival: { coinAmount: '3' }
		});
	});

	it('reads a failed payment with nothing sent as failed', async () => {
		serving(reading({ status: 200, json: { ...READ, payment_status: 'failed' } }));

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result.ok && result.value.status).toBe('failed');
	});

	// a payment is readable only with the key it was created under. NOWPayments answers an id this key
	// holds no payment for with this 404 (live read of a made-up id, 2026-09-17).
	it('answers a payment this key cannot read as not found, naming a replaced key', async () => {
		serving(
			reading({
				status: 404,
				json: { status: false, statusCode: 404, code: 'NOT_FOUND', message: 'Payment not found' }
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result.ok === false && result.reason).toBe('not_found');
		expect(result.ok === false ? result.detail : '').toContain('NOWPAYMENTS_API_KEY');
	});

	it('refuses as unconfigured where NOWPayments rejects the key', async () => {
		serving(
			reading({
				status: 403,
				json: {
					status: false,
					statusCode: 403,
					code: 'INVALID_API_KEY',
					message: 'Invalid api key'
				}
			})
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).readSettlement('5745459419');

		expect(result.ok === false && result.reason).toBe('not_configured');
	});
});

// an IPN as NOWPayments sends it: keys in its own order, `fee` nested, `payment_extra_ids` an array.
const IPN = `{"payment_id":5745459419,"parent_payment_id":null,"invoice_id":null,"payment_status":"finished","pay_address":"rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY","payin_extra_id":"2918473650","price_amount":25,"price_currency":"usd","pay_amount":19.36121163,"actually_paid":19.36121163,"actually_paid_at_fiat":24.87,"pay_currency":"xrp","order_id":"${DONATION_ID}","order_description":null,"purchase_id":"5837122679","created_at":"2026-09-17T15:00:22.742Z","updated_at":"2026-09-17T15:21:40.120Z","outcome_amount":24.1,"outcome_currency":"usdttrc20","payment_extra_ids":["2918473650"],"fee":{"currency":"usdttrc20","depositFee":0.12,"withdrawalFee":0.5,"serviceFee":0.25}}`;

// `IPN` signed under `CREDENTIALS.ipnSecret` by three algorithms, each run outside this repo: the
// SDK's `createWebhookSignature` (nowpayments-sdk-nodejs src/ipn.js, keys sorted at every depth);
// the top level sorted alone; and the collection's Node sample, which sorts an array into an object.
const SIGNED_DEEP =
	'c141b3c1c43e289ae851ea1f0f36e6573ab895f218fbcfea922d0ebc5e1fd77c0c16c90943be5feef7d03d94e409684f275b1abafbf032f7dda7d1ab4201b9b9';
const SIGNED_TOP_LEVEL =
	'97e60cd78d884f08add02a74241580584c5a72d02d7dc8573523a7aa1faa948f690187e387424c90292eedb70c6d5b1582b89e6a8891bfc3c7300672634f5332';
const SIGNED_ARRAY_FLATTENED =
	'0684b9ab794aa901756ba61c9b7a6764d407661904be0382ec98941f4e6ea34945bcda0cceb20bd169b210e404cc6110e80d2c409b20034fd2c15c8814d1f2f0';

/**
 * a delivery of `payment` as NOWPayments would sign it, for the cases whose subject is not the
 * signature: the SDK's `createWebhookSignature`, on node's HMAC rather than the adapter's.
 */
function delivered(payment: Record<string, unknown>, secret = CREDENTIALS.ipnSecret) {
	const sorted = (value: unknown): unknown =>
		Array.isArray(value)
			? value.map(sorted)
			: typeof value === 'object' && value !== null
				? Object.fromEntries(
						Object.keys(value)
							.sort()
							.map((key) => [key, sorted((value as Record<string, unknown>)[key])])
					)
				: value;
	const body = JSON.stringify(payment);
	const signature = createHmac('sha512', secret)
		.update(JSON.stringify(sorted(payment)))
		.digest('hex');
	return { body, headers: { 'x-nowpayments-sig': signature } };
}

const IPN_PAYMENT: Record<string, unknown> = JSON.parse(IPN);

describe('verifyEvent — an IPN checked and named', () => {
	it('verifies a notification signed over its keys sorted at every depth', async () => {
		serving(() => undefined);

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent({
			body: IPN,
			headers: { 'x-nowpayments-sig': SIGNED_DEEP }
		});

		expect(result.ok && result.value).toMatchObject({
			kind: 'settlement',
			providerTxnId: '5745459419',
			type: 'finished'
		});
	});

	it.each([
		['sorted at the top level only', { 'x-nowpayments-sig': SIGNED_TOP_LEVEL }],
		[
			'sorted with its array turned into an object',
			{ 'x-nowpayments-sig': SIGNED_ARRAY_FLATTENED }
		],
		['signed under another secret', delivered(IPN_PAYMENT, 'anotheripnsecret').headers],
		['carrying no signature', {}]
	])('refuses a notification %s, reading nothing', async (_case, headers) => {
		const calls = serving(() => undefined);

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent({ body: IPN, headers });

		expect(result.ok === false && result.reason).toBe('bad_signature');
		expect(calls).toHaveLength(0);
	});

	// nested past what the sort can recurse into: refused, never thrown out of a public endpoint.
	it('refuses a body nested too deep to sort as unverified', async () => {
		serving(() => undefined);
		const depth = 200_000;

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent({
			body: `${'['.repeat(depth)}${']'.repeat(depth)}`,
			headers: { 'x-nowpayments-sig': SIGNED_DEEP }
		});

		expect(result.ok === false && result.reason).toBe('bad_signature');
	});

	it('refuses a body that is not JSON as unverified', async () => {
		serving(() => undefined);

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent({
			body: `${IPN.slice(0, -1)}`,
			headers: { 'x-nowpayments-sig': SIGNED_DEEP }
		});

		expect(result.ok === false && result.reason).toBe('bad_signature');
	});

	// held open rather than refused, so a delivery made before the operator sets the value is redelivered.
	it.each([null, '  '])(
		'answers an IPN secret of %j as unconfigured, naming the variable',
		async (ipnSecret) => {
			serving(() => undefined);

			const result = await createNowpaymentsProvider({ ...CREDENTIALS, ipnSecret }).verifyEvent({
				body: IPN,
				headers: { 'x-nowpayments-sig': SIGNED_DEEP }
			});

			expect(result.ok === false && result.reason).toBe('not_configured');
			expect(result.ok === false ? result.detail : '').toContain('NOWPAYMENTS_IPN_SECRET');
		}
	);

	// the helper signing every case below is checked once against the signature the SDK produced.
	it('signs a fixture the way NOWPayments does', () => {
		expect(delivered(IPN_PAYMENT).headers['x-nowpayments-sig']).toBe(SIGNED_DEEP);
	});

	it.each(['finished', 'partially_paid'])(
		'reads a %s notification into the settlement it states, at the dollar value on arrival',
		async (payment_status) => {
			serving(() => undefined);

			const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
				delivered({ ...IPN_PAYMENT, payment_status })
			);

			expect(result.ok && result.value.kind === 'settlement' && result.value.delivered).toEqual({
				providerTxnId: '5745459419',
				status: 'succeeded',
				method: 'crypto',
				amountMinor: 2487,
				currency: 'USD',
				feeMinor: null,
				metadata: { [DONATION_METADATA_KEY]: DONATION_ID },
				occurredAt: new Date('2026-09-17T15:21:40.120Z'),
				arrival: {
					coin: 'xrp',
					coinAmount: '19.36121163',
					valuedBy: 'arrival_rate',
					repeatOf: null
				}
			});
		}
	);

	// NOWPayments names one currency for all three parts; the rate is the one this payment carries.
	it.each([
		[
			'the coin paid in, at the arrival rate',
			{ currency: 'xrp', depositFee: 0.1, serviceFee: 0.19361212, withdrawalFee: 0 },
			38
		],
		['dollars', { currency: 'usd', depositFee: 0.5, serviceFee: 0.25, withdrawalFee: 0 }, 75],
		[
			'a coin this payment carries no rate for',
			{ currency: 'usdttrc20', depositFee: 0.12, serviceFee: 0.25, withdrawalFee: 0.5 },
			null
		],
		[
			'a coin this payment carries no rate for, every part zero',
			{ currency: 'usdttrc20', depositFee: 0, serviceFee: 0, withdrawalFee: 0 },
			0
		],
		['no currency, every part zero', { depositFee: 0, serviceFee: 0, withdrawalFee: 0 }, 0],
		['no currency', { depositFee: 0.12, serviceFee: 0.25, withdrawalFee: 0.5 }, null],
		[
			'a part that is not a number',
			{ currency: 'usd', depositFee: 0.5, serviceFee: 'some', withdrawalFee: 0 },
			null
		]
	])('reads a fee in %s', async (_case, fee, feeMinor) => {
		serving(() => undefined);

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
			delivered({ ...IPN_PAYMENT, fee })
		);

		expect(
			result.ok && result.value.kind === 'settlement' && result.value.delivered?.feeMinor
		).toBe(feeMinor);
	});

	it('converts a fee in the coin paid in at the estimate where the payment carries no dollar value', async () => {
		serving((method, url) =>
			method === 'GET' && url.pathname === '/v1/estimate'
				? { status: 200, json: { estimated_amount: '16.24230373' } }
				: undefined
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
			delivered({
				...IPN_PAYMENT,
				actually_paid: 12.5,
				actually_paid_at_fiat: 0,
				fee: { currency: 'xrp', depositFee: 0.1, serviceFee: 0.19361212, withdrawalFee: 0 }
			})
		);

		expect(result.ok && result.value.kind === 'settlement' && result.value.delivered).toMatchObject(
			{
				amountMinor: 1624,
				feeMinor: 38
			}
		);
	});

	it.each([
		['absent', { actually_paid_at_fiat: undefined }],
		['null', { actually_paid_at_fiat: null }],
		['zero', { actually_paid_at_fiat: 0 }]
	])(
		'values an arrival whose dollar figure is %s at NOWPayments’ estimate for what arrived',
		async (_case, figure) => {
			const calls = serving((method, url) =>
				method === 'GET' && url.pathname === '/v1/estimate'
					? { status: 200, json: { estimated_amount: '24.61900001' } }
					: undefined
			);

			const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
				delivered({ ...IPN_PAYMENT, ...figure })
			);

			expect(
				result.ok && result.value.kind === 'settlement' && result.value.delivered
			).toMatchObject({ amountMinor: 2462, arrival: { valuedBy: 'processor_estimate' } });
			expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
				amount: '19.36121163',
				currency_from: 'xrp',
				currency_to: 'usd'
			});
		}
	);

	// never a $0 settlement: the body states none, and the read is left to value it.
	it('states no settlement for an arrival NOWPayments values at under a cent', async () => {
		serving((method, url) =>
			method === 'GET' && url.pathname === '/v1/estimate'
				? { status: 200, json: { estimated_amount: '0.004' } }
				: undefined
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
			delivered({ ...IPN_PAYMENT, actually_paid: 0.00001, actually_paid_at_fiat: 0 })
		);

		expect(result.ok && result.value).toMatchObject({
			kind: 'settlement',
			providerTxnId: '5745459419'
		});
		expect(
			result.ok && result.value.kind === 'settlement' && result.value.delivered
		).toBeUndefined();
	});

	it.each([
		['an overpayment', 'finished', 23.5, 30.19, 3019],
		['an underpayment', 'partially_paid', 9.5, 12.2, 1220]
	])(
		'settles %s at what arrived',
		async (_case, payment_status, actually_paid, atFiat, amountMinor) => {
			serving(() => undefined);

			const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
				delivered({ ...IPN_PAYMENT, payment_status, actually_paid, actually_paid_at_fiat: atFiat })
			);

			expect(
				result.ok && result.value.kind === 'settlement' && result.value.delivered
			).toMatchObject({
				status: 'succeeded',
				amountMinor,
				arrival: { coinAmount: String(actually_paid) }
			});
		}
	);

	// the coin is the one that arrived: a wrong-asset deposit processed on the account names its own.
	it('reads the coin off the notification', async () => {
		serving(() => undefined);

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
			delivered({ ...IPN_PAYMENT, pay_currency: 'usdtbsc', actually_paid: 24.9 })
		);

		expect(
			result.ok && result.value.kind === 'settlement' && result.value.delivered?.arrival?.coin
		).toBe('usdtbsc');
	});

	// a repeat deposit carries its parent's `order_id`; read by it, the parent's gift would settle twice.
	it('reads a repeat deposit as its own payment carrying its parent’s id, and no gift', async () => {
		serving(() => undefined);

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
			delivered({
				...IPN_PAYMENT,
				payment_id: 5890011223,
				parent_payment_id: 5745459419,
				actually_paid: 4,
				actually_paid_at_fiat: 5.14
			})
		);

		expect(result.ok && result.value).toMatchObject({
			kind: 'settlement',
			providerTxnId: '5890011223',
			delivered: {
				providerTxnId: '5890011223',
				amountMinor: 514,
				metadata: {},
				arrival: { repeatOf: '5745459419' }
			}
		});
	});

	it('reads an address that expired with nothing sent as a settlement that was not given', async () => {
		const calls = serving(() => undefined);

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
			delivered({
				...IPN_PAYMENT,
				payment_status: 'expired',
				actually_paid: 0,
				actually_paid_at_fiat: 0
			})
		);

		expect(result.ok && result.value).toMatchObject({
			kind: 'settlement',
			delivered: { status: 'cancelled', arrival: null }
		});
		expect(calls).toHaveLength(0);
	});

	// the collection's IPN example carries no `created_at` or `updated_at`.
	it('reads a notification carrying no time as settled when it arrived', async () => {
		serving(() => undefined);
		const { created_at: _created, updated_at: _updated, ...untimed } = IPN_PAYMENT;
		const before = Date.now();

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(delivered(untimed));

		const value = result.ok && result.value.kind === 'settlement' ? result.value : null;
		expect(value?.delivered?.amountMinor).toBe(2487);
		expect(value?.delivered?.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
		expect(value?.delivered?.occurredAt).toEqual(value?.occurredAt);
	});

	// NOWPayments sends a notification per status and redelivers on any error; each names the same event.
	it('answers the same delivery twice with the same event', async () => {
		serving(() => undefined);
		const provider = createNowpaymentsProvider(CREDENTIALS);

		const first = await provider.verifyEvent(delivered(IPN_PAYMENT));
		const second = await provider.verifyEvent(delivered(IPN_PAYMENT));

		expect(first.ok && first.value).toMatchObject({
			id: '5745459419:finished:19.36121163',
			occurredAt: new Date('2026-09-17T15:21:40.120Z')
		});
		expect(second).toEqual(first);
	});

	// `JSON.stringify` prints each spelling as `5745459419`, so all three verify under one signature;
	// read as sent, each would be another payment and another event.
	it.each(['5745459419.0', '5.745459419e9'])(
		'refuses a signed payment id spelled %s rather than naming another payment',
		async (spelling) => {
			serving(() => undefined);
			const signed = delivered(IPN_PAYMENT);

			const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent({
				body: signed.body.replace('"payment_id":5745459419', `"payment_id":${spelling}`),
				headers: signed.headers
			});

			expect(result.ok).toBe(false);
		}
	);

	it('states no settlement for a signed parent id spelled other than as its digits', async () => {
		serving(() => undefined);
		const signed = delivered({ ...IPN_PAYMENT, parent_payment_id: 4409187012 });

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent({
			body: signed.body.replace(
				'"parent_payment_id":4409187012',
				'"parent_payment_id":4.409187012e9'
			),
			headers: signed.headers
		});

		expect(
			result.ok && result.value.kind === 'settlement' && result.value.delivered
		).toBeUndefined();
	});

	// the body is the only settlement for a payment the read will not answer, so it is asked for again.
	it('refuses retryably where the estimate valuing the body did not answer', async () => {
		serving((method, url) =>
			method === 'GET' && url.pathname === '/v1/estimate' ? { status: 503 } : undefined
		);

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
			delivered({ ...IPN_PAYMENT, actually_paid_at_fiat: 0 })
		);

		expect(result.ok === false && isRetryable(result.reason)).toBe(true);
	});

	it('names the same status with a different amount received as an event of its own', async () => {
		serving(() => undefined);
		const provider = createNowpaymentsProvider(CREDENTIALS);

		const first = await provider.verifyEvent(delivered(IPN_PAYMENT));
		const more = await provider.verifyEvent(
			delivered({ ...IPN_PAYMENT, actually_paid: 25.1, actually_paid_at_fiat: 32.24 })
		);

		expect(first.ok && more.ok && first.value.id !== more.value.id).toBe(true);
	});

	it('names a status change as an event of its own', async () => {
		serving(() => undefined);
		const provider = createNowpaymentsProvider(CREDENTIALS);

		const sending = await provider.verifyEvent(
			delivered({ ...IPN_PAYMENT, payment_status: 'sending' })
		);
		const finished = await provider.verifyEvent(delivered(IPN_PAYMENT));

		expect(sending.ok && finished.ok && sending.value.id !== finished.value.id).toBe(true);
	});

	it('refuses a verified body naming no payment, as a shape it cannot read', async () => {
		serving(() => undefined);

		const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
			delivered({ id: '123456789', batch_withdrawal_id: '987654321', status: 'CREATING' })
		);

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(result.ok === false ? result.detail : '').toContain('`payment_status`');
	});

	it.each(['refunded', 'a_status_nobody_documented'])(
		'answers a %s notification as ignored, reading nothing',
		async (payment_status) => {
			const calls = serving(() => undefined);

			const result = await createNowpaymentsProvider(CREDENTIALS).verifyEvent(
				delivered({ ...IPN_PAYMENT, payment_status })
			);

			expect(result.ok && result.value).toMatchObject({ kind: 'ignored', type: payment_status });
			expect(calls).toHaveLength(0);
		}
	);
});

describe('what the account is approved for', () => {
	it('reports charges enabled where the key reads the account’s coins', async () => {
		const calls = serving(account);

		const result = await createNowpaymentsProvider(CREDENTIALS).readAccountChargeability();

		expect(result.ok && result.value.chargesEnabled).toBe(true);
		expect(calls.map((call) => call.url.pathname)).toEqual(['/v1/merchant/coins']);
	});

	it('reports crypto approved and offered where the account enabled a coin', async () => {
		serving(account);
		const provider = createNowpaymentsProvider(CREDENTIALS);

		const [approvals, switches] = await Promise.all([
			provider.readAccountChargeability(),
			provider.readRailSwitchboard()
		]);

		expect(approvals.ok && approvals.value.rails).toEqual({ crypto: 'active' });
		expect(switches.ok && switches.value).toEqual({ crypto: { offered: true, switchedOn: true } });
	});

	it('reports crypto neither approved nor offered where the account enabled no coin', async () => {
		serving(() => ({ status: 200, json: { selectedCurrencies: [] } }));
		const provider = createNowpaymentsProvider(CREDENTIALS);

		const [approvals, switches] = await Promise.all([
			provider.readAccountChargeability(),
			provider.readRailSwitchboard()
		]);

		expect(approvals.ok && approvals.value.rails).toEqual({ crypto: 'inactive' });
		expect(switches.ok && switches.value).toEqual({ crypto: { offered: false, switchedOn: true } });
	});

	it('refuses as unconfigured where NOWPayments rejects the key', async () => {
		serving(() => ({
			status: 403,
			json: { status: false, statusCode: 403, code: 'INVALID_API_KEY', message: 'Invalid api key' }
		}));

		const result = await createNowpaymentsProvider(CREDENTIALS).readAccountChargeability();

		expect(result.ok === false && result.reason).toBe('not_configured');
	});
});

describe('the arms a crypto payment has nothing behind', () => {
	const provider = () => createNowpaymentsProvider(CREDENTIALS);

	it.each([
		['prepareRecurringGifts', () => provider().prepareRecurringGifts()],
		['readRecurringGiftProvision', () => provider().readRecurringGiftProvision()],
		[
			'createRecurringGift',
			() =>
				provider().createRecurringGift({
					amountMinor: 2500,
					currency: 'USD',
					interval: 'monthly',
					method: RAIL,
					idempotencyKey: 'gift-1'
				})
		],
		['cancelRecurringGift', () => provider().cancelRecurringGift('5745459419')],
		[
			'readRecurringGift',
			() =>
				provider().readRecurringGift({
					id: 'ipn-1',
					kind: 'recurring',
					type: 'finished',
					providerNoticeId: '5745459419',
					occurredAt: new Date(0)
				})
		],
		['listWebhookEndpoints', () => provider().listWebhookEndpoints()],
		[
			'registerWebhookEndpoint',
			() => provider().registerWebhookEndpoint('https://donate.example.org/api/nowpayments/webhook')
		],
		['resubscribeWebhookEndpoint', () => provider().resubscribeWebhookEndpoint('1')],
		[
			'replaceWebhookEndpoint',
			() =>
				provider().replaceWebhookEndpoint('1', 'https://donate.example.org/api/nowpayments/webhook')
		],
		['listWalletDomains', () => provider().listWalletDomains()],
		['registerWalletDomain', () => provider().registerWalletDomain('donate.example.org')]
	])('answers %s as unsupported, asking NOWPayments nothing', async (_name, ask) => {
		const calls = serving(() => undefined);

		const result = await ask();

		expect(result.ok === false && result.reason).toBe('unsupported');
		expect(calls).toHaveLength(0);
	});
});
