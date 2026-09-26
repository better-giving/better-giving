import {
	ApiError,
	CheckoutPaymentIntent,
	Client,
	Environment,
	IntervalUnit,
	OrderStatus,
	OrdersController,
	PaymentsController,
	PlanRequestStatus,
	RefundStatus,
	SubscriptionPlanStatus,
	SubscriptionsController,
	TenureType
} from '@paypal/paypal-server-sdk';
import type {
	BillingPlan,
	CapturedPayment,
	OAuthToken,
	Order,
	Refund,
	Subscription
} from '@paypal/paypal-server-sdk';
import { PAYPAL_RAILS, type PaypalRail } from '@better-giving/form/embed/rails';
import { PAYPAL_SDK_PATH } from '@better-giving/form/v1';
import {
	DISPUTE_EVENT_TYPES,
	RECURRING_COLLECTION_EVENT_TYPES,
	RECURRING_EVENT_TYPES,
	REVERSAL_EVENT_TYPES,
	REVERSED_EVENT_TYPES,
	SETTLEMENT_EVENT_TYPES,
	SUBSCRIBED_EVENT_TYPES
} from '@better-giving/operator/paypal/webhook-listener';
import type { PaymentStatus } from '../db/schema';
import { majorText, readAmount } from '../../forms/amounts';
import { redact, redactPublicId } from '../../redact';
import { DONATION_METADATA_KEY, INTERVAL_METADATA_KEY, refusing } from './provider';
import type {
	AccountChargeability,
	Intent,
	IntentRequest,
	PayableCoin,
	PaymentFailure,
	PaymentProvider,
	PaymentResult,
	QuotedRail,
	SettledRail,
	RecurringGift,
	RecurringGiftEnd,
	RecurringGiftNotice,
	ReversalEvent,
	ReversalRead,
	RecurringGiftProvision,
	RecurringGiftRequest,
	RecurringGiftStanding,
	RecurringGiftState,
	RecurringEvent,
	RecurringInterval,
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
// **it answers the one-off gift, the repeating one, a refund or dispute of either and the listener read, and
// refuses the listener repairs and the wallet arms** — `unsupported`, exactly as ./factory.ts
// answers for a processor with no adapter at all, and argued at each of them. the listener is registered by the console's binary
// (`packages/console/internal/paypal`), so the repairs have no caller here
// (./webhook-registration.ts).
//
// a gift that repeats is three objects on PayPal's side. the catalog product is what
// `prepareRecurringGifts` provisions and `readRecurringGiftProvision` reads; a plan is per amount
// and per cadence, so it is a helper ({@link findOrCreateBillingPlan}) rather than an arm and no
// module of this app names one; the subscription is what `createRecurringGift` commits a donor to.
// **two of its collections' fields are not readable here at all** — a v1 sale publishes no funding
// source and carries no `custom_id` — which is why a collection settles with no rail and no
// metadata of its own, argued at `saleSettlementOf`.
//
// **the reads a repeating gift makes cross two API generations.** the commitment is Subscriptions
// v1 through the SDK's controller; one collection is a v1 sale, read through this module's own
// authenticated call because no controller and no spec ship for Payments v1. `readSale` argues why
// a deprecated endpoint is the right one and what would replace it.
//
// **a refund is read in the generation of what it refunds.** a one-off gift's is a Payments v2 refund
// of its capture (https://developer.paypal.com/docs/api/payments/v2/#refunds_get, and `refund` in
// payments_payment_v2.json in https://github.com/paypal/paypal-rest-api-specifications); a
// collection's is a Payments v1 refund of its sale. the events that name them are
// `PAYMENT.CAPTURE.REFUNDED` and `PAYMENT.SALE.REFUNDED`
// (https://developer.paypal.com/api/rest/webhooks/event-names), and `readReversal` argues the rest.
//
// **a dispute is read off `GET /v1/customer/disputes/{id}`** (`dispute` in customer_disputes_v1.json
// in the same repository), and it moves money only where it took it (`heldMoney`): its transaction
// `HELD` while PayPal decides an internal claim or `REVERSED` by a card issuer's chargeback, a seller
// `DISPUTE_SETTLEMENT` debit, or a stage past the inquiry. an inquiry that never took the money moves
// nothing however it closes. resolved, the outcome decides (`DISPUTE_OUTCOMES`). PayPal can hold the
// funds of a case still at the inquiry stage and releases the hold when the case closes for the
// merchant (https://docs.paypal.ai/growth/disputes/test-go-live). reading one needs PayPal's Disputes
// feature on the app. without it a refund is read as the merchant's own and the missing feature
// logged, and a dispute or a reversal, which cannot be read without it, is refused terminally,
// telling staff to switch it on.
//
// **`PAYMENT.CAPTURE.REVERSED` and `PAYMENT.SALE.REVERSED` are PayPal taking the money back** —
// "PayPal reverses a payment capture" and "PayPal reverses a sale", each carrying a refund of the
// transaction (https://developer.paypal.com/api/rest/webhooks/event-names), and a transaction reads
// `REVERSED` when "reversed due to a chargeback or other reversal type" (`transaction_info` in
// customer_disputes_v1.json). so a reversal is never a refund: under a dispute standing on the
// transaction it is that dispute, and with none it is a dispute lost, keyed on the reversal's own
// id — the money is gone and there is no case to answer.
//
// **one chargeback withdraws once where its dispute is listed within `DISPUTE_WAIT_MS` of the
// reversal.** a card chargeback arrives as a dispute and as a reversal; the reversal waits that long
// for the dispute, and both then resolve to the key `withdrawalKeyOf` gives — the dispute's own id,
// or the claim's it replaced. a dispute listed only after the wait finds the reversal already booked
// under its own id, and its own withdrawal is refused by the writer for want of anything left, with
// staff told.
//
// **PayPal's dispute fee** is read off the dispute's `fund_movements`: the seller's `DISPUTE_FEE` and
// `CHARGEBACK_FEE` debits are what it charged, and credits of the same reasons are what it gave back
// on a win. a seller `REVERSED_TRANSACTION_FEE` credit is the transaction's own fee reimbursed, fee
// given back as well: capped at the fee the transaction was charged, it comes off a loss's fee,
// never below nothing, and joins a win's. PayPal documents the fee as charged on a case the merchant
// loses without seller protection (https://docs.paypal.ai/growth/disputes/test-go-live); whether and
// when it returns one is read off the case.
//
// **one address, and nothing here reads a stage.** every call — the token, the SDK's controllers and
// this module's own reach past them — goes to the origin of `PAYPAL_API_URL`, or of
// {@link PAYPAL_DEFAULT_API_URL} where it is unset. a key is good at one address only, and which one
// a deployment talks to is typed rather than derived; rehearsing is a second deployment (DEPLOY.md).

/** what the adapter needs to talk to an account. */
export type PaypalCredentials = {
	/** `PAYPAL_CLIENT_ID`. the half that also starts the browser SDK, so it is not a secret. */
	readonly clientId: string;
	/** `PAYPAL_CLIENT_SECRET`. server-only, never bundled, never logged, never echoed. */
	readonly clientSecret: string;
	/** `PAYPAL_API_URL`, or {@link PAYPAL_DEFAULT_API_URL} where it is unset (./factory.ts). */
	readonly apiUrl: string;
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
 * whether a quoted rail is this adapter's; `railOf` asks which rail a payer actually used,
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
 * whether a quoted rail is one this adapter settles.
 *
 * not a donor's value to get wrong — `OFFERED_METHOD` in ../donations/quote-input.ts narrows their
 * pick to the offered set before a quote is minted — so what this catches is this app handing the
 * gift to the wrong adapter, over the whole quoted-rail union `IntentRequest.method` carries.
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
			`The rails are ${Object.keys(SETTLED_RAILS).join(', ')}, and a value outside them is this app ` +
			'handing the gift to the wrong adapter — `Processors.forRail` — rather than anything a donor ' +
			'sent.'
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
 * how much of the metadata map one commitment can carry, which is half as much.
 *
 * a subscription's `custom_id` holds 127
 * (https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/billing_subscriptions_v1.json,
 * `subscription_request_post`) and it is the only field an API caller may write on one — there is no
 * metadata map here either.
 *
 * **it is the tightest constraint on the commitment metadata, and the reason that map is four keys
 * rather than six** — `commitmentMetadata` in ./provider.ts argues which four and why a fifth is a
 * decision above this file. {@link unusableGift} refuses over this ceiling rather than letting PayPal
 * answer 400, which is a message naming the keys instead of one naming a field length.
 */
const SUBSCRIPTION_CUSTOM_ID_MAX = 127;

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

/**
 * why an encoded metadata map may not be sent, or nothing.
 *
 * one function over two ceilings, because the rule is one: the map is what a settlement or a
 * collection is read back through, so a map that does not fit is refused rather than trimmed — a
 * trimmed one is a gift with no donation attached to it, found when the books are read.
 */
function oversizedMetadata(
	metadata: Readonly<Record<string, string>>,
	encoded: string,
	max: number,
	outcome: string
): PaymentFailure | null {
	if (encoded.length <= max) return null;

	return {
		ok: false,
		reason: 'invalid_request',
		// the keys and not their values: what is too long is a map this app built, and the values in
		// it are the gift's own id and the figures beside it — pointers at rows here, and this
		// message reaches a 4xx body.
		detail:
			`the metadata for this gift encodes to ${encoded.length} characters and PayPal's ` +
			`\`custom_id\` holds ${max} on this object, so ${outcome}. The keys are ` +
			`${Object.keys(metadata).join(', ')}. This is a bug in this app rather than anything about ` +
			'the gift: the map is what the money is read back through, so it is refused rather than ' +
			'trimmed.'
	};
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
 * the one catalog product every repeating gift on this account is charged against.
 *
 * this app's own id rather than a generated one, which is what makes the object findable without
 * anything being stored: PayPal takes a caller-supplied id on a product (6 to 50 characters, and
 * never the `PROD-` prefix its own generator uses), so there is one address to ask about and no page
 * of a catalogue to walk. the same rule the webhook endpoint is found under
 * (./webhook-registration.ts), applied to the object that happens to have an id this app can spell.
 *
 * it is matched on and it is therefore permanent. a deployment that has taken one repeating gift has
 * a product under this id and plans hanging off it; changing the string does not rename that
 * product, it makes this app unable to find it and mint a second one beside it — with every donor's
 * gift still charged against the first. ./paypal.spec.ts pins the value rather than reading it, so
 * the change is a failing test rather than a silent fork.
 *
 * hyphens and capitals only. PayPal publishes a length for this field and no character set, so the
 * spelling stays inside what its own generated ids use.
 */
const RECURRING_PRODUCT_ID = 'BETTER-GIVING-RECURRING-GIFT';

/**
 * what every idempotency key this adapter derives is prefixed with.
 *
 * the account is an operator's own and this app is not the only thing that may ever write to it, so
 * a key of this app's is spelled as one — the same reason `DERIVED_KEY` exists in ./stripe.ts.
 */
const DERIVED_KEY = 'better-giving';

/**
 * what the product is called, wherever PayPal shows it.
 *
 * it reaches a donor: PayPal's own approval window for a repeating gift names the product. so it is
 * the word a fundraiser uses (CLAUDE.md) — a gift that recurs, never a subscription and never a
 * plan. it is not matched on, so it is safe to reword.
 */
const RECURRING_PRODUCT_NAME = 'Recurring gift';

/** what the product is described as on the dashboard an operator opens. not matched on. */
const RECURRING_PRODUCT_DESCRIPTION = 'Repeating gifts made through this better-giving deployment.';

/**
 * what kind of thing PayPal is told the product is.
 *
 * `SERVICE` because the other two members of that closed set are goods, and a gift ships nothing.
 *
 * no `category` goes with it, and the omission is the decision: PayPal's category vocabulary holds
 * `CHARITY` and `NONPROFIT`, and which of them an account is entitled to is a fact about the
 * organisation that this app is never told — the same fact `PAYPAL_CHARITY_RATE_APPROVED` exists
 * because nothing in the API reports (./fees.ts). the field is optional, so the honest answer is to
 * send none rather than to assert one.
 */
const RECURRING_PRODUCT_TYPE = 'SERVICE';

/**
 * what PayPal records against a commitment this deployment stopped.
 *
 * it appears on PayPal's own dashboard beside the subscription and nowhere a donor reads, so it is
 * written for the operator reconciling one. not matched on, so it is safe to reword — and it says
 * nothing about the gift, because nothing a donor typed may reach a processor.
 */
const CANCEL_REASON = 'Stopped from this organisation’s better-giving dashboard.';

/** the address a deployment with no `PAYPAL_API_URL` calls. */
export const PAYPAL_DEFAULT_API_URL = 'https://api-m.paypal.com';

/**
 * the origin every call is sent to, or `null` for an address that is not an https origin.
 *
 * a trailing slash is the one addition taken, because it names the same origin. a path, a query or
 * a fragment is refused rather than dropped: each is a value that says something this adapter would
 * silently not do. `http:` is refused because the token request carries the client secret.
 */
export function paypalApiOrigin(apiUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(apiUrl);
	} catch {
		return null;
	}
	const bare =
		url.protocol === 'https:' &&
		url.username === '' &&
		url.password === '' &&
		url.pathname === '/' &&
		url.search === '' &&
		url.hash === '' &&
		!apiUrl.endsWith('?') &&
		!apiUrl.endsWith('#');
	return bare ? url.origin : null;
}

/**
 * the script the donor's page starts PayPal's SDK from, for an API address {@link paypalApiOrigin}
 * takes, or `null` where the host carries no `api-m.` label to derive one from.
 *
 * PayPal serves its API and its pages from sibling hosts, `api-m.` and `www.` under one domain, so
 * the one rule is the label and any address an operator sets maps the same way.
 * `Provider.sdkUrl` in packages/form/src/v1.ts is the field it fills.
 */
export function paypalSdkUrl(apiUrl: string): string | null {
	const origin = paypalApiOrigin(apiUrl);
	return origin === null ? null : paypalPageUrl(origin, PAYPAL_SDK_PATH);
}

/** a page on the `www.` sibling of an API origin, or `null` where the host carries no `api-m.` label. */
function paypalPageUrl(origin: string, pathname: string): string | null {
	const url = new URL(origin);
	if (!url.hostname.startsWith('api-m.')) return null;
	url.hostname = `www.${url.hostname.slice('api-m.'.length)}`;
	url.pathname = pathname;
	return url.href;
}

/**
 * where staff answer a dispute: the account's Resolution Center
 * (https://docs.paypal.ai/growth/disputes/handle-disputes/use-resolution-center), which lists
 * every open case by its id. PayPal publishes no address for one case, so the alert names the id
 * beside this link.
 */
const RESOLUTION_CENTER_PATH = '/resolutioncenter';

/** what is wrong with an address {@link paypalApiOrigin} refuses, as a clause a sentence carries. */
export function unusablePaypalAddress(apiUrl: string): string {
	return (
		`\`PAYPAL_API_URL\` is \`${apiUrl}\`, which is not an https origin with nothing after the ` +
		`host, such as \`${PAYPAL_DEFAULT_API_URL}\``
	);
}

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

/** the id the resource carries, or nothing where the delivery names no object this app can read. */
function resourceIdOf(resource: unknown): string | null {
	const object = json(resource);
	return typeof object?.id === 'string' ? object.id : null;
}

/** a dispute names itself `dispute_id` (`dispute` in customer_disputes_v1.json). */
function disputeIdOf(resource: unknown): string | null {
	const id = json(resource)?.dispute_id;
	return typeof id === 'string' && id !== '' ? id : null;
}

function isDisputeEvent(type: string): boolean {
	return (DISPUTE_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * a verified delivery this app subscribes to and cannot read, as the refusal it has to be.
 *
 * verified, subscribed, and unreadable. an event name is published under more than one API
 * generation and the generations carry different resources, so this is what a delivery serialised
 * for one this adapter does not read arrives as. reported as `ignored` it would be a settlement
 * dropped in silence under a 200, which is the failure that loses a gift.
 *
 * `unsupported` and not a retryable reason: every redelivery of this delivery carries the same
 * resource and reads the same way, so a 5xx would buy PayPal's whole retry schedule of one answer.
 * what changes it is a release that reads the shape, which is that reason's own definition
 * (`PAYMENT_FAILURE_REASONS` in ./provider.ts). not `invalid_request` either, which
 * `settleDelivery` in ../donations/settle.ts answers with a 400 — and PayPal redelivers any non-2xx.
 *
 * `resource_type` and `resource_version` are reported rather than gated on. PayPal publishes
 * neither for any subscription event, so a gate on a value nobody has seen would refuse every live
 * delivery — naming them here is how they are learned off a real one.
 */
function unreadableResource(
	type: string,
	event: Json,
	named: string,
	reads: string
): PaymentFailure {
	return {
		ok: false,
		reason: 'unsupported',
		detail:
			`A verified \`${redactPublicId(type)}\` delivery named ${named}, so there is nothing to ` +
			`reconcile it against. Its \`resource_type\` is ` +
			`\`${redactPublicId(String(event?.resource_type ?? 'absent'))}\` and its ` +
			`\`resource_version\` is \`${redactPublicId(String(event?.resource_version ?? 'absent'))}\`; ` +
			`this app reads ${reads}.`
	};
}

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
	const object = json(resource);
	const found = type.startsWith('CHECKOUT.ORDER.')
		? object?.id
		: json(json(object?.supplementary_data)?.related_ids)?.order_id;
	return typeof found === 'string' ? found : null;
}

/** an object read out of somebody else's JSON, indexed without asserting what is under a key. */
type Json = Record<string, unknown> | undefined;

/**
 * a value as `Json`, where it is an object at all.
 *
 * the narrowing every read of a PayPal body goes through: a field a schema calls an object arrives
 * as a string, a number or an array often enough that `Json` asserted straight onto `unknown` is a
 * claim nothing checked — and the next reader indexing one gets no help from the compiler.
 *
 * `undefined` for everything else, which lands every caller on the branch an absent key already
 * takes.
 */
const json = (value: unknown): Json =>
	typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

/**
 * why an amount or the currency it is denominated in may not be sent, or nothing.
 *
 * shared by the one-off path and the repeating one rather than written twice: both cross the same
 * units boundary into the same decimal string, and a second copy of the rule is the one that
 * disagrees about what a fractional minor unit is.
 */
function unusableAmount(amountMinor: number, currency: string): PaymentFailure | null {
	if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
		return {
			ok: false,
			reason: 'invalid_request',
			detail:
				`amountMinor is ${amountMinor}, which is not a positive safe integer. ` +
				'Amounts are minor units — $100.00 is 10000, not 100 and not 100.0.'
		};
	}

	if (!CURRENCY.test(currency)) {
		return {
			ok: false,
			reason: 'invalid_request',
			// echoed through ../../redact.ts, which is the policy for every message in this app that
			// names an offending value.
			detail:
				`currency \`${redact(currency)}\` is not a 3-letter uppercase ISO-4217 code. ` +
				'PayPal takes the same uppercase code the ledger stores, and the number of decimal ' +
				'places the amount is written to is read from it.'
		};
	}

	return null;
}

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
	return (
		unusableAmount(request.amountMinor, request.currency) ?? unusableKey(request.idempotencyKey)
	);
}

/**
 * why an idempotency key may not be spent, or nothing.
 *
 * shared by the one-off path and the repeating one, which spend it on different calls and lose the
 * same thing without it.
 */
function unusableKey(idempotencyKey: string): PaymentFailure | null {
	// not `=== ''`. an `undefined` reaching here through an untyped caller would make the SDK omit
	// the header altogether and the request would succeed — the double-charge defence gone, with
	// nothing anywhere reporting it. whitespace is the same hole wearing a value.
	if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
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
 * the two keys a commitment has to carry, and the whole of what makes its charges attributable.
 *
 * read off ./provider.ts rather than spelled here: they are the port's contract with every adapter,
 * and a second spelling is the one that disagrees the day a key is added.
 *
 * the split rides a commitment too ({@link commitmentMetadata} there) and is not checked: absence of
 * a figure is a charge nobody added a fee to, which ../donations/collect.ts records either way.
 * absence of the pointer is money with no gift to attach it to.
 */
const COMMITMENT_METADATA_KEYS = [DONATION_METADATA_KEY, INTERVAL_METADATA_KEY] as const;

/**
 * why a commitment may not be made, or nothing.
 *
 * the money checks a one-off gift makes, plus the two keys — and the two are the ones with no
 * second chance. a charge under a commitment arrives carrying no metadata of its own, so a
 * commitment created without them collects money this deployment can record against nobody, every
 * interval, for as long as nobody cancels it. {@link commitmentMetadata} in ./provider.ts argues it.
 */
function unusableGift(request: RecurringGiftRequest): PaymentFailure | null {
	const refusal =
		unusableAmount(request.amountMinor, request.currency) ?? unusableKey(request.idempotencyKey);
	if (refusal) return refusal;

	const absent = COMMITMENT_METADATA_KEYS.filter(
		(key) => (request.metadata?.[key] ?? '').trim() === ''
	);
	if (absent.length > 0) {
		return {
			ok: false,
			reason: 'invalid_request',
			// the keys and not their values: what is missing is a key, and the value beside it is the
			// gift's own id — a pointer at a row here, and this message reaches a 4xx body.
			detail:
				`the metadata for this repeating gift carries no ${absent.join(', ')}, so no commitment ` +
				'was made and nothing was charged. Every charge after the first arrives with no metadata ' +
				'of its own, so what the commitment carries is the only thing tying a collection back to ' +
				'the gift it belongs to. This is a bug in this app rather than anything about the gift.'
		};
	}

	return oversizedMetadata(
		request.metadata ?? {},
		encodeMetadata(request.metadata ?? {}),
		SUBSCRIPTION_CUSTOM_ID_MAX,
		'no commitment was made and nothing was charged'
	);
}

/**
 * what each group of unbuilt arms says, stated once.
 *
 * one sentence per group rather than one per arm, because every arm in a group is refused for the
 * same reason and a reader who saw two wordings would go looking for the difference.
 */
const NO_LISTENER_REPAIR =
	'This deployment does not change its PayPal listener. The console registers it and brings its ' +
	'subscription level in the press that saves PayPal\u2019s credentials (`better-giving start`, under ' +
	'Donation processor), and stores its id as `PAYPAL_WEBHOOK_ID`.';

const NO_WALLET_DOMAINS =
	'PayPal registers no hostname for wallets. Its funding sources are drawn inside PayPal\u2019s own ' +
	'window on PayPal\u2019s own domain rather than on a page this deployment serves, so there is ' +
	'nothing here to register and nothing to read.';

/**
 * a `Client` and the one token every call through it spends, built per request from that request's
 * own credentials.
 *
 * never a module-scope singleton — the secret only exists on a request's `platform.env`
 * (CLAUDE.md) — which is the `createStripeProvider` shape in ./stripe.ts and `createDb(d1)`'s in
 * ../db/client.ts.
 *
 * the token comes back beside the client rather than being minted again by whoever needs a bearer
 * value, because two of this adapter's APIs have no controller in the package — the notification API
 * and the catalog — and a second cache is a second token request on every delivery.
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
 *
 * `env.fetch` is where the address is decided. the SDK takes an `Environment` naming one of its own
 * two hosts and no address at all, so it is handed the one constant and every request it builds is
 * re-addressed onto `origin` on its way out — the token request included, which is what makes a key
 * minted at one address usable against it.
 */
function paypalClient(
	credentials: PaypalCredentials,
	origin: string
): {
	readonly client: Client;
	readonly accessToken: () => Promise<string>;
} {
	// `updateToken` mints only when what it is handed is absent or expired, so this is a cache rather
	// than a call.
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
		unstable_httpClientOptions: {
			adapter: 'fetch',
			fetchOptions: { cache: 'no-store' },
			env: { fetch: addressedTo(origin) }
		}
	});

	return {
		client,
		accessToken: async () => {
			token = await client.clientCredentialsAuthManager.updateToken(token);
			return token.accessToken;
		}
	};
}

