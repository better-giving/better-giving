import { describe, expect, it, vi } from 'vitest';
import { commitmentMetadata, type PaymentProvider } from './provider';
import { createPaypalProvider, findOrCreateBillingPlan, paypalSubscriptions } from './paypal';

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
// out. the SDK is built on axios's fetch adapter (`paypalClient` in ./paypal.ts says why),
// so the request under assertion is the request PayPal would receive, encoded by PayPal's own
// encoder — and the arms that reach past the SDK land in the same recording: the notification API
// and the catalog, neither of which the package ships a controller for. one seam covers both
// halves; ./stripe.spec.ts needs two because that SDK has a client of its own.
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
		// a 204 is an answer this adapter has to read — PayPal's cancel is one — and a body is
		// illegal on it, so `Response.json` throws rather than answering. scripted as `null`.
		if (next.json === null) return new Response(null, { status: next.status });
		return Response.json(next.json, { status: next.status });
	});

	return { calls };
}

/** the call the adapter made past the token, which is the one every case is about. */
const apiCall = (calls: readonly Recorded[], index = 0): Recorded | undefined =>
	calls.filter((call) => !call.url.endsWith('/v1/oauth2/token'))[index];

/** the path one recorded call was made to, without the query the SDK appends for optional filters. */
const path = (call: Recorded | undefined): string => new URL(call?.url ?? 'https://x/').pathname;

/** the query one recorded call was made with, which is where a list's filter and its paging are. */
const query = (call: Recorded | undefined): URLSearchParams =>
	new URL(call?.url ?? 'https://x/').searchParams;

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

/** the plan a monthly gift of $25.00 is charged on, as every case about one asks for it. */
const MONTHLY = { amountMinor: 2500, currency: 'USD', interval: 'monthly' } as const;

/**
 * one plan as PayPal lists it, matching {@link MONTHLY} until a case overrides a field.
 *
 * written out rather than built from the adapter's own request body: a fixture derived from the
 * subject agrees with it by construction, and what these cases are about is whether this app reads
 * PayPal's shape correctly.
 */
