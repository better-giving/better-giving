import {
	ApiError,
	CheckoutPaymentIntent,
	Client,
	Environment,
	OrderStatus,
	OrdersController,
	PaymentsController
} from '@paypal/paypal-server-sdk';
import type { CapturedPayment, OAuthToken, Order } from '@paypal/paypal-server-sdk';
import { PAYPAL_RAILS, type PaypalRail } from '@better-giving/form/embed/rails';
import type { PaymentStatus } from '../db/schema';
import { majorText, readAmount } from '../../forms/amounts';
import { redact, redactPublicId } from '../../redact';
import type {
	AccountChargeability,
	Intent,
	IntentRequest,
	PaymentFailure,
	PaymentProvider,
	PaymentResult,
	QuotedRail,
	SettledRail,
	RecurringGift,
	RecurringGiftEnd,
	RecurringGiftNotice,
	RecurringGiftProvision,
	RecurringGiftStanding,
	RailSwitchboard,
	RegisteredWebhookEndpoint,
	Settlement,
	WalletDomain,
	WebhookDelivery,
	WebhookEndpointRegistry,
	WebhookEndpointSummary,
	PaymentEvent
} from './provider';

// the PayPal adapter, and the only module in this repository that imports
// `@paypal/paypal-server-sdk`.
//
// that is the rule ./sole-importer.spec.ts enforces, and it is the same shape ./stripe.ts holds over
// its own SDK for the same stated reason: so the contract has exactly one place to be stated.
// everything else takes `PaymentProvider` from ./provider.ts.
//
// **it answers the one-off gift and refuses the rest, and both halves are the shape of the thing.**
// a gift that repeats is a catalog product, a billing plan and a subscription on PayPal's side —
// three object graphs this release does not build — so the five recurring arms answer `unsupported`,
// exactly as ./factory.ts answers for a processor with no adapter at all. the webhook-management and
// wallet arms answer the same way and for a different reason, argued at each of them.
//
// **live only, and nothing here reads a stage.** `Environment.Production` is the one host, because
// nothing in this project reads test-versus-live and rehearsing is a second deployment (DEPLOY.md).

/** what the adapter needs to talk to an account. */
export type PaypalCredentials = {
	/** `PAYPAL_CLIENT_ID`. the half that also starts the browser SDK, so it is not a secret. */
	readonly clientId: string;
	/** `PAYPAL_CLIENT_SECRET`. server-only, never bundled, never logged, never echoed. */
	readonly clientSecret: string;
	/**
	 * `PAYPAL_WEBHOOK_ID` — the id of the listener this deployment's deliveries are sent to, or
	 * `null` where the deployment holds none.
	 *
	 * nullable rather than required, for the reason `StripeCredentials.webhookSecret` in ./stripe.ts
	 * is: it is sent on no outbound call and read by `verifyEvent` alone. it is not a credential —
	 * it is a public identifier, and `RegisteredWebhookEndpoint.verificationValue` in ./provider.ts
	 * argues what that changes — but it is the value the verification is made *against*, and a
	 * deployment holding none can verify nothing.
	 *
	 * `null` rather than an empty string, so the compiler puts the refusal at the one line that reads
	 * it. an empty string would type-check straight into the verification call and come back as a
	 * delivery that did not verify, sending an operator to compare an id they do not have against a
	 * listener that is fine.
	 */
	readonly webhookId: string | null;
};

/**
 * how long a call may take before it is reported as unanswered.
 *
 * the same number ./stripe.ts carries and for the same reason: the caller is a donor waiting on a
 * public endpoint, and a request that hangs is a form that appears broken and a person who presses
 * the button again. twelve seconds absorbs an ordinary slow answer and is short enough that
 * `unreachable` — which the caller retries under the same idempotency key — arrives while they are
 * still on the page.
 */
const TIMEOUT_MS = 12_000;

/** the shape the ledger holds a currency in, and the shape this port takes one in. */
const CURRENCY = /^[A-Z]{3}$/;

/**
 * the rails this adapter settles: the key each one appears under on an order's `payment_source`, and
 * what a `payment` row calls it.
 *
 * one table read in both directions, because the two questions are one fact. `settles` below asks
 * whether a rail a donor picked is this adapter's; `railOf` asks which rail a payer actually used,
 * off the one key PayPal filled in. written as two tables the second would be the one that stops
 * agreeing with the first.
 *
 * total over `PaypalRail` (`PAYPAL_RAILS` in packages/form/src/embed/rails.ts) and checked against
 * `SettledRail` by `satisfies`, so a rail added to this processor's list is a compile error here —
 * and so is one the `payment` column cannot record. the two vocabularies happen to spell these two
 * the same and nothing here rests on that: the mapping is written out.
 */
const SETTLED_RAILS = Object.freeze({
	paypal: 'paypal',
	venmo: 'venmo'
}) satisfies Record<PaypalRail, SettledRail>;

/**
 * whether a rail a donor picked is one this adapter settles.
 *
 * the write path narrows through this before its own lookup rather than calling a guard from inside
 * one, so the lookup behind the narrowing is total — the shape ./stripe.ts's `unsettledRail` keeps.
 *
 * `Object.hasOwn` and never `in`: `in` walks the prototype chain, so `constructor` and `toString`
 * pass it and the lookup behind hands back something off `Object.prototype` — a `TypeError` out of
 * the adapter, which is a 500 on a public payment-initiating endpoint in place of the 4xx this
 * guard is written to produce.
 */
function settles(rail: QuotedRail): rail is PaypalRail {
	return Object.hasOwn(SETTLED_RAILS, rail);
}

function unsettledRail(method: QuotedRail): PaymentFailure {
	return {
		ok: false,
		reason: 'invalid_request',
		detail:
			`method \`${redact(String(method))}\` is not a rail this adapter can mint an order for. ` +
			`The rails are ${Object.keys(SETTLED_RAILS).join(', ')}, and the value is one a donor picked ` +
			'from what the form offered.'
	};
}

