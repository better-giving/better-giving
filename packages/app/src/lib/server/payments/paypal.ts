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
	SubscriptionPlanStatus,
	SubscriptionsController,
	TenureType
} from '@paypal/paypal-server-sdk';
import type {
	BillingPlan,
	CapturedPayment,
	OAuthToken,
	Order,
	Subscription
} from '@paypal/paypal-server-sdk';
import { PAYPAL_RAILS, type PaypalRail } from '@better-giving/form/embed/rails';
import type { PaymentStatus } from '../db/schema';
import { majorText, readAmount } from '../../forms/amounts';
import { redact, redactPublicId } from '../../redact';
import { DONATION_METADATA_KEY, INTERVAL_METADATA_KEY } from './provider';
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
// **it answers the one-off gift and the repeating one, and refuses the webhook-management and
// wallet arms** — `unsupported`, exactly as ./factory.ts answers for a processor with no adapter at
// all, and argued at each of them.
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
 * the deliveries about a repeating gift that say money was meant to move.
 *
 * two, and the second is not a mistake: `BILLING.SUBSCRIPTION.PAYMENT.FAILED` is a collection with
 * nothing behind it — a charge was due and did not happen — which is the same reading
 * `RECURRING_COLLECTION_EVENT_TYPES` in packages/operator/src/stripe/webhook-endpoint.ts gives the
 * failed half of its own pair. read as the commitment's standing instead, a gift whose card failed
 * once would be recorded as having stopped.
 *
 * **their resources are not the same object.** the charge event carries a v1 sale and the failure
 * event carries the subscription, which is what {@link createPaypalProvider}'s recurring read
 * branches on — and it is the reason a caller is handed the delivery rather than an id.
 *
 * **no retry is built on the failure.** PayPal retries a failed collection twice per cycle on its
 * own and suspends the commitment when its threshold is reached
 * (https://developer.paypal.com/docs/subscriptions/customize/failed-payments/), so a retry here
 * would be a donor charged twice for one missed month.
 */
const RECURRING_COLLECTION_EVENT_TYPES = [
	'PAYMENT.SALE.COMPLETED',
	'BILLING.SUBSCRIPTION.PAYMENT.FAILED'
] as const;

/**
 * the deliveries about a commitment's own standing, each naming the subscription.
 *
 * four rather than PayPal's seven `BILLING.SUBSCRIPTION.*` names. `CREATED` and `UPDATED` are not
 * here: this app records the gift from its own create call, and nothing in this product revises a
 * subscription — so both would be a read that changes nothing.
 *
 * **every one of these names is published twice**, under the live Subscriptions set and under the
 * deprecated Billing Agreements set, carrying a different resource each time
 * (https://developer.paypal.com/api/rest/webhooks/event-names). the listener this deployment
 * registers subscribes to the Subscriptions set, and a delivery whose resource this app cannot read
 * is refused rather than reconciled against whatever id happened to be readable.
 */
const RECURRING_COMMITMENT_EVENT_TYPES = [
	'BILLING.SUBSCRIPTION.ACTIVATED',
	'BILLING.SUBSCRIPTION.CANCELLED',
	'BILLING.SUBSCRIPTION.EXPIRED',
	'BILLING.SUBSCRIPTION.SUSPENDED'
] as const;

/** every delivery about a repeating gift, in one list because they share one kind and one read. */
const RECURRING_EVENT_TYPES: readonly string[] = [
	...RECURRING_COLLECTION_EVENT_TYPES,
	...RECURRING_COMMITMENT_EVENT_TYPES
];

/** the id the resource carries, or nothing where the delivery names no object this app can read. */
function resourceIdOf(resource: unknown): string | null {
	const object = json(resource);
	return typeof object?.id === 'string' ? object.id : null;
}

/**
 * a verified delivery this app subscribes to and cannot read, as the refusal it has to be.
 *
 * verified, subscribed, and unreadable. an event name is published under more than one API
 * generation and the generations carry different resources, so this is what a delivery serialised
 * for one this adapter does not read arrives as. reported as `ignored` it would be a settlement
 * dropped in silence under a 200, which is the failure that loses a gift.
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
		reason: 'provider_error',
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
const NO_LISTENER_MANAGEMENT =
	'This release does not manage PayPal\u2019s listeners. The listener for this deployment\u2019s ' +
	'address is created on the PayPal developer dashboard, under the app these credentials belong to, ' +
	'and its id is what `PAYPAL_WEBHOOK_ID` is set to.';

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
 */
function paypalClient(credentials: PaypalCredentials): {
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
		unstable_httpClientOptions: { adapter: 'fetch', fetchOptions: { cache: 'no-store' } }
	});

	return {
		client,
		accessToken: async () => {
			token = await client.clientCredentialsAuthManager.updateToken(token);
			return token.accessToken;
		}
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
	return new SubscriptionsController(paypalClient(credentials).client);
}

export function createPaypalProvider(credentials: PaypalCredentials): PaymentProvider {
	const { client, accessToken } = paypalClient(credentials);
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
		const answer = await fetch(`${API_BASE}${path}`, {
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

			if (RECURRING_EVENT_TYPES.includes(type)) {
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
		occurredAt: at(typeof sale.create_time === 'string' ? sale.create_time : undefined)
	};
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
