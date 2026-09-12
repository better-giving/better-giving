import Stripe from 'stripe';
import type { PaymentStatus } from '../db/schema';
import { redact, redactPublicId } from '../../redact';
import { isStripeRail, STRIPE_RAILS, type StripeRail } from '@better-giving/form/embed/rails';
import { RAIL_CAPABILITY_STATES, WALLETS } from './provider';
import {
	FINGERPRINT_METADATA_KEY,
	secretFingerprint
} from '@better-giving/operator/stripe/secret-fingerprint';
import {
	API_VERSION,
	RECURRING_COLLECTION_EVENT_TYPES,
	RECURRING_EVENT_TYPES,
	SETTLEMENT_EVENT_TYPES,
	SUBSCRIBED_EVENT_TYPES
} from '@better-giving/operator/stripe/webhook-endpoint';
import type {
	AccountChargeability,
	RailCapabilityState,
	Intent,
	IntentRequest,
	PaymentEvent,
	PaymentFailure,
	PaymentProvider,
	PaymentResult,
	QuotedRail,
	RailSwitch,
	RailSwitchboard,
	RecurringEvent,
	RecurringGift,
	RecurringGiftEnd,
	RecurringGiftNotice,
	RecurringGiftProvision,
	RecurringGiftRequest,
	RecurringGiftStanding,
	RecurringGiftState,
	RecurringInterval,
	RegisteredWebhookEndpoint,
	SettledRail,
	Settlement,
	WalletDomain,
	WalletStanding,
	WebhookDelivery,
	WebhookEndpointSummary
} from './provider';

// the Stripe adapter, and the only module in this repository that imports `stripe`.
//
// that is the rule ./sole-importer.spec.ts enforces, and it is the same shape ../db/client.ts
// holds over D1 for the same stated reason: so the contract has exactly one place to be stated.
// everything else takes `PaymentProvider` from ./provider.ts.
//
// it is written for workerd, which is what the constructor options are about — see
// `createStripeProvider`, and ./stripe.workers.spec.ts, which is where that claim is actually
// exercised rather than asserted in prose.

/** what the adapter needs to talk to an account. */
export type StripeCredentials = {
	/** `STRIPE_SECRET_KEY`. server-only, never bundled, never logged, never echoed. */
	readonly secretKey: string;
	/**
	 * `STRIPE_WEBHOOK_SECRET` — the signing secret of this deployment's own endpoint, or `null` where
	 * the deployment holds none.
	 *
	 * nullable rather than required, because it is the one credential here that is sent on no call:
	 * every arm below authenticates with the secret key, and this value is read by `verifyEvent`
	 * alone, to check that an inbound delivery came from Stripe. so a deployment without it can still
	 * do everything outbound — including registering the endpoint that mints one, which is the only
	 * way to obtain the value at all.
	 *
	 * `null` rather than an empty string, so the compiler puts the refusal at the one line that reads
	 * it. an empty string would type-check straight into the verification call, fail there, and be
	 * reported as a delivery whose signature did not match — sending an operator to compare a secret
	 * they do not have against an endpoint that is fine.
	 */
	readonly webhookSecret: string | null;
};

/**
 * how long a call may take before it is reported as unanswered.
 *
 * the SDK's own default is 80 seconds, which is the wrong order of magnitude for this app: the
 * caller is a donor waiting on a public endpoint with a card in their hand, and a request that
 * hangs for eighty seconds is a form that appears broken and a person who presses the button
 * again. twelve seconds is long enough to absorb an ordinary slow answer and short enough that
 * `unreachable` — which the caller retries under the same idempotency key — arrives while they
 * are still on the page.
 */
const TIMEOUT_MS = 12_000;

/**
 * how many times one settlement read asks for a fee Stripe has not computed yet, and how long it
 * waits between asks.
 *
 * `capture_method: automatic_async` is the API default since version `2024-04-10`, and under it the
 * balance transaction behind a succeeded payment is documented as possibly absent at the moment the
 * delivery fires (https://docs.stripe.com/payments/payment-intents/asynchronous-capture). the wait
 * is ordinarily a second or two, so three asks four seconds apart in total absorb the common case
 * inside the delivery Stripe is already waiting on, and `fee_not_ready` in ./provider.ts carries the
 * long tail into a redelivery.
 *
 * the budget is bounded by what the processor will wait for rather than by this runtime. a Worker
 * has no wall-clock limit while its client stays connected and a timer costs it no CPU time
 * (https://developers.cloudflare.com/workers/platform/limits/), so the four seconds are the
 * processor's patience being spent and nothing else's.
 *
 * **nothing caps the read as a whole, and that is the same argument rather than a gap in it.** the
 * waits are four seconds; the retrieves are what can run long, and only while Stripe's own API is
 * hanging — three of them at the SDK's per-call timeout puts the worst case near forty seconds,
 * past what Stripe waits for a delivery. a read that outlives the delivery is answered by a
 * redelivery, which is the outcome the terminal arm below asks for in as many words, so a cap here
 * would buy the same ending one round trip earlier and add a number nobody can source. what would
 * change the reasoning is a runtime that charged for the wall clock, and this one does not.
 */
const FEE_ATTEMPTS = 3;
const FEE_SPACING_MS = 2_000;

/**
 * how old a charge has to be before its fee is given up on rather than waited for.
 *
 * the terminal arm, and it exists so that a fee that never arrives cannot cost the gift. Stripe stops
 * redelivering after about three days, and an account on interchange-plus pricing cannot read a fee
 * off the balance transaction at all (https://docs.stripe.com/expand/use-cases) — so a read that
 * refused unconditionally would answer every delivery with a 503 until the retries ran out, and the
 * charge would never be posted at all. past this age the settlement is answered without a fee, which
 * ../donations/settle.ts posts and tells an operator about.
 *
 * measured from the charge, falling back to the intent. both are fixed at the moment the money moved
 * and are therefore the same on every redelivery, which the delivery's own attempt count is not.
 */
const FEE_WINDOW_MS = 6 * 60 * 60 * 1_000;

/** the same promise, `FEE_SPACING_MS` later. */
function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** the shape the ledger holds a currency in, and the shape this port takes one in. */
const CURRENCY = /^[A-Z]{3}$/;

/**
 * the header a delivery's signature arrives in, lowercase.
 *
 * lowercase because `WebhookDelivery.headers` in ./provider.ts is keyed the way `Headers` iterates,
 * so the lookup is exact rather than case-folded.
 */
const SIGNATURE_HEADER = 'stripe-signature';

/**
 * the rail the donor was quoted on, as the parameter that holds a charge to it.
 *
 * one table for both write arms, because Stripe spells a rail the same way in each: the same
 * vocabulary is `payment_method_types` on an intent and `payment_settings.payment_method_types` on
 * a commitment (https://docs.stripe.com/billing/subscriptions/payment-methods-setting). a second
 * copy for the repeating arm would be two lists that have to agree about `us_bank_account` with
 * nothing saying so — which is the failure ./rail-agreement.spec.ts already exists to catch across
 * the confirmation boundary.
 *
 * wallets are not their own value here, and that is the part worth knowing rather than guessing:
 * Apple Pay and Google Pay are delivered *through* the card method — the Payment Element surfaces
 * them when the intent supports cards and the donor's platform has one — so all three map to
 * `card`. asking for a wallet by name would name a method the API does not have.
 *
 * total over `StripeRail`, so a rail added to this processor's own list in
 * packages/form/src/embed/rails.ts without a mapping is a compile error rather than an intent
 * minted for the wrong method. the rails another processor settles are absent: this API has no
 * method for them, and naming one would mint an intent nothing can pay.
 *
 * it mirrors `RAILS` in `packages/form/src/embed/rails.ts`, which is the list the element group confirms
 * with, and ./rail-agreement.spec.ts holds the two to each other: a confirmation carries the
 * group's own list for the API to check against the intent's, so a rail the two spell differently
 * is a gift refused before any rail is touched.
 */
export const INTENT_METHODS: Readonly<Record<StripeRail, readonly string[]>> = Object.freeze({
	card: Object.freeze(['card']),
	apple_pay: Object.freeze(['card']),
	google_pay: Object.freeze(['card']),
	ach: Object.freeze(['us_bank_account'])
});

/**
 * which of the account's capabilities answers for a rail.
 *
 * total over `StripeRail`, so a rail added to this processor's own list in
 * packages/form/src/embed/rails.ts has to be given a source here rather than inheriting one.
 *
 * the wallets answer to the card capability, which is not the card rail's answer borrowed: a wallet
 * settles as a card charge (`RAILS` in packages/form/src/embed/rails.ts), so the approval that
 * governs it is the same approval, while the switch is each wallet's own — an account approved for
 * cards with Apple Pay switched off reports `switched_off` for the wallet and `approved` for the
 * card, which is exactly the difference an operator needs to see
 * (./rail-chargeability.ts derives both).
 *
 * a reader per rail rather than a key string, for the reason {@link RAIL_SWITCHES} below has one:
 * read by a string index the hash would need a cast, and a cast is what would let a key that no
 * longer exists compile.
 */
const RAIL_CAPABILITIES: Readonly<
	Record<StripeRail, (capabilities: Stripe.Account.Capabilities | undefined) => string | undefined>
> = Object.freeze({
	card: (capabilities) => capabilities?.card_payments,
	ach: (capabilities) => capabilities?.us_bank_account_ach_payments,
	apple_pay: (capabilities) => capabilities?.card_payments,
	google_pay: (capabilities) => capabilities?.card_payments
});

/**
 * where one rail's switch lives on a payment method configuration.
 *
 * a third spelling of the same four rails, and the reason this is a table of its own rather than a
 * reuse of `INTENT_METHODS` above: the three vocabularies do not line up. a bank debit is
 * `us_bank_account` on an intent and on a configuration and `us_bank_account_ach_payments` as a
 * capability — while `us_bank_transfer_payments` is a different product entirely and not this one.
 * the wallets have no intent method at all and do have a configuration key each, which is exactly
 * the pair a single table would have to lie about.
 *
 * a reader per rail rather than a key string, because each of these fields has its own type on the
 * configuration object: read by a string index the four would need a cast, and a cast is what would
 * let a key that no longer exists compile.
 *
 * total over `StripeRail`, so a rail added to this processor's own list in
 * packages/form/src/embed/rails.ts is a compile error here rather than a rail quietly missing from
 * what the deployment reports it offers.
 */
const RAIL_SWITCHES: Readonly<
	Record<
		StripeRail,
		(configuration: Stripe.PaymentMethodConfiguration) => ConfiguredRail | undefined
	>
> = Object.freeze({
	card: (configuration) => configuration.card,
	ach: (configuration) => configuration.us_bank_account,
	apple_pay: (configuration) => configuration.apple_pay,
	google_pay: (configuration) => configuration.google_pay
});

/**
 * the two fields every rail on a configuration carries, named structurally.
 *
 * the SDK gives each rail its own interface with these same two members, so this is what they have
 * in common rather than a shape this app invented. `available` is documented as the display
 * preference being `on` *and* the capability being active
 * (https://docs.stripe.com/api/payment_method_configurations/object), which is why it is the field
 * the offered list is taken from and the preference is read only to explain a rail that is not.
 */
type ConfiguredRail = {
	readonly available: boolean;
	readonly display_preference: { readonly value: string };
};

