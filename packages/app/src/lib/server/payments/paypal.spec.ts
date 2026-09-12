import { describe, expect, it, vi } from 'vitest';
import type { PaymentProvider } from './provider';
import { createPaypalProvider } from './paypal';

// the adapter, exercised through a recording `fetch` rather than a stubbed SDK.
//
// the seam is one level lower than it looks like it should be, deliberately, and it is the same
// choice ./stripe.spec.ts makes for the same reason: a fake controller object would prove that this
// module calls a method — which was never in doubt — while every mistake worth catching lives in
// what actually goes on the wire. an amount in the wrong unit, a currency in the wrong case, an
// idempotency key that never left, a webhook id read off the request instead of out of the
// configuration: all of them are a request body, and all of them type-check.
//
// `fetch` rather than an injected client, because that is where this adapter's transport bottoms
// out. the SDK is built on axios's fetch adapter (`createPaypalProvider` in ./paypal.ts says why),
// so the request under assertion is the request PayPal would receive, encoded by PayPal's own
// encoder — and the arms that reach past the SDK for the notification API land in the same
// recording. one seam covers both halves; ./stripe.spec.ts needs two because that SDK has a client
// of its own.
//
// ./vitest.config.ts sets `unstubGlobals`, so the stub installed here is taken back before the next
// test runs and no case leaks its script into another.
//
// what this pool cannot see is whether the transport works at all, because a stub answers every
// call. ./paypal.workers.spec.ts is where that is covered, inside workerd.

/** one request the adapter made, as the assertions need to read it. */
type Recorded = {
	readonly url: string;
	readonly method: string;
	readonly headers: Record<string, string>;
	readonly body: string;
};

/**
 * a `fetch` that answers from a script and remembers what it was asked.
 *
 * the token request is answered automatically and is not scripted, because it is plumbing rather
 * than subject: the SDK mints one before the first call of every provider, so scripting it would put
 * the same entry at the head of every case and a case that forgot it would fail on the wrong line.
 * it is still recorded, so a case about authentication can assert it.
 *
 * everything else is consumed in order, and running out is an error rather than a default: a test
 * that made one more call than it scripted is a test whose subject did something it was not asked
 * to, and a permissive fallback would hide exactly that.
 */
function recording(responses: readonly { status: number; json: unknown }[]) {
	const remaining = [...responses];
	const calls: Recorded[] = [];

	vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		const url = request.url;
		calls.push({
			url,
			method: request.method,
			headers: Object.fromEntries(request.headers),
			body: await request.clone().text()
		});

		if (url.endsWith('/v1/oauth2/token')) {
			return Response.json({
				access_token: 'A21AA-token',
				token_type: 'Bearer',
				expires_in: 32400
			});
		}

		const next = remaining.shift();
		if (!next) throw new Error(`unscripted request: ${request.method} ${url}`);
		return Response.json(next.json, { status: next.status });
	});

	return { calls };
}

/** the call the adapter made past the token, which is the one every case is about. */
const apiCall = (calls: readonly Recorded[], index = 0): Recorded | undefined =>
	calls.filter((call) => !call.url.endsWith('/v1/oauth2/token'))[index];

/** the path one recorded call was made to, without the query the SDK appends for optional filters. */
const path = (call: Recorded | undefined): string => new URL(call?.url ?? 'https://x/').pathname;

/** the request body of one recorded call, parsed. */
const sent = (call: Recorded | undefined): Record<string, unknown> =>
	JSON.parse(call?.body || '{}') as Record<string, unknown>;

const CREDENTIALS = {
	clientId: 'Aa-notarealclientid',
	clientSecret: 'EL-notarealsecret',
	webhookId: '7YN47048TX2895013'
};

/** the smallest request that is valid, for cases asserting something other than validation. */
const REQUEST = {
	amountMinor: 1000,
	currency: 'USD',
	method: 'paypal',
	idempotencyKey: 'attempt-1'
} as const;

/** the fields the adapter reads off a created order, and nothing else. */
const ORDER = { id: '5O190127TN364715T', status: 'CREATED' };

describe('createIntent', () => {
	/**
	 * minor units become a decimal string at the currency's own scale.
	 *
	 * this is the conversion Stripe's adapter does not have to make, which is exactly why it is the
	 * first thing asserted: PayPal's `value` is a decimal string in major units and this app stores
	 * integer minor units everywhere (CLAUDE.md), so every gift crosses a units boundary here. a
	 * divide by ten charges a tenth, a multiply charges ten times, and both are plausible figures
	 * nothing downstream disagrees with.
	 */
	it('sends the amount as a decimal string at the currency’s scale', async () => {
		const { calls } = recording([{ status: 201, json: ORDER }]);

		await createPaypalProvider(CREDENTIALS).createIntent({ ...REQUEST, amountMinor: 12345 });

		expect(path(apiCall(calls))).toBe('/v2/checkout/orders');
		expect(sent(apiCall(calls))).toMatchObject({
			purchase_units: [{ amount: { currency_code: 'USD', value: '123.45' } }]
		});
	});
});