/**
 * how much of the metadata map one order can carry.
 *
 * `custom_id` on a purchase unit is capped at 255 characters
 * (https://developer.paypal.com/docs/api/orders/v2/#definition-purchase_unit_request), and it is the
 * whole of what an API caller may write on an order: there is no metadata map, and the other two
 * writable fields are read by the payer — `invoice_id` appears in their transaction history and
 * `description` on the approval screen — so neither is a place to put this app's own pointers.
 */
const CUSTOM_ID_MAX = 255;

/**
 * the port's metadata map as one field, and back.
 *
 * JSON rather than a delimited form, because the values are a third party's to read and one of them
 * is free text the day a key is added — a `key=value;` encoding is one semicolon in a value away
 * from a map that parses into the wrong shape, silently, on the read side.
 *
 * the read is total and never throws: a `custom_id` that is not this app's JSON is an order created
 * before this encoding, or by hand in the dashboard, and it carries no metadata rather than failing
 * a settlement. a settlement with no metadata is already a state ../donations/settle.ts answers —
 * it tells an operator — where a throw here would be a delivery retried for three days over an
 * object that will never parse.
 */
function encodeMetadata(metadata: Readonly<Record<string, string>>): string {
	return JSON.stringify(metadata);
}

function decodeMetadata(customId: string | undefined): Readonly<Record<string, string>> {
	if (!customId) return {};
	try {
		const read: unknown = JSON.parse(customId);
		if (typeof read !== 'object' || read === null || Array.isArray(read)) return {};
		return Object.fromEntries(
			Object.entries(read as Record<string, unknown>).flatMap(([key, value]) =>
				typeof value === 'string' ? [[key, value]] : []
			)
		);
	} catch {
		return {};
	}
}

/**
 * the one host this adapter talks to.
 *
 * spelled here for the calls that reach past the SDK, and it is the same host the SDK resolves
 * `Environment.Production` to. there is no sandbox constant beside it because nothing in this
 * project reads test-versus-live: rehearsing is a second deployment (DEPLOY.md).
 */
const API_BASE = 'https://api-m.paypal.com';

/**
 * the five headers a delivery is signed with, and the field each one is sent for verification as.
 *
 * lowercase, because `WebhookDelivery.headers` in ./provider.ts is keyed the way `Headers` iterates.
 * the field names are the verification request's own
 * (https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature), and the pairing is
 * a table rather than five reads so that a header this app forgets to forward is a missing entry
 * here rather than a verification that quietly checks less than it looks like it does.
 */
const SIGNING_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	'paypal-transmission-id': 'transmission_id',
	'paypal-transmission-time': 'transmission_time',
	'paypal-transmission-sig': 'transmission_sig',
	'paypal-cert-url': 'cert_url',
	'paypal-auth-algo': 'auth_algo'
});

/**
 * the deliveries this adapter acts on, and which of them says a payment moved.
 *
 * three rather than PayPal's whole catalogue, because three is what the one-off path has a read for.
 * `CHECKOUT.ORDER.APPROVED` is the payer having authorised the order and is what the capture is made
 * from; the two capture events are the money having moved or having been refused. everything else
 * verifies, reports `ignored`, and is answered — a listener subscribed to more than this is noisy
 * rather than broken.
 *
 * **an event name is not unique to one API generation**, which is why membership of this list is not
 * the whole of what a delivery is read on. `PAYMENT.CAPTURE.COMPLETED` is published under Payments
 * v2 and under Payments v1, and the two carry different resources under the same name — so
 * `orderIdOf` below looks for the order where the shape this app reads puts it, and a delivery that
 * carries none is refused rather than reconciled against whatever id happened to be readable.
 */
const SETTLEMENT_EVENT_TYPES = [
	'CHECKOUT.ORDER.APPROVED',
	'PAYMENT.CAPTURE.COMPLETED',
	'PAYMENT.CAPTURE.DENIED'
] as const;

/**
 * the order a delivery is about, off the resource the event carries.
 *
 * every arm of this app's settlement path is keyed on the order id — it is what `createIntent`
 * returned and what `payment.provider_txn_id` holds — so a capture event is resolved to the order
 * behind it here rather than anywhere downstream. a capture id stored in that column would be a row
 * no later delivery about the same gift could find.
 *
 * a v2 capture carries it at `supplementary_data.related_ids.order_id`
 * (https://developer.paypal.com/docs/api/payments/v2/#definition-related_ids); an order event
 * carries the order itself. `null` is a delivery this adapter subscribes to and cannot reconcile,
 * which the caller reports rather than ignores.
 */
function orderIdOf(type: string, resource: unknown): string | null {
	const read = (value: unknown): string | null => (typeof value === 'string' ? value : null);
	const object: Record<string, unknown> =
		typeof resource === 'object' && resource !== null ? (resource as Record<string, unknown>) : {};
	if (type.startsWith('CHECKOUT.ORDER.')) return read(object.id);
	return read(((object.supplementary_data as Json)?.related_ids as Json)?.order_id);
}

/** an object read out of somebody else's JSON, indexed without asserting what is under a key. */
type Json = Record<string, unknown> | undefined;

/**
 * why an amount, a currency or a key may not be sent, or nothing.
 *
 * the same three checks ./stripe.ts's `unusableMoney` makes and for the same three reasons: the
 * message names the offending field instead of quoting a processor's error at whoever reads a 4xx,
 * the currency is checked before it is used to pick a scale, and a malformed attempt does not burn
 * an idempotency key the corrected attempt may want.
 *
 * the amount is checked as a positive safe integer and never coerced. minor units are the encoding
 * everywhere in this app (CLAUDE.md), so a float arriving here is money arithmetic done in dollars
 * somewhere upstream — rounding it would charge a number nobody computed.
 */