/**
 * how many configurations one read asks for.
 *
 * the API's own page defaults to ten, and an account with more than that would answer the question
 * "which one is the default" from a first page that need not hold it. the maximum is asked for
 * instead, which is the same reasoning `ENDPOINT_PAGE` below is written from.
 */
const CONFIGURATION_PAGE = 100;

/**
 * what the processor reports about a settled charge, mapped onto the `payment.method` column.
 *
 * partial on purpose: a rail this app never offers can still appear on a charge — an account can
 * be configured for methods a donation form does not show — and `PAYMENT_METHODS` in
 * ../db/schema.ts has no member for one. an unmapped rail reads null rather than being coerced
 * into `card`, which would be a row asserting a rail nobody used.
 */
const SETTLED_METHODS: Readonly<Record<string, SettledRail>> = Object.freeze({
	card: 'card',
	us_bank_account: 'ach'
});

/**
 * the object on the account every repeating gift is charged against, named by an id this app
 * derives rather than one anybody stored.
 *
 * Stripe generates a product's id and lets the caller override it, requiring only that it is unique
 * across the account (https://docs.stripe.com/api/products/create — `id`). that is what makes the
 * lookup a retrieve of a known address rather than a scan: nothing about this deployment's product
 * lives in a row, in an environment variable or in an operator's clipboard, and the account is still
 * the only thing asked. the same rule ./webhook-registration.ts states for the endpoint, applied to
 * the object that happens to have an address this app can spell.
 *
 * it is matched on and it is therefore permanent. a deployment that has taken one repeating gift has
 * a product under this id and subscriptions hanging off it; changing the string does not rename that
 * product, it makes this app unable to find it and mint a second one beside it — with every donor's
 * gift still charged against the first. ./stripe.spec.ts pins the value rather than reading it, so
 * the change is a failing test rather than a silent fork.
 */
const RECURRING_PRODUCT_ID = 'better_giving_recurring_gift';

/**
 * what the one product is called, wherever the processor shows it.
 *
 * it reaches a donor: an invoice and a card statement for a repeating gift carry the product's name.
 * so it is the word a fundraiser uses (CLAUDE.md) — a gift that recurs, never a subscription and
 * never a plan. it is not matched on, so it is safe to reword.
 */
const RECURRING_PRODUCT_NAME = 'Recurring gift';

/**
 * what the product is described as on the dashboard an operator opens.
 *
 * the same sentence `ENDPOINT_DESCRIPTION` below is: somebody looking at Stripe's own catalogue finds
 * an object nothing explains, and this is the explanation. not matched on, so it is safe to reword.
 */
const RECURRING_PRODUCT_DESCRIPTION = 'Repeating gifts made through this better-giving deployment.';

/**
 * how often a gift repeats, as the parameter that says so.
 *
 * total over `RecurringInterval`, which is `FREQUENCIES` in packages/form/src/v1.ts minus the one-off — so
 * a frequency added to the wire contract is a compile error here rather than a donor offered a
 * cadence nothing can charge. the same shape `INTENT_METHODS` above holds over the rails.
 *
 * `interval_count` is 1 in both cases and is sent explicitly at the call site rather than folded in
 * here: this table is what a cadence is called, and how many of them make a billing period is a
 * different fact.
 */
const RECURRING_INTERVALS: Readonly<Record<RecurringInterval, 'month' | 'year'>> = Object.freeze({
	monthly: 'month',
	yearly: 'year'
});

/**
 * what a repeating gift's state is called here, off the processor's own word for it.
 *
 * partial on purpose, and the fallback is the design rather than a gap. the processor holds states
 * this app can never produce — it never trials, never pauses and never invoices by email — so a
 * total table would be members with no caller and no test. anything absent reads `pending`, which is
 * the direction safe to be wrong in: nothing may be acted on from `pending` and the next read
 * corrects it, where a wrong `active` is the dashboard reporting income that is not being collected.
 *
 * `past_due` is `active`, and it is the member worth arguing. the processor's own retry schedule is
 * running against a charge that missed, which is a commitment still being collected rather than one
 * that has stopped — `lapsed` is where it lands only once the processor gives up, which is what
 * `unpaid` means.
 */
const RECURRING_STATES: Readonly<Record<string, RecurringGiftState>> = Object.freeze({
	incomplete: 'pending',
	incomplete_expired: 'lapsed',
	trialing: 'active',
	active: 'active',
	past_due: 'active',
	unpaid: 'lapsed',
	canceled: 'ended'
});

/**
 * what every key this app derives is prefixed with, so nothing it derives can collide with a
 * caller's own.
 *
 * the caller hands one idempotency key for the whole of `createRecurringGift`, and that arm makes
 * more than one write — so each write is keyed off a value derived from it. derived without a
 * namespace, the customer's key and the commitment's key would be the same string, which the
 * processor answers by replaying the customer at the call that wanted the commitment.
 */
const DERIVED_KEY = 'better-giving';

/**
 * the string a price for one cadence, currency and amount is found by.
 *
 * a lookup key rather than a search over the catalogue, because the processor holds one price per
 * key and hands it back by exact match (https://docs.stripe.com/api/prices/list — `lookup_keys`).
 * that is what makes the second donor giving £25 a month reuse the first donor's price instead of
 * minting one of their own — the difference between a catalogue with a row per amount offered and
 * one with a row per gift ever made.
 *
 * every field the price is defined by is in the key, and that is what makes reuse safe: two prices
 * that would be charged differently can never resolve to the same string. the amount is in minor
 * units, so £25.00 and £2,500.00 are `2500` and `250000` rather than a rounded pair.
 *
 * the interval is the processor's own word for it rather than this app's, so the key describes the
 * object it names — the price a reader is looking at says `month`, and so does the key that found
 * it. it stays under the 200-character ceiling the processor sets for a lookup key by construction.
 */
function priceLookupKey(
	interval: RecurringInterval,
	currency: string,
	amountMinor: number
): string {
	return `better_giving_recurring_${RECURRING_INTERVALS[interval]}_${currency.toLowerCase()}_${amountMinor}`;
}

/**
 * how many endpoints one read of the account asks for.
 *
 * the whole account in one answer, deliberately. Stripe caps an account at sixteen registered
 * endpoints (https://docs.stripe.com/webhooks#register-your-endpoint) and this page is the API's own
 * maximum, so `has_more` cannot be true and nothing here paginates. that matters beyond tidiness:
 * `registerWebhookEndpoint` decides whether to create by looking for a URL in this list, and a
 * second page left unread would be a duplicate endpoint whose secret is the one nobody kept.
 */
const ENDPOINT_PAGE = 100;

/**
 * what a registered endpoint is described as on the dashboard it appears on.
 *
 * an operator opening Stripe's own webhooks screen finds a URL and a list of events, and nothing
 * saying which of the things they set up that morning made it. this is that sentence. it is not
 * matched on — `registerWebhookEndpoint` identifies an endpoint by its URL — so it is safe to
 * reword.
 */
const ENDPOINT_DESCRIPTION =
	'Donation and repeating-gift events for this better-giving deployment.';

/**
 * how many registered hostnames one read of the account asks for.
 *
 * the API's own maximum, and the whole answer on any deployment this app is written for. it is not
 * the guarantee `ENDPOINT_PAGE` above carries: Stripe caps an account's webhook endpoints and
 * documents no cap on registered hostnames
 * (https://docs.stripe.com/api/payment_method_domains/list), so an account holding more than this
 * reports a page rather than everything and a hostname past it reads as unregistered.
 *
 * what that costs is bounded, which is why nothing here paginates. the press for such a hostname
 * registers it, Stripe answers a registration it already holds with the registration it already
 * holds, and the reading that comes back is that object's own — so the press is right where the
 * list was wrong.
 */
const WALLET_DOMAIN_PAGE = 100;

/**
 * why a hostname may not be registered, or nothing.
 *
 * a bare lowercase hostname is the whole of the rule, and the value it exists to catch is an
 * origin: a deployment's sites are stored as origins, so `https://example.org` is what arrives here
 * when a caller hands over the wrong half of one. sent through, that is a registration held under a
 * name no read of this account will ever match, drawing wallets on nothing, and nothing in this
 * port can delete it again.
 *
 * lowercase because the hostname a read answers with is what a caller matches on, and the two have
 * to be the same string. two labels at least, because a wallet is drawn on a site a donor reaches.
 */
const BARE_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

function unusableHost(host: string): PaymentFailure | null {
	if (BARE_HOST.test(host)) return null;

	return {
		ok: false,
		reason: 'invalid_request',
		detail:
			`\`${redactPublicId(host)}\` is not a bare hostname, so it cannot be registered for ` +
			'wallets. Stripe registers a bare lowercase hostname with no scheme, no port and no ' +
			'path, such as `example.org`, and treats `www.example.org` as a separate registration. ' +
			'Register each site’s hostname rather than its origin.'
	};
}

/** seconds to milliseconds. the processor reports unix seconds; everything here is unix ms. */
function atMillis(seconds: number): Date {
	return new Date(seconds * 1000);
}

/**
 * how much of a sentence written by the processor a message of ours may repeat.
 *
 * long enough for the part that names a field, short enough that a response body pasted into a
 * message cannot become the message. the processor's error strings are not a bounded vocabulary —
 * a `SyntaxError` from a failed JSON parse embeds a slice of the body it choked on — so a
 * concatenation with no ceiling is a refusal whose length is decided by whoever sent the body.
 */
const PROVIDER_QUOTE_MAX = 200;

/**
 * anything shaped like a credential, as it may appear inside somebody else's sentence.
 *
 * the live case is the rejected key: the processor describes it by quoting a masked copy of the
 * value that was sent — prefix, asterisks, last four — and that sentence is what lands in a
 * refusal that reaches a 4xx body and /admin. masked is not absent, the prefix names the mode and
 * the account, and ../../redact.ts states the echo policy with no exception for text somebody else
 * wrote.
 *
 * matched on the prefix rather than on the mask, because the mask is a rendering choice upstream
 * is free to change while the prefix is the part that makes it a key at all. `whsec_` is here for
 * the reason it is here at all: it is the value most often pasted into the wrong slot, and a
 * message repeating it back would publish the signing secret.
 */
const CREDENTIAL_SHAPED = /\b(?:sk|rk|pk|whsec)_[A-Za-z0-9*_-]+/g;

/**
 * a sentence written by the processor, made safe to repeat.
 *
 * bounded, flattened to one line, and stripped of anything key-shaped. all three matter and none
 * of them is about tidiness: the ceiling stops a body becoming a message, the flattening keeps a
 * multi-line value out of a single-line log or header, and the substitution is ../../redact.ts's
 * policy applied to text this app did not write.
 *
 * what survives is the part that names a field, which is the only reason to repeat a processor's
 * message at all — CLAUDE.md: a 4xx body names the offending value and where to fix it, and these
 * bodies are read by agents rather than by a person at a terminal.
 */
function quoteProvider(message: string): string {
	const sanitised = message
		.replace(CREDENTIAL_SHAPED, '[redacted credential]')
		.replace(/\s+/g, ' ')
		.trim();
	return sanitised.length <= PROVIDER_QUOTE_MAX
		? sanitised
		: `${sanitised.slice(0, PROVIDER_QUOTE_MAX)}…`;
}