describe('the metadata an order carries', () => {
	/**
	 * everything the port writes rides one field, because PayPal has one field to ride.
	 *
	 * there is no metadata map on an order: `custom_id` on the purchase unit is the whole of what an
	 * API caller may write on it, and it is the field the capture and the delivery carry back
	 * (https://developer.paypal.com/docs/api/orders/v2/#definition-purchase_unit_request). so the map
	 * the port defines is encoded into it, and the encoding is asserted here rather than left to the
	 * round trip below, because a settlement that cannot be read back is a gift with no donation
	 * attached and it is discovered when the books are read.
	 */
	it('writes the whole metadata map into the purchase unit’s custom_id', async () => {
		const { calls } = recording([{ status: 201, json: ORDER }]);

		await createPaypalProvider(CREDENTIALS).createIntent({
			...REQUEST,
			metadata: {
				donation_id: '019412e0-8a1f-7000-9000-a1b2c3d4e5f6',
				gift_minor: '9700',
				fee_covered: 'true',
				fee_rail: 'paypal'
			}
		});

		const unit = (sent(apiCall(calls)).purchase_units as { custom_id: string }[])[0];
		expect(JSON.parse(unit?.custom_id ?? '{}')).toEqual({
			donation_id: '019412e0-8a1f-7000-9000-a1b2c3d4e5f6',
			gift_minor: '9700',
			fee_covered: 'true',
			fee_rail: 'paypal'
		});
	});

	/**
	 * metadata too long for the field is refused, and nothing is charged.
	 *
	 * `custom_id` is capped at 255 characters and PayPal refuses a longer one outright, so the value
	 * either fits or there is no order. what this guard buys over that refusal is which failure the
	 * caller is told about — and what it forecloses is the alternative nobody would notice: an
	 * encoding that trimmed to fit would mint a perfectly good order whose `donation_id` is half a
	 * UUID, settle it, and leave the gift unroutable under a 200.
	 */
	it('refuses metadata that will not fit the field rather than trimming it', async () => {
		const { calls } = recording([]);

		const result = await createPaypalProvider(CREDENTIALS).createIntent({
			...REQUEST,
			metadata: { donation_id: 'd'.repeat(300) }
		});

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(apiCall(calls)).toBeUndefined();
	});
});

/** the five headers PayPal signs a delivery with, as a listener receives them. */
const DELIVERY_HEADERS = {
	'paypal-transmission-id': '69cd13f0-d67a-11e5-baa3-778b53f4ae55',
	'paypal-transmission-time': '2026-08-16T22:20:08Z',
	'paypal-transmission-sig': 'thyEr3QCIhkC2gwCnZpU/4AS2A==',
	'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT-abc',
	'paypal-auth-algo': 'SHA256withRSA'
};

/** one delivery, as the route that owns the endpoint hands it over. */
function delivery(event: Record<string, unknown>, headers = DELIVERY_HEADERS) {
	return { body: JSON.stringify(event), headers };
}

const APPROVED_EVENT = {
	id: 'WH-1AB23456CD789012E-3FG45678HI901234J',
	event_type: 'CHECKOUT.ORDER.APPROVED',
	resource_type: 'checkout-order',
	resource_version: '2.0',
	create_time: '2026-08-16T22:20:08Z',
	resource: { id: '5O190127TN364715T' }
};