const heldPlan = (
	over: { id?: string; status?: string; currency?: string; value?: string } = {}
) => ({
	id: over.id ?? 'P-5ML4271244454362WXNWU5NQ',
	product_id: 'BETTER-GIVING-RECURRING-GIFT',
	status: over.status ?? 'ACTIVE',
	billing_cycles: [
		{
			tenure_type: 'REGULAR',
			sequence: 1,
			total_cycles: 0,
			frequency: { interval_unit: 'MONTH', interval_count: 1 },
			pricing_scheme: {
				fixed_price: { currency_code: over.currency ?? 'USD', value: over.value ?? '25.00' }
			}
		}
	]
});

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
	/**
	 * every delivery about a repeating gift is one kind, naming the object PayPal sent it about.
	 *
	 * the id is a sale's on the charge event and a subscription's on the five lifecycle ones, and
	 * which of the two it is stays inside the adapter — `RecurringEvent` in ./provider.ts says why a
	 * caller reading PayPal's own id prefixes is the thing this port exists to prevent.
	 *
	 * the table is the list this deployment subscribes to, and DEPLOY.md names the same six for the
	 * operator who registers the listener. a member missing here is a charge that reaches no books.
	 */
	it.each([
		['PAYMENT.SALE.COMPLETED', '1KE4800513426762K'],
		['BILLING.SUBSCRIPTION.ACTIVATED', 'I-BW452GLLEP1G'],
		['BILLING.SUBSCRIPTION.CANCELLED', 'I-BW452GLLEP1G'],
		['BILLING.SUBSCRIPTION.EXPIRED', 'I-BW452GLLEP1G'],
		['BILLING.SUBSCRIPTION.SUSPENDED', 'I-BW452GLLEP1G'],
		['BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'I-BW452GLLEP1G']
	])('reports %s as a recurring delivery naming its own resource', async (type, id) => {
		recording([{ status: 200, json: { verification_status: 'SUCCESS' } }]);

		const result = await createPaypalProvider(CREDENTIALS).verifyEvent(
			delivery({ ...APPROVED_EVENT, event_type: type, resource: { id } })
		);

		expect(result.ok && result.value).toEqual({
			id: APPROVED_EVENT.id,
			kind: 'recurring',
			type,
			providerNoticeId: id,
			occurredAt: new Date('2026-08-16T22:20:08Z')
		});
	});

	/**
	 * the events about a plan, a product, a subscription being made or revised, and a refunded sale
	 * are answered and acted on for nothing.
	 *
	 * the first four this app created itself and nothing here revises either object; a refund is a
	 * `payment` row of its own with its own id, which is another kind and another read
	 * (`SUBSCRIBED_EVENT_TYPES` in packages/operator/src/paypal/webhook-listener.ts names what is
	 * acted on).
	 * `ignored` is a success — the route answers 2xx and PayPal stops — where a refusal would buy days
	 * of redelivery for a no-op.
	 */
	it.each([
		'BILLING.SUBSCRIPTION.CREATED',
		'BILLING.SUBSCRIPTION.UPDATED',
		'CATALOG.PRODUCT.UPDATED',
		'BILLING.PLAN.UPDATED',
		'PAYMENT.SALE.REFUNDED',
		'PAYMENT.SALE.REVERSED'
	])('reports %s as ignored', async (type) => {
		recording([{ status: 200, json: { verification_status: 'SUCCESS' } }]);

		const result = await createPaypalProvider(CREDENTIALS).verifyEvent(
			delivery({ ...APPROVED_EVENT, event_type: type })
		);

		expect(result.ok && result.value.kind).toBe('ignored');
	});

	/**
	 * a subscribed delivery about a repeating gift whose resource names nothing is refused loudly.
	 *
	 * the same shape an unreadable capture takes above, and for the same reason: `BILLING.SUBSCRIPTION.*`
	 * is published under the live Subscriptions set and under the deprecated Billing Agreements set,
	 * and the two carry different resources under one name. reported as `ignored` it would be a
	 * charge dropped in silence under a 200.
	 */
	it('refuses a recurring delivery whose resource names nothing', async () => {
		recording([{ status: 200, json: { verification_status: 'SUCCESS' } }]);

		const result = await createPaypalProvider(CREDENTIALS).verifyEvent(
			delivery({ ...APPROVED_EVENT, event_type: 'PAYMENT.SALE.COMPLETED', resource: {} })
		);

		expect(result.ok === false && result.reason).toBe('provider_error');
		expect(result.ok === false && result.detail).toContain('resource_version');
	});

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
	 * not a donor's doing: `OFFERED_METHOD.safeParse` in ../donations/quote-input.ts has already
	 * narrowed what they picked to the offered set. what reaches here is this app's own routing —
	 * `IntentRequest.method` on ./provider.ts is the whole quoted-rail union, so a gift routed through
	 * `Processors.forRail` (../donations/quote.ts) to the wrong adapter arrives carrying a rail the
	 * other processor settles.
	 *
	 * the refusal is a 4xx naming the value rather than a `TypeError` out of the adapter on a public
	 * payment-initiating endpoint.
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

	/**
	 * an id on another account is a reading a caller already has an answer for.
	 *
	 * two refusals and not one: `readSettlement` takes an id that is an order on the single-gift path
	 * and a v1 sale on the repeating one, so an id PayPal holds as neither is the answer to both
	 * reads.
	 */
	it('reads a 404 as not_found', async () => {
		recording([
			{ status: 404, json: { name: 'RESOURCE_NOT_FOUND' } },
			{ status: 404, json: { name: 'RESOURCE_NOT_FOUND' } }
		]);

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

describe('what the account holds for repeating gifts', () => {
	/**
	 * the product is asked about by an id this app derives, rather than one it stored.
	 *
	 * the same rule the webhook endpoint is found under (./webhook-registration.ts): nothing about the
	 * object lives in a row, in an environment variable or in an operator’s clipboard, so there is one
	 * address to ask about and no page two to miss.
	 */
	it('reads the derived product and reports it ready', async () => {
		const { calls } = recording([{ status: 200, json: { id: 'BETTER-GIVING-RECURRING-GIFT' } }]);

		const result = await createPaypalProvider(CREDENTIALS).readRecurringGiftProvision();

		expect(result.ok && result.value).toBe('ready');
		expect(path(apiCall(calls))).toBe('/v1/catalogs/products/BETTER-GIVING-RECURRING-GIFT');
	});

	/**
	 * an account holding nothing is a standing rather than a failure.
	 *
	 * it is the fresh-fork state and the one the console's setup button belongs to, so reported as a
	 * failure it would draw an unreadable block over a deployment that is simply new
	 * (`RecurringProvision` in ./recurring-provision.ts).
	 */
	it('reports a product PayPal does not hold as absent', async () => {
		recording([{ status: 404, json: { name: 'RESOURCE_NOT_FOUND' } }]);

		const result = await createPaypalProvider(CREDENTIALS).readRecurringGiftProvision();

		expect(result.ok && result.value).toBe('absent');
	});

	/**
	 * a read that could not be made says nothing about what the account holds.
	 *
	 * read as `absent` it would draw a setup button over an account nobody can reach, and pressing it
	 * is how an account acquires a product per outage. a rejected credential is the operator's to fix
	 * and a 500 is PayPal's, so the two are different sentences and neither is a standing.
	 */
	it.each([
		[500, 'provider_error'],
		[401, 'not_configured']
	])('reports a read it could not make at %s as a failure', async (status, reason) => {
		recording([{ status, json: { name: 'INTERNAL_SERVER_ERROR' } }]);

		const result = await createPaypalProvider(CREDENTIALS).readRecurringGiftProvision();

		expect(result.ok === false && result.reason).toBe(reason);
	});
});

describe('putting what repeating gifts are charged against on the account', () => {
	/**
	 * the product is made where the account holds none, and the press says it was this call.
	 *
	 * the create carries a `PayPal-Request-Id` derived from the product id rather than a fresh value:
	 * the whole point of the header is that two requests arriving together resolve to one object, and a
	 * key that changes per attempt is not an idempotency key (PayPal stores one for 72 hours on this
	 * API).
	 */
	it('creates the derived product where the account holds none', async () => {
		const { calls } = recording([
			{ status: 404, json: { name: 'RESOURCE_NOT_FOUND' } },
			{ status: 201, json: { id: 'BETTER-GIVING-RECURRING-GIFT' } }
		]);

		const result = await createPaypalProvider(CREDENTIALS).prepareRecurringGifts();

		expect(result.ok && result.value).toEqual({ created: true });
		expect(path(apiCall(calls, 1))).toBe('/v1/catalogs/products');
		expect(sent(apiCall(calls, 1))).toEqual({
			id: 'BETTER-GIVING-RECURRING-GIFT',
			name: 'Recurring gift',
			description: 'Repeating gifts made through this better-giving deployment.',
			type: 'SERVICE'
		});
		expect(apiCall(calls, 1)?.headers['paypal-request-id']).toBe(
			'better-giving:product:BETTER-GIVING-RECURRING-GIFT'
		);
	});

	/** a press on an account that already holds it writes nothing and says so. */
	it('creates nothing where the account already holds the product', async () => {
		const { calls } = recording([{ status: 200, json: { id: 'BETTER-GIVING-RECURRING-GIFT' } }]);

		const result = await createPaypalProvider(CREDENTIALS).prepareRecurringGifts();

		expect(result.ok && result.value).toEqual({ created: false });
		expect(apiCall(calls, 1)).toBeUndefined();
	});

	/**
	 * two requests that both found nothing leave one product, and the loser reports the truth.
	 *
	 * both carry the same derived `PayPal-Request-Id`, so PayPal ordinarily resolves them to one
	 * object — this is the case where it does not, because the window that key is stored for has
	 * passed or the two creates were not identical. the refusal is re-read rather than reported: what
	 * the loser asked for is on the account, and nothing is rolled back to make that true
	 * (CLAUDE.md).
	 */
	it('reconciles a create another request had already won', async () => {
		recording([
			{ status: 404, json: { name: 'RESOURCE_NOT_FOUND' } },
			{
				status: 400,
				json: { name: 'INVALID_REQUEST', details: [{ issue: 'DUPLICATE_RESOURCE' }] }
			},
			{ status: 200, json: { id: 'BETTER-GIVING-RECURRING-GIFT' } }
		]);

		const result = await createPaypalProvider(CREDENTIALS).prepareRecurringGifts();

		expect(result.ok && result.value).toEqual({ created: false });
	});

	/** a create refused for any other reason is the refusal, not a provision nobody made. */
	it('reports a create the account still does not hold as the refusal it was', async () => {
		recording([
			{ status: 404, json: { name: 'RESOURCE_NOT_FOUND' } },
			{
				status: 422,
				json: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INVALID_PARAMETER_VALUE' }] }
			},
			{ status: 404, json: { name: 'RESOURCE_NOT_FOUND' } }
		]);

		const result = await createPaypalProvider(CREDENTIALS).prepareRecurringGifts();

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(result.ok === false && result.detail).toContain('INVALID_PARAMETER_VALUE');
	});
});

describe('the billing plan one amount and interval is charged on', () => {
	/**
	 * a plan the account does not hold is created once, against the product the arm above provisions.
	 *
	 * the wire body is what is asserted rather than the call, because every mistake worth catching here
	 * is a field: `total_cycles` defaulting to 1 is a gift that repeats once
	 * (https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/billing_subscriptions_v1.json),
	 * a plan left `CREATED` is one no subscription can be made against, and an amount at the wrong
	 * scale is a charge nobody computed. all three type-check.
	 */
	it('creates the plan for a monthly gift and hands back its id', async () => {
		const { calls } = recording([
			{ status: 200, json: { plans: [] } },
			{ status: 201, json: { id: 'P-5ML4271244454362WXNWU5NQ', status: 'ACTIVE' } }
		]);

		const result = await findOrCreateBillingPlan(paypalSubscriptions(CREDENTIALS), {
			amountMinor: 2500,
			currency: 'USD',
			interval: 'monthly'
		});

		expect(result.ok && result.value).toBe('P-5ML4271244454362WXNWU5NQ');
		expect(path(apiCall(calls))).toBe('/v1/billing/plans');
		expect(query(apiCall(calls)).get('product_id')).toBe('BETTER-GIVING-RECURRING-GIFT');
		expect(sent(apiCall(calls, 1))).toEqual({
			product_id: 'BETTER-GIVING-RECURRING-GIFT',
			name: 'Recurring gift of 25.00 USD, monthly',
			status: 'ACTIVE',
			billing_cycles: [
				{
					tenure_type: 'REGULAR',
					sequence: 1,
					total_cycles: 0,
					frequency: { interval_unit: 'MONTH', interval_count: 1 },
					pricing_scheme: { fixed_price: { currency_code: 'USD', value: '25.00' } }
				}
			],
			payment_preferences: { auto_bill_outstanding: false }
		});
	});

	/** a plan the account already holds is used, and nothing is created beside it. */
	it('uses the plan the account already holds', async () => {
		const { calls } = recording([{ status: 200, json: { plans: [heldPlan()] } }]);

		const result = await findOrCreateBillingPlan(paypalSubscriptions(CREDENTIALS), MONTHLY);

		expect(result.ok && result.value).toBe('P-5ML4271244454362WXNWU5NQ');
		expect(apiCall(calls, 1)).toBeUndefined();
	});

	/** the cadence the donor picked is the cadence PayPal repeats on. */
	it('creates a yearly gift on a yearly interval', async () => {
		const { calls } = recording([
			{ status: 200, json: { plans: [heldPlan()] } },
			{ status: 201, json: { id: 'P-YEARLY', status: 'ACTIVE' } }
		]);

		await findOrCreateBillingPlan(paypalSubscriptions(CREDENTIALS), {
			...MONTHLY,
			interval: 'yearly'
		});

		expect(sent(apiCall(calls, 1)).billing_cycles).toMatchObject([
			{ frequency: { interval_unit: 'YEAR', interval_count: 1 } }
		]);
	});

	/**
	 * cents survive the units boundary in both directions.
	 *
	 * this repository holds integer minor units everywhere (CLAUDE.md) and PayPal takes a decimal
	 * string, so every repeating gift crosses that boundary twice — once into the plan it is created
	 * with, once back out of the plan it is matched against. the sibling product truncates the
	 * fraction on every repeating gift; a gift of $12.34 is $12.34 here.
	 */
	it('keeps an amount’s cents into the plan and back out of it', async () => {
		const { calls } = recording([
			{ status: 200, json: { plans: [] } },
			{ status: 201, json: { id: 'P-CENTS', status: 'ACTIVE' } },
			{
				status: 200,
				json: {
					plans: [heldPlan({ id: 'P-CENTS', value: '12.34' })]
				}
			}
		]);
		const plans = paypalSubscriptions(CREDENTIALS);
		const cents = { ...MONTHLY, amountMinor: 1234 };

		const created = await findOrCreateBillingPlan(plans, cents);
		const found = await findOrCreateBillingPlan(plans, cents);

		expect(sent(apiCall(calls, 1)).billing_cycles).toMatchObject([
			{ pricing_scheme: { fixed_price: { value: '12.34' } } }
		]);
		expect(created.ok && created.value).toBe('P-CENTS');
		expect(found.ok && found.value).toBe('P-CENTS');
	});

	/**
	 * a zero-decimal currency never gets a fractional part.
	 *
	 * the scale is the currency's own, and a plan created at the wrong one is every collection wrong
	 * rather than one — PayPal refuses `2500.00` for JPY outright, and a deployment would find that
	 * out at the first donor.
	 */
	it('writes a zero-decimal currency with no fractional part', async () => {
		const { calls } = recording([
			{ status: 200, json: { plans: [] } },
			{ status: 201, json: { id: 'P-JPY', status: 'ACTIVE' } }
		]);

		await findOrCreateBillingPlan(paypalSubscriptions(CREDENTIALS), {
			...MONTHLY,
			currency: 'JPY'
		});

		expect(sent(apiCall(calls, 1)).billing_cycles).toMatchObject([
			{ pricing_scheme: { fixed_price: { currency_code: 'JPY', value: '2500' } } }
		]);
	});

	/**
	 * the same derived key on every attempt, which is what makes two of them one plan.
	 *
	 * PayPal honours it for 72 hours on this API, so two donors giving the same amount at the same
	 * cadence at the same moment resolve to one plan rather than racing to make two. a key that
	 * changed per attempt would make each of them a first attempt, which is not an idempotency key.
	 */
	it('derives the create’s idempotency key from what the plan charges', async () => {
		const { calls } = recording([
			{ status: 200, json: { plans: [] } },
			{ status: 201, json: { id: 'P-1', status: 'ACTIVE' } }
		]);

		await findOrCreateBillingPlan(paypalSubscriptions(CREDENTIALS), MONTHLY);

		expect(apiCall(calls, 1)?.headers['paypal-request-id']).toBe(
			'better-giving:plan:monthly:USD:2500'
		);
	});

	/**
	 * a duplicate that slipped through is reconciled rather than rolled back.
	 *
	 * two plans charging the same thing is the race PayPal's own key ordinarily prevents, and neither
	 * of them is deleted: a gift is already committed to whichever one won, so removing it is a
	 * commitment charged against nothing. what is fixed instead is the choice — every request picks
	 * the same one of the pair, whatever order PayPal lists them in (CLAUDE.md: a lost race is settled
	 * by a correcting entry).
	 */
	it('picks the same one of a duplicate pair whatever order they arrive in', async () => {
		recording([
			{ status: 200, json: { plans: [heldPlan({ id: 'P-SECOND' }), heldPlan({ id: 'P-FIRST' })] } },
			{ status: 200, json: { plans: [heldPlan({ id: 'P-FIRST' }), heldPlan({ id: 'P-SECOND' })] } }
		]);
		const plans = paypalSubscriptions(CREDENTIALS);

		const one = await findOrCreateBillingPlan(plans, MONTHLY);
		const other = await findOrCreateBillingPlan(plans, MONTHLY);

		expect(one.ok && one.value).toBe('P-FIRST');
		expect(other.ok && other.value).toBe('P-FIRST');
	});

	/**
	 * a plan that looks right and charges wrong is passed over.
	 *
	 * the account is an operator's own and a plan's price can be edited in PayPal's dashboard, so a
	 * match on anything but what is charged is a donor committed to a figure this app never computed.
	 * the right plan is made beside it rather than the wrong one repaired: every gift already
	 * repeating on the edited plan is charged against that one.
	 */
	it.each([
		['charges another amount', { value: '30.00' }],
		['charges another currency', { currency: 'EUR' }],
		['takes no new subscription', { status: 'INACTIVE' }]
	])('passes over a plan that %s', async (_why, over) => {
		const { calls } = recording([
			{ status: 200, json: { plans: [heldPlan(over)] } },
			{ status: 201, json: { id: 'P-NEW', status: 'ACTIVE' } }
		]);

		const result = await findOrCreateBillingPlan(paypalSubscriptions(CREDENTIALS), MONTHLY);

		expect(result.ok && result.value).toBe('P-NEW');
		expect(path(apiCall(calls, 1))).toBe('/v1/billing/plans');
	});

	/**
	 * a full page with no match is followed rather than treated as the whole catalogue.
	 *
	 * PayPal publishes no filter finer than the product and caps a page at 20, so a deployment
	 * offering more than twenty distinct amounts has its plans spread over pages — and a walk that
	 * stopped at the first would mint a second plan for an amount already on page two, every time.
	 */
	it('walks past a full page that holds no match', async () => {
		const { calls } = recording([
			{
				status: 200,
				json: {
					plans: Array.from({ length: 20 }, (_, index) =>
						heldPlan({ id: `P-OTHER-${index}`, value: `${index + 30}.00` })
					)
				}
			},
			{ status: 200, json: { plans: [heldPlan()] } }
		]);

		const result = await findOrCreateBillingPlan(paypalSubscriptions(CREDENTIALS), MONTHLY);

		expect(result.ok && result.value).toBe('P-5ML4271244454362WXNWU5NQ');
		expect(query(apiCall(calls, 1)).get('page')).toBe('2');
	});

	/**
	 * an amount that is not in minor units is refused before anything is created.
	 *
	 * the stake is higher here than on a one-off gift: a wrong amount on a plan is not one charge but
	 * every charge, for as long as nobody cancels it.
	 */
	it('refuses an amount that is not a positive safe integer', async () => {
		const { calls } = recording([]);

		const result = await findOrCreateBillingPlan(paypalSubscriptions(CREDENTIALS), {
			...MONTHLY,
			amountMinor: 25.5
		});

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(calls).toEqual([]);
	});
});

/** the commitment metadata the port requires, exactly as ../donations/quote.ts assembles it. */
const GIFT_METADATA = commitmentMetadata({
	donationId: '019412e0-8a1f-7000-9000-a1b2c3d4e5f8',
	interval: 'monthly',
	giftMinor: 2500,
	coversFee: false
});

/** the smallest repeating gift that is valid, for cases asserting something other than validation. */
const GIFT = {
	amountMinor: 2500,
	currency: 'USD',
	interval: 'monthly',
	method: 'paypal',
	idempotencyKey: 'gift-1',
	metadata: GIFT_METADATA
} as const;

/** a subscription as PayPal answers a create it was asked to answer in full. */
const COMMITMENT = {
	id: 'I-BW452GLLEP1G',
	plan_id: 'P-5ML4271244454362WXNWU5NQ',
	status: 'APPROVAL_PENDING',
	start_time: '2026-08-16T22:20:08Z',
	create_time: '2026-08-16T22:20:08Z',
	custom_id: JSON.stringify(GIFT_METADATA)
};

describe('createRecurringGift', () => {
	/**
	 * a commitment is made against the plan its amount and cadence resolve to, and nothing else.
	 *
	 * the plan is the whole of what PayPal charges from — a subscription carries no figure of its own
	 * — so the one thing this call has to get right is which plan it names. the wire body is asserted
	 * rather than the call, because that is where every mistake worth catching lives.
	 */
	it('creates a subscription on the plan the amount and cadence resolve to', async () => {
		const { calls } = recording([
			{ status: 200, json: { plans: [heldPlan()] } },
			{ status: 201, json: COMMITMENT }
		]);

		const result = await createPaypalProvider(CREDENTIALS).createRecurringGift(GIFT);

		expect(path(apiCall(calls, 1))).toBe('/v1/billing/subscriptions');
		expect(sent(apiCall(calls, 1))).toEqual({
			plan_id: 'P-5ML4271244454362WXNWU5NQ',
			custom_id: JSON.stringify(GIFT_METADATA)
		});
		expect(result.ok && result.value).toEqual({
			providerGiftId: 'I-BW452GLLEP1G',
			providerCustomerId: '',
			state: 'pending',
			paymentToken: 'I-BW452GLLEP1G',
			startedAt: new Date('2026-08-16T22:20:08Z')
		});
	});

	/** the cadence the donor picked is the cadence the plan repeats on. */
	it('commits a yearly gift against a yearly plan', async () => {
		const { calls } = recording([
			{ status: 200, json: { plans: [] } },
			{ status: 201, json: { id: 'P-YEARLY', status: 'ACTIVE' } },
			{ status: 201, json: { ...COMMITMENT, plan_id: 'P-YEARLY' } }
		]);

		const result = await createPaypalProvider(CREDENTIALS).createRecurringGift({
			...GIFT,
			interval: 'yearly',
			metadata: { ...GIFT_METADATA, interval: 'yearly' }
		});

		expect(sent(apiCall(calls, 1)).billing_cycles).toMatchObject([
			{ frequency: { interval_unit: 'YEAR', interval_count: 1 } }
		]);
		expect(sent(apiCall(calls, 2))).toMatchObject({ plan_id: 'P-YEARLY' });
		expect(result.ok).toBe(true);
	});

	/**
	 * a commitment short of either key is refused, and nothing is created.
	 *
	 * every charge after the first arrives carrying none of its own metadata — PayPal mints the sale
	 * and copies nothing onto it — so what the commitment holds is the only path from money that
	 * moved to the gift it belongs to. created without the pointer, it collects money this deployment
	 * can record against nobody, every interval, until somebody notices and cancels it.
	 * {@link commitmentMetadata} in ./provider.ts argues both.
	 */
	it.each(['donation_id', 'interval'])(
		'refuses a commitment carrying no %s rather than making one',
		async (missing) => {
			const { calls } = recording([]);
			const { [missing]: _absent, ...rest } = GIFT_METADATA;

			const result = await createPaypalProvider(CREDENTIALS).createRecurringGift({
				...GIFT,
				metadata: rest
			});

			expect(result.ok === false && result.reason).toBe('invalid_request');
			expect(result.ok === false && result.detail).toContain(missing);
			expect(calls).toEqual([]);
		}
	);

	/**
	 * the same attempt made twice resolves to one commitment, because the key does not move.
	 *
	 * this is the whole of what an idempotency key buys and it is lost by generating one: a value
	 * minted inside this call is new on every retry, so a lost answer becomes a donor committed
	 * twice — charged twice, every interval, until somebody notices. PayPal honours the header for
	 * 72 hours, which is the window a retry after a lost answer happens inside.
	 */
	it('sends one derived key for the same attempt made twice', async () => {
		const { calls } = recording([
			{ status: 200, json: { plans: [heldPlan()] } },
			{ status: 201, json: COMMITMENT },
			{ status: 200, json: { plans: [heldPlan()] } },
			{ status: 201, json: COMMITMENT }
		]);
		const provider = createPaypalProvider(CREDENTIALS);

		await provider.createRecurringGift(GIFT);
		await provider.createRecurringGift(GIFT);

		const first = apiCall(calls, 1)?.headers['paypal-request-id'];
		expect(first).toContain(GIFT.idempotencyKey);
		expect(apiCall(calls, 3)?.headers['paypal-request-id']).toBe(first);
	});

	/**
	 * the map a real repeating gift carries fits PayPal's field, which is what makes this rail usable
	 * at all.
	 *
	 * `custom_id` on a subscription holds 127 characters
	 * (https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/billing_subscriptions_v1.json,
	 * `subscription_request_post`), against 255 on a purchase unit — and a map of six keys with two
	 * UUIDs among them encodes to 217, which is why the donor and the fund are read off the gift's
	 * own row rather than carried here.
	 *
	 * the fixture is `commitmentMetadata` itself rather than a map written out here: what has to fit is
	 * what ../donations/quote.ts actually sends, and a hand-written copy of it would go on fitting
	 * after the real one stopped. the amount is the largest a donor plausibly commits to, because the
	 * gift figure is the only value in the map whose length moves.
	 */
	it('creates a commitment carrying the map a repeating gift actually mints', async () => {
		const { calls } = recording([
			{ status: 200, json: { plans: [heldPlan()] } },
			{ status: 201, json: COMMITMENT }
		]);
		const metadata = commitmentMetadata({
			donationId: '019412e0-8a1f-7000-9000-a1b2c3d4e5f8',
			interval: 'monthly',
			giftMinor: 100_000_000,
			coversFee: true
		});

		const result = await createPaypalProvider(CREDENTIALS).createRecurringGift({
			...GIFT,
			metadata
		});

		expect(result.ok).toBe(true);
		expect(sent(apiCall(calls, 1)).custom_id).toBe(JSON.stringify(metadata));
	});

	/**
	 * a commitment whose metadata will not fit PayPal's field is refused rather than trimmed.
	 *
	 * a trimmed map is a collection with no gift attached to it, found when the books are read. what
	 * the refusal buys over PayPal's own 400 is a message naming the keys.
	 */
	it('refuses metadata that will not fit the subscription’s field', async () => {
		const { calls } = recording([]);

		const result = await createPaypalProvider(CREDENTIALS).createRecurringGift({
			...GIFT,
			metadata: { ...GIFT_METADATA, note: 'x'.repeat(128) }
		});

		expect(result.ok === false && result.reason).toBe('invalid_request');
		expect(result.ok === false && result.detail).toContain('note');
		expect(calls).toEqual([]);
	});
});

describe('cancelRecurringGift', () => {
	/**
	 * a stopped commitment is dated by this deployment's clock, because PayPal answers with nothing.
	 *
	 * the cancel is documented as `204 No Content`
	 * (https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/billing_subscriptions_v1.json),
	 * so there is no `status_update_time` to take and the moment the call was made is the honest
	 * answer — which is what `RecurringGiftEnd.endedAt` in ./provider.ts already says it is.
	 */
	it('stops the commitment and dates it when the call was made', async () => {
		const { calls } = recording([{ status: 204, json: null }]);
		const before = Date.now();

		const result = await createPaypalProvider(CREDENTIALS).cancelRecurringGift('I-BW452GLLEP1G');

		expect(path(apiCall(calls))).toBe('/v1/billing/subscriptions/I-BW452GLLEP1G/cancel');
		expect(result.ok && result.value.providerGiftId).toBe('I-BW452GLLEP1G');
		const endedAt = result.ok ? result.value.endedAt.getTime() : 0;
		expect(endedAt).toBeGreaterThanOrEqual(before);
		expect(endedAt).toBeLessThanOrEqual(Date.now());
	});

	/**
	 * a cancel PayPal refused is a refusal, never a stop this app then records.
	 *
	 * ../recurring/stop.ts writes `ended_at` off this answer and writes nothing on a refusal, because
	 * a row marked stopped over a subscription still collecting is the dashboard saying a donor was
	 * let go while their card goes on being charged — the one disagreement no later read repairs.
	 */
	it('reports a cancel PayPal refused rather than a gift that stopped', async () => {
		recording([
			{
				status: 422,
				json: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'SUBSCRIPTION_STATUS_INVALID' }] }
			}
		]);

		const result = await createPaypalProvider(CREDENTIALS).cancelRecurringGift('I-BW452GLLEP1G');

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.detail).toContain('SUBSCRIPTION_STATUS_INVALID');
	});

	/**
	 * a commitment PayPal does not hold is `not_found`, which is the one refusal the caller writes on.
	 *
	 * ../recurring/stop.ts reads it as "nothing is collecting under it" and stops the row all the
	 * same, which is how a gift cancelled in PayPal's own dashboard first is correctable from this
	 * deployment's at all.
	 */
	it('reports a commitment PayPal does not hold as not_found', async () => {
		recording([{ status: 404, json: { name: 'RESOURCE_NOT_FOUND' } }]);

		const result = await createPaypalProvider(CREDENTIALS).cancelRecurringGift('I-GONE');

		expect(result.ok === false && result.reason).toBe('not_found');
	});
});