function unusableMoney(request: IntentRequest): PaymentFailure | null {
	if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0) {
		return {
			ok: false,
			reason: 'invalid_request',
			detail:
				`amountMinor is ${request.amountMinor}, which is not a positive safe integer. ` +
				'Amounts are minor units — $100.00 is 10000, not 100 and not 100.0.'
		};
	}

	if (!CURRENCY.test(request.currency)) {
		return {
			ok: false,
			reason: 'invalid_request',
			// echoed through ../../redact.ts, which is the policy for every message in this app that
			// names an offending value.
			detail:
				`currency \`${redact(request.currency)}\` is not a 3-letter uppercase ISO-4217 code. ` +
				'PayPal takes the same uppercase code the ledger stores, and the number of decimal ' +
				'places the amount is written to is read from it.'
		};
	}

	// not `=== ''`. an `undefined` reaching here through an untyped caller would make the SDK omit
	// the header altogether and the request would succeed — the double-charge defence gone, with
	// nothing anywhere reporting it. whitespace is the same hole wearing a value.
	if (typeof request.idempotencyKey !== 'string' || request.idempotencyKey.trim() === '') {
		return {
			ok: false,
			reason: 'invalid_request',
			detail:
				'idempotencyKey is empty. It is what makes a retry after a lost answer resolve to the ' +
				'order that already exists rather than minting a second one, so an attempt without one ' +
				'is an attempt that can double-charge.'
		};
	}

	return null;
}

/**
 * what each group of unbuilt arms says, stated once.
 *
 * one sentence per group rather than one per arm, because every arm in a group is refused for the
 * same reason and a reader who saw two wordings would go looking for the difference.
 */
const NO_REPEATING =
	'This release cannot take a gift that repeats through PayPal: a repeating gift is a catalog ' +
	'product, a billing plan and a subscription on PayPal\u2019s side, and this release builds none of ' +
	'the three. Nothing about the deployment changes it. A one-off gift through PayPal is unaffected.';

const NO_LISTENER_MANAGEMENT =
	'This release does not manage PayPal\u2019s listeners. The listener for this deployment\u2019s ' +
	'address is created on the PayPal developer dashboard, under the app these credentials belong to, ' +
	'and its id is what `PAYPAL_WEBHOOK_ID` is set to.';

const NO_WALLET_DOMAINS =
	'PayPal registers no hostname for wallets. Its funding sources are drawn inside PayPal\u2019s own ' +
	'window on PayPal\u2019s own domain rather than on a page this deployment serves, so there is ' +
	'nothing here to register and nothing to read.';

/**
 * a `Client` and the port over it, built per call from a request's own credentials.
 *
 * never a module-scope singleton — the secret only exists on a request's `platform.env`
 * (CLAUDE.md) — which is the `createStripeProvider` shape in ./stripe.ts and `createDb(d1)`'s in
 * ../db/client.ts.
 *
 * two options make it work on workerd, and both are passed explicitly rather than left to the SDK's
 * platform detection:
 *
 *   - `adapter: 'fetch'`. the SDK is built on axios, whose default adapter reaches for node's
 *     `http` module; the fetch adapter is what this runtime has.
 *   - `fetchOptions.cache`. axios's fetch adapter otherwise sends `cache: 'default'`, which workerd
 *     rejects outright — every call throws `Unsupported cache mode: default` before it leaves.
 *
 * neither claim is left to this comment. ./paypal.workers.spec.ts builds a provider with no seam at
 * all and makes a request inside workerd, which is the only place either can be observed — under
 * node both settings work and a spec there would pass against a build that cannot make one request
 * in production.
 *
 * `maxNumberOfRetries: 0` is not one of those and is pinned for this port's own reason: the SDK's
 * own retry cannot know whether the caller wants one, and every retry that matters here is the
 * caller's to make under the same `IntentRequest.idempotencyKey` — a retry underneath this port is
 * one nothing above it can see or bound.
 */