describe('verifyEvent', () => {
	/**
	 * a deployment with no listener id verifies nothing, and says so before reading anything.
	 *
	 * `not_configured` rather than `bad_signature`, which is the difference between a delivery held
	 * open and a delivery lost: it is a retryable reason (`RETRYABLE_FAILURE_REASONS` in
	 * ./provider.ts), so the route answers 5xx and PayPal brings the delivery back across a window
	 * measured in days — which is the window an operator sets this value inside.
	 *
	 * checked before the headers, because a delivery carrying a perfect signature is no more
	 * verifiable here than one carrying none, and what an operator has to do about it is set a value
	 * rather than look at the request.
	 */
	it('refuses a delivery as not_configured when no webhook id is held', async () => {
		const { calls } = recording([]);

		const result = await createPaypalProvider({ ...CREDENTIALS, webhookId: null }).verifyEvent(
			delivery(APPROVED_EVENT)
		);

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false && result.detail).toContain('PAYPAL_WEBHOOK_ID');
		expect(calls).toEqual([]);
	});

	/**
	 * a delivery PayPal will not vouch for is refused, and nothing is read out of it.
	 *
	 * this endpoint is public and it grants donation records, so an unverified body is a way to write
	 * yourself a receipt. the order matters as much as the answer: the body is handed to PayPal to be
	 * vouched for and is read for nothing else until it has been, which is why a refusal here carries
	 * no event id and no order id — there is nothing in an unverified body that may be believed.
	 */
	it('refuses a delivery PayPal reports as FAILURE', async () => {
		const { calls } = recording([{ status: 200, json: { verification_status: 'FAILURE' } }]);

		const result = await createPaypalProvider(CREDENTIALS).verifyEvent(delivery(APPROVED_EVENT));

		expect(path(apiCall(calls))).toBe('/v1/notifications/verify-webhook-signature');
		expect(result.ok === false && result.reason).toBe('bad_signature');
	});

	/**
	 * the listener id sent for verification is the configured one, never a value off the request.
	 *
	 * this is the whole of what makes the check mean anything. every other field in that request is
	 * taken from the delivery, so an id taken from it too would be a caller vouching for their own
	 * delivery against their own listener — a signature check that verifies whatever it is handed.
	 */
	it('verifies against the configured listener id and not anything in the delivery', async () => {
		const { calls } = recording([{ status: 200, json: { verification_status: 'FAILURE' } }]);

		await createPaypalProvider(CREDENTIALS).verifyEvent(
			delivery({ ...APPROVED_EVENT, webhook_id: 'ATTACKERS-OWN-LISTENER' })
		);

		expect(sent(apiCall(calls))).toMatchObject({
			webhook_id: '7YN47048TX2895013',
			transmission_id: DELIVERY_HEADERS['paypal-transmission-id'],
			transmission_time: DELIVERY_HEADERS['paypal-transmission-time'],
			transmission_sig: DELIVERY_HEADERS['paypal-transmission-sig'],
			cert_url: DELIVERY_HEADERS['paypal-cert-url'],
			auth_algo: DELIVERY_HEADERS['paypal-auth-algo']
		});
	});

	/**
	 * a delivery short of a header it is signed with is refused before PayPal is asked.
	 *
	 * the shape a hand-rolled POST at a public address takes. asked anyway, the verification would be
	 * refused as a malformed request — which reads as this app's bug rather than as the delivery not
	 * being PayPal's, and spends a round trip to arrive at the wrong sentence.
	 */
	it('refuses a delivery missing any signing header without asking PayPal', async () => {
		const { calls } = recording([]);
		const { 'paypal-transmission-sig': _omitted, ...rest } = DELIVERY_HEADERS;

		const result = await createPaypalProvider(CREDENTIALS).verifyEvent(
			delivery(APPROVED_EVENT, rest as typeof DELIVERY_HEADERS)
		);

		expect(result.ok === false && result.reason).toBe('bad_signature');
		expect(apiCall(calls)).toBeUndefined();
	});

	/**
	 * a verification that cannot be reached holds the delivery open rather than losing it.
	 *
	 * the cost of routing verification through PayPal rather than through local cryptography is one
	 * more outbound call per delivery, and this is the failure that buys: `unreachable` is retryable
	 * (`RETRYABLE_FAILURE_REASONS` in ./provider.ts), so the route answers 5xx and PayPal brings the
	 * delivery back. reported as `bad_signature` — the neighbouring answer, and the tempting one,
	 * since neither says the delivery is genuine — it would be terminal, and one bad minute between
	 * two machines would be a settled gift that never reaches the books.
	 */
	it('reports a verification it could not reach as unreachable', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('Network connection lost.');
		});

		const result = await createPaypalProvider(CREDENTIALS).verifyEvent(delivery(APPROVED_EVENT));

		expect(result.ok === false && result.reason).toBe('unreachable');
	});

	/**
	 * a verified delivery this app subscribes to nothing for is answered rather than dropped.
	 *
	 * `ignored` is a success: the route answers 2xx and PayPal stops, which is what a delivery that
	 * needs nothing done deserves. a failure here would buy days of redelivery for a no-op.
	 */
	it('reports a verified delivery it acts on nothing for as ignored', async () => {
		recording([{ status: 200, json: { verification_status: 'SUCCESS' } }]);

		const result = await createPaypalProvider(CREDENTIALS).verifyEvent(
			delivery({ ...APPROVED_EVENT, event_type: 'CUSTOMER.DISPUTE.CREATED' })
		);

		expect(result).toEqual({
			ok: true,
			value: {
				id: APPROVED_EVENT.id,
				kind: 'ignored',
				type: 'CUSTOMER.DISPUTE.CREATED',
				occurredAt: new Date('2026-08-16T22:20:08Z')
			}
		});
	});

	/** the ordinary case: the payer approved, and the delivery names the order to reconcile. */
	it('reports an approved order as a settlement naming that order', async () => {
		recording([{ status: 200, json: { verification_status: 'SUCCESS' } }]);

		const result = await createPaypalProvider(CREDENTIALS).verifyEvent(delivery(APPROVED_EVENT));

		expect(result).toEqual({
			ok: true,
			value: {
				id: APPROVED_EVENT.id,
				kind: 'settlement',
				type: 'CHECKOUT.ORDER.APPROVED',
				providerTxnId: '5O190127TN364715T',
				occurredAt: new Date('2026-08-16T22:20:08Z')
			}
		});
	});

	/**
	 * a capture delivery is reconciled against the order behind it, never against the capture.
	 *
	 * the two deliveries about one gift name two different objects — an order event names the order,
	 * a capture event names the capture — and `payment.provider_txn_id` holds the order id, because
	 * that is what `createIntent` returned before either delivery existed. resolved to the capture
	 * instead, the second delivery would open a second row for money already recorded.
	 */
	it('reports a completed capture as a settlement naming the order behind it', async () => {
		recording([{ status: 200, json: { verification_status: 'SUCCESS' } }]);

		const result = await createPaypalProvider(CREDENTIALS).verifyEvent(
			delivery({
				...APPROVED_EVENT,
				event_type: 'PAYMENT.CAPTURE.COMPLETED',
				resource_type: 'capture',
				resource: {
					id: '3C679366HH908993F',
					supplementary_data: { related_ids: { order_id: '5O190127TN364715T' } }
				}
			})
		);

		expect(result.ok && result.value).toMatchObject({
			kind: 'settlement',
			providerTxnId: '5O190127TN364715T'
		});
	});

	/**
	 * a delivery under a name this app subscribes to whose resource it cannot read is refused loudly.
	 *
	 * `PAYMENT.CAPTURE.COMPLETED` is published under Payments v2 and under Payments v1, and the two
	 * carry different resources under one name — so this is the shape a listener subscribed to the
	 * older one produces. reported as `ignored` it would be a settled gift dropped in silence under a
	 * 200, which is the failure that loses money without anything to find later.
	 */
	it('refuses a subscribed delivery whose resource names no order', async () => {
		recording([{ status: 200, json: { verification_status: 'SUCCESS' } }]);

		const result = await createPaypalProvider(CREDENTIALS).verifyEvent(
			delivery({
				...APPROVED_EVENT,
				event_type: 'PAYMENT.CAPTURE.COMPLETED',
				resource_type: 'capture',
				resource: { id: '3C679366HH908993F' }
			})
		);

		expect(result.ok === false && result.reason).toBe('provider_error');
		expect(result.ok === false && result.detail).toContain('resource_version');
	});

	/**
	 * the same delivery twice answers the same way, which is what makes a redelivery cost nothing.
	 *
	 * PayPal redelivers a non-2xx for days and a duplicate is ordinary rather than exceptional. the
	 * handler no-ops on `PaymentEvent.id`, so what this holds is that the id and the order a second
	 * delivery resolves to are the ones the first resolved to — a verification that read anything off
	 * the attempt rather than off the delivery would break that and nothing downstream would see it.
	 */
	it('answers a redelivered event exactly as it answered the first', async () => {
		recording([
			{ status: 200, json: { verification_status: 'SUCCESS' } },
			{ status: 200, json: { verification_status: 'SUCCESS' } }
		]);
		const provider = createPaypalProvider(CREDENTIALS);

		const first = await provider.verifyEvent(delivery(APPROVED_EVENT));
		const again = await provider.verifyEvent(delivery(APPROVED_EVENT));

		expect(again).toEqual(first);
		expect(first.ok).toBe(true);
	});
});