/** `fetch`, sending the request it is handed to the same path and query at `origin`. */
function addressedTo(origin: string): typeof fetch {
	return (input, init) => {
		const request = new Request(input, init);
		const { pathname, search } = new URL(request.url);
		return fetch(new Request(`${origin}${pathname}${search}`, request));
	};
}

/**
 * the controller {@link findOrCreateBillingPlan} makes its calls through, over one account.
 *
 * built from {@link paypalClient} exactly as the provider builds its own, so what a plan is resolved
 * through and what a gift is charged through cannot be configured differently — the two workerd
 * options on that client are the ones ./paypal.workers.spec.ts proves are needed.
 */
export function paypalSubscriptions(credentials: PaypalCredentials): SubscriptionsController {
	const origin = paypalApiOrigin(credentials.apiUrl);
	if (origin === null) throw new Error(`${unusablePaypalAddress(credentials.apiUrl)}.`);
	return new SubscriptionsController(paypalClient(credentials, origin).client);
}

export function createPaypalProvider(credentials: PaypalCredentials): PaymentProvider {
	const origin = paypalApiOrigin(credentials.apiUrl);
	if (origin === null) {
		return refusing(
			'paypal',
			'not_configured',
			`${unusablePaypalAddress(credentials.apiUrl)}, so no call to PayPal can be made.`
		);
	}
	const { client, accessToken } = paypalClient(credentials, origin);
	const resolutionCenter = paypalPageUrl(origin, RESOLUTION_CENTER_PATH);
	const orders = new OrdersController(client);
	const payments = new PaymentsController(client);
	// built off this provider's own client rather than through {@link paypalSubscriptions}, which
	// would mint a second client and a second token cache on every request.
	const subscriptions = new SubscriptionsController(client);

	/**
	 * one authenticated call to an API the SDK ships no controller for.
	 *
	 * it answers with the parsed body and the status rather than throwing, because every caller here
	 * has to tell a refusal apart from a fault — a verification that came back `FAILURE` is a 200 and
	 * is not an error at all, and a catalog product that is not there is a 404 this app reads as a
	 * standing.
	 *
	 * the timeout is set here rather than inherited: the SDK carries {@link TIMEOUT_MS} on its own
	 * calls and `fetch` carries none, so without this a verification that never answers holds the
	 * webhook open for as long as PayPal's socket stays up — and the delivery it is holding is one a
	 * redelivery would settle in seconds.
	 */
	async function call(
		method: 'GET' | 'POST',
		path: string,
		sending?: { readonly body?: unknown; readonly requestId?: string }
	): Promise<{ status: number; body: unknown }> {
		const answer = await fetch(`${origin}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${await accessToken()}`,
				'content-type': 'application/json',
				...(sending?.requestId === undefined ? {} : { 'paypal-request-id': sending.requestId })
			},
			...(sending?.body === undefined ? {} : { body: JSON.stringify(sending.body) }),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		return { status: answer.status, body: await answer.json().catch(() => null) };
	}

	/**
	 * what the account holds for repeating gifts, asked and not touched.
	 *
	 * one read of the derived id, and the two answers it can give. a 404 is the only status that is a
	 * reading rather than a failure: anything else means the account could not be asked. reported as
	 * `absent` it would draw a setup button over an account nobody can reach — and creating a product
	 * on the strength of a rejected credential is how an account acquires one per outage.
	 *
	 * **`archived` is never answered, because PayPal's catalog has no such state.** a product carries
	 * no status field at all (the `product` schema in
	 * https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/catalogs_products_v1.json),
	 * so there is nothing to read a third standing off — which is why the answer is the pair rather
	 * than the port's whole union, and why the find-or-create below has no archived arm to write. it
	 * stays in the port's union because Stripe's catalogue does hold one and folding it out would be a
	 * reading that adapter cannot report (`RecurringGiftStanding` in ./provider.ts).
	 *
	 * both recurring arms are built on this, so what the console reads and what a donor's first
	 * repeating gift finds are one call with one interpretation.
	 */
	async function readRecurringProduct(): Promise<PaymentResult<'ready' | 'absent'>> {
		let answer: { status: number; body: unknown };
		try {
			answer = await call('GET', `/v1/catalogs/products/${RECURRING_PRODUCT_ID}`);
		} catch (error) {
			return classify(error);
		}

		if (answer.status === 404) return { ok: true, value: 'absent' };
		if (answer.status < 200 || answer.status >= 300) {
			return classifyStatus(
				answer.status,
				answer.body,
				'PayPal could not be asked what this account holds for repeating gifts'
			);
		}
		return { ok: true, value: 'ready' };
	}

	/**
	 * the one product every repeating gift is charged against, found or made.
	 *
	 * a read of the derived id and then a create, rather than a create that reads a refusal: PayPal
	 * publishes no issue code for a product id that is taken, so a blind create could not tell the
	 * account that already had one from the account that refused for any other reason.
	 *
	 * **a create that is refused is re-read rather than reported**, and that is where the race is
	 * settled. two requests can both read `absent` and both create; the `PayPal-Request-Id` both carry
	 * is derived from the product id, so PayPal resolves them to one object — and where a duplicate
	 * still lands outside that window, the loser of the race is holding exactly what it asked for.
	 * nothing is rolled back and nothing is deleted (CLAUDE.md: a lost race is settled by a correcting
	 * entry).
	 */
	async function ensureRecurringProduct(): Promise<PaymentResult<RecurringGiftProvision>> {
		const standing = await readRecurringProduct();
		if (!standing.ok) return standing;
		if (standing.value === 'ready') return { ok: true, value: { created: false } };

		let created: { status: number; body: unknown };
		try {
			created = await call('POST', '/v1/catalogs/products', {
				body: {
					id: RECURRING_PRODUCT_ID,
					name: RECURRING_PRODUCT_NAME,
					description: RECURRING_PRODUCT_DESCRIPTION,
					type: RECURRING_PRODUCT_TYPE
				},
				requestId: `${DERIVED_KEY}:product:${RECURRING_PRODUCT_ID}`
			});
		} catch (error) {
			return classify(error);
		}

		if (created.status >= 200 && created.status < 300)
			return { ok: true, value: { created: true } };

		const again = await readRecurringProduct();
		if (again.ok && again.value === 'ready') return { ok: true, value: { created: false } };
		return classifyStatus(
			created.status,
			created.body,
			'PayPal refused to hold what a repeating gift is charged against'
		);
	}

	/**
	 * one charge under a commitment, as the deprecated Payments v1 API answers for it.
	 *
	 * **that endpoint is a deliberate choice and not an oversight.** the current substitute is
	 * `GET /v1/billing/subscriptions/{id}/transactions`, which is keyed by the subscription's id plus
	 * a required `start_time` and `end_time` and answers with a list — there is no read-one-by-id on
	 * it. taking it would cost a window derived from the delivery's own time rather than the
	 * charge's, a walk over that list, and a second failure mode on every collection, to read a
	 * figure this one call returns. the sale, its id and the whole `PAYMENT.SALE.*` family this
	 * listener subscribes to are one API generation: when the events retire, so does this read, and
	 * that is the trigger to move — not a deprecation notice on the endpoint alone.
	 *
	 * no SDK controller ships for Payments v1 (no spec for it ships either), so this goes through
	 * {@link createPaypalProvider}'s own authenticated call and the body is read as JSON.
	 */
	async function readSale(saleId: string): Promise<PaymentResult<Record<string, unknown>>> {
		let answer: { status: number; body: unknown };
		try {
			answer = await call('GET', `/v1/payments/sale/${encodeURIComponent(saleId)}`);
		} catch (error) {
			return unreachable(error);
		}

		if (answer.status < 200 || answer.status >= 300) {
			return classifyStatus(answer.status, answer.body, SALE_READ_CONTEXT);
		}

		if (typeof answer.body !== 'object' || answer.body === null) {
			return {
				ok: false,
				reason: 'provider_error',
				detail: `${SALE_READ_CONTEXT}. PayPal answered with no object this app could read.`
			};
		}

		return { ok: true, value: answer.body as Record<string, unknown> };
	}

	/**
	 * the commitment one delivery is about, read fresh and turned into a notice.
	 *
	 * `fields=plan` because the schedule is what `RecurringGiftNotice.interval` reports and a
	 * subscription answers without its plan otherwise
	 * (https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/billing_subscriptions_v1.json).
	 */
	async function readCommitment(
		giftId: string,
		about: 'collection' | 'commitment',
		providerTxnId: string | null
	): Promise<PaymentResult<RecurringGiftNotice>> {
		try {
			const { result } = await subscriptions.getSubscription({ id: giftId, fields: 'plan' });
			return { ok: true, value: noticeOf(result, about, providerTxnId) };
		} catch (error) {
			return classify(error);
		}
	}

	/**
	 * one charge under a commitment as the port carries it.
	 *
	 * the same `Settlement` a captured order produces, out of a third vocabulary: a v1 sale states
	 * `amount.total` and `transaction_fee` and publishes no net, where an Orders v2 capture states a
	 * `seller_receivable_breakdown`. the ledger sees a gross and a fee either way.
	 */
	async function readSaleSettlement(saleId: string): Promise<PaymentResult<Settlement>> {
		const sale = await readSale(saleId);
		if (!sale.ok) return sale;

		const settlement = saleSettlementOf(sale.value, saleId);
		if (settlement === null) {
			return {
				ok: false,
				reason: 'provider_error',
				detail:
					`PayPal reported charge ${redactPublicId(saleId)} with an amount or a currency this ` +
					'app cannot read, so nothing was posted. The amount is a decimal string at the ' +
					'currency’s own scale and the currency is a 3-letter ISO-4217 code; this delivery is ' +
					'worth having again.'
			};
		}

		return { ok: true, value: settlement };
	}

	/**
	 * a Payments v2 refund of a one-off gift's capture, which names the capture only through its `up`
	 * link, read as {@link takenBack} decides against the capture's order ({@link captureReversed}).
	 *
	 * the figure is the refund's `amount`, in the currency the donor was charged in, and the fee
	 * PayPal gave back is {@link returnedFeeOf}. a refund's own `custom_id` is whatever the refund was
	 * made with, and one made in PayPal's dashboard carries none, so it is never read.
	 */
	async function readCaptureRefund(
		refundId: string,
		how: TakenBack
	): Promise<PaymentResult<ReversalRead>> {
		try {
			const refund = (await payments.getRefund({ refundId })).result;
			if (refund.status !== RefundStatus.Completed) {
				return { ok: true, value: { kind: 'nothing_moved', providerReversalId: refundId } };
			}
			const currency = (refund.amount?.currencyCode ?? '').toUpperCase();
			const amountMinor = minorOf(takenFigure(refund.amount?.value, how), currency);
			if (amountMinor === null) return unreadableRefund(refundId);
			const captureId = upLinkId(refund.links);
			if (captureId === null) {
				return unsupported(
					`PayPal's refund ${redactPublicId(refundId)} links to no capture, so which gift it ` +
						'reverses cannot be read and nothing was written. Every refund of a capture carries ' +
						'an `up` link to it (https://developer.paypal.com/docs/api/payments/v2/#refunds_get).'
				);
			}
			return takenBack(
				{
					how,
					providerReversalId: refundId,
					amountMinor,
					currency,
					occurredAt: at(refund.createTime),
					madeAt: whenever(refund.createTime),
					feeReturnedMinor: returnedFeeOf(refund, currency)
				},
				captureId,
				captureReversed
			);
		} catch (error) {
			return classify(error);
		}
	}

	/**
	 * a Payments v1 refund of one collection, read against the sale it settled on
	 * ({@link saleReversed}).
	 *
	 * `GET /v1/payments/refund/{id}` is the same deprecated API generation as {@link readSale}, and
	 * retires with it: `PAYMENT.SALE.REFUNDED` and `PAYMENT.SALE.REVERSED` carry a v1 refund, and
	 * this is that resource's read.
	 * no spec ships for it; the fields read are `Refund` in PayPal's own PHP SDK
	 * (https://github.com/paypal/PayPal-PHP-SDK/blob/master/lib/PayPal/Api/Refund.php), which
	 * carries no fee figure — so no returned fee is read, and the collection's fee stays booked.
	 */
	async function readSaleRefund(
		refundId: string,
		how: TakenBack
	): Promise<PaymentResult<ReversalRead>> {
		let answer: { status: number; body: unknown };
		try {
			answer = await call('GET', `/v1/payments/refund/${encodeURIComponent(refundId)}`);
		} catch (error) {
			return unreachable(error);
		}
		if (answer.status < 200 || answer.status >= 300) {
			return classifyStatus(answer.status, answer.body, 'PayPal could not be asked about a refund');
		}
		const refund = json(answer.body);
		if (refund === undefined) {
			return {
				ok: false,
				reason: 'provider_error',
				detail: `PayPal answered the read of refund ${redactPublicId(refundId)} with no object this app could read.`
			};
		}
		if (refund.state !== 'completed') {
			return { ok: true, value: { kind: 'nothing_moved', providerReversalId: refundId } };
		}
		const amount = json(refund.amount);
		const currency = String(amount?.currency ?? '').toUpperCase();
		const amountMinor = minorOf(
			takenFigure(typeof amount?.total === 'string' ? amount.total : undefined, how),
			currency
		);
		if (amountMinor === null) return unreadableRefund(refundId);
		const saleId = typeof refund.sale_id === 'string' ? refund.sale_id : '';
		if (saleId === '') {
			return unsupported(
				`PayPal's refund ${redactPublicId(refundId)} names no sale, so which charge it reverses ` +
					'cannot be read and nothing was written.'
			);
		}

		return takenBack(
			{
				how,
				providerReversalId: refundId,
				amountMinor,
				currency,
				occurredAt: at(typeof refund.create_time === 'string' ? refund.create_time : undefined),
				madeAt: whenever(typeof refund.create_time === 'string' ? refund.create_time : undefined),
				feeReturnedMinor: null
			},
			saleId,
			saleReversed
		);
	}

	/**
	 * a completed refund of a capture or a sale, as the reversal it is.
	 *
	 * a refund of a transaction that a dispute stands on — one that took the money and has not been
	 * won or closed undecided — is that dispute's money, read as the dispute, fresh, under the key
	 * {@link withdrawalKeyOf} gives it, so the writer finds it already recorded or records it once:
	 *
	 *   - a reversal is always the standing dispute's.
	 *   - a refund is the dispute's where the dispute was lost: PayPal settles a claim the merchant
	 *     accepted by refunding it (https://docs.paypal.ai/reference/api/rest/disputes-actions/accept-claim).
	 *     beside a dispute still holding the money, which of the two it is waits on how the dispute
	 *     closes: held open (`provider_error`, retryable) for {@link DISPUTE_WAIT_MS} after the refund
	 *     was made, then refused terminally, naming both, for a person to settle.
	 *
	 * with no dispute standing, a refund is the merchant's own. a reversal is held open for the same
	 * window, because a chargeback's dispute may not be listed yet, then read as a dispute lost under
	 * its own id: PayPal took the money and there is no case to answer.
	 *
	 * where PayPal refuses the disputes list, a refund is read as the merchant's own, logged, and the
	 * writer caps it at what is left of the gift; a reversal is refused ({@link disputesOff}).
	 */
	async function takenBack(
		taken: {
			readonly how: TakenBack;
			readonly providerReversalId: string;
			readonly amountMinor: number;
			readonly currency: string;
			readonly occurredAt: Date;
			/** when PayPal made the refund, or null where it said nothing readable. */
			readonly madeAt: Date | null;
			readonly feeReturnedMinor: number | null;
		},
		transactionId: string,
		reversedOf: (transactionId: string) => Promise<PaymentResult<Transaction>>
	): Promise<PaymentResult<ReversalRead>> {
		const listed = await listDisputes(transactionId);
		if (!listed.ok) return listed;
		if (listed.value === null) {
			if (taken.how === 'reversed') return disputesOff(LIST_CONTEXT);
			console.warn(
				'a PayPal refund was read as the merchant’s own without its disputes: PayPal refused the disputes read, so Disputes is off on the PayPal app whose keys this deployment holds:',
				JSON.stringify({ refund: taken.providerReversalId, transaction: transactionId })
			);
		}
		const disputes = listed.value ?? [];
		const fresh = taken.madeAt !== null && Date.now() - taken.madeAt.getTime() < DISPUTE_WAIT_MS;

		for (const each of [...disputes].reverse()) {
			const fetched = await fetchDispute(each.id);
			if (!fetched.ok) return fetched;
			if (!standsOn(fetched.value)) continue;
			const read = await readDispute(each.id, { disputed: fetched.value, listed: disputes });
			if (!read.ok || taken.how === 'reversed' || read.value.kind === 'dispute_lost') return read;
			const both =
				`PayPal refunded ${redactPublicId(taken.providerReversalId)} on a transaction whose ` +
				`dispute ${redactPublicId(each.id)} still holds its money`;
			return fresh
				? {
						ok: false,
						reason: 'provider_error',
						detail: `${both}, so whether the refund is the dispute’s or the merchant’s waits on how the dispute closes; this delivery is worth having again.`
					}
				: unsupported(
						`${both} a day after the refund was made, so whether the refund is the dispute’s or ` +
							'the merchant’s is a person’s call and nothing was written. Read both in PayPal and ' +
							'correct the gift in /admin/books by hand.'
					);
		}

		if (taken.how === 'reversed' && fresh) {
			return {
				ok: false,
				reason: 'provider_error',
				detail:
					`PayPal reversed ${redactPublicId(taken.providerReversalId)} and lists no dispute on the ` +
					'transaction yet; a chargeback’s dispute can follow its reversal, so this delivery is ' +
					'worth having again.'
			};
		}

		const reversed = await reversedOf(transactionId);
		if (!reversed.ok) return reversed;
		const { how, madeAt: _made, feeReturnedMinor, ...money } = taken;
		return {
			ok: true,
			value:
				how === 'reversed'
					? {
							kind: 'dispute_lost',
							...reversed.value.gift,
							...money,
							feeMinor: null,
							reason: null,
							dashboardUrl: null
						}
					: { kind: 'refund', ...reversed.value.gift, ...money, feeReturnedMinor }
		};
	}

	/**
	 * the disputes on one transaction, oldest first
	 * (`GET /v1/customer/disputes?disputed_transaction_id=`, `dispute_search` in
	 * customer_disputes_v1.json), or null where PayPal refuses the read with a 403: its Disputes
	 * feature is off on the app.
	 *
	 * one page of 50, the most PayPal serves, and no further page is asked for. PayPal lists only
	 * disputes updated in the last 180 days by default (`update_time_after`), so one older than that
	 * is not among them.
	 */
	async function listDisputes(
		transactionId: string
	): Promise<PaymentResult<readonly Listed[] | null>> {
		let answer: { status: number; body: unknown };
		try {
			answer = await call(
				'GET',
				`/v1/customer/disputes?disputed_transaction_id=${encodeURIComponent(transactionId)}&page_size=50`
			);
		} catch (error) {
			return unreachable(error);
		}
		if (answer.status === 403) return { ok: true, value: null };
		if (answer.status < 200 || answer.status >= 300) {
			return classifyStatus(answer.status, answer.body, LIST_CONTEXT);
		}
		const items = json(answer.body)?.items;
		const listed: Listed[] = [];
		for (const each of Array.isArray(items) ? items : []) {
			const item = json(each);
			const id = item?.dispute_id;
			if (typeof id === 'string' && id !== '') {
				const created = typeof item?.create_time === 'string' ? item.create_time : undefined;
				listed.push({ id, createdAt: whenever(created) ?? new Date(0) });
			}
		}
		listed.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
		return { ok: true, value: listed };
	}

	/**
	 * the id a dispute's withdrawal is recorded under: the earliest dispute on its transaction, opened
	 * before it, that took money and was not won — or its own id where there is none.
	 *
	 * PayPal closes a claim `NONE` when a chargeback replaces it on the same transaction, and the
	 * claim's money is the chargeback's from then on (`dispute_outcome` in customer_disputes_v1.json).
	 * keyed on the claim, every report of the chargeback finds the withdrawal the claim recorded, and
	 * its close settles it. an earlier dispute that was won gave its money back, so it keys nothing.
	 */
	async function withdrawalKeyOf(
		transactionId: string,
		disputeId: string,
		disputed: Json,
		known: readonly Listed[] | undefined
	): Promise<PaymentResult<string>> {
		let listed = known;
		if (listed === undefined) {
			const read = await listDisputes(transactionId);
			if (!read.ok) return read;
			if (read.value === null) return disputesOff(LIST_CONTEXT);
			listed = read.value;
		}
		const createdAt =
			whenever(typeof disputed?.create_time === 'string' ? disputed.create_time : undefined) ??
			new Date();
		for (const earlier of listed) {
			if (earlier.createdAt >= createdAt) break;
			if (earlier.id === disputeId) continue;
			const fetched = await fetchDispute(earlier.id);
			if (!fetched.ok) return fetched;
			if (heldMoney(fetched.value) && !wonFor(fetched.value)) {
				return { ok: true, value: earlier.id };
			}
		}
		return { ok: true, value: disputeId };
	}

	/** one dispute, fetched fresh (`GET /v1/customer/disputes/{id}`). */
	async function fetchDispute(disputeId: string): Promise<PaymentResult<Json>> {
		let answer: { status: number; body: unknown };
		try {
			answer = await call('GET', `/v1/customer/disputes/${encodeURIComponent(disputeId)}`);
		} catch (error) {
			return unreachable(error);
		}
		if (answer.status === 403) return disputesOff(READ_CONTEXT);
		if (answer.status < 200 || answer.status >= 300) {
			return classifyStatus(answer.status, answer.body, READ_CONTEXT);
		}
		const disputed = json(answer.body);
		if (disputed === undefined) {
			return {
				ok: false,
				reason: 'provider_error',
				detail: `PayPal answered the read of dispute ${redactPublicId(disputeId)} with no object this app could read.`
			};
		}
		return { ok: true, value: disputed };
	}

	/**
	 * the gift behind a one-off gift's capture: the order it settled on, which is what the gift's
	 * `payment` row holds, and the capture's `custom_id`, which PayPal copies from the purchase unit.
	 */
	async function captureReversed(captureId: string): Promise<PaymentResult<Transaction>> {
		try {
			const captured = (await payments.getCapturedPayment({ captureId })).result;
			const fee = captured.sellerReceivableBreakdown?.paypalFee;
			return {
				ok: true,
				value: {
					gift: {
						// every capture this app takes is an order's; one with no order is another
						// integration's, read against its own id so the writer finds no gift behind it.
						reversedTxnId: captured.supplementaryData?.relatedIds?.orderId ?? captureId,
						reversedMetadata: decodeMetadata(captured.customId)
					},
					fee: fee ? { value: fee.value, currency: fee.currencyCode } : null
				}
			};
		} catch (error) {
			return classify(error);
		}
	}

	/**
	 * the gift behind one collection: the sale, which is what the collection's `payment` row holds,
	 * and the commitment's metadata, reached through the sale's `billing_agreement_id` exactly as
	 * `readRecurringGift` reaches it. a sale under no subscription, or under one PayPal answers 404
	 * for, is none of this app's collections and reads with none, which the writer answers 200 and
	 * leaves.
	 */
	async function saleReversed(saleId: string): Promise<PaymentResult<Transaction>> {
		const sale = await readSale(saleId);
		if (!sale.ok) return sale;
		const giftId = sale.value.billing_agreement_id;
		let reversedMetadata: Readonly<Record<string, string>> = {};
		if (typeof giftId === 'string' && giftId !== '') {
			try {
				const { result } = await subscriptions.getSubscription({ id: giftId });
				reversedMetadata = decodeMetadata(result.customId);
			} catch (error) {
				if (!(error instanceof ApiError && error.statusCode === 404)) return classify(error);
			}
		}
		const fee = json(sale.value.transaction_fee);
		return {
			ok: true,
			value: {
				gift: { reversedTxnId: saleId, reversedMetadata },
				fee:
					typeof fee?.value === 'string' && typeof fee.currency === 'string'
						? { value: fee.value, currency: fee.currency }
						: null
			}
		};
	}

	/**
	 * the gift behind a transaction a dispute names, which is a capture or a sale: PayPal gives both
	 * ids one shape, so the capture is asked first and a 404 sends the id to the sale read — the order
	 * `readSettlement` asks in. an id neither read holds is another integration's on the same account,
	 * read with no metadata so the writer finds no gift behind it and leaves it.
	 */
	async function transactionReversed(transactionId: string): Promise<PaymentResult<Transaction>> {
		const captured = await captureReversed(transactionId);
		if (captured.ok || captured.reason !== 'not_found') return captured;
		const sold = await saleReversed(transactionId);
		return !sold.ok && sold.reason === 'not_found'
			? {
					ok: true,
					value: { gift: { reversedTxnId: transactionId, reversedMetadata: {} }, fee: null }
				}
			: sold;
	}

	/**
	 * a dispute, read fresh, as what it has done to the money — {@link disputeStateOf} decides which
	 * — against the gift behind the one transaction it disputes, under {@link withdrawalKeyOf}'s key.
	 * `known` is the dispute and its transaction's list where a caller already fetched them.
	 */
	async function readDispute(
		disputeId: string,
		known?: { readonly disputed: Json; readonly listed: readonly Listed[] }
	): Promise<PaymentResult<ReversalRead>> {
		let disputed = known?.disputed;
		if (disputed === undefined) {
			const fetched = await fetchDispute(disputeId);
			if (!fetched.ok) return fetched;
			disputed = fetched.value;
		}
		const state = disputeStateOf(disputed, disputeId);
		if (state === null) {
			return { ok: true, value: { kind: 'nothing_moved', providerReversalId: disputeId } };
		}
		if ('ok' in state) return state;

		const key = await withdrawalKeyOf(state.transactionId, disputeId, disputed, known?.listed);
		if (!key.ok) return key;
		const reversed = await transactionReversed(state.transactionId);
		if (!reversed.ok) return reversed;
		const facts = { ...reversed.value.gift, providerReversalId: key.value };
		const charged = chargedFeeOf(reversed.value, state.currency);
		const reason = typeof disputed?.reason === 'string' ? disputed.reason : null;
		const time = (field: 'create_time' | 'update_time') =>
			at(typeof disputed?.[field] === 'string' ? disputed[field] : undefined);
		switch (state.kind) {
			case 'dispute_opened':
				return {
					ok: true,
					value: {
						kind: 'dispute_opened',
						...facts,
						amountMinor: state.amountMinor,
						currency: state.currency,
						occurredAt: time('create_time'),
						feeMinor: disputeFeeChargedOf(disputed, state.currency, disputeId),
						respondBy: whenever(
							typeof disputed?.seller_response_due_date === 'string'
								? disputed.seller_response_due_date
								: undefined
						),
						reason,
						dashboardUrl: resolutionCenter
					}
				};
			case 'dispute_lost':
				return {
					ok: true,
					value: {
						kind: 'dispute_lost',
						...facts,
						amountMinor: state.amountMinor,
						currency: state.currency,
						occurredAt: time('update_time'),
						feeMinor: lostDisputeFeeOf(disputed, state.currency, charged, disputeId),
						reason,
						dashboardUrl: resolutionCenter
					}
				};
			case 'dispute_won':
				return {
					ok: true,
					value: {
						kind: 'dispute_won',
						...facts,
						occurredAt: time('update_time'),
						feeReturnedMinor: wonDisputeFeeOf(disputed, state.currency, charged, disputeId)
					}
				};
		}
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
			const oversized = oversizedMetadata(
				request.metadata ?? {},
				customId,
				CUSTOM_ID_MAX,
				'no order was created and nothing was charged'
			);
			if (oversized) return oversized;

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
						'out of it. Open the console (`better-giving start`) and save PayPal’s credentials under ' +
						'Donation processor: that press registers the listener for this deployment’s address ' +
						'and stores its id.'
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
				verification = await call('POST', '/v1/notifications/verify-webhook-signature', {
					body: {
						...signature,
						// the configured id and never one off the request. every other field here is the
						// delivery's own, so an id taken from it too would be a caller vouching for their own
						// delivery against their own listener.
						webhook_id: credentials.webhookId,
						webhook_event: event
					}
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

			if (json(verification.body)?.verification_status !== 'SUCCESS') {
				return {
					ok: false,
					reason: 'bad_signature',
					detail:
						'PayPal did not vouch for this delivery, so its body was not read. If this ' +
						'deployment’s own listener is failing, `PAYPAL_WEBHOOK_ID` is not the id of the ' +
						'listener these deliveries are being sent to. Saving PayPal’s credentials again in ' +
						'the console (`better-giving start`) finds that listener and stores its id.'
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

			if ((SETTLEMENT_EVENT_TYPES as readonly string[]).includes(type)) {
				const providerTxnId = orderIdOf(type, event.resource);
				if (providerTxnId === null) {
					return unreadableResource(
						type,
						event,
						'no order',
						'the Orders v2 and Payments v2 shapes'
					);
				}

				return { ok: true, value: { id, kind: 'settlement', type, providerTxnId, occurredAt } };
			}

			if ((RECURRING_EVENT_TYPES as readonly string[]).includes(type)) {
				const providerNoticeId = resourceIdOf(event.resource);
				if (providerNoticeId === null) {
					return unreadableResource(
						type,
						event,
						'no subscription or sale',
						'the Subscriptions v1 shapes'
					);
				}

				return { ok: true, value: { id, kind: 'recurring', type, providerNoticeId, occurredAt } };
			}

			if ((REVERSAL_EVENT_TYPES as readonly string[]).includes(type)) {
				const providerNoticeId = isDisputeEvent(type)
					? disputeIdOf(event.resource)
					: resourceIdOf(event.resource);
				if (providerNoticeId === null) {
					return unreadableResource(
						type,
						event,
						'no refund or dispute',
						'the Payments v2 refund, the Payments v1 refund and the Disputes v1 dispute shapes'
					);
				}

				return { ok: true, value: { id, kind: 'reversal', type, providerNoticeId, occurredAt } };
			}

			return { ok: true, value: { id, kind: 'ignored', type, occurredAt } };
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
		 *
		 * **one signature over two objects, because `payment.provider_txn_id` holds two kinds of id.**
		 * a single gift's is an order; a repeating gift's charge is a v1 sale, which is a different
		 * API generation with a vocabulary of its own ({@link saleSettlementOf}). PayPal gives both
		 * ids the same shape and publishes no prefix to tell them apart, so which one this is, is
		 * decided by asking — the order first, so the majority path pays for no extra call.
		 */
		async readSettlement(providerTxnId: string): Promise<PaymentResult<Settlement>> {
			let order: Order;
			try {
				order = (await orders.getOrder({ id: providerTxnId })).result;
			} catch (error) {
				// not an order: the id is a repeating gift's charge, and the sale read is what answers
				// for one. any other refusal is the order read's own and is reported as it stands.
				if (error instanceof ApiError && error.statusCode === 404) {
					return readSaleSettlement(providerTxnId);
				}
				return classify(error);
			}

			try {
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
		 * the refund or the dispute a delivery names, fresh, and never by the event that carried it.
		 *
		 * a refund is read by its own status: only a completed refund moved money, and every other
		 * status — pending while an eCheck clears, failed, cancelled — reads as nothing moved until a
		 * later delivery reads it completed. its own id is the reversal's; it is never the order's or
		 * the sale's. `*.SALE.*` names a v1 refund of one collection and `*.CAPTURE.*` a v2 refund of a
		 * one-off gift's capture, each read in its own vocabulary, and a dispute standing on either
		 * decides what the refund is ({@link takenBack}).
		 *
		 * a dispute is read by {@link disputeStateOf}, under the key {@link withdrawalKeyOf} gives it.
		 */
		async readReversal(event: ReversalEvent): Promise<PaymentResult<ReversalRead>> {
			if (isDisputeEvent(event.type)) return readDispute(event.providerNoticeId);
			const how: TakenBack = (REVERSED_EVENT_TYPES as readonly string[]).includes(event.type)
				? 'reversed'
				: 'refunded';
			return event.type.startsWith('PAYMENT.SALE.')
				? readSaleRefund(event.providerNoticeId, how)
				: readCaptureRefund(event.providerNoticeId, how);
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
			return ensureRecurringProduct();
		},

		async readRecurringGiftProvision(): Promise<PaymentResult<RecurringGiftStanding>> {
			return readRecurringProduct();
		},

		/**
		 * a donor committed to a gift that repeats: the plan their amount and cadence resolve to, and
		 * a subscription against it. charges nothing itself.
		 *
		 * the subscription carries no figure of its own — a plan is where PayPal keeps what is
		 * charged — so the only thing this call decides is which plan it names, and
		 * {@link findOrCreateBillingPlan} is what decides that from the server's own numbers.
		 *
		 * **no `subscriber` is sent, and the omission is the rule rather than an economy.** the field
		 * takes a name, an email address and a shipping address, and every one of them is something
		 * the donor typed about themselves — a commitment carries pointers and figures only
		 * (CLAUDE.md, *Bans* → **Repeating gifts**). PayPal collects whatever it needs from the payer
		 * in its own window, where it already has them.
		 *
		 * the answer is asked for in full (`return=representation`) rather than minimal, because a
		 * minimal one is the id, the status and links — and the commitment's start is what the
		 * dashboard shows against the gift.
		 */
		async createRecurringGift(
			request: RecurringGiftRequest
		): Promise<PaymentResult<RecurringGift>> {
			const refusal = unusableGift(request);
			if (refusal) return refusal;
			if (!settles(request.method)) return unsettledRail(request.method);

			const planId = await findOrCreateBillingPlan(subscriptions, {
				amountMinor: request.amountMinor,
				currency: request.currency,
				interval: request.interval
			});
			if (!planId.ok) return planId;

			try {
				const { result } = await subscriptions.createSubscription({
					// derived from the caller's key rather than sent as it stands: this arm makes two
					// writes on PayPal's side and the plan's own key is `planRequestId`'s, so an
					// undecorated key here would be one of them replayed at the call that wanted the other.
					paypalRequestId: `${DERIVED_KEY}:gift:${request.idempotencyKey}`,
					prefer: 'return=representation',
					body: { planId: planId.value, customId: encodeMetadata(request.metadata ?? {}) }
				});

				if (!result.id) {
					return {
						ok: false,
						reason: 'provider_error',
						detail:
							'PayPal created a subscription without an id, so there is nothing for the donor’s ' +
							'browser to approve and nothing to cancel. No repeating gift was set up and nothing ' +
							'was charged.'
					};
				}

				return {
					ok: true,
					value: {
						providerGiftId: result.id,
						// empty at creation and not an error: a subscription awaiting approval has no
						// subscriber yet, because PayPal learns who the payer is in its own window. the id
						// arrives on the notice that opens the row instead (`RecurringGiftNotice.
						// providerCustomerId` in ./provider.ts), which is where `recurring_plan` takes it.
						providerCustomerId: result.subscriber?.payerId ?? '',
						state: recurringState(result.status),
						// the subscription's own id, which is what PayPal's browser SDK resolves an
						// approval from — so a repeating gift is confirmed by exactly the code that
						// confirms a single one (`confirm` in packages/form/src/embed/paypal.ts).
						paymentToken: result.id,
						startedAt: at(result.startTime ?? result.createTime)
					}
				};
			} catch (error) {
				return classify(error);
			}
		},

		/**
		 * stops a repeating gift at PayPal, effective at once.
		 *
		 * no `PayPal-Request-Id`, and the API takes none on this call: a cancel is a state change into
		 * a state it is already in on the second attempt, which is what makes the operator's button
		 * safe to press twice without one.
		 *
		 * the date is this deployment's clock because PayPal answers `204 No Content` — there is no
		 * `status_update_time` on the answer to take, and reading the subscription back for one would
		 * be a second call for a figure the first already fixed. `RecurringGiftEnd.endedAt` in
		 * ./provider.ts is written for exactly that.
		 */
		async cancelRecurringGift(providerGiftId: string): Promise<PaymentResult<RecurringGiftEnd>> {
			try {
				await subscriptions.cancelSubscription({
					id: providerGiftId,
					// required by the API, and read by an operator on PayPal's own dashboard. a fixed
					// sentence rather than anything about this gift: nothing a donor typed leaves here.
					body: { reason: CANCEL_REASON }
				});

				return { ok: true, value: { providerGiftId, endedAt: new Date() } };
			} catch (error) {
				return classify(error);
			}
		},

		/**
		 * which repeating gift a delivery is about, and which collection under it.
		 *
		 * two reads over two objects and three answers, decided by the delivery's own type because
		 * that is what says which object PayPal sent — an id prefix would be a fact about PayPal's
		 * spelling rather than about what this deployment subscribed to.
		 *
		 * a charge names a sale, and the sale is read for `billing_agreement_id` because it carries
		 * no `custom_id` of its own: the metadata that says whose gift this is lives on the
		 * commitment. everything else names the subscription directly.
		 */
		async readRecurringGift(event: RecurringEvent): Promise<PaymentResult<RecurringGiftNotice>> {
			if (event.type !== 'PAYMENT.SALE.COMPLETED') {
				return readCommitment(
					event.providerNoticeId,
					(RECURRING_COLLECTION_EVENT_TYPES as readonly string[]).includes(event.type)
						? 'collection'
						: 'commitment',
					null
				);
			}

			const sale = await readSale(event.providerNoticeId);
			if (!sale.ok) return sale;

			// the subscription's id, off the one field a sale carries it on. PayPal documents that
			// field only as the billing agreement's and publishes no sample body for a subscription's
			// sale, so nothing in its own documentation establishes that a subscription id lands
			// there — which is why an absent one is refused rather than filled in from the sale's own
			// id or the payer's.
			const giftId = sale.value.billing_agreement_id;
			if (typeof giftId !== 'string' || giftId === '') {
				return {
					ok: false,
					reason: 'provider_error',
					detail:
						`PayPal's sale ${redactPublicId(event.providerNoticeId)} carries no ` +
						'`billing_agreement_id`, so which repeating gift this charge belongs to could not be ' +
						'read and nothing was recorded. That field is the only path from a collection back ' +
						'to its commitment — a sale carries no `custom_id` — so there is nothing to fall ' +
						'back to and guessing would post the money against another donor’s gift.'
				};
			}

			return readCommitment(giftId, 'collection', event.providerNoticeId);
		},

		/**
		 * the listeners the app these credentials belong to holds.
		 *
		 * one read and no paging: PayPal lists an app's listeners whole and caps an app at ten
		 * (https://developer.paypal.com/docs/api/webhooks/v1/).
		 *
		 * **`enabled` is always true, because a listener carries no switch.** the `webhook` object is
		 * an id, a url and its event types (`notifications_webhooks_v1.json` in
		 * https://github.com/paypal/paypal-rest-api-specifications), so the only way a listener stops
		 * receiving a delivery is not being subscribed to it — which is what `missingEventTypes` reads.
		 *
		 * **the stamp is the listener's own id**, which is what `PAYPAL_WEBHOOK_ID` holds and what a
		 * delivery is verified against — public, so nothing is digested (`VERIFICATION` in
		 * ./webhook-secret.ts).
		 */
		async listWebhookEndpoints(): Promise<PaymentResult<WebhookEndpointRegistry>> {
			let answer: { status: number; body: unknown };
			try {
				answer = await call('GET', '/v1/notifications/webhooks');
			} catch (error) {
				return classify(error);
			}
			if (answer.status < 200 || answer.status >= 300) {
				return classifyStatus(
					answer.status,
					answer.body,
					'PayPal could not be asked which listeners this app holds'
				);
			}

			const listed = json(answer.body)?.webhooks;
			const endpoints = (Array.isArray(listed) ? listed : []).flatMap(
				(one: unknown): WebhookEndpointSummary[] => {
					const listener = json(one);
					if (typeof listener?.id !== 'string' || typeof listener.url !== 'string') return [];
					const types = Array.isArray(listener.event_types) ? listener.event_types : [];
					return [
						{
							id: listener.id,
							url: listener.url,
							enabled: true,
							eventTypes: types.flatMap((type: unknown) => {
								const name = json(type)?.name;
								return typeof name === 'string' ? [name] : [];
							}),
							apiVersion: null,
							verificationStamp: listener.id
						}
					];
				}
			);
			return { ok: true, value: { endpoints, requiredEventTypes: SUBSCRIBED_EVENT_TYPES } };
		},

		async registerWebhookEndpoint(): Promise<PaymentResult<RegisteredWebhookEndpoint>> {
			return unsupported(NO_LISTENER_REPAIR);
		},

		async resubscribeWebhookEndpoint(): Promise<PaymentResult<WebhookEndpointSummary>> {
			return unsupported(NO_LISTENER_REPAIR);
		},

		async replaceWebhookEndpoint(): Promise<PaymentResult<RegisteredWebhookEndpoint>> {
			return unsupported(NO_LISTENER_REPAIR);
		},

		async listWalletDomains(): Promise<PaymentResult<readonly WalletDomain[]>> {
			return unsupported(NO_WALLET_DOMAINS);
		},

		async registerWalletDomain(): Promise<PaymentResult<WalletDomain>> {
			return unsupported(NO_WALLET_DOMAINS);
		},

		async listPayableCoins(): Promise<PaymentResult<readonly PayableCoin[]>> {
			return unsupported(
				'PayPal takes no payment in a coin, so there is no coin list to read. Nothing was asked of PayPal.'
			);
		}
	};
}

/**
 * how often a gift repeats, as PayPal's own word for it.
 *
 * total over `RecurringInterval`, which is `FREQUENCIES` in packages/form/src/v1.ts minus the
 * one-off — so a frequency added to the wire contract is a compile error here rather than a donor
 * offered a cadence nothing can charge. the same shape `SETTLED_RAILS` above holds over the rails.
 *
 * `interval_count` is 1 in both cases and is sent at the call site rather than folded in here: this
 * table is what a cadence is called, and how many of them make a billing period is a different fact.
 */
const PLAN_INTERVALS: Readonly<Record<RecurringInterval, IntervalUnit>> = Object.freeze({
	monthly: IntervalUnit.Month,
	yearly: IntervalUnit.Year
});

/**
 * PayPal's six subscription statuses onto the port's four (`RECURRING_GIFT_STATES` in ./provider.ts).
 *
 * total over the closed set the API publishes — `APPROVAL_PENDING`, `APPROVED`, `ACTIVE`,
 * `SUSPENDED`, `CANCELLED`, `EXPIRED`
 * (https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/billing_subscriptions_v1.json,
 * `subscription_status`) — so nothing PayPal can say falls through the default.
 *
 * the two that are a reading rather than a translation:
 *
 *   `APPROVED` is `pending` and not `active`. the donor pressed the button in PayPal's window and
 *   nothing has been collected: PayPal moves it to `ACTIVE` when the first charge lands, and
 *   ../donations/collect.ts opens the commitment's row from that charge rather than from approval.
 *
 *   `SUSPENDED` is `lapsed` and not `ended`. PayPal suspends a commitment when its own retries run
 *   out inside a cycle (https://developer.paypal.com/docs/subscriptions/customize/failed-payments/),
 *   and that is reversible — `revives` in ../donations/collect.ts is written for a gift coming back
 *   from exactly this state, which `ended` would not.
 *
 * everything unrecognised is `pending`, the direction safe to be wrong in: nothing may be acted on
 * from it and the next read corrects it.
 */
const RECURRING_STATES: Readonly<Record<string, RecurringGiftState>> = Object.freeze({
	APPROVAL_PENDING: 'pending',
	APPROVED: 'pending',
	ACTIVE: 'active',
	SUSPENDED: 'lapsed',
	CANCELLED: 'ended',
	EXPIRED: 'ended'
});

function recurringState(status: string | undefined): RecurringGiftState {
	return RECURRING_STATES[status ?? ''] ?? 'pending';
}

/**
 * the plan PayPal repeats a gift on, as this app asks for one.
 *
 * no idempotency key on it, unlike `RecurringGiftRequest` in ./provider.ts: the parameters are the
 * same for every donor giving this amount at this cadence, so the key is derived from them
 * ({@link planRequestId}) and two donors arriving together resolve to one plan instead of racing to
 * make two. a caller's own key would make each of them a first attempt.
 */
export type RecurringPlanKey = {
	/** minor units, a positive safe integer, charged in full every interval. */
	readonly amountMinor: number;
	/** ISO-4217, uppercase, as `entry_group.currency` holds it. */
	readonly currency: string;
	readonly interval: RecurringInterval;
};

/**
 * what one plan is called, wherever PayPal shows it.
 *
 * it reaches a donor — PayPal's approval window names the plan — and it is not matched on, so it is
 * safe to reword. the figure is built with `majorText` rather than a currency formatter because
 * nothing in the money path divides (CLAUDE.md), and a name is not worth the one exception.
 */
function planName(key: RecurringPlanKey): string {
	return `Recurring gift of ${majorText(key.amountMinor, key.currency)} ${key.currency}, ${key.interval}`;
}

/**
 * what makes two requests for the same plan one create.
 *
 * derived from the amount, the currency and the cadence, which is the whole of what the plan is —
 * so the second of two requests that both found nothing is a repeat rather than a first attempt, and
 * PayPal answers it with the plan the first made. the header is honoured for 72 hours on this API
 * (https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/billing_subscriptions_v1.json),
 * which is the window a race can be settled inside; past it, {@link findOrCreateBillingPlan}'s own
 * read is what finds the plan and no create is reached.
 */
function planRequestId(key: RecurringPlanKey): string {
	return `${DERIVED_KEY}:plan:${key.interval}:${key.currency}:${key.amountMinor}`;
}

/**
 * how many plans are read looking for one, and how many at a time.
 *
 * PayPal caps a page at 20 and publishes no filter finer than the product
 * (https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/billing_subscriptions_v1.json),
 * so finding a plan is a walk and the walk needs an end: this runs on workerd, where every call is
 * answered inside one request's subrequest budget. an account holding more distinct amounts than
 * this ceiling can still take every one of them — the walk misses, the create is made, and the
 * derived request id is what keeps that from being a second plan for an amount already on page
 * eleven.
 */
const PLAN_PAGE_SIZE = 20;
const PLAN_PAGE_LIMIT = 10;

/**
 * the plan this cadence, currency and amount is charged on, found on the account or created once.
 *
 * **not a port arm, and no module of this app names a plan.** what the port exposes about repeating
 * gifts is the product (`RecurringGiftProvision` in ./provider.ts) — a plan is per amount and per
 * cadence, so it belongs to the commitment being made rather than to the account, and a caller
 * holding one would be holding a claim about a third party's state. it is exported for the
 * subscription arm that will call it, and for ./paypal.spec.ts, which drives it against the same
 * recorded transport every other arm here is asserted through.
 *
 * the product is assumed rather than provisioned here: every arm that needs a plan calls
 * `prepareRecurringGifts` first, which is what the port says find-or-create is for.
 *
 * **a plan is matched on what it charges, never on its name.** the name is a string an operator can
 * edit in PayPal's own dashboard and the price is what a donor is committed to, so matching on the
 * figure is what keeps a gift from being charged an amount this app never computed — an edited plan
 * simply stops being found, and the right one is made beside it.
 */
export async function findOrCreateBillingPlan(
	plans: SubscriptionsController,
	key: RecurringPlanKey
): Promise<PaymentResult<string>> {
	const refusal = unusableAmount(key.amountMinor, key.currency);
	if (refusal) return refusal;

	try {
		for (let page = 1; page <= PLAN_PAGE_LIMIT; page++) {
			const { result } = await plans.listBillingPlans({
				productId: RECURRING_PRODUCT_ID,
				pageSize: PLAN_PAGE_SIZE,
				page,
				// the whole plan rather than the id, the name and a link. what a plan is matched on is
				// its status and what it charges, and a minimal answer — which is what this API returns
				// when it is not asked — carries neither.
				prefer: 'return=representation'
			});
			const held = result.plans ?? [];
			// the lowest id of the plans on this page that charge what this gift is to be charged,
			// rather than the first PayPal happened to list. where a duplicate got past the derived
			// request id there are two of them, and neither is deleted — a gift is already committed to
			// whichever one won. what is fixed is the choice, so every later request lands on the same
			// one (CLAUDE.md: a lost race is settled by a correcting entry rather than a rollback).
			const matched = held
				.flatMap((plan) => (plan.id && charges(plan, key) ? [plan.id] : []))
				.sort();
			const found = matched[0];
			if (found) return { ok: true, value: found };
			if (held.length < PLAN_PAGE_SIZE) break;
		}

		const { result } = await plans.createBillingPlan({
			paypalRequestId: planRequestId(key),
			body: {
				productId: RECURRING_PRODUCT_ID,
				name: planName(key),
				// active on creation. a plan left `CREATED` takes no subscription, and activating it
				// afterwards is a second call that can fail on its own.
				status: PlanRequestStatus.Active,
				billingCycles: [
					{
						tenureType: TenureType.Regular,
						sequence: 1,
						// forever. the field defaults to 1, which is a gift that repeats once.
						totalCycles: 0,
						frequency: { intervalUnit: PLAN_INTERVALS[key.interval], intervalCount: 1 },
						pricingScheme: {
							fixedPrice: {
								currencyCode: key.currency,
								value: majorText(key.amountMinor, key.currency)
							}
						}
					}
				],
				paymentPreferences: {
					// a gift that could not be collected is not a debt. left on — PayPal's default —
					// a donor whose card failed in one month is charged two months in the next, which
					// is a figure they never agreed to. PayPal's own retries inside the cycle are
					// unaffected and are what recovers an ordinary failure.
					autoBillOutstanding: false
				}
			}
		});

		if (!result.id) {
			return {
				ok: false,
				reason: 'provider_error',
				detail:
					'PayPal created a billing plan without an id, so there is nothing to commit this gift ' +
					'to. Nothing was charged.'
			};
		}

		return { ok: true, value: result.id };
	} catch (error) {
		return classify(error);
	}
}

/**
 * whether a plan the account holds is the one this gift is to be charged on.
 *
 * every clause is a way a plan can look right and charge wrong: an `INACTIVE` one takes no new
 * subscription, a second regular cycle is a schedule this app does not model, and an amount or a
 * cadence read off somebody else's plan is a donor committed to a figure nobody computed. the amount
 * is compared in minor units rather than as text, so a price PayPal wrote as `25.0` is the same
 * plan as one it wrote as `25.00`.
 */
function charges(plan: BillingPlan, key: RecurringPlanKey): boolean {
	if (plan.status !== SubscriptionPlanStatus.Active) return false;

	const regular = (plan.billingCycles ?? []).filter(
		(cycle) => cycle.tenureType === TenureType.Regular
	);
	const cycle = regular.length === 1 ? regular[0] : undefined;
	const price = cycle?.pricingScheme?.fixedPrice;
	if (!cycle || !price) return false;

	return (
		cycle.frequency.intervalUnit === PLAN_INTERVALS[key.interval] &&
		(cycle.frequency.intervalCount ?? 1) === 1 &&
		cycle.totalCycles === 0 &&
		price.currencyCode.toUpperCase() === key.currency &&
		minorOf(price.value, key.currency) === key.amountMinor
	);
}

/**
 * what a failed read of one charge says, and where to go when this endpoint is finally gone.
 *
 * carried on every failure of that read rather than on the retirement alone, because the two are
 * indistinguishable from here: PayPal answers a sale it does not hold and a path it no longer serves
 * with the same status.
 */
const SALE_READ_CONTEXT =
	'PayPal could not be asked what one charge under a repeating gift came to. That read is ' +
	'`GET /v1/payments/sale/{id}` on the deprecated Payments v1 API; where it has been retired, the ' +
	'replacement is `GET /v1/billing/subscriptions/{id}/transactions`, which is keyed by the ' +
	'subscription and a time window rather than by the charge’s own id';

/**
 * PayPal's own word for a cadence as this app's, or nothing.
 *
 * the reverse of {@link PLAN_INTERVALS} and spelled separately rather than derived from it, because
 * the two are not the same map: this one is total over everything a plan can say — `DAY` and `WEEK`
 * included — and answers nothing for the cadences this app cannot hold.
 */
const CADENCES: Readonly<Record<string, RecurringInterval>> = Object.freeze({
	MONTH: 'monthly',
	YEAR: 'yearly'
});

/**
 * how often the commitment's own schedule says it collects, or nothing.
 *
 * the plan's regular cycle and never its trial, and `interval_count` has to be one: a plan billing
 * every third month is a cadence this app did not make and cannot describe, and the nearest member
 * would be a row asserting a schedule nobody set.
 *
 * null too where the read came back without its plan, which is a cadence unknown rather than a
 * collection to refuse — `RecurringGiftNotice.interval` in ./provider.ts argues that trade.
 */
function cadenceOf(committed: Subscription): RecurringInterval | null {
	const cycle = (committed.plan?.billingCycles ?? []).find(
		(held) => held.tenureType === TenureType.Regular
	);
	if (!cycle || (cycle.frequency.intervalCount ?? 1) !== 1) return null;
	return CADENCES[cycle.frequency.intervalUnit] ?? null;
}

/**
 * one commitment as the port carries it, with what the delivery was about.
 *
 * a function rather than the body of the read, so a collection's notice and a lifecycle one cannot
 * disagree about where a field came from.
 *
 * `endedAt` is the status's own update time and only on a commitment that has ended. a suspended one
 * is `lapsed` with no end: PayPal's suspension is reversible, and a date written for it would be a
 * gift recorded as stopped that goes on collecting.
 */
function noticeOf(
	committed: Subscription,
	about: 'collection' | 'commitment',
	providerTxnId: string | null
): RecurringGiftNotice {
	const state = recurringState(committed.status);

	return {
		about,
		providerGiftId: committed.id ?? '',
		providerCustomerId: committed.subscriber?.payerId ?? '',
		state,
		interval: cadenceOf(committed),
		metadata: decodeMetadata(committed.customId),
		nextChargeAt: whenever(committed.billingInfo?.nextBillingTime),
		providerTxnId,
		endedAt: state === 'ended' ? whenever(committed.statusUpdateTime) : null
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
 * capture states onto this schema's four (`PAYMENT_STATUSES` in ../db/schema.ts).
 *
 * a capture whose money later went back — `REFUNDED`, `PARTIALLY_REFUNDED`, or `REVERSED` on a
 * chargeback — is `succeeded`, the split {@link SALE_STATUSES} keeps: the charge did succeed, and
 * what went back is a `payment` row of its own with its own id, written from the refund's own
 * delivery (`readReversal`). the status is read after the fact, so a late read meets these where it
 * would have met `COMPLETED`, and read as anything else it would say the gift never settled.
 * `REVERSED` is not in the published `capture_status` enum (payments_payment_v2.json in
 * https://github.com/paypal/paypal-rest-api-specifications) and is held here as the word the
 * `PAYMENT.CAPTURE.REVERSED` event is named for.
 *
 * everything this table does not hold is `pending`, including PayPal's own `PENDING` and a state
 * added upstream — the direction that is safe to be wrong in, since the next read corrects it and no
 * posting is made on money reported as still in flight.
 */
const CAPTURE_STATUSES: Readonly<Record<string, PaymentStatus>> = Object.freeze({
	COMPLETED: 'succeeded',
	PARTIALLY_REFUNDED: 'succeeded',
	REFUNDED: 'succeeded',
	REVERSED: 'succeeded',
	DECLINED: 'failed',
	FAILED: 'failed'
});

/**
 * five v1 sale states onto this schema's four (`PAYMENT_STATUSES` in ../db/schema.ts).
 *
 * a table of its own rather than {@link CAPTURE_STATUSES} read case-insensitively: the two
 * vocabularies overlap without matching — a sale says `denied` where a capture says `DECLINED`, and
 * folded together that state would fall through to `pending` and a refused collection would read as
 * money still in flight.
 *
 * a refunded sale is `succeeded`, the same split the capture table keeps: the charge did succeed,
 * and a refund is a `payment` row of its own with its own id.
 */
const SALE_STATUSES: Readonly<Record<string, PaymentStatus>> = Object.freeze({
	completed: 'succeeded',
	partially_refunded: 'succeeded',
	refunded: 'succeeded',
	denied: 'failed'
});

/**
 * one charge under a commitment as the port carries it, or nothing where its money cannot be read.
 *
 * `method` is always null and that is PayPal rather than an omission: a v1 sale publishes no funding
 * source, so the rail a collection actually settled on is not readable at all. asserting the rail
 * the commitment was quoted on instead would make a divergence between the two permanently
 * invisible, which is exactly what `Settlement.method` in ./provider.ts forbids.
 *
 * `metadata` is empty for the same kind of reason: a sale carries no `custom_id`. a collection is
 * attributed through the commitment's, which `readRecurringGift` reads — so this map has nothing to
 * carry rather than something missing.
 */
function saleSettlementOf(sale: Record<string, unknown>, saleId: string): Settlement | null {
	const amount = json(sale.amount);
	const currency = String(amount?.currency ?? '').toUpperCase();
	const amountMinor = minorOf(
		typeof amount?.total === 'string' ? amount.total : undefined,
		currency
	);
	if (amountMinor === null) return null;

	// the fee in the charge's own currency or no fee at all, the rule `feeOf` above states in full.
	const fee = json(sale.transaction_fee);
	const feeMinor =
		String(fee?.currency ?? '').toUpperCase() === currency
			? minorOf(typeof fee?.value === 'string' ? fee.value : undefined, currency)
			: null;

	return {
		providerTxnId: saleId,
		// everything this table does not hold is `pending`, including PayPal's own `pending` — the
		// direction safe to be wrong in, since no posting is made on money reported as in flight.
		status: SALE_STATUSES[String(sale.state ?? '')] ?? 'pending',
		method: null,
		amountMinor,
		currency,
		feeMinor,
		metadata: {},
		occurredAt: at(typeof sale.create_time === 'string' ? sale.create_time : undefined),
		arrival: null
	};
}

/**
 * a completed refund whose figure this app cannot read, refused rather than posted.
 *
 * never a null amount, which the port reads as the rest of the gift (`Reversal` in ./provider.ts).
 * `unsupported` because a completed refund's figure never changes, so every redelivery reads the
 * same — the rule {@link unreadableResource} states — and the writer tells staff and answers 200
 * rather than holding the delivery open until PayPal drops it.
 */
function unreadableRefund(refundId: string): PaymentFailure {
	return unsupported(
		`PayPal reported refund ${redactPublicId(refundId)} with an amount or a currency this app ` +
			'cannot read, so nothing was posted. The amount is a decimal string at the currency’s own ' +
			'scale and the currency is a 3-letter ISO-4217 code; find the refund in PayPal and correct ' +
			'the gift in /admin/books by hand.'
	);
}

/** one dispute on a transaction, as PayPal lists it. */
type Listed = { readonly id: string; readonly createdAt: Date };

const LIST_CONTEXT = 'PayPal could not be asked for the disputes on a transaction';
const READ_CONTEXT = 'PayPal could not be asked about a dispute';

/**
 * PayPal's Disputes feature switched off on the app, which no redelivery changes: refused
 * terminally so the writer tells staff, where held open it would be a dispute dropped unheard when
 * PayPal stops redelivering. once the feature is on, PayPal resending the event records it in full
 * (`POST /v1/notifications/webhooks-events/{event_id}/resend` in notifications_webhooks_v1.json in
 * https://github.com/paypal/paypal-rest-api-specifications).
 */
function disputesOff(context: string): PaymentFailure {
	return unsupported(
		`${context}: PayPal refused this app the disputes read, so nothing was written. To fix it, ` +
			'enable Disputes on the PayPal app whose keys this deployment holds, then have PayPal ' +
			'resend this event.'
	);
}

/** whether the merchant sent money back (`*.REFUNDED`) or PayPal took it (`*.REVERSED`). */
type TakenBack = 'refunded' | 'reversed';

/**
 * a refund's decimal figure as the money taken back. a reversal's is read as its magnitude: PayPal
 * may state money leaving the merchant signed negative, and which way it went is the event's to say.
 */
function takenFigure(value: string | undefined, how: TakenBack): string | undefined {
	return how === 'reversed' && value?.startsWith('-') ? value.slice(1) : value;
}

/** the gift a reversal is found through: the transaction its row holds, and the metadata naming it. */
type Reversed = {
	readonly reversedTxnId: string;
	readonly reversedMetadata: Readonly<Record<string, string>>;
};

/** a disputed transaction: the gift behind it, and the fee PayPal charged on it as PayPal states it. */
type Transaction = {
	readonly gift: Reversed;
	readonly fee: { readonly value: string; readonly currency: string } | null;
};

/**
 * minor units: the fee PayPal charged on a transaction, in `currency`, which is all the books hold
 * of it — `feeOf`'s rule, so a fee in another currency, or none, is nothing.
 */
function chargedFeeOf(transaction: Transaction, currency: string): number {
	const fee = transaction.fee;
	if (fee === null || fee.currency.toUpperCase() !== currency) return 0;
	return minorOf(fee.value, currency) ?? 0;
}

/**
 * the states of a disputed transaction in which PayPal has the money rather than the merchant:
 * held while an internal claim is decided, or reversed by a card issuer's chargeback
 * (`transaction_info.transaction_status` in customer_disputes_v1.json).
 */
const WITHDRAWN_TRANSACTION_STATUSES: readonly string[] = ['HELD', 'REVERSED'];

/**
 * the stages past an inquiry (`dispute_lifecycle_stage` in customer_disputes_v1.json): a claim
 * PayPal decides, or an appeal of one, which is a case holding the money.
 */
const HOLDING_STAGES: readonly string[] = ['CHARGEBACK', 'PRE_ARBITRATION', 'ARBITRATION'];

/**
 * whether a dispute took the merchant's money at any point: its one transaction held or reversed
 * while it is open, a seller `DISPUTE_SETTLEMENT` debit in its `fund_movements`, or a stage past
 * the inquiry. a resolved transaction no longer reads held, so a close is judged by the other two.
 */
function heldMoney(disputed: Json): boolean {
	const transaction = json(
		Array.isArray(disputed?.disputed_transactions) ? disputed.disputed_transactions[0] : undefined
	);
	if (
		disputed?.status !== 'RESOLVED' &&
		WITHDRAWN_TRANSACTION_STATUSES.includes(String(transaction?.transaction_status))
	) {
		return true;
	}
	const movements = Array.isArray(disputed?.fund_movements) ? disputed.fund_movements : [];
	const settled = movements.some((each) => {
		const movement = json(each);
		return (
			movement?.party === 'SELLER' &&
			movement.type === 'DEBIT' &&
			movement.reason === 'DISPUTE_SETTLEMENT'
		);
	});
	return settled || HOLDING_STAGES.includes(String(disputed?.dispute_life_cycle_stage));
}

/**
 * how a resolved dispute's outcome leaves the merchant (`dispute_outcome.outcome_code` in
 * customer_disputes_v1.json). decided for the buyer, the money stays gone; decided for the seller,
 * cancelled by the buyer, or covered by PayPal's own protection, the merchant keeps it. `ACCEPTED`
 * and `DENIED` are the deprecated spellings of PayPal accepting or denying the buyer's dispute, and
 * read the same way. `NONE` is a dispute closed undecided because another opened on the same
 * transaction, which carries the money from here, so it moves nothing.
 */
const DISPUTE_OUTCOMES: Readonly<Record<string, 'dispute_lost' | 'dispute_won' | null>> =
	Object.freeze({
		RESOLVED_BUYER_FAVOUR: 'dispute_lost',
		ACCEPTED: 'dispute_lost',
		RESOLVED_SELLER_FAVOUR: 'dispute_won',
		CANCELED_BY_BUYER: 'dispute_won',
		RESOLVED_WITH_PAYOUT: 'dispute_won',
		DENIED: 'dispute_won',
		NONE: null
	});

/**
 * how long after PayPal made a refund or a reversal it is held open waiting on a dispute: for a
 * chargeback's dispute to be listed, or for a dispute holding the money to close with the refund.
 * measured from the refund's own `create_time`, which every redelivery carries alike, and well
 * inside PayPal's redelivery of a non-2xx for up to three days
 * (https://developer.paypal.com/api/rest/webhooks/rest/), so the terminal answer after it still
 * reaches staff.
 */
const DISPUTE_WAIT_MS = 24 * 60 * 60 * 1_000;

/** how a resolved dispute's outcome reads under {@link DISPUTE_OUTCOMES}; `undefined` for one it does not name. */
function outcomeOf(disputed: Json): 'dispute_lost' | 'dispute_won' | null | undefined {
	const code = String(json(disputed?.dispute_outcome)?.outcome_code);
	return Object.hasOwn(DISPUTE_OUTCOMES, code) ? DISPUTE_OUTCOMES[code] : undefined;
}

/**
 * whether the money on a dispute's transaction stands under it: it took the money and is open, or
 * was lost. one won, or closed undecided, no longer holds anything.
 */
function standsOn(disputed: Json): boolean {
	if (!heldMoney(disputed)) return false;
	return disputed?.status !== 'RESOLVED' || outcomeOf(disputed) === 'dispute_lost';
}

/** whether a dispute closed with the merchant keeping the money. */
function wonFor(disputed: Json): boolean {
	return disputed?.status === 'RESOLVED' && outcomeOf(disputed) === 'dispute_won';
}

/**
 * what a dispute has done to the money, off the dispute alone, or `null` where it has done nothing:
 * an open inquiry that holds no funds, or a close that moves none.
 */
function disputeStateOf(
	disputed: Json,
	disputeId: string
):
	| {
			readonly kind: 'dispute_opened' | 'dispute_lost';
			readonly transactionId: string;
			readonly amountMinor: number;
			readonly currency: string;
	  }
	| { readonly kind: 'dispute_won'; readonly transactionId: string; readonly currency: string }
	| PaymentFailure
	| null {
	const transactions = Array.isArray(disputed?.disputed_transactions)
		? disputed.disputed_transactions
		: [];
	const transaction = transactions.length === 1 ? json(transactions[0]) : undefined;
	const transactionId = transaction?.seller_transaction_id;
	if (typeof transactionId !== 'string' || transactionId === '') {
		return unsupported(
			`PayPal's dispute ${redactPublicId(disputeId)} names ${transactions.length} transactions, ` +
				'and this app reads a dispute over exactly one it can name, so which gift it is about ' +
				'cannot be read and nothing was written. Find the case in PayPal’s Resolution Center ' +
				'and correct the gifts in /admin/books by hand.'
		);
	}
	let kind: 'dispute_opened' | 'dispute_lost' | 'dispute_won' | null;
	const outcome = json(disputed?.dispute_outcome);
	if (!heldMoney(disputed)) {
		kind = null;
	} else if (disputed?.status === 'RESOLVED') {
		const closed = outcomeOf(disputed);
		if (closed === undefined) {
			const code = String(outcome?.outcome_code);
			return unsupported(
				`PayPal reported dispute ${redactPublicId(disputeId)} resolved as \`${redactPublicId(code)}\`, ` +
					'which this app does not read as won or lost, so nothing was written. Find the case in ' +
					'PayPal’s Resolution Center and correct the gift in /admin/books by hand.'
			);
		}
		kind = closed;
	} else {
		kind = 'dispute_opened';
	}
	if (kind === null) return null;

	// what the buyer was refunded where the dispute states it, which may be less than was disputed.
	const money =
		(kind === 'dispute_lost' ? json(outcome?.amount_refunded) : undefined) ??
		json(disputed?.dispute_amount);
	const currency = String(money?.currency_code ?? '').toUpperCase();
	const amountMinor = minorOf(typeof money?.value === 'string' ? money.value : undefined, currency);
	if (amountMinor === null) return unreadableDispute(disputeId);
	return kind === 'dispute_won'
		? { kind, transactionId, currency }
		: { kind, transactionId, amountMinor, currency };
}

function unreadableDispute(disputeId: string): PaymentFailure {
	return unsupported(
		`PayPal reported dispute ${redactPublicId(disputeId)} with an amount or a currency this app ` +
			'cannot read, so nothing was posted. Find the case in PayPal’s Resolution Center and ' +
			'correct the gift in /admin/books by hand.'
	);
}

/** what PayPal charges for a dispute itself (`fund_movement_reason` in customer_disputes_v1.json). */
const DISPUTE_FEE_REASONS: readonly string[] = ['DISPUTE_FEE', 'CHARGEBACK_FEE'];

/** the transaction's own fee, reimbursed to the seller as part of the dispute's resolution. */
const REIMBURSED_FEE_REASONS: readonly string[] = ['REVERSED_TRANSACTION_FEE'];

/**
 * the seller's `fund_movements` of one `type` for any of `reasons`, summed in minor units; zero
 * where there are none. a movement in another currency, or with no figure this app can read, is
 * left out of it and logged, since it is money the books do not hold.
 */
function sellerMovementsOf(
	disputed: Json,
	currency: string,
	type: 'DEBIT' | 'CREDIT',
	reasons: readonly string[],
	disputeId: string
): number {
	const movements = Array.isArray(disputed?.fund_movements) ? disputed.fund_movements : [];
	let total = 0;
	for (const each of movements) {
		const movement = json(each);
		if (
			movement?.party !== 'SELLER' ||
			movement.type !== type ||
			!reasons.includes(String(movement.reason))
		) {
			continue;
		}
		const amount = json(movement.amount);
		const figure =
			String(amount?.currency_code ?? '').toUpperCase() === currency
				? minorOf(typeof amount?.value === 'string' ? amount.value : undefined, currency)
				: null;
		if (figure === null) {
			console.warn(
				'a PayPal dispute fee was left out of the books: it is in another currency than the dispute, or not a figure:',
				JSON.stringify({ dispute: disputeId, type, reason: movement.reason, currency, amount })
			);
			continue;
		}
		total += figure;
	}
	return total;
}

/** what PayPal has charged for a dispute so far. none or zero is no figure. */
function disputeFeeChargedOf(disputed: Json, currency: string, disputeId: string): number | null {
	return figureOrNone(
		sellerMovementsOf(disputed, currency, 'DEBIT', DISPUTE_FEE_REASONS, disputeId)
	);
}

/**
 * a lost dispute's fee: what PayPal charged for it, less the transaction fee it reimbursed at the
 * close ({@link reimbursedFeeOf}), and never below nothing. a lost dispute carries no fee given
 * back (`Reversal` in ./provider.ts), so a reimbursement beyond the charge is logged.
 */
function lostDisputeFeeOf(
	disputed: Json,
	currency: string,
	transactionFee: number,
	disputeId: string
): number | null {
	const charged = sellerMovementsOf(disputed, currency, 'DEBIT', DISPUTE_FEE_REASONS, disputeId);
	const reimbursed = reimbursedFeeOf(disputed, currency, transactionFee, disputeId);
	if (reimbursed > charged) {
		console.warn(
			'a PayPal reimbursed transaction fee beyond a lost dispute’s fee was left out of the books:',
			JSON.stringify({ dispute: disputeId, currency, reimbursed, charged })
		);
	}
	return figureOrNone(Math.max(0, charged - reimbursed));
}

/** a won dispute's fee given back: the dispute fee returned, and the transaction fee reimbursed. */
function wonDisputeFeeOf(
	disputed: Json,
	currency: string,
	transactionFee: number,
	disputeId: string
): number | null {
	return figureOrNone(
		sellerMovementsOf(disputed, currency, 'CREDIT', DISPUTE_FEE_REASONS, disputeId) +
			reimbursedFeeOf(disputed, currency, transactionFee, disputeId)
	);
}

/**
 * the transaction fee PayPal reimbursed at a dispute's close, capped at `transactionFee` — what it
 * charged on the transaction, and all the books hold of it. the cap is logged.
 */
function reimbursedFeeOf(
	disputed: Json,
	currency: string,
	transactionFee: number,
	disputeId: string
): number {
	const reported = sellerMovementsOf(
		disputed,
		currency,
		'CREDIT',
		REIMBURSED_FEE_REASONS,
		disputeId
	);
	if (reported <= transactionFee) return reported;
	console.warn(
		'a PayPal reimbursed transaction fee was capped at the fee charged on the transaction:',
		JSON.stringify({ dispute: disputeId, currency, reported, charged: transactionFee })
	);
	return transactionFee;
}

function figureOrNone(minor: number): number | null {
	return minor === 0 ? null : minor;
}

/**
 * the part of its fee PayPal gave back with a v2 refund, in the refund's own currency, or nothing.
 *
 * `seller_payable_breakdown.paypal_fee` is the fee refunded to the merchant, in the currency of the
 * transaction (`refund` in payments_payment_v2.json in
 * https://github.com/paypal/paypal-rest-api-specifications). zero is none, and a figure in another
 * currency is no figure rather than a converted one, the rule {@link feeOf} states for a capture's.
 */
function returnedFeeOf(refund: Refund, currency: string): number | null {
	const fee = refund.sellerPayableBreakdown?.paypalFee;
	if (!fee || fee.currencyCode.toUpperCase() !== currency) return null;
	const returned = minorOf(fee.value, currency);
	return returned === 0 ? null : returned;
}

/** the last path segment of a refund's `up` link, which is the id of the object it reverses. */
function upLinkId(links: readonly { rel: string; href: string }[] | undefined): string | null {
	const href = links?.find((link) => link.rel === 'up')?.href;
	if (href === undefined) return null;
	return new URL(href).pathname.split('/').pop() || null;
}

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
		// the capture id is the transaction id PayPal's own activity list shows; an order id is not.
		...(captured?.id ? { reference: captured.id } : {}),
		occurredAt: at(captured?.createTime ?? order.createTime),
		arrival: null
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
	for (const rail of PAYPAL_RAILS) {
		if (order.paymentSource?.[rail] !== undefined) return SETTLED_RAILS[rail];
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

/** an RFC 3339 timestamp as a date, or nothing — for a field whose absence is itself the answer. */
function whenever(time: string | undefined): Date | null {
	if (time === undefined) return null;
	const read = new Date(time);
	return Number.isNaN(read.getTime()) ? null : read;
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
	const said = [json(body)?.name, ...issuesOf(body)]
		.filter((part) => typeof part === 'string')
		.join(', ');
	const sanitised = said.replace(/\s+/g, ' ').trim();
	if (sanitised === '') return 'nothing this app could read';
	return sanitised.length <= PROVIDER_QUOTE_MAX
		? sanitised
		: `${sanitised.slice(0, PROVIDER_QUOTE_MAX)}…`;
}

/** every `issue` code on a PayPal error body, which is what one refusal is told apart by. */
function issuesOf(body: unknown): readonly string[] {
	const details = json(body)?.details;
	if (!Array.isArray(details)) return [];
	return details.flatMap((detail: unknown) => {
		const issue = json(detail)?.issue;
		return typeof issue === 'string' ? [issue] : [];
	});
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
				'`PAYPAL_CLIENT_SECRET` are not a pair the account at `PAYPAL_API_URL` accepts, or the ' +
				'app they belong to does not carry the permission this call needs. The usual cause is ' +
				`keys from an app at another of PayPal’s addresses. ${said}`
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