export function createPaypalProvider(credentials: PaypalCredentials): PaymentProvider {
	// the access token both halves of this adapter spend, minted once.
	//
	// declared before the client because the client is pointed at it: `verifyEvent` reaches the
	// notification API past the SDK — the package ships no webhooks controller — and everything else
	// goes through it, so without one cache a single delivery authenticates twice. `updateToken`
	// mints only when what it is handed is absent or expired, so this is a cache rather than a call.
	//
	// it lives for one request, like the provider around it: the credentials only exist on a
	// request's `platform.env` (CLAUDE.md), so nothing here may outlive one.
	let token: OAuthToken | undefined;

	const client = new Client({
		environment: Environment.Production,
		clientCredentialsAuthCredentials: {
			oAuthClientId: credentials.clientId,
			oAuthClientSecret: credentials.clientSecret,
			oAuthTokenProvider: async (last, manager) => {
				token = await manager.updateToken(token ?? last);
				return token;
			}
		},
		timeout: TIMEOUT_MS,
		httpClientOptions: { retryConfig: { maxNumberOfRetries: 0 } },
		unstable_httpClientOptions: { adapter: 'fetch', fetchOptions: { cache: 'no-store' } }
	});
	const orders = new OrdersController(client);
	const payments = new PaymentsController(client);

	/** the token above as a bearer value, minting one where this request has not needed one yet. */
	const accessToken = async (): Promise<string> => {
		token = await client.clientCredentialsAuthManager.updateToken(token);
		return token.accessToken;
	};

	/**
	 * one authenticated call to an API the SDK ships no controller for.
	 *
	 * it answers with the parsed body and the status rather than throwing, because every caller here
	 * has to tell a refusal apart from a fault — a verification that came back `FAILURE` is a 200 and
	 * is not an error at all.
	 *
	 * the timeout is set here rather than inherited: the SDK carries {@link TIMEOUT_MS} on its own
	 * calls and `fetch` carries none, so without this a verification that never answers holds the
	 * webhook open for as long as PayPal's socket stays up — and the delivery it is holding is one a
	 * redelivery would settle in seconds.
	 */
	async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
		const answer = await fetch(`${API_BASE}${path}`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${await accessToken()}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		return { status: answer.status, body: await answer.json().catch(() => null) };
	}

	/**
	 * takes the money on an approved order, or reports the order as it already stands.
	 *
	 * the request id is derived from the order id rather than generated, because a generated one is
	 * new on every delivery and would therefore guarantee the second capture it exists to prevent.
	 * one order is one capture, so the order's own id is the key that says so.
	 *
	 * `ORDER_ALREADY_CAPTURED` is the answer to a repeat PayPal no longer holds a key for, and it is
	 * read as "the money already moved" rather than as a refusal: what the caller wanted was the
	 * order's current state, and a re-read is what gives it.
	 */
	async function capture(orderId: string) {
		try {
			return (
				await orders.captureOrder({
					id: orderId,
					paypalRequestId: `capture-${orderId}`,
					// the whole order back rather than the id and status a minimal answer carries, so
					// the capture is named without a second read to find it.
					prefer: 'return=representation'
				})
			).result;
		} catch (error) {
			if (error instanceof ApiError && issuesOf(readErrorBody(error)).includes(ALREADY_CAPTURED)) {
				return (await orders.getOrder({ id: orderId })).result;
			}
			throw error;
		}
	}

	return {
		processor: 'paypal',

		/**
		 * an order for one gift, approved in PayPal's own window and captured from the delivery that
		 * says the payer approved it. charges nothing itself.
		 *
		 * **the order names no funding source, which is where this parts company with the inline-card
		 * adapter and is safe here for one reason only.** ./stripe.ts pins an intent to the single rail
		 * the donor was quoted on, because the fee that produced `amountMinor` was priced for that rail
		 * and a gift collected at one price and settled at another comes out of the organisation. here
		 * the two rails are priced identically — `PAYPAL_US_FEE_RULES_CHARITY` and
		 * `PAYPAL_US_FEE_RULES_STANDARD` in ./fees.ts give `paypal` and `venmo` the same rule at both
		 * rates — so a payer who picked Venmo on the form and paid with a PayPal balance is charged
		 * what they were quoted either way. what settled is reported rather than assumed
		 * (`Settlement.method`), so the divergence is recorded rather than hidden.
		 *
		 * **that stops being true the day the two rails are priced apart**, and the fix then is
		 * `payment_source` on the create, which restricts the order to one funding source.
		 */
		async createIntent(request: IntentRequest): Promise<PaymentResult<Intent>> {
			const refusal = unusableMoney(request);
			if (refusal) return refusal;
			if (!settles(request.method)) return unsettledRail(request.method);

			const customId = encodeMetadata(request.metadata ?? {});
			if (customId.length > CUSTOM_ID_MAX) {
				return {
					ok: false,
					reason: 'invalid_request',
					// the keys and not their values: what is too long is a map this app built, and the
					// values in it are a donation id and a donor's contact id — pointers at rows here,
					// and this message reaches a 4xx body.
					detail:
						`the metadata for this gift encodes to ${customId.length} characters and PayPal's ` +
						`\`custom_id\` holds ${CUSTOM_ID_MAX}, so no order was created and nothing was ` +
						`charged. The keys are ${Object.keys(request.metadata ?? {}).join(', ')}. This is a ` +
						'bug in this app rather than anything about the gift: the map is what a settlement ' +
						'is read back through, so it is refused rather than trimmed.'
				};
			}

			try {
				const { result } = await orders.createOrder({
					body: {
						intent: CheckoutPaymentIntent.Capture,
						purchaseUnits: [
							{
								amount: {
									currencyCode: request.currency,
									value: majorText(request.amountMinor, request.currency)
								},
								customId
							}
						]
					},
					paypalRequestId: request.idempotencyKey
				});

				if (!result.id) {
					return {
						ok: false,
						reason: 'provider_error',
						detail:
							'PayPal created an order without an id, so there is nothing for the donor’s ' +
							'browser to approve and nothing to reconcile against. No charge was made.'
					};
				}

				return { ok: true, value: { providerTxnId: result.id, paymentToken: result.id } };
			} catch (error) {
				return classify(error);
			}
		},

		async verifyEvent(received: WebhookDelivery): Promise<PaymentResult<PaymentEvent>> {
			// the one arm this deployment's listener id is read by, and the one that cannot be answered
			// without it. checked before the headers, because a delivery that carried a perfect
			// signature is no more verifiable here than one that carried none — and what an operator
			// has to do about it is set a value rather than look at the request.
			//
			// `not_configured` rather than `bad_signature`, which is the difference between a delivery
			// held open and a delivery lost. it is a retryable reason (`RETRYABLE_FAILURE_REASONS` in
			// ./provider.ts), so the webhook route answers 5xx and PayPal brings the delivery back
			// across its redelivery window — which is the window an operator sets this value inside.
			if (credentials.webhookId === null) {
				return {
					ok: false,
					reason: 'not_configured',
					detail:
						'This deployment cannot check that a payment notification came from PayPal: ' +
						'`PAYPAL_WEBHOOK_ID` is not set, so the delivery was refused and nothing was read ' +
						'out of it. The value is the id of the listener registered for this deployment’s ' +
						'address, which is on the PayPal developer dashboard under the app these ' +
						'credentials belong to.'
				};
			}

			// every header PayPal signs with, or the refusal naming the one that is missing. read before
			// the body for the reason the id is read before them: nothing in an unverified body may be
			// believed, and a delivery short of a header it is signed with is not a delivery PayPal
			// could vouch for even if it were asked.
			const signature: Record<string, string> = {};
			for (const [header, field] of Object.entries(SIGNING_HEADERS)) {
				const value = received.headers[header];
				if (value === undefined) {
					return {
						ok: false,
						reason: 'bad_signature',
						detail:
							`The request carried no \`${header}\` header, so PayPal cannot be asked to vouch ` +
							'for it and its body was not read. This endpoint is public: an unverified ' +
							'delivery is anyone’s delivery.'
					};
				}
				signature[field] = value;
			}

			// parsed once, here, and handed on as an object because that is the shape the verification
			// request takes: `webhook_event` is the event itself rather than the bytes it arrived as
			// (https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature). the body is
			// still read exactly once by the route that owns the endpoint (CLAUDE.md) — this is the
			// string it read, and nothing else parses it.
			let event: Json;
			try {
				const parsed: unknown = JSON.parse(received.body);
				if (typeof parsed !== 'object' || parsed === null) throw new TypeError('not an object');
				event = parsed as Record<string, unknown>;
			} catch {
				return {
					ok: false,
					reason: 'bad_signature',
					detail:
						'The delivery’s body is not a JSON object, so there is nothing for PayPal to vouch ' +
						'for and nothing was read out of it. This endpoint is public: an unverified ' +
						'delivery is anyone’s delivery.'
				};
			}

			let verification: { status: number; body: unknown };
			try {
				verification = await post('/v1/notifications/verify-webhook-signature', {
					...signature,
					// the configured id and never one off the request. every other field here is the
					// delivery's own, so an id taken from it too would be a caller vouching for their own
					// delivery against their own listener.
					webhook_id: credentials.webhookId,
					webhook_event: event
				});
			} catch (error) {
				// a verification that could not be *reached* is not a delivery that failed to verify.
				// `unreachable` is retryable (`RETRYABLE_FAILURE_REASONS` in ./provider.ts), so the route
				// answers 5xx and PayPal brings the delivery back; reported as `bad_signature` it would
				// be a gift lost to one bad minute, under a 400 that says the secret is wrong.
				return unreachable(error);
			}

			if (verification.status !== 200) {
				return classifyStatus(
					verification.status,
					verification.body,
					'PayPal could not be asked whether this delivery is its own'
				);
			}

			if ((verification.body as Json)?.verification_status !== 'SUCCESS') {
				return {
					ok: false,
					reason: 'bad_signature',
					detail:
						'PayPal did not vouch for this delivery, so its body was not read. If this ' +
						'deployment’s own listener is failing, `PAYPAL_WEBHOOK_ID` is not the id of the ' +
						'listener these deliveries are being sent to — the ids are on the PayPal developer ' +
						'dashboard under the app these credentials belong to.'
				};
			}

			const type = typeof event.event_type === 'string' ? event.event_type : '';
			const id = typeof event.id === 'string' ? event.id : '';
			const occurredAt = new Date(String(event.create_time));
			if (id === '' || Number.isNaN(occurredAt.getTime())) {
				return {
					ok: false,
					reason: 'provider_error',
					detail:
						`A verified \`${redactPublicId(type)}\` delivery carried no readable id or time, so ` +
						'there is nothing to record it against and nothing to no-op on when it arrives ' +
						'again. Nothing was acted on.'
				};
			}

			if (!(SETTLEMENT_EVENT_TYPES as readonly string[]).includes(type)) {
				return { ok: true, value: { id, kind: 'ignored', type, occurredAt } };
			}

			const providerTxnId = orderIdOf(type, event.resource);
			if (providerTxnId === null) {
				// verified, subscribed, and unreadable. an event name is published under more than one
				// API generation and the generations carry different resources, so this is what a
				// delivery serialised for one this adapter does not read arrives as. reported as
				// `ignored` it would be a settlement dropped in silence under a 200, which is the failure
				// that loses a gift.
				return {
					ok: false,
					reason: 'provider_error',
					detail:
						`A verified \`${redactPublicId(type)}\` delivery named no order, so there is nothing ` +
						`to reconcile it against. Its \`resource_type\` is ` +
						`\`${redactPublicId(String(event.resource_type ?? 'absent'))}\` and its ` +
						`\`resource_version\` is \`${redactPublicId(String(event.resource_version ?? 'absent'))}\`; ` +
						'this app reads the Orders v2 and Payments v2 shapes.'
				};
			}

			return { ok: true, value: { id, kind: 'settlement', type, providerTxnId, occurredAt } };
		},

		/**
		 * what an order currently is, taking the money first where the payer has approved and it has
		 * not been taken.
		 *
		 * **this arm captures, and that is the shape of PayPal rather than a liberty taken with the
		 * port's word for it.** an order created with `intent: CAPTURE` and approved by the payer is
		 * money authorised and not moved: there is no auto-capture, and a merchant that never asks is
		 * a merchant that never gets paid. so the reconciliation read is also the capture, driven by
		 * the `CHECKOUT.ORDER.APPROVED` delivery — never by the browser coming back to a return URL,
		 * which can be forged, dropped, or arrive before the approval is real (CLAUDE.md, and
		 * `Settlement` in ./provider.ts).
		 *
		 * safe to repeat, which is what the whole redelivery window rests on. the capture carries a
		 * `PayPal-Request-Id` derived from the order id — a value fixed before the first delivery and
		 * identical on every one after it — so a second attempt resolves to the capture that already
		 * exists rather than taking the money twice. `ORDER_ALREADY_CAPTURED` is read as a state
		 * rather than as a failure for the same reason: PayPal honours a request id for a bounded
		 * window and a redelivery can arrive after it, so the two mechanisms cover each other.
		 *
		 * the capture is then read through Payments v2 rather than off whatever the order carries
		 * inline, and that is deliberate at the cost of a round trip: `seller_receivable_breakdown` is
		 * the only place the fee exists, it is documented as absent while a capture is pending, and an
		 * order's inline copy of a capture is a summary. one source means the first delivery and the
		 * fifth redelivery read the same figures.
		 */
		async readSettlement(providerTxnId: string): Promise<PaymentResult<Settlement>> {
			try {
				let order = (await orders.getOrder({ id: providerTxnId })).result;

				if (order.status === OrderStatus.Approved) {
					order = await capture(providerTxnId);
				}

				// the first capture, because this app never partially captures: one order is one gift and
				// `capture` above asks for the whole of it. a second entry here would mean that stopped
				// holding, which is a change to this adapter rather than a shape to guess at.
				//
				// no capture at all is most of an order's life and never a failure: an order the payer
				// has not approved, or has abandoned, has none.
				const id = order.purchaseUnits?.[0]?.payments?.captures?.[0]?.id;
				const captured = id ? (await payments.getCapturedPayment({ captureId: id })).result : null;

				const settlement = settlementOf(order, captured);
				if (settlement === null) {
					// a figure that cannot be read is a refusal rather than a zero. `unreachable` and
					// `provider_error` are both retryable (`RETRYABLE_FAILURE_REASONS` in ./provider.ts), so
					// the delivery is held open — where a settlement carrying 0 would post a gift of
					// nothing, balance, and be found only by someone reading the books against a statement.
					return {
						ok: false,
						reason: 'provider_error',
						detail:
							`PayPal reported order ${redactPublicId(providerTxnId)} with an amount or a ` +
							'currency this app cannot read, so nothing was posted. The amount is a decimal ' +
							'string at the currency’s own scale and the currency is a 3-letter ISO-4217 code; ' +
							'this delivery is worth having again.'
					};
				}

				return { ok: true, value: settlement };
			} catch (error) {
				return classify(error);
			}
		},

		/**
		 * whether this deployment can charge through PayPal, which is as far as PayPal will answer.
		 *
		 * **PayPal publishes no capability read to a direct merchant.** the merchant-integration read
		 * that reports `payments_receivable` and a capability list is the Partner Referrals API and
		 * takes a partner id and a merchant id (https://developer.paypal.com/docs/api/partner-referrals/v2/) —
		 * neither of which a deployment holding only its own client id and secret has. what is
		 * readable is whether the credentials authenticate, which is what this call makes and what
		 * this answer is: minting the token is the request, and it is the same token the rest of this
		 * adapter then spends.
		 *
		 * so the rails are reported `active` rather than read. what that claims is exactly what
		 * `AccountChargeability` on ./provider.ts documents a capability state to claim — a necessary
		 * condition, never a sufficient one — and the sufficient half is decided where PayPal actually
		 * decides it: the payer's own browser, where the JS SDK reports which funding sources are
		 * eligible for this account, this payer and this device, and draws no button for the ones that
		 * are not. Venmo is the live case: it is US-only and switched on per account, and a deployment
		 * that cannot take it draws no Venmo button rather than refusing a donor who picked it.
		 *
		 * a caller that wanted a stronger claim than this has nowhere to get one, which is why this is
		 * an answer rather than a refusal: `readRailChargeability` in ./rail-chargeability.ts reads a
		 * refusal as `unreadable`, and `offeredRails` in ../forms/offered-rails.ts widens on that — so
		 * refusing would offer the same two rails while telling every screen the account could not be
		 * read and keeping ../forms/rail-cache.ts from ever storing an answer.
		 */
		async readAccountChargeability(): Promise<PaymentResult<AccountChargeability>> {
			try {
				await accessToken();
			} catch (error) {
				return classify(error);
			}

			return {
				ok: true,
				value: {
					chargesEnabled: true,
					rails: Object.fromEntries(PAYPAL_RAILS.map((rail) => [rail, 'active']))
				}
			};
		},

		/**
		 * which rails the operator has switched on, where PayPal keeps no such setting.
		 *
		 * the funding sources a payer is shown are PayPal's own decision inside PayPal's own window,
		 * and there is no account-level list of them an API caller can read — so both rails are
		 * reported offered, which is the same claim `readAccountChargeability` above makes and argues.
		 *
		 * it asks nothing, and that is deliberate rather than lazy: the two reads are issued together
		 * (./rail-chargeability.ts), so a credential check here would be a second token request racing
		 * the first, and the failure it would report is the one that read already reports.
		 */
		async readRailSwitchboard(): Promise<PaymentResult<RailSwitchboard>> {
			return {
				ok: true,
				value: Object.fromEntries(
					PAYPAL_RAILS.map((rail) => [rail, { offered: true, switchedOn: true }])
				)
			};
		},

		async prepareRecurringGifts(): Promise<PaymentResult<RecurringGiftProvision>> {
			return unsupported(NO_REPEATING);
		},

		async readRecurringGiftProvision(): Promise<PaymentResult<RecurringGiftStanding>> {
			return unsupported(NO_REPEATING);
		},

		async createRecurringGift(): Promise<PaymentResult<RecurringGift>> {
			return unsupported(NO_REPEATING);
		},

		async cancelRecurringGift(): Promise<PaymentResult<RecurringGiftEnd>> {
			return unsupported(NO_REPEATING);
		},

		async readRecurringGift(): Promise<PaymentResult<RecurringGiftNotice>> {
			return unsupported(NO_REPEATING);
		},

		async listWebhookEndpoints(): Promise<PaymentResult<WebhookEndpointRegistry>> {
			return unsupported(NO_LISTENER_MANAGEMENT);
		},

		async registerWebhookEndpoint(): Promise<PaymentResult<RegisteredWebhookEndpoint>> {
			return unsupported(NO_LISTENER_MANAGEMENT);
		},

		async resubscribeWebhookEndpoint(): Promise<PaymentResult<WebhookEndpointSummary>> {
			return unsupported(NO_LISTENER_MANAGEMENT);
		},

		async replaceWebhookEndpoint(): Promise<PaymentResult<RegisteredWebhookEndpoint>> {
			return unsupported(NO_LISTENER_MANAGEMENT);
		},

		async listWalletDomains(): Promise<PaymentResult<readonly WalletDomain[]>> {
			return unsupported(NO_WALLET_DOMAINS);
		},

		async registerWalletDomain(): Promise<PaymentResult<WalletDomain>> {
			return unsupported(NO_WALLET_DOMAINS);
		}
	};
}