/** a capture as Payments v2 reports it, which is where the fee and the gross are read from. */
const CAPTURE = {
	id: '3C679366HH908993F',
	status: 'COMPLETED',
	custom_id: JSON.stringify({ donation_id: '019412e0-8a1f-7000-9000-a1b2c3d4e5f6' }),
	create_time: '2026-08-16T22:21:19Z',
	seller_receivable_breakdown: {
		gross_amount: { currency_code: 'USD', value: '97.00' },
		paypal_fee: { currency_code: 'USD', value: '3.11' },
		net_amount: { currency_code: 'USD', value: '93.89' }
	}
};

/** the order a capture hangs off, as Orders v2 reports it once the payer has approved. */
const captured = (overrides: Record<string, unknown> = {}) => ({
	id: '5O190127TN364715T',
	status: 'COMPLETED',
	create_time: '2026-08-16T22:20:08Z',
	payment_source: { paypal: { email_address: 'payer@example.org' } },
	purchase_units: [
		{
			custom_id: CAPTURE.custom_id,
			amount: { currency_code: 'USD', value: '97.00' },
			payments: { captures: [{ id: CAPTURE.id, status: 'COMPLETED' }] }
		}
	],
	...overrides
});

describe('readSettlement', () => {
	/**
	 * an order the payer has approved is captured, and the capture is what the fee is read off.
	 *
	 * PayPal has no auto-capture: an order with `intent: CAPTURE` that a payer approved is money
	 * authorised and not yet moved, and the merchant has to ask for it. so the read that reconciles a
	 * delivery is also the call that takes the money, and the approval is never what the app acts on
	 * — CLAUDE.md's rule that settlement comes from the webhook rather than from the redirect is what
	 * puts the capture here rather than on a page the donor's browser returns to.
	 */
	it('captures an order the payer has approved', async () => {
		const { calls } = recording([
			{
				status: 200,
				json: {
					...captured(),
					status: 'APPROVED',
					purchase_units: [
						{ custom_id: CAPTURE.custom_id, amount: { currency_code: 'USD', value: '97.00' } }
					]
				}
			},
			{ status: 201, json: captured() },
			{ status: 200, json: CAPTURE }
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(path(apiCall(calls, 0))).toBe('/v2/checkout/orders/5O190127TN364715T');
		expect(apiCall(calls, 1)?.method).toBe('POST');
		expect(path(apiCall(calls, 1))).toBe('/v2/checkout/orders/5O190127TN364715T/capture');
		expect(result.ok).toBe(true);
	});

	/**
	 * the gross, the fee and the currency come off the capture, in this app's integer minor units.
	 *
	 * the fee is the figure the ledger's fee entry has to reconcile against a bank statement, so it is
	 * PayPal's own and never what this app quoted (`Settlement.feeMinor` in ./provider.ts). the units
	 * are the other half: PayPal states both as decimal strings and every figure in this app is an
	 * integer of minor units, so the conversion is asserted on the value rather than on its presence —
	 * `3.11` read as 3 is a fee understated by a hundred and nothing downstream disagrees.
	 */
	it('reads the gross, the fee and the currency PayPal reported', async () => {
		recording([
			{ status: 200, json: captured() },
			{ status: 200, json: CAPTURE }
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(result.ok && result.value).toMatchObject({
			providerTxnId: '5O190127TN364715T',
			status: 'succeeded',
			amountMinor: 9700,
			currency: 'USD',
			feeMinor: 311
		});
	});

	/**
	 * a fee stated in some other currency is no fee, never a converted one.
	 *
	 * `paypal_fee` is documented as being in the transaction's own currency, and the `exchange_rate`
	 * on the same breakdown describes crediting the merchant's account in another one — so a rate
	 * applied here would be a figure wrong by the rate, arithmetically sound and silently wrong. an
	 * entry group holds one currency (../ledger/posting.ts), so the honest answers are this figure or
	 * none.
	 */
	it('reports no fee where PayPal stated one in another currency', async () => {
		recording([
			{ status: 200, json: captured() },
			{
				status: 200,
				json: {
					...CAPTURE,
					seller_receivable_breakdown: {
						gross_amount: { currency_code: 'USD', value: '97.00' },
						paypal_fee: { currency_code: 'EUR', value: '2.85' },
						exchange_rate: { source_currency: 'USD', target_currency: 'EUR', value: '0.91' }
					}
				}
			}
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(result.ok && result.value.feeMinor).toBeNull();
		expect(result.ok && result.value.currency).toBe('USD');
	});

	/**
	 * the rail is read from what the payer used, never from what the donor picked beforehand.
	 *
	 * the fee was priced off the donor's choice and the money settled on whatever they actually used,
	 * and the two are allowed to differ — recording the second under the name of the first is what
	 * would make a divergence permanently invisible (`Settlement.method` in ./provider.ts).
	 */
	it('reads the rail off the payment source PayPal filled in', async () => {
		recording([
			{ status: 200, json: captured({ payment_source: { venmo: { user_name: 'payer' } } }) },
			{ status: 200, json: CAPTURE }
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(result.ok && result.value.method).toBe('venmo');
	});

	/**
	 * a funding source this app does not model is no rail rather than the nearest one.
	 *
	 * PayPal's window presents sources beyond the two a form here offers, and a row asserting a rail
	 * nobody used is worse than a row asserting none.
	 */
	it('reports no rail for a payment source it does not model', async () => {
		recording([
			{ status: 200, json: captured({ payment_source: { card: { last_digits: '7704' } } }) },
			{ status: 200, json: CAPTURE }
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(result.ok && result.value.method).toBeNull();
	});

	/**
	 * every key the order was minted with comes back off the settlement.
	 *
	 * this is the whole reason the encoding exists: the settlement path finds the gift by the
	 * donation id on the metadata (`settleDelivery` in ../donations/settle.ts), and a delivery can
	 * reach the webhook before the row that caused it is readable — so a settlement that could only
	 * find its gift by looking the order id up here would lose exactly the race the metadata was
	 * written for.
	 */
	it('reads every metadata key back off the capture', async () => {
		const metadata = {
			donation_id: '019412e0-8a1f-7000-9000-a1b2c3d4e5f6',
			gift_minor: '9700',
			fee_covered: 'true',
			fee_rail: 'paypal'
		};
		recording([
			{ status: 200, json: captured() },
			{ status: 200, json: { ...CAPTURE, custom_id: JSON.stringify(metadata) } }
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(result.ok && result.value.metadata).toEqual(metadata);
	});

	/**
	 * an order somebody else's `custom_id` is on carries no metadata rather than failing the read.
	 *
	 * an order made by hand in the dashboard, or before this encoding shipped, is the live case. a
	 * throw here would be a delivery redelivered for days over an object that will never parse; a
	 * settlement with no metadata is a state ../donations/settle.ts already answers by telling an
	 * operator.
	 */
	it('reads a custom_id that is not this app’s as no metadata', async () => {
		recording([
			{ status: 200, json: captured() },
			{ status: 200, json: { ...CAPTURE, custom_id: 'invoice 4471' } }
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(result.ok && result.value.metadata).toEqual({});
	});

	/**
	 * a redelivery about an order already captured reads it and takes no money again.
	 *
	 * PayPal redelivers for days and both of the subscribed capture events arrive about one gift, so
	 * this is the ordinary path rather than the exceptional one. what it holds is the absence of a
	 * second POST: a capture issued on every delivery would charge a donor once per redelivery, and
	 * the books would be right about the first one only.
	 */
	it('captures nothing again for an order already captured', async () => {
		const { calls } = recording([
			{ status: 200, json: captured() },
			{ status: 200, json: CAPTURE }
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(calls.filter((call) => call.method === 'POST' && call.url.includes('capture'))).toEqual(
			[]
		);
		expect(result.ok && result.value.status).toBe('succeeded');
	});

	/**
	 * two readings of one order agree, which is what makes a redelivery cost nothing to answer.
	 *
	 * the settlement is read fresh from the object rather than reconstructed from whichever delivery
	 * arrived, so `CHECKOUT.ORDER.APPROVED` and `PAYMENT.CAPTURE.COMPLETED` — which arrive in no
	 * guaranteed order — converge on the same state. the first reading here captures and the second
	 * does not, and they still have to be equal.
	 */
	it('converges on the same settlement whether it captured or found the capture', async () => {
		recording([
			{
				status: 200,
				json: {
					...captured(),
					status: 'APPROVED',
					purchase_units: [
						{ custom_id: CAPTURE.custom_id, amount: { currency_code: 'USD', value: '97.00' } }
					]
				}
			},
			{ status: 201, json: captured() },
			{ status: 200, json: CAPTURE },
			{ status: 200, json: captured() },
			{ status: 200, json: CAPTURE }
		]);
		const provider = createPaypalProvider(CREDENTIALS);

		const first = await provider.readSettlement('5O190127TN364715T');
		const again = await provider.readSettlement('5O190127TN364715T');

		expect(again).toEqual(first);
		expect(first.ok && first.value.feeMinor).toBe(311);
	});

	/**
	 * a capture PayPal refuses because the money already moved is a state, not a failure.
	 *
	 * the shape two deliveries racing each other leave: the order read as approved a moment ago and
	 * has been captured since, so the request id no longer covers it. reported as a failure this would
	 * be a 5xx and days of redelivery over money that is already in the account.
	 */
	it('re-reads an order PayPal says is already captured', async () => {
		recording([
			{
				status: 200,
				json: {
					...captured(),
					status: 'APPROVED',
					purchase_units: [{ amount: { currency_code: 'USD', value: '97.00' } }]
				}
			},
			{
				status: 422,
				json: {
					name: 'UNPROCESSABLE_ENTITY',
					details: [{ issue: 'ORDER_ALREADY_CAPTURED' }]
				}
			},
			{ status: 200, json: captured() },
			{ status: 200, json: CAPTURE }
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(result.ok && result.value.status).toBe('succeeded');
		expect(result.ok && result.value.feeMinor).toBe(311);
	});

	/**
	 * an order nobody has approved is money that has not moved, and that is a settlement.
	 *
	 * the payer who opened PayPal's window and closed it is the ordinary case rather than an edge, and
	 * the answer is a `pending` payment with no fee — never a failure, which would have the route ask
	 * for the delivery again forever.
	 */
	it('reports an order with no capture as pending and unpriced', async () => {
		recording([
			{
				status: 200,
				json: {
					id: '5O190127TN364715T',
					status: 'CREATED',
					create_time: '2026-08-16T22:20:08Z',
					purchase_units: [{ amount: { currency_code: 'USD', value: '97.00' } }]
				}
			}
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(result.ok && result.value).toMatchObject({
			status: 'pending',
			amountMinor: 9700,
			currency: 'USD',
			feeMinor: null,
			method: null
		});
	});

	/**
	 * the capture carries the order's own id as its idempotency key, and no other.
	 *
	 * a key generated per attempt is new on every redelivery and would therefore guarantee the second
	 * capture it exists to prevent. this is invisible from the return value — a capture that sent no
	 * key produces a perfectly good settlement, and the duplicate appears only on the redelivery
	 * nobody tested — so it is asserted on the wire.
	 */
	it('derives the capture’s idempotency key from the order id', async () => {
		const { calls } = recording([
			{
				status: 200,
				json: {
					...captured(),
					status: 'APPROVED',
					purchase_units: [{ amount: { currency_code: 'USD', value: '97.00' } }]
				}
			},
			{ status: 201, json: captured() },
			{ status: 200, json: CAPTURE }
		]);

		await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(apiCall(calls, 1)?.headers['paypal-request-id']).toBe('capture-5O190127TN364715T');
	});
});

describe('what an order is minted with', () => {
	/**
	 * the caller's key reaches the header PayPal deduplicates on.
	 *
	 * this is the whole of what makes a lost answer safe, and it is invisible from the return value: a
	 * key that never left produces a perfectly good order, and the duplicate appears only on the
	 * retry nobody tested. so it is asserted on the wire.
	 */
	it('sends the caller’s idempotency key', async () => {
		const { calls } = recording([{ status: 201, json: ORDER }]);

		await createPaypalProvider(CREDENTIALS).createIntent({
			...REQUEST,
			idempotencyKey: 'donation-019412e0'
		});

		expect(apiCall(calls)?.headers['paypal-request-id']).toBe('donation-019412e0');
	});

	/**
	 * the order is minted to be captured rather than authorised.
	 *
	 * the two intents settle differently: an authorisation holds funds and has to be captured against
	 * a separate object with its own expiry, and nothing in this app reads one. an order minted the
	 * other way would be approved by a donor and never collected, with every screen reporting a gift.
	 */
	it('mints an order to be captured', async () => {
		const { calls } = recording([{ status: 201, json: ORDER }]);

		await createPaypalProvider(CREDENTIALS).createIntent(REQUEST);

		expect(sent(apiCall(calls))).toMatchObject({ intent: 'CAPTURE' });
	});

	/**
	 * a currency with no minor unit is written whole, not to two places.
	 *
	 * `100` sent as `100.00` for a currency PayPal defines as having no decimals is refused outright,
	 * and the shape that produces it is a hard-coded two. the scale is read from the currency itself
	 * (`minorUnitDigits` in ../../donations/money.ts), which is also what keeps a ¥2,500 gift from
	 * being sent as ¥25.
	 */
	it('writes a zero-decimal currency with no fractional part', async () => {
		const { calls } = recording([{ status: 201, json: ORDER }]);

		await createPaypalProvider(CREDENTIALS).createIntent({
			...REQUEST,
			amountMinor: 2500,
			currency: 'JPY'
		});

		expect(sent(apiCall(calls))).toMatchObject({
			purchase_units: [{ amount: { currency_code: 'JPY', value: '2500' } }]
		});
	});

	/**
	 * an amount that is not a positive integer of minor units is refused before anything is charged.
	 *
	 * a float here is money arithmetic done in dollars somewhere upstream, and rounding it would
	 * charge a number nobody computed. the key is not spent either, so the corrected attempt can
	 * still use it.
	 */
	it.each([0, -100, 12.5, Number.NaN])('refuses an amount of %s', async (amountMinor) => {
		const { calls } = recording([]);

		const result = await createPaypalProvider(CREDENTIALS).createIntent({
			...REQUEST,
			amountMinor
		});

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(apiCall(calls)).toBeUndefined();
	});

	/** a currency the ledger would refuse is refused here, before the gift is taken. */
	it('refuses a currency that is not an uppercase ISO-4217 code', async () => {
		const { calls } = recording([]);

		const result = await createPaypalProvider(CREDENTIALS).createIntent({
			...REQUEST,
			currency: 'usd'
		});

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(apiCall(calls)).toBeUndefined();
	});

	/**
	 * a rail this processor does not settle is refused rather than sent.
	 *
	 * the value is one a donor picked out of what the form offered, so an untyped caller is exactly
	 * who this guard is for — and the refusal is a 4xx naming the value rather than a `TypeError` out
	 * of the adapter on a public payment-initiating endpoint.
	 */
	it('refuses a rail another processor settles', async () => {
		const { calls } = recording([]);

		const result = await createPaypalProvider(CREDENTIALS).createIntent({
			...REQUEST,
			method: 'ach'
		});

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(apiCall(calls)).toBeUndefined();
	});

	/** the order id is what the browser approves and what the settlement path reconciles against. */
	it('hands back the order id as both the transaction id and the token', async () => {
		recording([{ status: 201, json: ORDER }]);

		const result = await createPaypalProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok && result.value).toEqual({
			providerTxnId: '5O190127TN364715T',
			paymentToken: '5O190127TN364715T'
		});
	});
});

describe('how PayPal’s refusals are read', () => {
	/**
	 * rejected credentials are a deployment an operator fixes, never a fault of the call.
	 *
	 * `not_configured` is also retryable (`RETRYABLE_FAILURE_REASONS` in ./provider.ts), which is what
	 * holds a delivery open across the minutes an operator spends correcting the pair.
	 */
	it.each([401, 403])('reads a %s as not_configured', async (status) => {
		recording([
			{ status, json: { name: 'NOT_AUTHORIZED', details: [{ issue: 'PERMISSION_DENIED' }] } }
		]);

		const result = await createPaypalProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false && result.detail).toContain('PAYPAL_CLIENT_SECRET');
	});

	/** shedding load is the one 4xx worth making the same call again for. */
	it('reads a 429 as rate_limited', async () => {
		recording([{ status: 429, json: { name: 'RATE_LIMIT_REACHED' } }]);

		const result = await createPaypalProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok === false && result.reason).toBe('rate_limited');
	});

	/** an order on another account is a reading a caller already has an answer for. */
	it('reads a 404 as not_found', async () => {
		recording([{ status: 404, json: { name: 'RESOURCE_NOT_FOUND' } }]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(result.ok === false && result.reason).toBe('not_found');
	});

	/**
	 * the issue codes reach the message and PayPal's correlation handle does not.
	 *
	 * the issue is what distinguishes a payer's problem from ours and it is a closed vocabulary, so it
	 * is the part worth repeating. `debug_id` belongs in a support ticket rather than in a 4xx body an
	 * agent reads.
	 */
	it('names the issue codes and not the debug id', async () => {
		recording([
			{
				status: 422,
				json: {
					name: 'UNPROCESSABLE_ENTITY',
					debug_id: 'b8ff1d2a3c4d5',
					details: [{ issue: 'CURRENCY_NOT_SUPPORTED' }]
				}
			}
		]);

		const result = await createPaypalProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok === false && result.detail).toContain('CURRENCY_NOT_SUPPORTED');
		expect(result.ok === false && result.detail).not.toContain('b8ff1d2a3c4d5');
	});

	/** a call that never got an answer is retried under the same key rather than reported terminal. */
	it('reads a transport failure as unreachable', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new TypeError('Network connection lost.');
		});

		const result = await createPaypalProvider(CREDENTIALS).createIntent(REQUEST);

		expect(result.ok === false && result.reason).toBe('unreachable');
	});
});

describe('what the account can be asked', () => {
	/**
	 * the chargeability read is the credentials being proved, which is as far as PayPal will answer.
	 *
	 * there is no capability read for a direct merchant — the merchant-integration read is the
	 * Partner Referrals API and takes a partner id nobody here has — so what this reports is that the
	 * credentials authenticate, and the rails are reported approved with the eligibility decision left
	 * where PayPal makes it: the payer's own browser. `readAccountChargeability` in ./paypal.ts argues
	 * it in full.
	 */
	it('reports both rails as approved once the credentials authenticate', async () => {
		recording([]);

		const result = await createPaypalProvider(CREDENTIALS).readAccountChargeability();

		expect(result.ok && result.value).toEqual({
			chargesEnabled: true,
			rails: { paypal: 'active', venmo: 'active' }
		});
	});

	/**
	 * credentials PayPal will not mint a token for report nothing rather than an approved account.
	 *
	 * this is the one fact the read actually establishes, so it is the one that has to be able to
	 * fail: reported as approved, a deployment with a mistyped secret would offer both rails on every
	 * form it serves and refuse every donor at the last step.
	 */
	it('refuses the read where the credentials are not accepted', async () => {
		vi.stubGlobal('fetch', async () => Response.json({ error: 'invalid_client' }, { status: 401 }));

		const result = await createPaypalProvider(CREDENTIALS).readAccountChargeability();

		expect(result.ok === false && result.reason).toBe('not_configured');
	});

	/** the switchboard answers for the same two rails, which is what the derivation is taken over. */
	it('reports both rails as switched on and offered', async () => {
		const result = await createPaypalProvider(CREDENTIALS).readRailSwitchboard();

		expect(result.ok && result.value).toEqual({
			paypal: { offered: true, switchedOn: true },
			venmo: { offered: true, switchedOn: true }
		});
	});
});

describe('the arms this release does not build', () => {
	/**
	 * every unbuilt arm refuses with a member of the closed set, and none of them throws.
	 *
	 * `unsupported` is terminal (`TERMINAL_FAILURE_REASONS` in ./provider.ts), which is what keeps a
	 * webhook route from asking for the same delivery for days against an answer a release rather
	 * than a deployment would have to change. the sentence matters as much: a refusal that told an
	 * operator to set a value would send them somewhere that changes nothing.
	 */
	it.each([
		['prepareRecurringGifts', (p: PaymentProvider) => p.prepareRecurringGifts()],
		['readRecurringGiftProvision', (p: PaymentProvider) => p.readRecurringGiftProvision()],
		[
			'createRecurringGift',
			(p: PaymentProvider) =>
				p.createRecurringGift({
					amountMinor: 2500,
					currency: 'USD',
					interval: 'monthly',
					method: 'paypal',
					idempotencyKey: 'k'
				})
		],
		['cancelRecurringGift', (p: PaymentProvider) => p.cancelRecurringGift('I-BW452GLLEP1G')],
		[
			'readRecurringGift',
			(p: PaymentProvider) =>
				p.readRecurringGift({
					id: 'WH-1',
					kind: 'recurring',
					type: 'PAYMENT.SALE.COMPLETED',
					providerNoticeId: 'I-BW452GLLEP1G',
					occurredAt: new Date()
				})
		],
		['listWebhookEndpoints', (p: PaymentProvider) => p.listWebhookEndpoints()],
		['registerWebhookEndpoint', (p: PaymentProvider) => p.registerWebhookEndpoint('https://x.org')],
		['resubscribeWebhookEndpoint', (p: PaymentProvider) => p.resubscribeWebhookEndpoint('WH-1')],
		[
			'replaceWebhookEndpoint',
			(p: PaymentProvider) => p.replaceWebhookEndpoint('WH-1', 'https://x.org')
		],
		['listWalletDomains', (p: PaymentProvider) => p.listWalletDomains()],
		['registerWalletDomain', (p: PaymentProvider) => p.registerWalletDomain('example.org')]
	])('refuses %s as unsupported', async (_arm, call) => {
		const { calls } = recording([]);

		const result = await call(createPaypalProvider(CREDENTIALS));

		expect(result.ok === false && result.reason).toBe('unsupported');
		expect(calls).toEqual([]);
	});
});

describe('a settlement whose money cannot be read', () => {
	/**
	 * an amount this app cannot read is refused, never posted as zero.
	 *
	 * the amount is what a `payment` row and both ledger entries are written from, so a settlement
	 * carrying 0 balances and posts a gift of nothing — found only by somebody reading the books
	 * against a statement. `provider_error` is retryable (`RETRYABLE_FAILURE_REASONS` in
	 * ./provider.ts), so the delivery is held open instead.
	 */
	it('refuses a capture whose gross is not a figure at the currency’s scale', async () => {
		recording([
			{ status: 200, json: captured() },
			{
				status: 200,
				json: {
					...CAPTURE,
					seller_receivable_breakdown: {
						gross_amount: { currency_code: 'USD', value: '97.0001' }
					}
				}
			}
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement('5O190127TN364715T');

		expect(result.ok === false && result.reason).toBe('provider_error');
	});
});