/**
 * why a rail this processor does not settle may not be charged, in the words of whichever path
 * asked.
 *
 * a request carries any rail the form's vocabulary holds and this processor settles four of them
 * (`STRIPE_RAILS` in packages/form/src/embed/rails.ts), so both write paths narrow before their
 * own lookup rather than calling this from inside a guard: `INTENT_METHODS` is total over the four,
 * and a check that answered only with a failure would leave the lookup behind it reaching for a key
 * the table cannot hold.
 *
 * neither path has a fallback behind that narrowing, and what an unsettled rail would cost differs
 * by path. an intent minted for no method is refused by the API; `payment_settings
 * .payment_method_types` takes an empty list as the field being unset, which is a commitment whose
 * every collection is decided by the account's own invoice settings, under a 200.
 *
 * `isStripeRail` reads a list rather than the table's own keys, and never `in`: `in` walks the
 * prototype chain, so `constructor` and `toString` pass it and the lookup behind hands back
 * something off `Object.prototype` — a function spread as a rail list, which throws a `TypeError`
 * out of the adapter. that is a 500 on a public payment-initiating endpoint in place of the 4xx
 * these guards are written to produce, and an untyped caller is precisely who they are for.
 */
function unsettledRail(method: QuotedRail, attempt: string): PaymentFailure {
	return {
		ok: false,
		reason: 'invalid_request',
		detail:
			`method \`${redact(String(method))}\` is not a rail this app can ${attempt}. ` +
			`The rails are ${Object.keys(INTENT_METHODS).join(', ')}, and the value is one a ` +
			'donor picked from what the form offered.'
	};
}

/**
 * why an amount, a currency or a key may not be sent, or nothing.
 *
 * the three checks both write paths share, in one place because the messages are what a caller
 * reads and two copies of a sentence drift into two different explanations of the same field. what
 * is not shared is what each path does beyond them — an intent is held to a rail, a repeating gift
 * to a cadence — so those stay at their own call sites.
 *
 * checked here rather than left to the API, for three reasons. the message names the offending
 * field instead of quoting a processor's error at someone reading a 4xx; the currency check has to
 * run before `toLowerCase()` flattens a value the ledger will later refuse (`/^[A-Z]{3}$/` in
 * ../ledger/posting.ts), which would take the gift and then fail to post it; and a malformed
 * attempt does not burn an idempotency key that the corrected attempt may want.
 *
 * the amount is checked as a positive safe integer and never coerced. minor units are the encoding
 * everywhere in this app (CLAUDE.md) and are exactly what the API takes, so a float arriving here
 * is money arithmetic done in dollars somewhere upstream — rounding it would charge a number
 * nobody computed.
 */
function unusableMoney(request: {
	readonly amountMinor: number;
	readonly currency: string;
	readonly idempotencyKey: string;
}): PaymentFailure | null {
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
			// names an offending value. a currency is not a credential, and this is the field a
			// mis-wired caller can put one in.
			detail:
				`currency \`${redact(request.currency)}\` is not a 3-letter uppercase ISO-4217 code. ` +
				'It is uppercase here and lowercased on the way to Stripe, so that the value stored on ' +
				'the payment and the entry group is the one the ledger accepts.'
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
				'intent that already exists rather than minting a second one, so an attempt without ' +
				'one is an attempt that can double-charge.'
		};
	}

	return null;
}

/**
 * why a repeating gift may not be committed to, or nothing.
 *
 * the same three money checks an intent gets, plus the two facts a commitment has: the cadence it
 * collects at and the rail it collects on. it refuses before the network for the reason `unusable`
 * above does, and one reason more: this arm makes several writes, so a malformed request caught at
 * the second of them leaves the account holding the first — a donor record with no commitment
 * behind it.
 *
 * the rail is not checked here. it is narrowed at the call site instead, for the reason
 * `unsettledRail` above states, and the refusal is that function's.
 */
function unusableGift(request: RecurringGiftRequest): PaymentFailure | null {
	const refusal = unusableMoney(request);
	if (refusal) return refusal;

	// `Object.hasOwn` and never `in`, for `unsettledRail` above's reason: `in` walks the prototype
	// chain, so `toString` passes it and the lookup behind hands back something off
	// `Object.prototype`.
	if (!Object.hasOwn(RECURRING_INTERVALS, request.interval)) {
		return {
			ok: false,
			reason: 'invalid_request',
			detail:
				`interval \`${redact(String(request.interval))}\` is not a cadence this app can charge. ` +
				`The cadences are ${Object.keys(RECURRING_INTERVALS).join(', ')}, and the value is one a ` +
				'donor picked from what the form offered.'
		};
	}

	return null;
}

/**
 * why an endpoint may not be registered for this URL, or nothing.
 *
 * checked here rather than left to the API for the reason `unusable` above is: the message names the
 * value and where it came from, instead of quoting a processor's error at an operator who is looking
 * at a button.
 *
 * `https` is the whole of the rule, and it is the processor's rather than this app's — a live
 * endpoint must be a publicly reachable HTTPS URL
 * (https://docs.stripe.com/webhooks#register-your-endpoint). the case it really catches is an
 * operator pressing the button on a laptop, where the URL the request carries is a localhost one
 * that Stripe could not reach even if it accepted it; the answer there is `stripe listen`, so the
 * message says so.
 */
function unusableEndpointUrl(url: string): PaymentFailure | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return {
			ok: false,
			reason: 'invalid_request',
			detail:
				`\`${redactPublicId(url)}\` is not a URL, so there is nothing to register. This value is ` +
				'the address this deployment was reached at, taken from the request that asked.'
		};
	}

	if (parsed.protocol !== 'https:') {
		return {
			ok: false,
			reason: 'invalid_request',
			detail:
				`\`${redactPublicId(url)}\` is not an \`https://\` URL. Stripe delivers only to a publicly ` +
				'reachable HTTPS endpoint, so a deployment cannot be registered from a laptop. To receive ' +
				'deliveries locally, run `stripe listen --forward-to <this URL>`, which prints a signing ' +
				'secret of its own for `STRIPE_WEBHOOK_SECRET`.'
		};
	}

	return null;
}

/**
 * a thrown value, sorted into this app's vocabulary.
 *
 * on the class the SDK constructs rather than on a status code or a message, because those are
 * the two things upstream is free to reword. the classes are what the package documents and what
 * a caller of this port is really being told apart.
 *
 * the order is load-bearing where the hierarchy is flat. `StripeIdempotencyError`,
 * `StripeCardError` and `StripeSignatureVerificationError` all extend `StripeError` directly
 * rather than `StripeInvalidRequestError`, so each has to be named before the general arm or it
 * falls through to `provider_error` — which this port defines as the processor's own fault and
 * `isRetryable` therefore treats as worth repeating. a key reused against different parameters
 * answers identically every time, so read that way it is an infinite retry against a permanent
 * 400.
 *
 * `StripeAuthenticationError` and `StripePermissionError` become `not_configured` rather than a
 * failure of the call: a key that is rejected or too narrow is a deployment an operator fixes,
 * and reporting it as a provider fault would send them to look at a status page.
 *
 * `StripeCardError` cannot arise from anything this adapter calls — nothing here confirms a
 * payment — so it is mapped rather than modelled: it is the processor refusing a request this app
 * made, which is `invalid_request`, and if one ever appears it is a bug here rather than a donor's
 * card. a decline reaches this app as a `Settlement` whose status is `failed`.
 *
 * every sentence borrowed from the processor goes through `quoteProvider`, never raw.
 */
function classify(error: unknown): PaymentFailure {
	if (error instanceof Stripe.errors.StripeAuthenticationError) {
		return {
			ok: false,
			reason: 'not_configured',
			detail:
				'Stripe rejected this deployment’s credentials: `STRIPE_SECRET_KEY` is not a key this ' +
				`account accepts. Stripe said: ${quoteProvider(error.message)}`
		};
	}

	if (error instanceof Stripe.errors.StripePermissionError) {
		return {
			ok: false,
			reason: 'not_configured',
			detail:
				'Stripe accepted this deployment’s key and refused the call: `STRIPE_SECRET_KEY` is a ' +
				`restricted key without the permissions this app needs. Stripe said: ${quoteProvider(error.message)}`
		};
	}

	if (error instanceof Stripe.errors.StripeRateLimitError) {
		return {
			ok: false,
			reason: 'rate_limited',
			detail: `Stripe is rate limiting this account. Stripe said: ${quoteProvider(error.message)}`
		};
	}

	if (error instanceof Stripe.errors.StripeConnectionError) {
		return {
			ok: false,
			reason: 'unreachable',
			detail:
				'No answer came back from Stripe, so whether this call took effect is unknown. Making ' +
				'the identical call again under the same idempotency key is what settles it. ' +
				`The transport said: ${quoteProvider(error.message)}`
		};
	}

	if (error instanceof Stripe.errors.StripeIdempotencyError) {
		return {
			ok: false,
			reason: 'invalid_request',
			detail:
				'Stripe refused this idempotencyKey: it has already been used for a request with ' +
				'different parameters. One key belongs to one attempt at one amount, so this is a bug ' +
				`in how the key is derived and repeating the call answers the same way. Stripe said: ${quoteProvider(error.message)}`
		};
	}

	if (error instanceof Stripe.errors.StripeCardError) {
		return {
			ok: false,
			reason: 'invalid_request',
			detail:
				'Stripe returned a card error to a call that does not charge a card, which means the ' +
				`request itself was wrong rather than any donor’s card. Stripe said: ${quoteProvider(error.message)}`
		};
	}

	if (error instanceof Stripe.errors.StripeInvalidRequestError) {
		return error.code === 'resource_missing'
			? {
					ok: false,
					reason: 'not_found',
					detail: `Stripe has no such object on this account. Stripe said: ${quoteProvider(error.message)}`
				}
			: {
					ok: false,
					reason: 'invalid_request',
					detail: `Stripe refused the request as malformed. Stripe said: ${quoteProvider(error.message)}`
				};
	}

	if (error instanceof Stripe.errors.StripeError) {
		return {
			ok: false,
			reason: 'provider_error',
			detail: `Stripe failed on its own side. Stripe said: ${quoteProvider(error.message)}`
		};
	}

	// not a Stripe error at all, so nothing may be assumed about it — including that reading its
	// `message` is safe. the seal in ./provider.ts is what this is handed to.
	throw error;
}

/**
 * an expandable field, told apart from an id string that was never expanded.
 *
 * three answers rather than two, because the two failures are not the same failure and only one of
 * them is ordinary. `absent` is a charge that does not exist yet, which is most of an intent's
 * life. `unexpanded` is the request having gone out without its `expand`, which is a bug here —
 * and collapsed onto `absent` it would read as a settlement with no fee under a clean 200, which
 * is the shape that never gets noticed.
 */
function expansionOf<T extends object>(
	field: string | T | null | undefined
): { readonly kind: 'object'; readonly value: T } | { readonly kind: 'absent' | 'unexpanded' } {
	if (typeof field === 'string') return { kind: 'unexpanded' };
	return field ? { kind: 'object', value: field } : { kind: 'absent' };
}