/**
 * the issue code PayPal answers a second capture of one order with.
 *
 * a state rather than a failure — see `capture` — and spelled once because it is the only issue code
 * this adapter branches on. every other one reaches a caller inside a message.
 */
const ALREADY_CAPTURED = 'ORDER_ALREADY_CAPTURED';

/**
 * seven capture and order states onto this schema's four (`PAYMENT_STATUSES` in ../db/schema.ts).
 *
 * a refunded capture is `succeeded` and not a state of its own, because the capture did succeed: a
 * refund is a `payment` row of its own with its own id, which is the same split ./stripe.ts keeps.
 *
 * everything this table does not hold is `pending`, including an order the payer has not approved
 * and a state added upstream — the direction that is safe to be wrong in, since the next read
 * corrects it and no posting is made on money reported as still in flight.
 */
const CAPTURE_STATUSES: Readonly<Record<string, PaymentStatus>> = Object.freeze({
	COMPLETED: 'succeeded',
	PARTIALLY_REFUNDED: 'succeeded',
	REFUNDED: 'succeeded',
	DECLINED: 'failed',
	FAILED: 'failed'
});

/** an order with no capture behind it: money that has not moved, or an order nobody will pay. */
const ORDER_STATUSES: Readonly<Record<string, PaymentStatus>> = Object.freeze({
	VOIDED: 'cancelled'
});