/**
 * a v1 sale, as one charge under a commitment is read back.
 *
 * the resource `PAYMENT.SALE.COMPLETED` carries, and the only shape that names both the money and
 * the subscription it was collected for. PayPal publishes no sample body for a subscription's sale;
 * the fields are the ones on its own schema.
 */
const SALE = {
	id: '1KE4800513426762K',
	state: 'completed',
	amount: { total: '97.13', currency: 'USD' },
	transaction_fee: { currency: 'USD', value: '3.11' },
	billing_agreement_id: 'I-BW452GLLEP1G',
	create_time: '2026-09-16T22:20:08Z'
};

/** a commitment as PayPal answers a read asked for its plan, until a case overrides a field. */
const commitment = (over: Record<string, unknown> = {}) => ({
	id: 'I-BW452GLLEP1G',
	plan_id: 'P-5ML4271244454362WXNWU5NQ',
	status: 'ACTIVE',
	start_time: '2026-08-16T22:20:08Z',
	custom_id: JSON.stringify(GIFT_METADATA),
	subscriber: { payer_id: 'QYR5Z8CTNNPXA' },
	// the two the SDK's schema requires beside the date this app reads, so the fixture is a body
	// PayPal's own decoder accepts.
	billing_info: {
		outstanding_balance: { currency_code: 'USD', value: '0.00' },
		failed_payments_count: 0,
		next_billing_time: '2026-10-16T22:20:08Z'
	},
	plan: {
		billing_cycles: [
			{
				tenure_type: 'REGULAR',
				sequence: 1,
				frequency: { interval_unit: 'MONTH', interval_count: 1 }
			}
		]
	},
	...over
});