/**
 * seven processor intent states onto this schema's four (`PAYMENT_STATUSES` in ../db/schema.ts).
 *
 * `requires_payment_method` is the one that is two states wearing one name: an intent sits there
 * both before anyone has tried to pay and again after a rail refused, and `last_payment_error` is
 * the only thing that separates them. read as a single state, every decline would be recorded as a
 * gift still on its way.
 *
 * everything not terminal is `pending`, including the states this app does not use, so a state
 * added upstream is recorded as money still in flight rather than as an outcome — the direction
 * that is safe to be wrong in, since the next read corrects it and no posting is made on it.
 */
function settlementStatus(intent: Stripe.PaymentIntent): PaymentStatus {
	if (intent.status === 'succeeded') return 'succeeded';
	if (intent.status === 'canceled') return 'cancelled';
	if (intent.status === 'requires_payment_method' && intent.last_payment_error) return 'failed';
	return 'pending';
}

/**
 * the processor's word for how a commitment is going, onto this port's four.
 *
 * anything the table does not hold reads `pending`, which includes the states this app never
 * produces. the same shape `settlementStatus` above keeps and pointed the same way: an unknown state
 * is money not yet accounted for rather than an outcome, so nothing is posted on it and the next
 * read corrects it.
 */
function recurringState(status: string): RecurringGiftState {
	return RECURRING_STATES[status] ?? 'pending';
}

/**
 * a commitment as a delivery about it is reported, with the collection it was about beside it.
 *
 * one mapper for both reads, because the two deliveries differ only in what they carry a transaction
 * for: a collection names one and the commitment's own standing names none. written twice, the state
 * a gift is recorded in would depend on which event reached the handler.
 */
function noticeOf(
	committed: Stripe.Subscription,
	about: 'collection' | 'commitment',
	providerTxnId: string | null
): RecurringGiftNotice {
	return {
		about,
		providerGiftId: committed.id,
		// `customer` is an id on an unexpanded read and an object where something else asked for it
		// to be expanded; a deleted customer is still an object with an id on it. the id is what the
		// commitment's row stores either way, so both shapes collapse here rather than at the caller.
		providerCustomerId:
			typeof committed.customer === 'string' ? committed.customer : committed.customer.id,
		state: recurringState(committed.status),
		interval: cadenceOf(committed),
		metadata: committed.metadata ?? {},
		nextChargeAt: nextChargeOf(committed),
		providerTxnId,
		endedAt: stoppedAt(committed)
	};
}

/**
 * how often the processor's schedule says a commitment collects, in this app's own vocabulary.
 *
 * read off the item's price, which is where the cadence lives — the same item `nextChargeOf` below
 * takes the period from, and a commitment this app created has exactly one.
 *
 * `interval_count` has to be one, and that is the check that keeps this honest rather than
 * convenient: a price billing every three months is `month` with a count of 3, so reading the unit
 * alone would report a quarterly commitment as monthly and every screen would then say so. a count
 * this app does not model reports nothing, exactly as an interval it does not model does.
 */
function cadenceOf(committed: Stripe.Subscription): RecurringInterval | null {
	const recurring = committed.items?.data[0]?.price?.recurring;
	if (recurring?.interval_count !== 1) return null;
	return CADENCES[recurring.interval] ?? null;
}

/**
 * the processor's own words for a cadence, onto `RECURRING_INTERVALS` (../db/schema.ts).
 *
 * the reverse of `RECURRING_INTERVALS` above, which is what `createRecurringGift` sends. spelled
 * separately rather than derived from it, because the two are not the same map: this one is total
 * over everything the processor can say — `day` and `week` included — and answers nothing for the
 * ones this app cannot hold.
 */
const CADENCES: Readonly<Record<string, RecurringInterval>> = Object.freeze({
	month: 'monthly',
	year: 'yearly'
});

/**
 * when the processor expects to collect next, off the item that holds the schedule.
 *
 * the period sits on the subscription's items on this API version rather than on the subscription
 * itself, and a commitment this app creates has exactly one item — the price carrying the whole
 * gift, at quantity one (`createRecurringGift` below). so the first item is the schedule, and a
 * commitment with no items at all reports nothing rather than a date invented for it.
 */
function nextChargeOf(committed: Stripe.Subscription): Date | null {
	const at = committed.items?.data[0]?.current_period_end;
	return typeof at === 'number' ? atMillis(at) : null;
}

/**
 * when collection stopped, where the processor records that it has.
 *
 * two fields and not one. a commitment the processor gave up on is `unpaid` with neither set — it
 * has stopped collecting and has not ended — so this is null on a gift that has lapsed rather than
 * been cancelled, and `RecurringGiftNotice.endedAt` in ./provider.ts says what a caller does with
 * that. the ordering is the one `cancelRecurringGift` uses: the end, then the cancellation that
 * caused it.
 */
function stoppedAt(committed: Stripe.Subscription): Date | null {
	const at = committed.ended_at ?? committed.canceled_at;
	return typeof at === 'number' ? atMillis(at) : null;
}

/**
 * the transaction a collection was attempted on, out of the attempts its invoice lists.
 *
 * the paid attempt wins, and the most recent one is the answer when none of them is paid — which is
 * the pair of readings the two subscribed collection events need: a gift that was collected names
 * the charge that worked, and one that failed names the attempt that just failed rather than an
 * older one that failed before it. `created` is compared rather than the list's order, so nothing
 * here rests on the order Stripe happens to return them in.
 *
 * an attempt that is not a payment intent is passed over rather than reported: an invoice can be
 * settled outside the processor and marked paid, and there is no transaction to read a fee off.
 * `RecurringGiftNotice.providerTxnId` in ./provider.ts is where that null is explained.
 */
function collectedOn(collected: Stripe.Invoice): string | null {
	let latest: { readonly at: number; readonly id: string } | null = null;

	for (const attempt of collected.payments?.data ?? []) {
		const intent = attempt.payment.payment_intent;
		const id = typeof intent === 'string' ? intent : intent?.id;
		if (!id) continue;
		if (attempt.status === 'paid') return id;
		if (!latest || attempt.created > latest.at) latest = { at: attempt.created, id };
	}

	return latest?.id ?? null;
}

/**
 * why a price found under this app's own lookup key may not be charged against, or nothing.
 *
 * a lookup key belongs to one price at a time and can be moved between them, so what comes back
 * under a key is the processor's answer rather than this app's own object. every field the key
 * claims is checked against the price that arrived, because the failure this prevents is the one
 * that never surfaces: a commitment created against a price for some other amount charges the wrong
 * figure every interval, correctly, forever.
 */
function mismatchedPrice(
	found: Stripe.Price,
	wanted: {
		readonly lookupKey: string;
		readonly currency: string;
		readonly interval: 'month' | 'year';
		readonly amountMinor: number;
	}
): PaymentFailure | null {
	const product = typeof found.product === 'string' ? found.product : found.product.id;
	const agrees =
		found.active &&
		found.unit_amount === wanted.amountMinor &&
		found.currency === wanted.currency &&
		found.recurring?.interval === wanted.interval &&
		found.recurring?.interval_count === 1 &&
		product === RECURRING_PRODUCT_ID;

	if (agrees) return null;

	return {
		ok: false,
		reason: 'provider_error',
		// the price is named and its contents are not. what went wrong is that the key points
		// somewhere unexpected, and quoting the figure it points at would put one account's pricing
		// into a message that reaches a 4xx body.
		detail:
			`Stripe’s price ${redactPublicId(found.id)} answers to the lookup key ` +
			`\`${redactPublicId(wanted.lookupKey)}\` and is not the price that key describes, so no ` +
			'repeating gift was committed to and nothing was charged. The key is derived from the ' +
			'cadence, the currency and the amount, so a price answering to it that does not match them ' +
			'has had the key moved onto it. Move it back, or delete the key from that price in the ' +
			'Stripe dashboard and this app will make the right one.'
	};
}

/**
 * what the processor took, in the currency the gift was charged in.
 *
 * the balance transaction is denominated in the account's settlement currency, which need not be
 * the currency the donor was charged in, and an entry group holds exactly one currency
 * (../ledger/posting.ts) — so a fee that settled in another one arrives in the gift's currency or
 * not at all. it is converted rather than dropped because that is the case most likely to have been
 * mispriced: a foreign card is exactly where the processor's real fee exceeds the rule ./fees.ts
 * quotes from, and a fee that never posts leaves `1020 Undeposited Funds` overstated by it with no
 * error anywhere (../donations/entries.ts).
 *
 * the rate runs from the charged currency to the settlement currency: the `amount` in the charged
 * currency multiplied by `exchange_rate` is the `amount` in the settlement currency
 * (https://docs.stripe.com/api/balance_transactions/object). so a fee stated in the settlement
 * currency is divided by it and never multiplied. worked: a gift charged 10.00 EUR settles to 12.34
 * USD, `exchange_rate` is 1.234, and a fee of 66 USD cents is 66 / 1.234 = 53 EUR cents. multiplied
 * instead it reads 81, which is a plausible figure no total downstream disagrees with — which is
 * why ./stripe.spec.ts asserts the arithmetic and not merely that something came back.
 *
 * no usable rate is no figure. `exchange_rate` is null on a transaction that converted nothing, so
 * a cross-currency fee without one is a conversion this app cannot do — null, which
 * ../donations/settle.ts already answers by telling an operator the gift posted with no processor
 * fee. never the unconverted figure, which would balance arithmetically and be wrong by the rate,
 * and never a zero, which claims the processor took nothing.
 *
 * rounded to whole minor units, because that is what the ledger takes. the residual is at most half
 * a minor unit against the processor's own statement.
 */
/**
 * one transaction as the port carries it, off the three objects one retrieve brings back.
 *
 * a function rather than the body of the read arm, because that arm reads the transaction more than
 * once — see `FEE_ATTEMPTS` — and a mapping written inside the loop would be a mapping written per
 * exit from it, with nothing holding the exits to agreeing about a currency's case or a fee's sign.
 */
function settlementOf(
	intent: Stripe.PaymentIntent,
	charge: Stripe.Charge | null,
	balance: Stripe.BalanceTransaction | null
): Settlement {
	const currency = intent.currency.toUpperCase();
	return {
		providerTxnId: intent.id,
		status: settlementStatus(intent),
		// what the processor says settled it, never what the donor picked beforehand.
		method: charge ? (SETTLED_METHODS[charge.payment_method_details?.type ?? ''] ?? null) : null,
		// the charge's amount where there is one, because that is what actually moved; the intent's
		// before any charge exists. this app never partially captures, so the two agree — a divergence
		// is the signal that assumption stopped holding.
		amountMinor: charge?.amount ?? intent.amount,
		currency,
		feeMinor: feeOf(balance, currency),
		metadata: intent.metadata ?? {},
		// the balance transaction's time is when the money reached the account, which is the date a
		// reconciler matches against a statement. before there is one, the charge's; before that, the
		// intent's, so this is never absent and never a guess dressed as a date.
		occurredAt: atMillis(balance?.created ?? charge?.created ?? intent.created)
	};
}

function feeOf(balance: Stripe.BalanceTransaction | null, currency: string): number | null {
	if (!balance) return null;
	if (balance.currency.toUpperCase() === currency) return balance.fee;

	const rate = balance.exchange_rate;
	if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
	return Math.round(balance.fee / rate);
}