/**
 * one order as the port carries it, with the capture Payments v2 reported for it, or nothing where
 * the money it names cannot be read.
 *
 * a function rather than the body of the read arm, so an order with a capture and one without cannot
 * disagree about a currency's case or where a figure came from.
 */
function settlementOf(order: Order, captured: CapturedPayment | null): Settlement | null {
	// the capture's own gross where the money moved, because that is what actually moved; the order's
	// total before a capture exists. this app never partially captures, so the two agree — a
	// divergence is the signal that assumption stopped holding.
	const moved = captured?.sellerReceivableBreakdown?.grossAmount ?? captured?.amount;
	const asked = order.purchaseUnits?.[0]?.amount;
	const currency = (moved?.currencyCode ?? asked?.currencyCode ?? '').toUpperCase();

	// null rather than a settlement carrying zero, which is the caller's refusal to make: the amount
	// is what a `payment` row and the ledger's entries are written from, and a gift of nothing
	// balances.
	const amountMinor = minorOf(moved?.value ?? asked?.value, currency);
	if (amountMinor === null) return null;

	return {
		providerTxnId: order.id ?? '',
		status: captured?.status
			? (CAPTURE_STATUSES[captured.status] ?? 'pending')
			: (ORDER_STATUSES[order.status ?? ''] ?? 'pending'),
		method: railOf(order),
		amountMinor,
		currency,
		feeMinor: feeOf(captured, currency),
		// the capture's copy where there is one, which is where a redelivery about the capture finds
		// it; the purchase unit's before a capture exists. PayPal copies `custom_id` from one onto the
		// other, so these are the same value read from whichever object exists.
		metadata: decodeMetadata(captured?.customId ?? order.purchaseUnits?.[0]?.customId),
		occurredAt: at(captured?.createTime ?? order.createTime)
	};
}