/** one recurring delivery, as `verifyEvent` hands it to the read arm. */
const notice = (type: string, providerNoticeId: string) => ({
	id: 'WH-1AB23456CD789012E-3FG45678HI901234J',
	kind: 'recurring' as const,
	type,
	providerNoticeId,
	occurredAt: new Date('2026-09-16T22:20:08Z')
});

describe('readRecurringGift', () => {
	/**
	 * a charge is read back to the commitment it belongs to, through the sale and then the
	 * subscription.
	 *
	 * two reads and not one, because the sale is the only object that names both: there is no
	 * `custom_id` on a v1 sale, so the metadata that says whose gift this is lives on the commitment
	 * and `billing_agreement_id` is the whole path to it. everything on the notice comes from those
	 * reads rather than from the delivery — a delivery is serialised in whatever API version the
	 * account held when it happened (`RecurringGiftNotice` in ./provider.ts).
	 */
	it('reads a charge back to the commitment it belongs to', async () => {
		const { calls } = recording([
			{ status: 200, json: SALE },
			{ status: 200, json: commitment() }
		]);

		const result = await createPaypalProvider(CREDENTIALS).readRecurringGift(
			notice('PAYMENT.SALE.COMPLETED', SALE.id)
		);

		expect(path(apiCall(calls))).toBe('/v1/payments/sale/1KE4800513426762K');
		expect(path(apiCall(calls, 1))).toBe('/v1/billing/subscriptions/I-BW452GLLEP1G');
		expect(query(apiCall(calls, 1)).get('fields')).toBe('plan');
		expect(result.ok && result.value).toEqual({
			about: 'collection',
			providerGiftId: 'I-BW452GLLEP1G',
			providerCustomerId: 'QYR5Z8CTNNPXA',
			state: 'active',
			interval: 'monthly',
			metadata: GIFT_METADATA,
			nextChargeAt: new Date('2026-10-16T22:20:08Z'),
			providerTxnId: '1KE4800513426762K',
			endedAt: null
		});
	});

	/**
	 * a sale naming no billing agreement is refused, never reconciled against whatever was readable.
	 *
	 * `billing_agreement_id` is documented only as the billing agreement's id and PayPal publishes no
	 * sample body for a subscription's sale, so nothing in its documentation establishes that a
	 * subscription id lands there. guessing the other way — taking the sale's own id, or the payer's
	 * — is a collection posted against the wrong donor's gift, which nothing downstream could see.
	 */
	it('refuses a sale that names no billing agreement', async () => {
		const { billing_agreement_id: _absent, ...orphan } = SALE;
		recording([{ status: 200, json: orphan }]);

		const result = await createPaypalProvider(CREDENTIALS).readRecurringGift(
			notice('PAYMENT.SALE.COMPLETED', SALE.id)
		);

		expect(result.ok === false && result.reason).toBe('provider_error');
		expect(result.ok === false && result.detail).toContain('billing_agreement_id');
	});

	/**
	 * a collection that failed is a collection with no transaction, never the commitment's standing.
	 *
	 * money was meant to move and did not, and the resource PayPal sends is the subscription rather
	 * than a charge — so there is nothing for `readSettlement` to reconcile and `providerTxnId` is
	 * null. read as `commitment`, a gift whose card failed once would be recorded as having stopped;
	 * PayPal's own retries are still running against it and the state says `active`.
	 */
	it('reads a failed collection as a collection with no transaction', async () => {
		const { calls } = recording([{ status: 200, json: commitment() }]);

		const result = await createPaypalProvider(CREDENTIALS).readRecurringGift(
			notice('BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'I-BW452GLLEP1G')
		);

		expect(path(apiCall(calls))).toBe('/v1/billing/subscriptions/I-BW452GLLEP1G');
		expect(result.ok && result.value).toMatchObject({
			about: 'collection',
			providerTxnId: null,
			state: 'active'
		});
	});

	/** a lifecycle delivery is about the commitment itself and names no charge at all. */
	it('reads a lifecycle delivery as the commitment’s own standing', async () => {
		recording([
			{
				status: 200,
				json: commitment({ status: 'CANCELLED', status_update_time: '2026-09-16T22:20:08Z' })
			}
		]);

		const result = await createPaypalProvider(CREDENTIALS).readRecurringGift(
			notice('BILLING.SUBSCRIPTION.CANCELLED', 'I-BW452GLLEP1G')
		);

		expect(result.ok && result.value).toMatchObject({
			about: 'commitment',
			providerTxnId: null,
			state: 'ended',
			endedAt: new Date('2026-09-16T22:20:08Z')
		});
	});

	/**
	 * every status PayPal can report reads back as one of the port's four.
	 *
	 * the closed set is the six on `subscription_status` in the shipped spec, and the two readings
	 * worth pinning are `APPROVED` and `SUSPENDED`: approval is not collection, so a gift nobody has
	 * paid for yet must not read as collecting; and PayPal's suspension is reversible, so `ended`
	 * would be a commitment this deployment could never see come back — `revives` in
	 * ../donations/collect.ts is written for exactly that return.
	 */
	it.each([
		['APPROVAL_PENDING', 'pending'],
		['APPROVED', 'pending'],
		['ACTIVE', 'active'],
		['SUSPENDED', 'lapsed'],
		['CANCELLED', 'ended'],
		['EXPIRED', 'ended']
	])('reads %s back as %s', async (status, state) => {
		recording([{ status: 200, json: commitment({ status }) }]);

		const result = await createPaypalProvider(CREDENTIALS).readRecurringGift(
			notice('BILLING.SUBSCRIPTION.ACTIVATED', 'I-BW452GLLEP1G')
		);

		expect(result.ok && result.value.state).toBe(state);
	});

	/**
	 * a cadence outside the two this app models is no cadence rather than the nearest one.
	 *
	 * PayPal's plans can repeat daily, weekly and every third month, and a commitment on one of those
	 * was not made by this app. `RecurringGiftNotice.interval` in ./provider.ts is null for it so the
	 * collection is still recorded — a cadence is a label on money that has already moved.
	 */
	it('reports a cadence it does not model as none', async () => {
		recording([
			{
				status: 200,
				json: commitment({
					plan: {
						billing_cycles: [
							{
								tenure_type: 'REGULAR',
								sequence: 1,
								frequency: { interval_unit: 'WEEK', interval_count: 1 }
							}
						]
					}
				})
			}
		]);

		const result = await createPaypalProvider(CREDENTIALS).readRecurringGift(
			notice('BILLING.SUBSCRIPTION.ACTIVATED', 'I-BW452GLLEP1G')
		);

		expect(result.ok && result.value.interval).toBe(null);
	});
});

describe('readSettlement on a repeating gift’s charge', () => {
	/** an order read that answers with nothing, which is how a sale id reaches the sale read. */
	const NO_ORDER = { status: 404, json: { name: 'RESOURCE_NOT_FOUND' } };

	/**
	 * a collection reconciles through the same arm a single gift does, and keeps its cents.
	 *
	 * the port hands `readSettlement` one id and a repeating gift's charge is a v1 sale rather than
	 * an order, so this arm reads both — the order first, because that is the majority of what the
	 * column holds and a one-off gift must not pay for a second call. the three field vocabularies
	 * are the adapter's to absorb: a sale states `amount.total` and `transaction_fee` and no net,
	 * where an Orders v2 capture states a breakdown.
	 */
	it('reads the gross, the fee and the time PayPal reported for one charge', async () => {
		const { calls } = recording([NO_ORDER, { status: 200, json: SALE }]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement(SALE.id);

		expect(path(apiCall(calls, 1))).toBe('/v1/payments/sale/1KE4800513426762K');
		expect(result.ok && result.value).toEqual({
			providerTxnId: '1KE4800513426762K',
			status: 'succeeded',
			// PayPal publishes no funding source on a sale, so a collection records none rather than
			// asserting the rail the commitment was quoted on.
			method: null,
			amountMinor: 9713,
			currency: 'USD',
			feeMinor: 311,
			// a sale carries no `custom_id`; a collection is attributed through the commitment's,
			// which `readRecurringGift` reads.
			metadata: {},
			occurredAt: new Date('2026-09-16T22:20:08Z')
		});
	});

	/**
	 * a charge PayPal refused is `failed`, and its money is still read.
	 *
	 * a denied collection is a `payment` row of its own — the books record the attempt — so the
	 * figures matter as much as the state does.
	 */
	it('reads a denied charge as failed', async () => {
		recording([NO_ORDER, { status: 200, json: { ...SALE, state: 'denied' } }]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement(SALE.id);

		expect(result.ok && result.value.status).toBe('failed');
	});

	/**
	 * a fee PayPal stated in another currency is no fee rather than a converted one.
	 *
	 * an entry group holds one currency (../ledger/posting.ts), and a rate applied to a figure whose
	 * denomination this app is guessing at is a fee wrong by that rate — arithmetically sound and
	 * silently wrong. ../donations/settle.ts posts the charge and tells an operator.
	 */
	it('reports no fee where PayPal stated one in another currency', async () => {
		recording([
			NO_ORDER,
			{ status: 200, json: { ...SALE, transaction_fee: { currency: 'GBP', value: '2.44' } } }
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement(SALE.id);

		expect(result.ok && result.value.feeMinor).toBe(null);
		expect(result.ok && result.value.amountMinor).toBe(9713);
	});

	/**
	 * a charge read that came back gone fails loudly, naming what replaces it.
	 *
	 * the read is on the deprecated Payments v1 API and it is deliberate — the current substitute is
	 * keyed by the subscription and a time window and returns a list with no read-one-by-id. the day
	 * PayPal retires the endpoint, every collection stops reconciling, and what stands between that
	 * and a silent 200 is this refusal.
	 */
	it('refuses a charge it could not read rather than reporting nothing', async () => {
		recording([NO_ORDER, { status: 404, json: { name: 'RESOURCE_NOT_FOUND' } }]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement(SALE.id);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.detail).toContain(
			'/v1/billing/subscriptions/{id}/transactions'
		);
	});

	/**
	 * a sale whose gross this app cannot read is refused, never posted as zero.
	 *
	 * the same refusal a capture takes, and for the same reason: the amount is what a `payment` row
	 * and both ledger entries are written from, so a settlement carrying 0 balances and posts a gift
	 * of nothing.
	 */
	it('refuses a charge whose gross is not a figure at the currency’s scale', async () => {
		recording([
			NO_ORDER,
			{ status: 200, json: { ...SALE, amount: { total: '97.1301', currency: 'USD' } } }
		]);

		const result = await createPaypalProvider(CREDENTIALS).readSettlement(SALE.id);

		expect(result.ok === false && result.reason).toBe('provider_error');
	});
});

describe('what a donor typed', () => {
	/**
	 * no name, email address or message a donor gave this deployment reaches PayPal on either call.
	 *
	 * a commitment carries pointers and figures only (CLAUDE.md, *Bans* → **Repeating gifts**), and
	 * the field that would break that is `subscriber` — it takes a name, an email address and a
	 * shipping address, and PayPal collects all three in its own window anyway. the cancel's reason
	 * is the other one: it is a fixed sentence rather than anything about the gift.
	 */
	it('reaches PayPal on neither the create nor the cancel', async () => {
		const { calls } = recording([
			{ status: 200, json: { plans: [heldPlan()] } },
			{ status: 201, json: COMMITMENT },
			{ status: 204, json: null }
		]);
		const provider = createPaypalProvider(CREDENTIALS);

		await provider.createRecurringGift(GIFT);
		await provider.cancelRecurringGift('I-BW452GLLEP1G');

		expect(Object.keys(sent(apiCall(calls, 1)))).toEqual(['plan_id', 'custom_id']);
		expect(Object.keys(sent(apiCall(calls, 2)))).toEqual(['reason']);
	});
});

describe('the listeners the app holds', () => {
	/**
	 * one read of the app's listeners, each summarised with its own id as the stamp.
	 *
	 * the id is what `PAYPAL_WEBHOOK_ID` holds and what a delivery is verified against, so it is the
	 * whole of what ./webhook-secret.ts compares — and it is public, so nothing is digested.
	 */
	it('summarises every listener with its id as the stamp and the whole subscription as required', async () => {
		const { calls } = recording([
			{
				status: 200,
				json: {
					webhooks: [
						{
							id: '7YN47048TX2895013',
							url: 'https://give.example.org/api/paypal/webhook',
							event_types: [
								{ name: 'CHECKOUT.ORDER.APPROVED', description: 'x', status: 'ENABLED' },
								{ name: 'PAYMENT.CAPTURE.COMPLETED', description: 'x', status: 'ENABLED' }
							]
						}
					]
				}
			}
		]);

		const result = await createPaypalProvider(CREDENTIALS).listWebhookEndpoints();

		expect(apiCall(calls)?.method).toBe('GET');
		expect(path(apiCall(calls))).toBe('/v1/notifications/webhooks');
		expect(result.ok && result.value).toEqual({
			endpoints: [
				{
					id: '7YN47048TX2895013',
					url: 'https://give.example.org/api/paypal/webhook',
					enabled: true,
					eventTypes: ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED'],
					apiVersion: null,
					verificationStamp: '7YN47048TX2895013'
				}
			],
			requiredEventTypes: [
				'CHECKOUT.ORDER.APPROVED',
				'PAYMENT.CAPTURE.COMPLETED',
				'PAYMENT.CAPTURE.DENIED',
				'PAYMENT.SALE.COMPLETED',
				'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
				'BILLING.SUBSCRIPTION.ACTIVATED',
				'BILLING.SUBSCRIPTION.CANCELLED',
				'BILLING.SUBSCRIPTION.EXPIRED',
				'BILLING.SUBSCRIPTION.SUSPENDED'
			]
		});
	});

	/** an app holding no listener is an empty list, which is what reads as unregistered. */
	it('reads an app with no listener as an empty list', async () => {
		recording([{ status: 200, json: {} }]);

		const result = await createPaypalProvider(CREDENTIALS).listWebhookEndpoints();

		expect(result.ok && result.value.endpoints).toEqual([]);
	});

	/** a refused read is the credentials' sentence, never an app holding nothing. */
	it('refuses the read where PayPal does not accept the credentials', async () => {
		recording([{ status: 401, json: { name: 'AUTHENTICATION_FAILURE' } }]);

		const result = await createPaypalProvider(CREDENTIALS).listWebhookEndpoints();

		expect(result.ok === false && result.reason).toBe('not_configured');
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