/**
 * one capability off the account, in the port's vocabulary.
 *
 * absent is a state rather than a missing value, and it is the reason this is a function instead of
 * a field read. Stripe reports a capability the account never asked for by leaving it out of the
 * hash entirely, so `undefined` here is the answer rather than the absence of one — and read as
 * `inactive` it would tell an operator that a rail was refused when nobody ever applied for it.
 *
 * anything outside the set is read as `inactive`, which is the direction that is safe to be wrong
 * in: `active` is the only state a caller may act on, so it is the one state that may never come out
 * of a value this app does not recognise. that is the same reasoning `settlementStatus` above is
 * written from, pointed the same way.
 */
function railCapabilityState(status: string | undefined): RailCapabilityState {
	if (status === undefined) return 'unrequested';
	return (RAIL_CAPABILITY_STATES as readonly string[]).includes(status)
		? (status as RailCapabilityState)
		: 'inactive';
}

/**
 * a registered endpoint, in the port's vocabulary and stripped of what the port does not carry.
 *
 * it reads six fields off a wider object, and the omissions are the point. `secret` is
 * the one that must not travel: it is populated on the answer to a create and absent from every
 * other read (https://docs.stripe.com/api/webhook_endpoints/create), so a mapper that copied
 * whatever was there would put a credential into the value a screen renders a list from — and
 * ./stripe.spec.ts holds it to dropping one that arrives where none should be.
 *
 * the fingerprint is the one field read out of metadata, and it is read rather than trusted: an
 * operator can type anything into that map from the dashboard, so a value that is not a non-empty
 * string is no stamp at all. what it is for is
 * `packages/operator/src/stripe/secret-fingerprint.ts`'s header.
 *
 * `status` is a string on the object rather than a closed union, so it is read as the one state that
 * matters — delivering — and anything else, including a state Stripe adds later, is not that.
 */
function summarise(registered: Stripe.WebhookEndpoint): WebhookEndpointSummary {
	const stamped = registered.metadata?.[FINGERPRINT_METADATA_KEY];
	return {
		id: registered.id,
		url: registered.url,
		enabled: registered.status === 'enabled',
		eventTypes: [...registered.enabled_events],
		apiVersion: registered.api_version,
		verificationStamp: typeof stamped === 'string' && stamped !== '' ? stamped : null
	};
}

/**
 * one wallet's block on a registered hostname, in the port's vocabulary.
 *
 * `active` and nothing else is active. the SDK types this field as its two words or any other
 * string, so a word Stripe adds later lands on `inactive` — `WALLET_STATES` in ./provider.ts is
 * where that direction is argued. an absent block is the same answer for the same reason.
 *
 * the sentence rides through `quoteProvider` like every other borrowed one. it describes the
 * operator's own domain rather than anything about a key, so nothing is withheld from it — but it
 * is prose this app did not write, on its way to a screen and to a 4xx body, so the ceiling, the
 * flattening and the credential strip all apply. an empty string is no sentence and reads as null,
 * because a screen drawing an empty line under a wallet is a screen claiming Stripe said something.
 */
function walletStanding(
	block: { status: string; status_details?: { error_message: string } } | undefined
): WalletStanding {
	const said = block?.status_details?.error_message;
	const detail = typeof said === 'string' ? quoteProvider(said) : '';

	return {
		state: block?.status === 'active' ? 'active' : 'inactive',
		detail: detail === '' ? null : detail
	};
}

/**
 * a registered hostname, in the port's vocabulary and stripped of what the port does not carry.
 *
 * the id is the omission that matters: it is what switching a hostname back on takes, and
 * `registerWalletDomain` does that from the hostname, so nothing outside this module ever holds
 * one. the three wallets are read by name and Stripe's other blocks are dropped rather than
 * carried, which is `WALLETS` in ./provider.ts's rule — and the hash is written out rather than
 * built by a loop so that a wallet added to that list stops this compiling.
 */
function summariseDomain(registered: Stripe.PaymentMethodDomain): WalletDomain {
	return {
		host: registered.domain_name,
		enabled: registered.enabled,
		wallets: {
			apple_pay: walletStanding(registered.apple_pay),
			google_pay: walletStanding(registered.google_pay),
			link: walletStanding(registered.link)
		}
	};
}

/**
 * a thrown value's message, without becoming a throw site.
 *
 * reading `.message` off an arbitrary value runs whatever getter the thrower supplied, and this
 * is called from a `catch` on the money path. the fallback is deliberately uninformative rather
 * than a serialisation attempt, which would have the same problem.
 */
function messageOf(error: unknown): string {
	try {
		return error instanceof Error ? error.message : String(error);
	} catch {
		return 'an error that could not be described';
	}
}

/**
 * the seam a test reaches through, and nothing production ever passes.
 *
 * both fields exist for one reason: every mistake worth catching in this module is in what goes on
 * the wire, and the only honest way to assert that is to let the real SDK encode a real request.
 * the same reason `createSmtpProvider` in ../email/smtp.ts takes a loader.
 *
 * `host` is what lets ./stripe.workers.spec.ts point the *default* client — the one production
 * builds — at an address that cannot answer, and check that the failure arrives as `unreachable`.
 * without it, every spec would inject `httpClient` and nothing would ever construct the client
 * this app actually ships.
 */
export type StripeSeam = {
	readonly httpClient?: Stripe.HttpClient;
	readonly host?: string;
};

/**
 * a `Stripe` client and the port over it, built per call from a request's own credentials.
 *
 * never a module-scope singleton — the secret only exists on a request's `platform.env`
 * (CLAUDE.md), so a cached client is a cached copy of one deployment's environment. this is the
 * `createAuth(db, …)` shape ../auth/index.ts holds, and ../db/client.ts's `createDb(d1)`.
 *
 * two options make it work on workerd, and both are passed explicitly rather than left to the
 * SDK's platform detection, so that this module is correct whichever build of the package a
 * bundler resolves:
 *
 *   - `httpClient` — the fetch client, which is what workerd has. a client built on node's
 *     `http`/`https` modules constructs happily here and throws on every call in production.
 *   - the crypto provider handed to `constructEventAsync` in `verifyEvent`, for the same reason
 *     the synchronous `constructEvent` is never called: it wants node's crypto and throws there.
 *
 * neither claim is left to this comment. ./stripe.workers.spec.ts builds a provider with no seam
 * at all and exercises both inside workerd, which is the only place either can be observed —
 * under node both work whether or not they are the ones production would use.
 *
 * `maxNetworkRetries: 0`, deliberately. the SDK's own retry cannot know whether the caller wants
 * one, and every retry that matters here is the caller's to make under the same
 * `IntentRequest.idempotencyKey` — a retry underneath this port is one nothing above it can see
 * or bound.
 */