/**
 * the rail a payer actually used, off the one key PayPal filled in on `payment_source`.
 *
 * never copied from the rail the donor picked on the form beforehand: those are two different facts
 * and the fee was priced off the second, so recording the second under the name of the first is what
 * would make a divergence permanently invisible (`Settlement.method` in ./provider.ts).
 *
 * a source outside the table is no rail rather than the nearest one: PayPal's window presents
 * funding sources this app does not model, and a row asserting a rail nobody used is worse than a
 * row asserting none.
 */
function railOf(order: Order): SettledRail | null {
	const source = order.paymentSource ?? {};
	for (const [key, rail] of Object.entries(SETTLED_RAILS)) {
		if ((source as Json)?.[key] !== undefined) return rail;
	}
	return null;
}

/**
 * what PayPal actually took, in the currency the gift was charged in.
 *
 * `paypal_fee` is documented as being in the currency of the transaction
 * (https://developer.paypal.com/docs/api/payments/v2/#definition-seller_receivable_breakdown), which
 * is why nothing here converts and why no `exchange_rate` is read: that rate exists on the breakdown
 * to describe crediting the merchant's account in *another* currency, and the fee is stated before
 * that conversion. a rate applied to a figure already in the right currency would be a fee wrong by
 * the rate, arithmetically sound and silently wrong.
 *
 * so a fee that nonetheless arrives in some other currency is no figure at all rather than a
 * converted one. `Settlement.feeMinor` in ./provider.ts is where that null is answered —
 * ../donations/settle.ts posts the charge and tells an operator.
 *
 * null is also the ordinary absence: the breakdown is documented as not available while a capture is
 * pending. there is no `fee_not_ready` counterpart here, because PayPal publishes the fee on the
 * capture that carries it rather than computing it afterwards — a capture that has completed has its
 * fee in the same answer.
 */
function feeOf(captured: CapturedPayment | null, currency: string): number | null {
	const fee = captured?.sellerReceivableBreakdown?.paypalFee;
	if (!fee || fee.currencyCode.toUpperCase() !== currency) return null;
	return minorOf(fee.value, currency);
}

/**
 * a decimal string as this app's integer minor units, or nothing.
 *
 * `readAmount` in ../../forms/amounts.ts is the app's one parser for this, and it is reused rather
 * than copied: the rule is identical — digits, at most the currency's own width, a safe integer — and
 * a second parser is the one that disagrees about whether `97.005` is 9700 or 9701. its refusal
 * sentences are written for an operator's amount box and are not surfaced; what a caller of this gets
 * is a figure or a null.
 *
 * no float ever holds the value: that function moves the digits rather than multiplying.
 */
function minorOf(value: string | undefined, currency: string): number | null {
	if (value === undefined || !CURRENCY.test(currency)) return null;
	return readAmount(value, currency).minor;
}

/** an RFC 3339 timestamp as a date, falling back to now where PayPal sent none this app can read. */
function at(time: string | undefined): Date {
	const read = new Date(time ?? '');
	return Number.isNaN(read.getTime()) ? new Date() : read;
}

/**
 * how much of a sentence written by PayPal a message of ours may repeat.
 *
 * long enough for the part that names a field, short enough that a response body pasted into a
 * message cannot become the message — the reason ./stripe.ts bounds the same thing.
 */
const PROVIDER_QUOTE_MAX = 200;