export function createStripeProvider(
	credentials: StripeCredentials,
	seam?: StripeSeam
): PaymentProvider {
	const stripe = new Stripe(credentials.secretKey, {
		apiVersion: API_VERSION,
		httpClient: seam?.httpClient ?? Stripe.createFetchHttpClient(),
		maxNetworkRetries: 0,
		timeout: TIMEOUT_MS,
		typescript: true,
		...(seam?.host ? { host: seam.host } : {})
	});
	const cryptoProvider = Stripe.createSubtleCryptoProvider();

	/**
	 * the create both endpoint arms are built out of, written once.
	 *
	 * what it must never become is two creates. the subscription list and the pinned version are the
	 * whole of what makes an endpoint a working one, and an endpoint registered by the recovery path
	 * with a different list from the one the setup path uses is a deployment that works until
	 * somebody's secret goes missing.
	 */
	async function createEndpoint(url: string): Promise<PaymentResult<RegisteredWebhookEndpoint>> {
		try {
			const created = await stripe.webhookEndpoints.create({
				url,
				// exactly what this app acts on, and nothing else. Stripe's own guidance is to
				// subscribe only to what the integration handles — every other delivery is a request
				// this deployment answers and discards.
				enabled_events: [...SUBSCRIBED_EVENT_TYPES],
				// pinned, so deliveries to this endpoint are serialised in the version this app reads
				// them against rather than in whatever version the account happens to be set to.
				api_version: API_VERSION,
				description: ENDPOINT_DESCRIPTION
			});

			if (!created.secret) {
				return {
					ok: false,
					reason: 'provider_error',
					// the endpoint exists at this point, and saying so is the whole of the message: an
					// operator who reads this and presses the button again is refused for a URL that is
					// already registered, with no way left to reach the secret of the thing they made.
					detail:
						`Stripe registered webhook endpoint ${redactPublicId(created.id)} and returned no ` +
						'signing secret, so there is nothing to set `STRIPE_WEBHOOK_SECRET` to and no way to ' +
						'ask for it again. The endpoint exists and is subscribed; replace it to get one whose ' +
						'secret is known.'
				};
			}

			// the stamp that lets a console tell this deployment's stored secret from the one before
			// it — `packages/operator/src/stripe/secret-fingerprint.ts`'s header is the whole of why. it is a second call because
			// the value being stamped does not exist until the create above answers, and Stripe
			// accepts no caller-chosen secret to stamp in advance.
			//
			// a stamp that could not be written is swallowed, and that is the direction to be wrong
			// in: the caller is holding the only copy of a signing secret there will ever be, so a
			// refusal here takes it off the operator's screen over a value whose only job is telling
			// them later whether they set it. unstamped, the endpoint reads as one the console cannot
			// confirm — where every hand-registered endpoint already sits.
			const stamped = await stampFingerprint(created.id, created.secret);

			return {
				ok: true,
				value: { endpoint: summarise(stamped ?? created), verificationValue: created.secret }
			};
		} catch (error) {
			return classify(error);
		}
	}

	/**
	 * writes the secret's fingerprint onto the endpoint it belongs to, or answers null.
	 *
	 * no idempotency key: this is an update rather than a create, so a repeat writes the same value
	 * onto the same object. the metadata is sent as one key rather than as a replacement map, which
	 * is Stripe's own merge behaviour for the field — an endpoint carrying something an operator put
	 * there keeps it.
	 */
	async function stampFingerprint(
		id: string,
		secret: string
	): Promise<Stripe.WebhookEndpoint | null> {
		const fingerprint = await secretFingerprint(secret);
		if (fingerprint === null) return null;

		try {
			return await stripe.webhookEndpoints.update(id, {
				metadata: { [FINGERPRINT_METADATA_KEY]: fingerprint }
			});
		} catch {
			return null;
		}
	}

	/**
	 * what the account holds for repeating gifts, asked and not touched.
	 *
	 * one retrieve of the derived id, and the three answers it can give. `resource_missing` is the
	 * only error that is a reading rather than a failure: anything else means the account could not be
	 * asked. reported as `absent` it would draw a setup button over an account nobody can reach — and
	 * creating a product on the strength of a rejected key is how an account acquires one per outage.
	 *
	 * both arms below are built on this, so what the console reads and what a donor's first
	 * repeating gift finds are one call with one interpretation. the difference is only in what each
	 * does about an answer.
	 */
	async function readRecurringProduct(): Promise<PaymentResult<RecurringGiftStanding>> {
		try {
			const found = await stripe.products.retrieve(RECURRING_PRODUCT_ID);
			// archived, which Stripe reports rather than refuses: the object is there and no price may
			// be added to it.
			return { ok: true, value: found.active ? 'ready' : 'archived' };
		} catch (error) {
			if (
				error instanceof Stripe.errors.StripeInvalidRequestError &&
				error.code === 'resource_missing'
			) {
				return { ok: true, value: 'absent' };
			}
			return classify(error);
		}
	}

	/**
	 * the one product every repeating gift is charged against, found or made.
	 *
	 * a retrieve of a known id rather than a walk of the account's catalogue. the id is this app's
	 * own (`RECURRING_PRODUCT_ID` above), so there is one address to ask about and no page two to
	 * miss — and a missed page is a second product minted beside the live one, which is the failure
	 * that only shows up in a reconciliation months later.
	 *
	 * a create that comes back saying the id is taken is the answer rather than a failure: the id is
	 * derived, so nothing else could have taken it, and two requests arriving together is the
	 * ordinary way that happens. the loser of that race is holding exactly what it asked for.
	 */
	async function ensureRecurringProduct(): Promise<PaymentResult<RecurringGiftProvision>> {
		const standing = await readRecurringProduct();
		if (!standing.ok) return standing;

		// archived, which Stripe reports rather than refuses. a price cannot be added to an inactive
		// product, so left unnamed here it is a repeating gift refused at the price call with a
		// sentence about a product the operator never chose an id for.
		if (standing.value === 'archived') {
			return {
				ok: false,
				reason: 'invalid_request',
				detail:
					`Stripe’s product ${redactPublicId(RECURRING_PRODUCT_ID)} is archived, so no repeating ` +
					'gift can be charged against it. Unarchive it in the Stripe dashboard, under Product ' +
					'catalogue. It is not replaced here: every gift already repeating is charged against ' +
					'that product, and a new one would leave them charged against the archived one.'
			};
		}

		if (standing.value === 'ready') return { ok: true, value: { created: false } };

		try {
			await stripe.products.create({
				id: RECURRING_PRODUCT_ID,
				name: RECURRING_PRODUCT_NAME,
				description: RECURRING_PRODUCT_DESCRIPTION
			});
			return { ok: true, value: { created: true } };
		} catch (error) {
			if (
				error instanceof Stripe.errors.StripeInvalidRequestError &&
				error.code === 'resource_already_exists'
			) {
				return { ok: true, value: { created: false } };
			}
			return classify(error);
		}
	}

	/**
	 * the price this cadence, currency and amount is charged at, looked up before it is made.
	 *
	 * the lookup is first and the product is only reached for when it misses, which is the ordinary
	 * order rather than an optimisation: a price that answers to the key already names the product it
	 * belongs to, and `mismatchedPrice` checks that it is this app's — so asking about the product
	 * beforehand would be a round trip to learn something the next answer carries.
	 *
	 * the create is keyed off the lookup key rather than off the caller's, and that is deliberate.
	 * the parameters are the same for every donor giving this amount at this cadence, so two of them
	 * arriving together resolve to one price instead of racing to make two — a caller's own key would
	 * make each of them a first attempt.
	 */
	async function findOrCreatePrice(request: RecurringGiftRequest): Promise<PaymentResult<string>> {
		const lookupKey = priceLookupKey(request.interval, request.currency, request.amountMinor);
		const currency = request.currency.toLowerCase();
		const interval = RECURRING_INTERVALS[request.interval];

		try {
			const page = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
			const found = page.data[0];
			if (found) {
				const mismatch = mismatchedPrice(found, {
					lookupKey,
					currency,
					interval,
					amountMinor: request.amountMinor
				});
				return mismatch ?? { ok: true, value: found.id };
			}
		} catch (error) {
			return classify(error);
		}

		const provisioned = await ensureRecurringProduct();
		if (!provisioned.ok) return provisioned;

		try {
			const created = await stripe.prices.create(
				{
					product: RECURRING_PRODUCT_ID,
					currency,
					// the gift's own amount, in the minor units it is held in everywhere else in this app
					// (CLAUDE.md). the price is what is charged and the quantity is left at one, so a gift
					// with cents in it survives being made to repeat.
					unit_amount: request.amountMinor,
					recurring: { interval, interval_count: 1 },
					lookup_key: lookupKey,
					// the key belongs to one price at a time, and a price this app made can be archived
					// from the dashboard — after which the lookup no longer finds it and the create is
					// refused for a key that is taken. transferring it makes that state self-repairing:
					// the new price answers to the key and every commitment already charged against the
					// old one is untouched, because a price's amount cannot change.
					transfer_lookup_key: true
				},
				{ idempotencyKey: `${DERIVED_KEY}:price:${lookupKey}` }
			);
			return { ok: true, value: created.id };
		} catch (error) {
			return classify(error);
		}
	}

	/**
	 * one collection, resolved to the commitment it belongs to and the transaction it was paid on.
	 *
	 * one round trip for both facts, and both of them are asked for. this runs on workerd, where
	 * every delivery is answered inside a request budget, so the whole answer is one retrieve with two
	 * expansions on it rather than a walk from invoice to subscription to charge.
	 *
	 * the subscription is expanded rather than read as an id and retrieved, because the id alone is
	 * not the answer: what a caller needs is the state the commitment is in now, and a second
	 * retrieve to learn it would be a second subrequest for something the first can carry.
	 *
	 * `payments` is expanded because it is an *includable* property rather than an included one —
	 * Stripe's own word for a sub-list that arrives only when the request asks for it
	 * (https://docs.stripe.com/api/invoices/object). left off, the invoice comes back with no attempts
	 * on it at all, every collection reports no transaction, and that reads as a gift settled outside
	 * Stripe rather than as a request missing a parameter.
	 */
	async function readCollection(invoiceId: string): Promise<PaymentResult<RecurringGiftNotice>> {
		try {
			const collected = await stripe.invoices.retrieve(invoiceId, {
				expand: ['parent.subscription_details.subscription', 'payments']
			});

			// where this API version keeps it. an invoice's own `subscription` field is not read
			// anywhere here, and a delivery replayed from an account on an older version is answered
			// by this read rather than by the shape that arrived — which is the whole reason nothing
			// is taken off the event body.
			const commitment = expansionOf<Stripe.Subscription>(
				collected.parent?.subscription_details?.subscription
			);

			if (commitment.kind === 'unexpanded') {
				return {
					ok: false,
					reason: 'provider_error',
					detail:
						`Stripe returned the subscription on invoice ${redactPublicId(collected.id)} as an id ` +
						'rather than an object, so which repeating gift this collection belongs to could not ' +
						'be read and nothing was recorded. The retrieve went out without its `expand`, which ' +
						'is a bug in this app rather than anything about the gift.'
				};
			}

			if (commitment.kind !== 'object') {
				return {
					ok: false,
					reason: 'not_found',
					// named rather than reported as an empty answer, because this is the one shape here
					// that is nobody's fault: an invoice raised by hand on the same Stripe account is a
					// real thing an org does, and it is not a repeating gift.
					detail:
						`Stripe’s invoice ${redactPublicId(collected.id)} was not raised by a subscription, so ` +
						'there is no repeating gift behind it and nothing was recorded. An invoice made by ' +
						'hand on this Stripe account reaches this endpoint the same way a repeating gift’s ' +
						'does; only the second is a gift this app keeps books for.'
				};
			}

			return { ok: true, value: noticeOf(commitment.value, 'collection', collectedOn(collected)) };
		} catch (error) {
			return classify(error);
		}
	}

	/**
	 * the commitment itself, read for the state it is in now.
	 *
	 * no `expand` and no collection: these deliveries are the gift's own standing changing, and the
	 * money that did or did not move is a collection event of its own. a cancelled commitment is still
	 * retrievable, which is what makes this the read for the delivery that says it ended.
	 */
	async function readCommitment(giftId: string): Promise<PaymentResult<RecurringGiftNotice>> {
		try {
			return {
				ok: true,
				value: noticeOf(await stripe.subscriptions.retrieve(giftId), 'commitment', null)
			};
		} catch (error) {
			return classify(error);
		}
	}

	return {
		processor: 'stripe',

		async prepareRecurringGifts(): Promise<PaymentResult<RecurringGiftProvision>> {
			return ensureRecurringProduct();
		},

		async readRecurringGiftProvision(): Promise<PaymentResult<RecurringGiftStanding>> {
			return readRecurringProduct();
		},

		async createRecurringGift(
			request: RecurringGiftRequest
		): Promise<PaymentResult<RecurringGift>> {
			const refusal = unusableGift(request);
			if (refusal) return refusal;
			if (!isStripeRail(request.method)) {
				return unsettledRail(request.method, 'commit a repeating gift on');
			}

			const priced = await findOrCreatePrice(request);
			if (!priced.ok) return priced;

			let donorId: string;
			try {
				// the donor's record, holding nothing. a commitment must name a customer, and this call
				// is the only thing that knows the donor has no record yet — but no payment method is
				// attached here, because none exists: the donor confirms this gift's first collection
				// afterwards, and the processor attaches what they used.
				const donor = await stripe.customers.create(
					{},
					{ idempotencyKey: `${DERIVED_KEY}:donor:${request.idempotencyKey}` }
				);
				donorId = donor.id;
			} catch (error) {
				return classify(error);
			}

			let committed: Stripe.Subscription;
			try {
				committed = await stripe.subscriptions.create(
					{
						customer: donorId,
						// one item at quantity one, which is what carrying the amount on the price buys.
						// a quantity here would multiply a figure that is already the whole gift.
						items: [{ price: priced.value }],
						currency: request.currency.toLowerCase(),
						// nothing is charged by this call. the commitment is created awaiting payment and
						// its first invoice carries a secret the donor's browser confirms, which is what
						// lets a repeating gift be confirmed by exactly the code that confirms a one-off
						// one (https://docs.stripe.com/api/subscriptions/create — `payment_behavior`).
						// the donor is at their browser throughout, so nothing here is off-session.
						payment_behavior: 'default_incomplete',
						payment_settings: {
							// the method the donor confirms with becomes the commitment's default, which is
							// what every collection after the first is charged against. without it a
							// confirmed gift collects once and then has nothing to charge.
							save_default_payment_method: 'on_subscription',
							// the commitment is collectable only on the rail the donor was quoted on, for
							// the reason `createIntent` below names — with the difference that this prices
							// every collection rather than one. absent, what the commitment may be
							// collected on is the account's own invoice settings
							// (https://docs.stripe.com/billing/subscriptions/payment-methods-setting), so
							// the deployment stops deciding: what a rail arriving here is allowed to be is
							// ./rail-chargeability.ts's, enforced by the caller.
							//
							// no fallback behind the lookup. the field takes an empty list as itself being
							// unset, so a rail with no mapping falling through to `[]` is that same
							// dashboard-decided commitment wearing a 200 — `unusableGift` refuses it in
							// front of this instead.
							payment_method_types: [...INTENT_METHODS[request.method]]
						},
						// the secret is not on the answer unless it is asked for, and this call is the
						// only chance to ask: it is read straight back out below and handed to the browser.
						expand: ['latest_invoice.confirmation_secret'],
						// the anchor for every charge after the first. the processor mints a repeat charge
						// carrying none of the metadata the opening one had, so what the commitment holds
						// is the only thing tying charge fifty back to the gift it belongs to.
						...(request.metadata ? { metadata: { ...request.metadata } } : {})
					},
					{ idempotencyKey: `${DERIVED_KEY}:gift:${request.idempotencyKey}` }
				);
			} catch (error) {
				return classify(error);
			}

			const invoice = expansionOf<Stripe.Invoice>(committed.latest_invoice);
			if (invoice.kind === 'unexpanded') {
				return {
					ok: false,
					reason: 'provider_error',
					// the same fault `unexpanded` below reports on the settlement read, and it cannot
					// share that function: this one costs a donor their gift rather than a fee figure, so
					// what it has to say is different.
					detail:
						`Stripe returned \`latest_invoice\` on subscription ${redactPublicId(committed.id)} as an ` +
						'id rather than an object, so the donor has nothing to confirm the first collection ' +
						'with and nothing was charged. The create went out without its `expand`, which is a ' +
						'bug in this app rather than anything about the gift.'
				};
			}

			const paymentToken =
				invoice.kind === 'object' ? invoice.value.confirmation_secret?.client_secret : null;
			if (!paymentToken) {
				// the commitment exists at this point and is collecting nothing, which is the one state
				// of this call a caller cannot infer from a bare failure. it needs no cleaning up: a
				// commitment nobody confirms is abandoned by Stripe 23 hours after it was made
				// (https://docs.stripe.com/billing/subscriptions/overview#subscription-statuses).
				return {
					ok: false,
					reason: 'provider_error',
					detail:
						`Stripe created subscription ${redactPublicId(committed.id)} with nothing on its first ` +
						'invoice for the donor’s browser to confirm, so no repeating gift was set up and ' +
						'nothing was charged. The commitment collects nothing and Stripe abandons it within ' +
						'23 hours, so there is nothing to undo. The donor has to give again.'
				};
			}

			return {
				ok: true,
				value: {
					providerGiftId: committed.id,
					providerCustomerId: donorId,
					state: recurringState(committed.status),
					paymentToken,
					startedAt: atMillis(committed.start_date)
				}
			};
		},

		async cancelRecurringGift(providerGiftId: string): Promise<PaymentResult<RecurringGiftEnd>> {
			try {
				// the delete, which stops collection at once, and never the update that sets a
				// commitment to stop at the end of the period the donor has paid for. the second leaves a
				// gift that is neither collecting nor stopped for as long as a year.
				//
				// no idempotency key: a delete is idempotent by definition and a key sent on one has no
				// effect (https://docs.stripe.com/api/idempotent_requests), which is what makes the
				// operator's button safe to press twice without one.
				const ended = await stripe.subscriptions.cancel(providerGiftId);

				return {
					ok: true,
					value: {
						providerGiftId: ended.id,
						// when collection actually stopped, as the processor recorded it. the creation
						// time is the last resort rather than a guess dressed as a date: a commitment that
						// reports neither is one that never ran.
						endedAt: atMillis(ended.ended_at ?? ended.canceled_at ?? ended.created)
					}
				};
			} catch (error) {
				return classify(error);
			}
		},

		async createIntent(request: IntentRequest): Promise<PaymentResult<Intent>> {
			const refusal = unusableMoney(request);
			if (refusal) return refusal;
			if (!isStripeRail(request.method)) return unsettledRail(request.method, 'mint an intent for');

			try {
				const intent = await stripe.paymentIntents.create(
					{
						amount: request.amountMinor,
						currency: request.currency.toLowerCase(),
						// the intent is payable only on the rail the donor was quoted on, because the
						// fee that produced `amountMinor` was priced for that rail (./fees.ts). the
						// value is one donor's choice out of what this deployment offers, which is
						// `OFFERED_PAYMENT_METHODS` in ../../forms/offered-rails.ts.
						//
						// naming a rail here is also what opts this charge out of Stripe's own
						// dashboard-driven selection of payment methods, so nothing on Stripe's side
						// holds this call to the switches an operator set: what a rail arriving here
						// is allowed to be is decided by ./rail-chargeability.ts and enforced by the
						// caller. its header states that rule in full.
						payment_method_types: [...INTENT_METHODS[request.method]],
						...(request.metadata ? { metadata: { ...request.metadata } } : {})
					},
					{ idempotencyKey: request.idempotencyKey }
				);

				// nullable on the object, and an empty string in its place is the shape that fails
				// furthest from here: a 200, a token the browser cannot confirm with, and a donation
				// form that silently does nothing. this is the last place it can still be named.
				if (!intent.client_secret) {
					return {
						ok: false,
						reason: 'provider_error',
						detail:
							`Stripe created payment intent ${redactPublicId(intent.id)} without a client secret, ` +
							'so there is nothing the donor’s browser can confirm it with. No charge was made.'
					};
				}

				return {
					ok: true,
					value: { providerTxnId: intent.id, paymentToken: intent.client_secret }
				};
			} catch (error) {
				return classify(error);
			}
		},

		async verifyEvent(delivery: WebhookDelivery): Promise<PaymentResult<PaymentEvent>> {
			// the one arm this deployment's signing secret is read by, and the one that cannot be
			// answered without it. checked before the header, because a delivery that carried a perfect
			// signature is no more verifiable here than one that carried none — and what an operator has
			// to do about it is set a variable rather than look at the request.
			//
			// `not_configured` rather than `bad_signature`, which is the difference between a delivery
			// held open and a delivery lost. it is a retryable reason (`RETRYABLE_FAILURE_REASONS` in
			// ./provider.ts), so the webhook route answers 5xx and Stripe brings the delivery back across
			// the three-day window — which is the window an operator sets this value inside, having just
			// registered the endpoint that minted it.
			if (credentials.webhookSecret === null) {
				return {
					ok: false,
					reason: 'not_configured',
					detail:
						'This deployment cannot check that a payment notification came from Stripe: ' +
						'`STRIPE_WEBHOOK_SECRET` is not set, so the delivery was refused and its body was not ' +
						'read. The value is minted by registering this deployment’s endpoint — set payment ' +
						'notifications up on the console (`better-giving open`), which stores it in the same ' +
						'press.'
				};
			}

			const signature = delivery.headers[SIGNATURE_HEADER];
			if (signature === undefined) {
				return {
					ok: false,
					reason: 'bad_signature',
					detail:
						'The request carried no `stripe-signature` header, so nothing about it can be ' +
						'trusted and its body was not read. This endpoint is public: an unverified ' +
						'delivery is anyone’s delivery.'
				};
			}

			let event: Stripe.Event;
			try {
				// the async form, and the crypto provider passed explicitly. the synchronous
				// `constructEvent` reaches for node's crypto and throws on workerd, which is the
				// runtime this app deploys to — and it would do so only in production, since a node
				// test pool has that crypto and would pass either way.
				//
				// verified against the raw body string exactly as it arrived. a body that has been
				// parsed and re-serialised is a different byte sequence and verifies against nothing,
				// which is why CLAUDE.md gives the endpoint that owns this the body and forbids a
				// hook from touching it.
				event = await stripe.webhooks.constructEventAsync(
					delivery.body,
					signature,
					credentials.webhookSecret,
					undefined,
					cryptoProvider
				);
			} catch (error) {
				// two outcomes, and only one of them is about the signature. a failed verification is
				// the delivery not being this endpoint's; anything else out of this call is a body
				// that verified and then could not be read — malformed JSON, or an event shape this
				// version does not parse. reported as `bad_signature`, the second sends an operator to
				// rotate a secret that was never wrong while the real deliveries keep arriving, so
				// they are told apart by the class the library throws rather than lumped together.
				if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
					return {
						ok: false,
						reason: 'bad_signature',
						detail:
							'The delivery did not verify against `STRIPE_WEBHOOK_SECRET`, so its body was not ' +
							'read. If this deployment’s own endpoint is failing, the secret set here is not ' +
							'the one the endpoint was created with — a local `stripe listen` prints a ' +
							`different secret from the live endpoint’s. Stripe’s library said: ${quoteProvider(messageOf(error))}`
					};
				}

				return {
					ok: false,
					reason: 'provider_error',
					// through `quoteProvider` like every other borrowed sentence, and this one needs it
					// most: a JSON parse failure embeds a slice of the body it choked on, and the body
					// of an unread delivery is whatever was posted to a public endpoint.
					detail:
						'The delivery’s signature verified and its body could not be read, so nothing was ' +
						'acted on. The signing secret is not the problem. This is either a body that is ' +
						`not the JSON it was signed over, or an event shape this app does not parse ` +
						`against ${API_VERSION}. The library said: ${quoteProvider(messageOf(error))}`
				};
			}

			const type: string = event.type;
			const occurredAt = atMillis(event.created);
			const settles = (SETTLEMENT_EVENT_TYPES as readonly string[]).includes(type);
			const repeats = (RECURRING_EVENT_TYPES as readonly string[]).includes(type);

			if (!settles && !repeats) {
				return { ok: true, value: { id: event.id, kind: 'ignored', type, occurredAt } };
			}

			const object: unknown = event.data.object;
			const id =
				typeof object === 'object' &&
				object !== null &&
				'id' in object &&
				typeof object.id === 'string'
					? object.id
					: null;

			if (id === null) {
				// verified, subscribed, and unreadable. an event is serialised in the API version the
				// account held when it happened, so a replayed old delivery can carry a shape this
				// app does not know. reported as `ignored` it would be a settlement dropped in
				// silence under a 200, which is the failure that loses a gift.
				return {
					ok: false,
					reason: 'provider_error',
					detail:
						`A verified \`${redactPublicId(type)}\` delivery carried no readable object id, so ` +
						'there is nothing to reconcile it against. Events are serialised in the API ' +
						`version the account held when they happened; this app reads them against ${API_VERSION}.`
				};
			}

			// the id is all that is read off either kind of delivery, and the kind is decided by the
			// type rather than by what the id looks like. what that id names — a transaction, a
			// commitment, one collection — is the read arm's business, which is where a shape this
			// version does not recognise is a failure rather than a silent misreading.
			return {
				ok: true,
				value: settles
					? { id: event.id, kind: 'settlement', type, providerTxnId: id, occurredAt }
					: { id: event.id, kind: 'recurring', type, providerNoticeId: id, occurredAt }
			};
		},

		async readSettlement(providerTxnId: string): Promise<PaymentResult<Settlement>> {
			try {
				for (let attempt = 1; ; attempt++) {
					// both levels expanded in one round trip. neither is expanded by default, so without
					// this the charge is an id string and the processor's fee is not in the answer at
					// all — which `expansionOf` turns into a reported fault rather than a settlement that
					// reads clean with no fee.
					const intent = await stripe.paymentIntents.retrieve(providerTxnId, {
						expand: ['latest_charge.balance_transaction']
					});

					const chargeField = expansionOf<Stripe.Charge>(intent.latest_charge);
					if (chargeField.kind === 'unexpanded') return unexpanded('latest_charge', intent.id);

					const charge = chargeField.kind === 'object' ? chargeField.value : null;
					const balanceField = expansionOf<Stripe.BalanceTransaction>(charge?.balance_transaction);
					if (balanceField.kind === 'unexpanded')
						return unexpanded('latest_charge.balance_transaction', intent.id);

					const balance = balanceField.kind === 'object' ? balanceField.value : null;

					// the money moved and Stripe has not said yet what it took. every other reading is
					// answered on the first pass: a balance transaction that is there is the figure, and
					// an intent that has not succeeded legitimately has none.
					//
					// the age is what separates a figure still coming from one that is never coming, and
					// it is taken from the money rather than from the delivery so that every redelivery
					// of the same charge measures the same thing.
					const settledAt = atMillis(charge?.created ?? intent.created).getTime();
					const unpriced =
						balance === null &&
						settlementStatus(intent) === 'succeeded' &&
						Date.now() - settledAt < FEE_WINDOW_MS;
					if (!unpriced) return { ok: true, value: settlementOf(intent, charge, balance) };

					if (attempt >= FEE_ATTEMPTS) {
						return {
							ok: false,
							reason: 'fee_not_ready',
							detail:
								`Stripe has not published what it took out of ${redactPublicId(intent.id)} yet: ` +
								'the payment succeeded and the balance transaction behind it has not been ' +
								'computed. Nothing was written and nothing needs fixing. This delivery is worth ' +
								'having again, and the fee posts with the charge when it arrives.'
						};
					}

					await pause(FEE_SPACING_MS);
				}
			} catch (error) {
				return classify(error);
			}
		},

		/**
		 * which repeating gift a delivery is about, off the two lists that say what it named.
		 *
		 * the type decides the read, never the id: `RECURRING_COLLECTION_EVENT_TYPES` in
		 * `@better-giving/operator/stripe/webhook-endpoint` holds the
		 * deliveries whose object is an invoice and `RECURRING_COMMITMENT_EVENT_TYPES` the ones whose
		 * object is the commitment, so a member added to either is a member that already knows which
		 * object it names. read off the id's own prefix instead, a subscription id Stripe spells
		 * differently one day would be retrieved as an invoice.
		 */
		async readRecurringGift(event: RecurringEvent): Promise<PaymentResult<RecurringGiftNotice>> {
			return (RECURRING_COLLECTION_EVENT_TYPES as readonly string[]).includes(event.type)
				? readCollection(event.providerNoticeId)
				: readCommitment(event.providerNoticeId);
		},

		async readAccountChargeability(): Promise<PaymentResult<AccountChargeability>> {
			try {
				// `retrieveCurrent`, which is `GET /v1/account` — the account the key belongs to. the
				// other retrieve takes an account id as a required argument, and there is no id to give
				// it: an account id is a deployment artifact and none is committed to this repository
				// (CLAUDE.md), so the credentials are the only thing that says which account this is.
				const current = await stripe.accounts.retrieveCurrent();

				return {
					ok: true,
					value: {
						chargesEnabled: current.charges_enabled,
						// the rails this adapter settles, and no others. the hash holds a key per
						// capability the account has ever asked for, which is a list of somebody else's
						// products; a mapper that carried all of them would be a list to keep in step for
						// the sake of fields with no reader.
						rails: Object.fromEntries(
							STRIPE_RAILS.map((rail) => [
								rail,
								railCapabilityState(RAIL_CAPABILITIES[rail](current.capabilities))
							])
						)
					}
				};
			} catch (error) {
				return classify(error);
			}
		},

		async readRailSwitchboard(): Promise<PaymentResult<RailSwitchboard>> {
			try {
				const page = await stripe.paymentMethodConfigurations.list({ limit: CONFIGURATION_PAGE });

				// selected on `is_default` rather than taken from the front of the list. an account holds
				// more than one of these — a plain account is created with a second one beside the default
				// — and the order they arrive in is not this app's to rely on. the default is the one the
				// switches on Stripe's own payment-methods screen belong to, which is what makes it the one
				// this deployment honours; ./rail-chargeability.ts is where honouring it is decided.
				const preferred = page.data.find((candidate) => candidate.is_default);
				if (!preferred) {
					return {
						ok: false,
						reason: 'provider_error',
						// not "nothing is switched on", which is the reading that would quietly report a
						// deployment offering no way to pay. an account always has a default configuration,
						// so its absence means this read is wrong rather than that an operator turned
						// everything off — and the two have nothing in common to do about them.
						detail:
							'Stripe listed no default payment method configuration for this account, so which ' +
							'ways of paying are switched on could not be read. An account always has one, so ' +
							'this is not an account with everything switched off.'
					};
				}

				const switchboard: Partial<Record<QuotedRail, RailSwitch>> = {};
				for (const rail of STRIPE_RAILS) {
					const configured = RAIL_SWITCHES[rail](preferred);
					// a rail the configuration does not mention is off, never on. the direction is the one
					// this whole read is safe to be wrong in: a rail wrongly reported on is a way of paying
					// this deployment offers that the operator did not.
					switchboard[rail] = {
						offered: configured?.available === true,
						switchedOn: configured?.display_preference.value === 'on'
					};
				}

				return { ok: true, value: switchboard };
			} catch (error) {
				return classify(error);
			}
		},

		async listWebhookEndpoints() {
			try {
				const page = await stripe.webhookEndpoints.list({ limit: ENDPOINT_PAGE });
				return {
					ok: true,
					value: {
						endpoints: page.data.map(summarise),
						// the same list the create subscribes an endpoint to, handed over so that a caller
						// comparing the two takes both facts from one answer rather than importing this
						// module's constant into a screen.
						requiredEventTypes: [...SUBSCRIBED_EVENT_TYPES]
					}
				};
			} catch (error) {
				return classify(error);
			}
		},

		async registerWebhookEndpoint(url: string) {
			const refusal = unusableEndpointUrl(url);
			if (refusal) return refusal;

			try {
				// looked up rather than deduplicated by an idempotency key, and the difference is not a
				// preference. a key derived from the URL would replay the answer to the last create for
				// the same URL — Stripe holds one for 24 hours — so a replacement made inside that window
				// would come back with the deleted endpoint's id and its dead secret, reported as a
				// success. the account's own list is the thing that cannot go stale that way.
				const page = await stripe.webhookEndpoints.list({ limit: ENDPOINT_PAGE });
				const registered = page.data.find((candidate) => candidate.url === url);
				if (registered) {
					return {
						ok: false,
						reason: 'invalid_request',
						detail:
							`Stripe already has a webhook endpoint for ${redactPublicId(url)}, registered as ` +
							`${redactPublicId(registered.id)}. Registering a second one would not help: an ` +
							'endpoint’s signing secret is returned once, when it is created, and cannot be read ' +
							'back afterwards, so this deployment would hold a secret for one of the two and ' +
							'refuse every delivery from the other. Replace the existing endpoint to get a new ' +
							'secret, which deletes it and registers a new one under a new id.'
					};
				}
			} catch (error) {
				return classify(error);
			}

			return createEndpoint(url);
		},

		async resubscribeWebhookEndpoint(id: string) {
			try {
				// one update, carrying both halves of what makes an endpoint a working one. the
				// subscription list is the same `SUBSCRIBED_EVENT_TYPES` the create sends, so the
				// endpoint this repairs and the endpoint this app registers are subscribed to one
				// sentence rather than two.
				//
				// `disabled: false` is sent unconditionally rather than only where the endpoint is off:
				// the alternative is a read to decide, which is a round trip to avoid writing a value
				// that is already what it is. Stripe disables an endpoint that has been failing, so an
				// endpoint being repaired is one of the two states this reaches.
				//
				// nothing here sends or reads a secret. the update response carries none
				// (https://docs.stripe.com/api/webhook_endpoints/update), and `summarise` would drop one
				// that arrived — which is what keeps the `STRIPE_WEBHOOK_SECRET` the deployment already
				// holds verifying across this call. `api_version` is not sent because the operation has
				// no parameter for it; an endpoint on the wrong version is a replacement.
				const updated = await stripe.webhookEndpoints.update(id, {
					enabled_events: [...SUBSCRIBED_EVENT_TYPES],
					disabled: false
				});
				return { ok: true as const, value: summarise(updated) };
			} catch (error) {
				return classify(error);
			}
		},

		async replaceWebhookEndpoint(id: string, url: string) {
			const refusal = unusableEndpointUrl(url);
			if (refusal) return refusal;

			try {
				await stripe.webhookEndpoints.del(id);
			} catch (error) {
				// nothing has changed on the account, so the failure is reported as it arrived.
				return classify(error);
			}

			const registered = await createEndpoint(url);
			if (registered.ok) return registered;

			// the delete succeeded and the create did not, which is the one state of this call an
			// operator cannot infer from the failure underneath it: the endpoint they were replacing is
			// gone, this deployment now receives nothing, and pressing the button again registers rather
			// than replaces. the reason is carried through unchanged so the webhook route's own
			// retryable/terminal reading of it (`isRetryable` in ./provider.ts) still holds.
			return {
				ok: false,
				reason: registered.reason,
				detail:
					`Webhook endpoint ${redactPublicId(id)} was deleted and its replacement was not ` +
					'created, so Stripe is delivering nothing to this deployment. Registering an endpoint ' +
					`again is what fixes it. ${registered.detail}`
			};
		},

		async listWalletDomains(): Promise<PaymentResult<readonly WalletDomain[]>> {
			try {
				const page = await stripe.paymentMethodDomains.list({ limit: WALLET_DOMAIN_PAGE });
				return { ok: true, value: page.data.map(summariseDomain) };
			} catch (error) {
				return classify(error);
			}
		},

		async registerWalletDomain(host: string): Promise<PaymentResult<WalletDomain>> {
			const refusal = unusableHost(host);
			if (refusal) return refusal;

			try {
				// the create is the find as well. Stripe answers a `domain_name` the account already
				// holds with that hostname's own object rather than with an error, so one call covers
				// both states — where a look-up and then a create would be two calls with a window
				// between them, and would hand this module an id it has nothing else to do with.
				const registered = await stripe.paymentMethodDomains.create({ domain_name: host });

				// switched back on only where it is off. sent unconditionally this would be a write on
				// every press, and `levelWalletDomains` in ./wallet-domains.ts reports whether a press
				// changed anything by comparing what it found against what came back — so a write that
				// always happens is a press that can never say it did nothing.
				const switchedOn = registered.enabled
					? registered
					: await stripe.paymentMethodDomains.update(registered.id, { enabled: true });

				const drawing = summariseDomain(switchedOn);
				if (WALLETS.every((wallet) => drawing.wallets[wallet].state === 'active')) {
					return { ok: true, value: drawing };
				}

				// one look-again for a drawn wallet Stripe is not drawing, and never a loop. it is the
				// only operation that moves a wallet off `inactive`
				// (https://docs.stripe.com/api/payment_method_domains/validate), and what such a wallet
				// is short of is satisfied outside this deployment — so asking twice in one press
				// answers twice the same way, and the answer is reported as it stands.
				const revalidated = await stripe.paymentMethodDomains.validate(switchedOn.id);
				return { ok: true, value: summariseDomain(revalidated) };
			} catch (error) {
				return classify(error);
			}
		}
	};
}

/**
 * an expandable field that came back as an id, which means the request went out without its
 * `expand`.
 *
 * a fault rather than an absence, and loud rather than quiet: the alternative is a settlement that
 * reads perfectly well with `feeMinor: null` forever, so the ledger records no processor fee and
 * nothing anywhere reports why.
 */
function unexpanded(field: string, intentId: string): PaymentFailure {
	return {
		ok: false,
		reason: 'provider_error',
		detail:
			`Stripe returned \`${field}\` on payment intent ${redactPublicId(intentId)} as an id rather than ` +
			'an object, so the fee this settlement is reconciled against could not be read. The ' +
			'retrieve went out without its `expand`, which is a bug in this app rather than anything ' +
			'about the payment.'
	};
}