/**
 * what PayPal said, as a message of ours may repeat it.
 *
 * the error name and its `issue` codes rather than the prose, because the issue is the part that
 * distinguishes a payer's problem from ours and it is a closed vocabulary
 * (https://developer.paypal.com/api/rest/responses/). `debug_id` is deliberately not carried: it is
 * PayPal's own correlation handle and belongs in a support ticket rather than in a 4xx body an agent
 * reads.
 *
 * bounded and flattened to one line, for the reason `quoteProvider` in ./stripe.ts is: the ceiling
 * stops a body becoming a message, and the flattening keeps a multi-line value out of a single-line
 * log.
 */
function quoteProvider(body: unknown): string {
	const error = (typeof body === 'object' && body !== null ? body : {}) as Json;
	const issues = Array.isArray(error?.details)
		? error.details.flatMap((detail) =>
				typeof (detail as Json)?.issue === 'string' ? [String((detail as Json)?.issue)] : []
			)
		: [];
	const said = [error?.name, ...issues].filter((part) => typeof part === 'string').join(', ');
	const sanitised = said.replace(/\s+/g, ' ').trim();
	if (sanitised === '') return 'nothing this app could read';
	return sanitised.length <= PROVIDER_QUOTE_MAX
		? sanitised
		: `${sanitised.slice(0, PROVIDER_QUOTE_MAX)}…`;
}

/** every `issue` code on a PayPal error body, which is what one refusal is told apart by. */
function issuesOf(body: unknown): readonly string[] {
	const details = (typeof body === 'object' && body !== null ? (body as Json)?.details : []) ?? [];
	if (!Array.isArray(details)) return [];
	return details.flatMap((detail) =>
		typeof (detail as Json)?.issue === 'string' ? [String((detail as Json)?.issue)] : []
	);
}

/**
 * a non-2xx answer, sorted into this app's vocabulary.
 *
 * on the status rather than on the message, because the status is what PayPal documents as the
 * class of the failure and the message is the part it is free to reword
 * (https://developer.paypal.com/api/rest/responses/).
 *
 * 401 and 403 become `not_configured` rather than a failure of the call: credentials that are
 * rejected or an app without the permission this call needs is a deployment an operator fixes, and
 * reporting it as a provider fault would send them to look at a status page.
 *
 * everything in the 4xx range that is not one of those is `invalid_request` — this app built the
 * request, so repeating it answers the same way — except 404, which is a `not_found` a caller
 * already has a reading for, and 429, which is the one 4xx worth repeating.
 */
function classifyStatus(status: number, body: unknown, context: string): PaymentFailure {
	const said = `${context}. PayPal said: ${quoteProvider(body)}`;

	if (status === 401 || status === 403) {
		return {
			ok: false,
			reason: 'not_configured',
			detail:
				'PayPal rejected this deployment’s credentials: `PAYPAL_CLIENT_ID` and ' +
				`\`PAYPAL_CLIENT_SECRET\` are not a pair this account accepts, or the app they belong to ` +
				`does not carry the permission this call needs. ${said}`
		};
	}

	if (status === 404) return { ok: false, reason: 'not_found', detail: said };
	if (status === 429) {
		return { ok: false, reason: 'rate_limited', detail: `PayPal is rate limiting. ${said}` };
	}
	if (status >= 400 && status < 500) return { ok: false, reason: 'invalid_request', detail: said };
	return { ok: false, reason: 'provider_error', detail: said };
}

/**
 * a call that never got an answer.
 *
 * whether it took effect is unknown, which is what `PaypalCredentials`' idempotency is for: the
 * identical call under the same `PayPal-Request-Id` resolves to the object that already exists
 * rather than to a second one.
 *
 * the error's own class is not read. a transport failure arrives here as whatever the runtime threw
 * — a `TypeError` from `fetch`, an abort from the timeout, an axios wrapper around either — and the
 * only fact this app can use is that nothing came back.
 */
function unreachable(error: unknown): PaymentFailure {
	return {
		ok: false,
		reason: 'unreachable',
		detail:
			'No answer came back from PayPal, so whether this call took effect is unknown. Making the ' +
			'identical call again under the same idempotency key is what settles it. The transport ' +
			`said: ${messageOf(error)}`
	};
}

/**
 * a thrown value, described without becoming a second throw site.
 *
 * reading `message` off an arbitrary value runs whatever getter the thrower supplied, which is the
 * same hazard ./stripe.ts's `messageOf` is written around.
 */
function messageOf(error: unknown): string {
	try {
		const said = error instanceof Error ? error.message : String(error);
		return said.replace(/\s+/g, ' ').trim().slice(0, PROVIDER_QUOTE_MAX);
	} catch {
		return 'an error that could not be described';
	}
}

/**
 * a thrown value out of the SDK, sorted into this app's vocabulary.
 *
 * `ApiError` is the class the SDK constructs for any non-2xx, and it carries the status and the raw
 * body — the body rather than `result`, because `result` is populated only where the SDK had a
 * schema for that error shape and every arm here has to read the same one.
 *
 * anything else is a transport failure. it is not rethrown to the seal the way ./stripe.ts rethrows
 * an unrecognised value, because the two SDKs differ in exactly this: that one constructs an error
 * class for a failed connection and this one lets the runtime's own throw through, so a rethrow here
 * would report every unreachable PayPal as a bug in this app.
 */
function classify(error: unknown): PaymentFailure {
	if (error instanceof ApiError) {
		return classifyStatus(error.statusCode, readErrorBody(error), 'PayPal refused the call');
	}
	return unreachable(error);
}

function readErrorBody(error: ApiError): unknown {
	if (typeof error.body !== 'string') return error.result;
	try {
		return JSON.parse(error.body);
	} catch {
		return error.result;
	}
}

/**
 * what an arm this release does not build answers.
 *
 * `unsupported` is terminal (`TERMINAL_FAILURE_REASONS` in ./provider.ts), which is the right side
 * for it: no value an operator can set changes the answer, and a delivery held open against one
 * would buy days of retries against a release that cannot change inside them.
 */
function unsupported(detail: string): PaymentFailure {
	return { ok: false, reason: 'unsupported', detail };
}
