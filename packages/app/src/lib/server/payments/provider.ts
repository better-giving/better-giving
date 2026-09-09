import type { Frequency, PaymentMethod as QuotedRail } from '@better-giving/form/v1';
import type { PaymentMethod as SettledRail, PaymentStatus } from '../db/schema';

// the payment port: the one interface every caller in this app takes money through, and the one
// thing an adapter has to implement.
//
// payments go through this port, never Stripe directly (CLAUDE.md). exactly one module imports
// the `stripe` package — ./stripe.ts — which is the same shape ../db/client.ts holds over D1, and
// for the same stated reason: so the contract has one place to be stated rather than one per call
// site.
//
// the seam is hypothetical, and saying so is the honest version of the argument for it. one
// adapter has ever been written against this interface, so nothing has yet pulled on it, and
// CLAUDE.md rejects speculative portability for the store on exactly those grounds. what the port
// buys is not a second processor. it is containment and testability: the processor's vocabulary —
// seven PaymentIntent states, sixteen error classes, unix seconds, lowercase currencies,
// expandable fields that are sometimes id strings — stops at one file, and everything above it
// takes types this repository defines and can construct in a test with no network and no account.
//
// nothing here imports an SDK, a binding or a route. ./factory.ts is what turns a deployment's
// configuration into one of these, per request.
//
// this file also holds `PROVIDER_NAME`, because it lives beside the fee table rather than in
// ../forms/: both are facts about the processor and neither is a fact about a form, so this
// folder is where a Stripe fact goes.

/**
 * what `Provider.name` on the served config says.
 *
 * data, not a field name. `Provider` in packages/form/src/v1.ts is what tells an adapter which SDK to
 * reach for, so the contract carries a provider without a field named after one — and a field
 * named after one could only ever be corrected by shipping a `v2`.
 */
export const PROVIDER_NAME = 'stripe';

/**
 * the key the donation's id is written under, on whichever object at the processor this app created
 * for that gift — an intent for a single gift, a commitment for a repeating one.
 *
 * one key for both, because it is one fact: the row this deployment wrote when the donor pressed
 * the button, named on the object that will be paid. the settlement path reads it back out of
 * `Settlement.metadata` to find the payment row a quote opened; the collection path reads it out of
 * `RecurringGiftNotice.metadata` and claims that row for the charge that opens the series, rather
 * than opening a second gift for money the donor is already recorded as giving
 * (../donations/collect.ts).
 *
 * a constant because the halves that spell it are not written together, and a mismatch is silent —
 * the object carries a key nobody reads, the handler finds nothing under the key it wants, and every
 * test on either side goes on passing because neither knows what the other wrote. what it costs is a
 * settled gift with no donation attached to it, discovered when the books are read.
 *
 * a UUID this app minted and nothing else. it is a pointer rather than anything about the donor,
 * which is the rule `contact_id` below states and the reason the dedication is not up here beside
 * it: the honoree and the person to tell are written on the gift's own row and reach the processor
 * not at all.
 *
 * it is a key on a third party's record, so renaming it does not migrate anything already written:
 * an object minted under the old spelling keeps it for as long as it can still be paid. add a key
 * rather than rename this one.
 */
export const DONATION_METADATA_KEY = 'donation_id';

/**
 * the three keys that make a charge readable on its own, for whoever is reconciling one in the
 * processor's dashboard with no way to look a row up here.
 *
 * `DONATION_METADATA_KEY` above is a pointer and these are the facts it points at. what the
 * dashboard shows beside them is one number — what was charged — and that number answers none of
 * the three questions a reconciler has about it: how much of it was the gift, whose choice the rest
 * of it was, and which price list it was computed from.
 *
 *   gift_minor  — the donor's chosen amount, before the fee, in the same minor units. it is written
 *                 here because it is written nowhere else as itself: the line item is minted at the
 *                 grossed-up total, so this figure is `total_minor - fee_minor` and has no column
 *                 (../db/schema.ts).
 *   fee_covered — `true` where the donor chose to cover the fee and the charge was grossed up for
 *                 it, `false` where the organisation absorbs it and `donation.fee_minor` is zero.
 *   fee_rail    — the rail the fee was priced off, in `PaymentMethod`'s spelling in packages/form/src/v1.ts.
 *                 the donor's pre-selection rather than what settled, which is the fact the fee was
 *                 actually computed from — `Settlement.method` below is the other one, and the two
 *                 are allowed to differ.
 *
 * the first two ride a commitment as well as a charge, written by `mintCommitment` in
 * ../donations/quote.ts beside the three keys below. a collection under a commitment reads what
 * moved and nothing else, so they are the only thing that can say how much of a grossed-up charge
 * the donor added — `coveredFeeOf` in ../donations/collect.ts derives `donation.fee_minor` from
 * them on every charge in the series.
 *
 * absence is "written before these keys shipped", and never "no" — a charge minted before this
 * carries only the donation id, and it can still settle, be refunded and be read for as long as the
 * account holds it. a reader that took a missing `fee_covered` for `false` would report every gift
 * this deployment took before then as one the donor declined to cover. read all three as unknown
 * when they are absent, and never one of them as a default.
 *
 * they are keys on a third party's record, so renaming one does not migrate anything already
 * written. add a key rather than rename one.
 */
export const GIFT_MINOR_METADATA_KEY = 'gift_minor';
export const FEE_COVERED_METADATA_KEY = 'fee_covered';
export const FEE_RAIL_METADATA_KEY = 'fee_rail';

/**
 * the three keys a commitment's metadata must carry, and the whole of what makes a repeating
 * gift's charges attributable to anything in this deployment.
 *
 * a collection under a commitment has no rows waiting for it and arrives naming nothing of ours:
 * the processor mints the collection's own intent and copies nothing onto it, so
 * `DONATION_METADATA_KEY` above names nothing on it and there is no donation to find. what the
 * commitment carries is therefore the only path from money that moved to the donor it came from —
 * and it is read on charge one and on charge fifty alike, because the commitment outlives every
 * browser that could have said.
 *
 * so `createRecurringGift` is called with all three set, and a commitment created without them
 * collects money this deployment can record against nobody. that is a refusal rather than a
 * guess — `readRecurringGift`'s notice carries the metadata back, and the settlement path answers
 * a collection it cannot attribute by telling an operator (../donations/collect.ts).
 *
 *   contact_id — the donor's row here. a pointer rather than a name or an address, because this is
 *                a third party's store and a field put here is a field exported from this
 *                deployment. it follows that the row exists before the commitment is created: the
 *                path that makes one mints the donor first and names them here.
 *   form_id    — the form the gift was made on, which is what makes a fund reachable for charge
 *                two. `recurring_plan.form_id` is NOT NULL for the same reason (../db/schema.ts).
 *   interval   — how often it collects, in `RECURRING_INTERVALS`' own spelling
 *                (../db/schema.ts). it is this app's own word for a decision it made, kept beside
 *                the other two rather than read back off the processor's schedule, so that what
 *                the commitment row records is what the gift was set up as.
 *
 * they are keys on a third party's record, so renaming one does not migrate anything already
 * written: a commitment created under the old spelling keeps it for as long as it can still
 * collect. add a key rather than rename one.
 */
export const CONTACT_METADATA_KEY = 'contact_id';
export const FORM_METADATA_KEY = 'form_id';
export const INTERVAL_METADATA_KEY = 'interval';

/**
 * the two rail vocabularies this module holds at once, each under a name that says which it is.
 *
 * `PAYMENT_METHODS` in packages/form/src/v1.ts and `PAYMENT_METHODS` in ../db/schema.ts are different
 * lists — one is what a donation form offers a donor, the other is what a `payment` row may
 * record — and they overlap without matching. imported under their own name they would shadow
 * each other, and the field that says which rail was quoted would be indistinguishable from the
 * field that says which rail settled.
 */
export type { QuotedRail, SettledRail };

/**
 * why a call did not produce what it was asked for, as a closed set.
 *
 * a `const` array plus a derived union rather than a TS `enum`, the way `SEND_FAILURE_REASONS` in
 * ../email/provider.ts does it — the values are what a caller switches on and what a test names,
 * and the array is what makes "did we cover all of them" checkable.
 *
 * there is no `card_declined` here, and its absence is the design rather than a gap. nothing this
 * port does charges a card: `createIntent` mints an intent, the donor's own browser confirms it,
 * and a refusal by the rail comes back as a `Settlement` whose `status` is `failed`. a decline is
 * an outcome, not an error, and modelling it as one would put the donor's most ordinary
 * experience on the exception path.
 *
 *   not_configured   — this deployment holds no usable credentials, or the processor rejected the
 *                      ones it holds. fix the deployment, not the call.
 *   invalid_request  — the call was malformed: an amount that is not a positive integer of minor
 *                      units, a currency that is not ISO-4217, an idempotency key reused against
 *                      different parameters. this is a bug in this app and repeating it changes
 *                      nothing.
 *   bad_signature    — `verifyEvent` only. the body did not match the signature under the
 *                      configured secret, or no signature was presented. the delivery is refused
 *                      and nothing is read out of it — an unverified event is anyone's event.
 *   not_found        — the processor has no such object on this account, or the object it has is not
 *                      one this app keeps books for. `readSettlement` is where it is expected, from
 *                      a delivery replayed against another account; `readRecurringGift` answers it
 *                      for an invoice no repeating gift raised, which is what a hand-made invoice on
 *                      the same account arrives as; `createIntent` can also produce it, for an
 *                      object its parameters named.
 *   fee_not_ready    — `readSettlement` only. the money moved and the processor has not published
 *                      what it took out of it yet. the read is worth making again and nothing else
 *                      is: the transaction is fine, the gift is fine, and the one figure the ledger
 *                      needs is still being computed. it is a reason of its own rather than a
 *                      settlement carrying no fee, because those two answers are a gift posted with
 *                      its fee and a gift posted permanently without one — see `Settlement.feeMinor`
 *                      below, whose null is the ordinary absence this is not.
 *   rate_limited     — the processor is shedding load. the same call is worth making again.
 *   unreachable      — no answer came back at all: a connection that failed, or a timeout.
 *   provider_error   — the processor answered with a fault of its own, or answered with something
 *                      this app cannot read.
 *   internal_error   — an adapter threw where its contract says it must not. a bug in this app
 *                      rather than anything about payments, and it exists so `sealed` below has
 *                      somewhere honest to put one.
 */
export const PAYMENT_FAILURE_REASONS = [
	'not_configured',
	'invalid_request',
	'bad_signature',
	'not_found',
	'fee_not_ready',
	'rate_limited',
	'unreachable',
	'provider_error',
	'internal_error'
] as const;
export type PaymentFailureReason = (typeof PAYMENT_FAILURE_REASONS)[number];

/**
 * the reasons whose answer is to make the same call again.
 *
 * partitioned here, once, because two routes have to agree about it and neither is the place to
 * decide it. the webhook is the demanding one: it has to answer a retryable failure with a 5xx so
 * the processor redelivers, and a terminal one with a 2xx so it stops — and a delivery answered
 * the wrong way is either a settlement lost to a single bad minute or a deterministic bug hammered
 * for three days. a `switch` written in each route is two switches, and the ninth reason added
 * later falls into whichever `default` each of them happens to have.
 *
 * `not_configured` is retryable, and it is the member worth arguing. no immediate retry fixes it —
 * an operator has to set a variable. but a redelivery window is measured in days, so a delivery
 * held open across the moment somebody sets that variable is a gift recovered, while one answered
 * terminally is a gift lost to a deployment that was half-finished for an hour.
 *
 * `internal_error` is terminal for the opposite reason: it is our own defect, it answers the same
 * way every time, and holding a delivery open against it buys nothing but noise.
 *
 * `fee_not_ready` is retryable and is the member that leans hardest on the redelivery window. the
 * figure it waits for ordinarily lands in seconds and the adapter waits that out inside one
 * delivery, so a refusal here means the tail — where a window measured in days is the only thing
 * long enough. it cannot hang forever: the adapter stops refusing once the charge is old enough and
 * answers without a fee instead (`FEE_WINDOW_MS` in ./stripe.ts).
 */
export const RETRYABLE_FAILURE_REASONS = [
	'not_configured',
	'fee_not_ready',
	'rate_limited',
	'unreachable',
	'provider_error'
] as const satisfies readonly PaymentFailureReason[];

/** the reasons whose answer is anything but the same call again. */
export const TERMINAL_FAILURE_REASONS = [
	'invalid_request',
	'bad_signature',
	'not_found',
	'internal_error'
] as const satisfies readonly PaymentFailureReason[];

/**
 * whether making the identical call again is worth anything.
 *
 * the one reader of the partition above, so that a caller writes `isRetryable(result.reason)`
 * rather than a membership test it could get backwards. ./provider.spec.ts holds the two arrays to
 * being a partition of `PAYMENT_FAILURE_REASONS` — every member in exactly one — which is what
 * makes a reason added later a failing test rather than a silent default.
 */
export function isRetryable(reason: PaymentFailureReason): boolean {
	return (RETRYABLE_FAILURE_REASONS as readonly PaymentFailureReason[]).includes(reason);
}

/**
 * why a call did not succeed, naming the value to fix.
 *
 * `detail` is read by an operator and by an agent — CLAUDE.md's rule for a 4xx body applies to
 * anything that ends up in one, and every refusal here can. it never carries a credential: the
 * processor's own sentences are bounded and stripped of key-shaped tokens before they reach it
 * (`quoteProvider` in ./stripe.ts), because a rejected key is described by quoting the key.
 *
 * deliberately no `indeterminate` flag, which is where this port parts company with `SendResult`
 * in ../email/provider.ts, and that file says in as many words why: for mail a boolean is enough
 * because the cost of being wrong is a duplicate receipt, and here the cost is a second charge. a
 * flag would only name the problem. what answers it is the two mechanisms this port is built out
 * of — `IntentRequest.idempotencyKey`, which makes the same attempt retried after a lost answer
 * resolve to the intent that already exists, and `readSettlement`, which is the reconciliation
 * read that says what actually happened. so a caller's answer to any failure here is to retry the
 * identical call or to go and read; never to guess.
 */
export type PaymentFailure = {
	readonly ok: false;
	readonly reason: PaymentFailureReason;
	readonly detail: string;
};

/**
 * a discriminated union, so a caller cannot reach the value without having checked `ok`.
 *
 * generic over one `value` rather than a differently-named field per method, because `sealed` and
 * `refusing` below have to produce a failure for every arm of the port and a hand-written union
 * per arm is how the arms drift.
 */
export type PaymentResult<T> = { readonly ok: true; readonly value: T } | PaymentFailure;

/**
 * what an intent is minted from.
 *
 * every number here is the server's. an amount that arrived from a browser is an input to look up
 * against the form record, never a figure to send — `/api/v1` is public, unauthenticated and
 * payment-initiating (CLAUDE.md), so the only defence against a donor charging themselves a cent
 * is that nothing they send reaches this type.
 */
export type IntentRequest = {
	/**
	 * minor units, a positive safe integer — 10_000 is $100.00.
	 *
	 * the same encoding the ledger fixes (CLAUDE.md) and the same one the processor's own API
	 * takes, so this value is passed through rather than converted. no float ever touches it: the
	 * gross-up that produced it is `estimateFee`'s in packages/form/src/fee.ts and it rounds to an
	 * integer there.
	 */
	readonly amountMinor: number;
	/** ISO-4217, uppercase, as `entry_group.currency` and `payment.currency` hold it. */
	readonly currency: string;
	/**
	 * the rail the donor was quoted on, and the only rail this intent may be paid with.
	 *
	 * it is on the request because the fee is priced per rail — ./fees.ts prices a bank debit at
	 * 0.8% capped at $5.00 and a card at 2.9% plus 30¢ — and the donor picks the rail before the
	 * quote is minted. an intent payable on some other rail is a gift collected at one price and
	 * settled at another, with the difference coming out of the org, and nothing downstream could
	 * see it because both figures are individually correct.
	 *
	 * what a form may offer at all stays the org's own dashboard configuration, reported per-site
	 * through `FormConfig.paymentMethods` in packages/form/src/v1.ts. this field carries one donor's
	 * choice out of that set, so no list of methods is decided in this repository.
	 */
	readonly method: QuotedRail;
	/**
	 * what makes this attempt the same attempt when it is made twice.
	 *
	 * required, and it is the reason `PaymentFailure` needs no "did it happen" flag. a call whose
	 * answer never arrived may well have minted an intent; repeating it under the same key
	 * resolves to that intent instead of a second one. a key generated inside this port would be
	 * new on every call and would therefore guarantee the duplicate it exists to prevent, so it
	 * comes from the caller, whose attempt it is.
	 *
	 * one key belongs to one set of parameters. reused against a different amount it is refused
	 * rather than silently honoured either way, and arrives back as `invalid_request`.
	 */
	readonly idempotencyKey: string;
	/**
	 * what this app needs written on the processor's copy of the record.
	 *
	 * the donation id belongs here. an event can reach the webhook before the row that caused it
	 * is readable, and the intent is then the only thing that knows which gift it was — which is
	 * why `Settlement` reads it back out rather than leaving this write-only.
	 *
	 * never a donor's details beyond what settling the payment needs — this is a third party's
	 * store, and a field put here is a field exported from this deployment.
	 */
	readonly metadata?: Readonly<Record<string, string>>;
};

/** a minted intent, as the quote endpoint needs it. */
export type Intent = {
	/** the processor's own id, stored as `payment.provider_txn_id`. */
	readonly providerTxnId: string;
	/**
	 * what the donor's browser confirms this attempt with, and `Quote.paymentToken` on the wire.
	 *
	 * opaque here as it is there: named for what it does rather than for what one processor calls
	 * it, so the adapter is the only thing that knows what is inside it.
	 */
	readonly paymentToken: string;
};

/**
 * what a transaction turned out to be, read from the processor rather than reconstructed from an
 * event.
 *
 * the webhook's whole answer. events carry no ordering guarantee, so a handler that rebuilt state
 * from the sequence it happened to receive would be wrong for any donor whose bank was slow; this
 * is the re-read that replaces that.
 */
export type Settlement = {
	readonly providerTxnId: string;
	/** the row's own vocabulary — `PAYMENT_STATUSES` in ../db/schema.ts. */
	readonly status: PaymentStatus;
	/**
	 * the rail that actually settled it, in the `payment.method` column's vocabulary.
	 *
	 * read from what the processor reports about the charge, never copied from what the donor
	 * picked beforehand. those are two different facts, and recording the second under the name of
	 * the first is what would make a divergence between them permanently invisible — which matters
	 * precisely because the fee was priced off the donor's choice.
	 *
	 * null when nothing has settled yet, and null again when the rail is one `PAYMENT_METHODS` in
	 * ../db/schema.ts does not model. a value invented for that case would be a row asserting a
	 * rail nobody used.
	 */
	readonly method: SettledRail | null;
	/** minor units, positive. `payment.amount_minor` carries no sign; `direction` does. */
	readonly amountMinor: number;
	/** ISO-4217, uppercase. the processor reports it lowercase and it is uppercased here. */
	readonly currency: string;
	/**
	 * what the processor actually took, in the same minor units — never what this app quoted.
	 *
	 * the two are different numbers on purpose. the donor is shown the fee this app estimated from
	 * ./fees.ts and that figure is what `donation.fee_minor` keeps, because it is what they agreed
	 * to; the ledger's fee entry has to reconcile against a bank statement, so it can only ever be
	 * the processor's own figure.
	 *
	 * always in this settlement's own currency. an entry group holds one currency
	 * (../ledger/posting.ts), so a fee the processor settled in another one reaches a caller
	 * converted at the processor's own rate or not at all — `feeOf` in ./stripe.ts is where that
	 * conversion is stated, and it is the adapter's job precisely because the rate is a fact about
	 * the processor's transaction.
	 *
	 * null when there is no such figure yet, which is the ordinary case rather than an error: an
	 * intent still in flight has no settled transaction behind it. null also when a fee in another
	 * currency came with no rate to carry it across — a caller answers that the way it answers
	 * every other absent fee, and ../donations/settle.ts tells an operator so.
	 *
	 * what it is never null for is a fee that is merely late. money that moved and a figure the
	 * processor has not published yet is `fee_not_ready` above — a refusal rather than a settlement —
	 * because the two answers differ by whether the fee is ever posted at all: a null read as "no fee"
	 * posts the charge alone under a 2xx and nothing looks again.
	 */
	readonly feeMinor: number | null;
	/**
	 * whatever `IntentRequest.metadata` wrote on the record, read back.
	 *
	 * this is what makes that field worth having. a delivery can arrive before the row that caused
	 * it is readable, so a handler that could only find its gift by looking the transaction id up
	 * in its own database would lose exactly the race the metadata was written for.
	 */
	readonly metadata: Readonly<Record<string, string>>;
	/** business time: when the money moved, as the ledger's `occurred_at` wants it. */
	readonly occurredAt: Date;
};

/**
 * what a verified delivery turns out to be about.
 *
 * a kind per read this app has to make, and never one per processor event type. every settlement
 * event there is collapses to one kind because the handler does the same thing with all of them —
 * re-read the transaction and reconcile — and an event vocabulary mirrored one-for-one here would
 * put the processor's strings in the handler's switch, which is exactly what this port exists to
 * keep out of it.
 *
 *   settlement — this names a transaction whose current state is worth reading, and `readSettlement`
 *                is what reads it.
 *   recurring  — this is about a gift that repeats: one collection under a commitment, or the
 *                commitment's own standing. it names neither a transaction nor a donation, so it is
 *                a kind of its own with a read of its own — `readRecurringGift`, which is what turns
 *                it into the commitment it belongs to.
 *   ignored    — a delivery this app subscribes to nothing for. it is answered and logged rather
 *                than dropped silently, so an endpoint subscribed to more than it handles is
 *                visible instead of merely quiet.
 */
export const PAYMENT_EVENT_KINDS = ['settlement', 'recurring', 'ignored'] as const;
export type PaymentEventKind = (typeof PAYMENT_EVENT_KINDS)[number];

/**
 * what every verified delivery carries, whatever it turns out to be about.
 *
 * it holds no metadata, no amount and no status, and that is a rule rather than an omission: a
 * delivery is serialised in the API version the account held when it happened, so a replayed one
 * can carry an older shape for any field. what is read here is the little that has never moved.
 * everything a handler acts on comes from a read — `readSettlement` or `readRecurringGift` — which
 * fetches the object fresh against one pinned version.
 */
type VerifiedDelivery = {
	/**
	 * the processor's event id, and the handler's idempotency key.
	 *
	 * deliveries repeat for up to three days and a duplicate is ordinary rather than exceptional,
	 * so this is what a handler records and no-ops on when it sees again.
	 */
	readonly id: string;
	/** the processor's own event type, carried verbatim for the log and never switched on. */
	readonly type: string;
	readonly occurredAt: Date;
};

/** a delivery naming one transaction, which `readSettlement` reconciles. */
export type SettlementEvent = VerifiedDelivery & {
	readonly kind: 'settlement';
	/** the transaction this is about, and never null on this kind. */
	readonly providerTxnId: string;
};

/**
 * a delivery about a gift that repeats, naming the object the processor sent it about.
 *
 * the id is a commitment's or one of its collections', and which of the two is decided by `type` —
 * so it is handed straight back to `readRecurringGift` with the delivery it came on, and read by
 * nothing else. a caller that told them apart itself would be spelling the processor's own id
 * prefixes, which is the vocabulary this port exists to hold at one file.
 */
export type RecurringEvent = VerifiedDelivery & {
	readonly kind: 'recurring';
	readonly providerNoticeId: string;
};

/** a delivery this app acts on nothing for, answered and logged. */
export type IgnoredEvent = VerifiedDelivery & {
	readonly kind: 'ignored';
};

/**
 * a delivery whose signature checked out.
 *
 * a union rather than one shape with a `kind` beside it, because what a delivery names differs by
 * kind and a nullable field per kind would let a handler reach for the id of a delivery that has
 * none. narrowed on `kind`, the id a read arm needs is the only one in scope.
 */
export type PaymentEvent = SettlementEvent | RecurringEvent | IgnoredEvent;

/** a webhook delivery, exactly as it arrived. */
export type WebhookDelivery = {
	/**
	 * the raw body, byte for byte.
	 *
	 * the signature is computed over what was sent, so a body that has been parsed and
	 * re-serialised verifies against nothing. the route that owns this endpoint reads the body
	 * once and hands the string here — CLAUDE.md: the request body is read exactly once, by the
	 * endpoint that owns it, and a hook that touches it breaks verification at runtime.
	 */
	readonly body: string;
	/** the `stripe-signature` header, or null where the request carried none. */
	readonly signature: string | null;
};

/**
 * how far the processor has got with one payment rail on the account, as a closed set.
 *
 * four members rather than three, and the fourth is the one that would otherwise be lost. the
 * processor reports a rail it was never asked about by leaving it out of the answer altogether, so
 * read as a two-way boolean — or collapsed onto `inactive` — "nobody ever asked for this" and "this
 * was asked for and is not usable" become the same value. they have different fixes: one is a
 * request to make, the other is a requirement to satisfy or a refusal to appeal, and a screen that
 * cannot tell them apart tells an operator to do the wrong one.
 *
 * a `const` array plus a derived union, the way `PAYMENT_FAILURE_REASONS` above does it: the array
 * is what makes "did we cover all of them" checkable.
 *
 *   active      — the rail is usable on this account. necessary and not sufficient — see
 *                 ./rail-chargeability.ts, which is where that caveat is stated in full and where
 *                 the vocabulary a screen reads is built.
 *   pending     — asked for, not usable yet, and the processor is working through requirements.
 *                 waiting is the fix.
 *   inactive    — asked for and not usable: short of a requirement, paused, or refused. an
 *                 operator has something to do, and what it is lives on the processor's dashboard.
 *   unrequested — the account has never asked for this rail at all. the fresh-account state for
 *                 every rail past the ones an account is opened with.
 *
 * `Rail` in the name and not for length: `RailStanding` in
 * `@better-giving/operator/console/payments` is what a console draws off one of these and is a
 * different word entirely. unqualified, the two are one grep and an import line that does not say
 * which arrived.
 */
export const RAIL_CAPABILITY_STATES = ['active', 'pending', 'inactive', 'unrequested'] as const;
export type RailCapabilityState = (typeof RAIL_CAPABILITY_STATES)[number];

/**
 * what the processor's own account is approved to charge, read from the account rather than
 * inferred from a payment that worked.
 *
 * approved, not working. every field here is a *necessary* condition for a rail and none of them is
 * sufficient — a rail reported `active` still refuses a donation over the currency it is charged
 * in, the amount, or where the donor's bank is. ./rail-chargeability.ts is the module that states
 * that in full and turns these three facts into the vocabulary a screen may use; nothing built on
 * this type may promise that a rail will work.
 *
 * two rails and not the processor's whole capability hash, because two is what this app can mint an
 * intent for (`INTENT_METHODS` in ./stripe.ts). a field per capability the account happens to hold
 * would be a list to keep in step with somebody else's product catalogue, and no caller here has a
 * reader for one.
 */
export type AccountChargeability = {
	/**
	 * whether the account may process a charge at all.
	 *
	 * the account-level gate, above every rail: false makes every rail un-chargeable whatever its
	 * own state says, which is why it is carried beside them rather than folded into them. an
	 * account can hold an `active` card capability and still be switched off here — a restriction or
	 * a pause is applied to the account, not to the rail — and a reading that only looked at the
	 * capability would report a rail as approved on a deployment that cannot take a cent.
	 */
	readonly chargesEnabled: boolean;
	/** the state of the account's card capability. */
	readonly cardPayments: RailCapabilityState;
	/** the state of the account's US bank debit capability. */
	readonly achPayments: RailCapabilityState;
};

/**
 * one rail as the operator has it set on the processor's own dashboard.
 *
 * two booleans rather than one, and the second is the one that would otherwise be lost. `offered` is
 * the processor's own conjunction — the operator's switch is on *and* the account's capability for
 * the rail is active — so it is exactly the list a deployment offers and it is the field to derive
 * that list from. read alone it collapses two states with two different fixes: an account the
 * processor has not approved is a requirements flow measured in weeks, and a rail the operator
 * switched off is one click. `switchedOn` is the operator's half by itself, and it is what tells the
 * two apart when it is read beside `AccountChargeability` above.
 */
export type RailSwitch = {
	/** whether the processor will present this rail at all: switched on and approved. */
	readonly offered: boolean;
	/** whether the operator's own switch is on, whatever the account's approval says. */
	readonly switchedOn: boolean;
};

/**
 * what the operator has switched on, one entry per rail this app's form vocabulary holds.
 *
 * total over `QuotedRail`, so a rail added to `PAYMENT_METHODS` in packages/form/src/v1.ts is an adapter
 * that no longer compiles rather than a rail silently missing from the answer. the wallets carry an
 * entry like anything else — the processor holds a switch for each of them — and what this
 * deployment can do with that is ./rail-chargeability.ts's decision rather than this type's.
 *
 * nothing here says a rail will work. it is the same caveat `AccountChargeability` carries and for
 * the same reason: a rail switched on and approved still refuses a donation over the currency, the
 * amount, or where the donor's bank is.
 */
export type RailSwitchboard = Readonly<Record<QuotedRail, RailSwitch>>;

/**
 * one webhook endpoint registered on the processor's account, as a screen has to read it.
 *
 * enough to answer the question /admin asks — is this deployment's own URL registered, is the
 * processor actually delivering to it, and is it subscribed to everything the handler settles on —
 * and nothing beyond that.
 *
 * no secret, and that is the shape of the thing rather than a field left off. an endpoint's signing
 * secret is handed over once, in the answer to the call that creates it, and no read of any kind
 * returns it afterwards — see `RegisteredWebhookEndpoint` below, which is the only type in this file
 * that carries one.
 */
export type WebhookEndpointSummary = {
	/** the processor's own id for the endpoint, and what `replaceWebhookEndpoint` names. */
	readonly id: string;
	/** the URL deliveries are posted to, exactly as it was registered. */
	readonly url: string;
	/**
	 * whether the processor is currently delivering to it.
	 *
	 * a boolean rather than the processor's own word for the state, because the two a screen has to
	 * tell apart are delivering and not. an endpoint that exists and is switched off is the shape
	 * that reads as a finished setup while nothing ever arrives.
	 */
	readonly enabled: boolean;
	/**
	 * what it is subscribed to, spelled the way the processor spells it.
	 *
	 * carried verbatim and never switched on, the same rule `PaymentEvent.type` above keeps. what a
	 * caller does with it is compare it against `WebhookEndpointRegistry.requiredEventTypes` and show
	 * what is missing: an endpoint registered by hand is subscribed by searching a list one event at
	 * a time, which is exactly how one member gets left off — and a settlement nobody subscribed to
	 * is a gift that never posts, with a green-looking endpoint above it.
	 */
	readonly eventTypes: readonly string[];
	/**
	 * the API version deliveries to this endpoint are serialised in, or null for the account's own.
	 *
	 * reported rather than acted on, and it is the field that says whether this endpoint is the one
	 * this app registered. an endpoint pinned to nothing follows whatever version the account is set
	 * to, which is a value somebody can change in a dashboard — so a screen can show that an endpoint
	 * exists and is not the endpoint `registerWebhookEndpoint` would have made.
	 */
	readonly apiVersion: string | null;
	/**
	 * the fingerprint of the signing secret this endpoint was created with, or null where it carries
	 * none.
	 *
	 * the only fact on this type that can be compared against what the deployment holds. the secret
	 * itself is returned once and never again — see `RegisteredWebhookEndpoint` below — so a
	 * deployment holding a stale one reads exactly like a deployment holding the right one, and that
	 * is a console saying the payments line is fine while every delivery fails verification.
	 * `secretFingerprint` in `@better-giving/operator/stripe/secret-fingerprint` is what produces both
	 * sides of the comparison.
	 *
	 * null is a third answer and not a mismatch: an endpoint registered in a dashboard or by
	 * `stripe listen` was never stamped, so what can be said about it is nothing rather than no.
	 */
	readonly secretFingerprint: string | null;
};

/**
 * what the processor's account holds, and what this app needs one of them to be.
 *
 * the required list travels with the endpoints instead of being imported from wherever the adapter
 * keeps it, so that a caller comparing the two takes both facts from one answer. it is also what
 * keeps the processor's event vocabulary out of a screen's own source: the strings are displayed and
 * diffed, never written down a second time.
 *
 * the list is the whole account in one answer, and it is bounded by the processor rather than by
 * this app — an account may register at most sixteen endpoints
 * (https://docs.stripe.com/webhooks#register-your-endpoint), which is why nothing here paginates.
 */
export type WebhookEndpointRegistry = {
	/** every endpoint registered on the account these credentials name. */
	readonly endpoints: readonly WebhookEndpointSummary[];
	/** what a usable endpoint is subscribed to, in the processor's own spelling. */
	readonly requiredEventTypes: readonly string[];
};

/**
 * an endpoint that has just been registered, with the only copy of its signing secret there is.
 *
 * the secret is returned at creation and never again — no retrieve, no list and no update on either
 * of the processor's two APIs hands it back
 * (https://docs.stripe.com/api/webhook_endpoints/create — "Returns the webhook endpoint object with
 * the `secret` field populated" — against
 * https://docs.stripe.com/api/webhook_endpoints/list, whose objects carry none). so a caller that
 * loses this value has no way to ask for it: what replaces it is a new endpoint, which is what
 * `replaceWebhookEndpoint` is for.
 *
 * it is a credential and behaves like one: it is shown to an operator once so they can set
 * `STRIPE_WEBHOOK_SECRET` with it, and it is never logged, never echoed into a failure's `detail`
 * and never written to a row — secrets in this app are deploy-time and live only under
 * `src/lib/server/**` (CLAUDE.md).
 */
export type RegisteredWebhookEndpoint = {
	readonly endpoint: WebhookEndpointSummary;
	/** the value `STRIPE_WEBHOOK_SECRET` is set to for this endpoint. */
	readonly signingSecret: string;
};

/**
 * the wallets this app draws inside the processor's payment element, as a closed set.
 *
 * a list of its own rather than a subset of `QuotedRail`, and `link` is why: it is not in
 * `PAYMENT_METHODS` in packages/form/src/v1.ts at all — `chosenRail` in
 * packages/form/src/embed/stripe.ts is where a donation form's silence about it is argued, and a
 * donor who picks it is quoted on the card rail — so a type derived from the form's vocabulary could
 * not hold it. what these three share is not how a donor pays but where they are allowed to appear:
 * the processor draws none of them on a hostname that is not registered for it
 * (https://docs.stripe.com/payments/payment-methods/pmd-registration).
 *
 * the processor reports a block per wallet on a registered hostname and holds more of them than
 * this — PayPal, Amazon Pay, Klarna — and this deployment draws none of those, so none of them is
 * carried across the port. a member with no reader is a state a screen has to find a sentence for.
 *
 * a `const` array plus a derived union, the way `PAYMENT_FAILURE_REASONS` above does it: the array
 * is what makes "did we cover all of them" checkable.
 */
export const WALLETS = ['apple_pay', 'google_pay', 'link'] as const;
export type Wallet = (typeof WALLETS)[number];

/**
 * how far the processor has got with one wallet on one registered hostname, as a closed set.
 *
 * two members, because the processor's own vocabulary here is two words
 * (https://docs.stripe.com/api/payment_method_domains/list). anything else it reports later is read
 * as `inactive`, which is the direction safe to be wrong in: a wallet reported active and not drawn
 * is an operator told their setup is finished over a donation page missing the button.
 *
 *   active   — the processor draws this wallet on this hostname.
 *   inactive — it does not, because a requirement for it is unmet. `levelWalletDomains` in
 *              ./wallet-domains.ts is the press that asks the processor to look again.
 */
export const WALLET_STATES = ['active', 'inactive'] as const;
export type WalletState = (typeof WALLET_STATES)[number];

/**
 * one wallet on one registered hostname: whether the processor draws it, and what it says about not
 * drawing it.
 *
 * the sentence is the half a screen cannot write for itself. what an inactive wallet is short of is
 * a requirement on the operator's own domain — a file the domain does not serve, a name the domain
 * does not match, an agreement not accepted — and every one of those is settled somewhere this
 * deployment cannot see, so the state word alone tells an operator that something is wrong and
 * nothing about where to go. the processor is the only thing that knows, and this is what it wrote.
 *
 * `WalletStanding` and not `WalletDomainStanding`, which is a different thing in
 * ./wallet-domains.ts: that one is a whole hostname as a screen draws it, and this is one wallet on
 * one. unqualified, the two are one grep and an import line that does not say which arrived — the
 * same trap `RAIL_CAPABILITY_STATES` above is named against.
 */
export type WalletStanding = {
	readonly state: WalletState;
	/**
	 * the processor's own sentence about this wallet on this hostname, or null where it wrote none.
	 *
	 * null is the ordinary case rather than a gap: a wallet that is drawn has nothing to explain, and
	 * the processor sends no sentence for one. so absence is "nothing to say" and never "the reason
	 * could not be read".
	 *
	 * it is the operator's own domain being described, so it is carried rather than withheld — but it
	 * is somebody else's prose reaching a screen and a 4xx body, so it arrives bounded, flattened to
	 * one line and stripped of anything key-shaped, exactly as every other borrowed sentence in this
	 * port does (`quoteProvider` in ./stripe.ts). it is never a credential and nothing here may make
	 * it one.
	 */
	readonly detail: string | null;
};

/**
 * one hostname registered on the account for wallets, as a screen has to read it.
 *
 * no processor id on it, and that omission is the design rather than a field left off. an id is
 * what switching a registered hostname back on takes, and `registerWalletDomain` below does that
 * from the hostname instead — so no caller ever holds one, nothing can post one back, and a press
 * acts on the hostname it was given rather than on whichever object a request happened to name. the
 * hostname identifies one of these anyway: the account holds at most one per hostname.
 *
 * `enabled` and the wallet states are two facts and both have to be read. a hostname switched off
 * draws nothing whatever its wallets say, and a hostname switched on draws only the wallets that
 * are `active` on it.
 */
export type WalletDomain = {
	/** the hostname exactly as the account holds it — no scheme, no port, no path. */
	readonly host: string;
	/** whether the processor honours this registration at all. */
	readonly enabled: boolean;
	/**
	 * where each drawn wallet stands on this hostname, and what the processor says about the ones it
	 * is not drawing.
	 *
	 * total over `Wallet`, so a wallet added to that list is an adapter that no longer compiles
	 * rather than a wallet silently missing from every answer.
	 */
	readonly wallets: Readonly<Record<Wallet, WalletStanding>>;
};

/**
 * what this deployment's account needs to hold before a gift can be made to repeat.
 *
 * one boolean and no id, and the missing id is the design. what the processor holds standing for
 * recurring giving is found on every request that needs it, the way this deployment's webhook
 * endpoint is found by its URL (./webhook-registration.ts states the rule and its reason) — so
 * there is nothing here for a row to keep, nothing for an environment variable to carry and nothing
 * for an operator to paste. a value handed out would be a claim about a third party's state that
 * nothing in this deployment could ever be told had changed.
 *
 * `created` is what the operator's screen says afterwards, and it is the only thing that separates
 * the two successes: the account had nothing and now does, or it already did and nothing happened.
 * both are the same finished state, which is what makes the button safe to press twice.
 */
export type RecurringGiftProvision = {
	/** whether this call is what put it there, rather than finding it already registered. */
	readonly created: boolean;
};

/**
 * what the account holds for repeating gifts, read without changing it.
 *
 * three members and not two, because an account can hold the thing in a state that is neither
 * present nor absent:
 *
 *   ready    — the account holds it and it can be charged against. nothing to do.
 *   absent   — the account holds nothing. the fresh-fork state, and the one the setup button
 *              belongs to.
 *   archived — the account holds it and it cannot be charged against. an operator archived it, and
 *              it is not replaced: every gift already repeating is charged against that one, so a
 *              new one beside it would leave those gifts charged against the archived one. the way
 *              out is unarchiving it where it was archived, which is a screen this app does not
 *              have.
 *
 * folded into two, `archived` would be wrong whichever way it went — read as `absent` it draws a
 * setup button that `prepareRecurringGifts` refuses, and read as `ready` it reports a deployment
 * that can take a repeating gift and cannot.
 *
 * a failure is not a member and must not become one: a read that could not be made says nothing
 * about what the account holds, and `PaymentResult`'s failing arm is where it goes.
 */
export type RecurringGiftStanding = 'ready' | 'absent' | 'archived';

/**
 * how often a gift repeats, as the port takes it.
 *
 * derived from `FREQUENCIES` in packages/form/src/v1.ts rather than spelled again, and derived by
 * subtraction rather than by listing the two: a frequency added to the wire contract arrives here on
 * its own and is a compile error at the adapter's mapping table, where a rail added to
 * `PAYMENT_METHODS` already lands. spelled independently, a fourth frequency would be a donor
 * offered something no adapter can charge, and nothing would say so until they picked it.
 *
 * `one_time` is excluded because a gift that happens once is not a repeating one: it is minted by
 * `createIntent` above, settles as a `Settlement`, and has no commitment behind it to cancel.
 */
export type RecurringInterval = Exclude<Frequency, 'one_time'>;

/**
 * how far the processor has got with one repeating gift, as a closed set.
 *
 * four members and none of them is the processor's own word, which is the containment this port
 * exists for. the processor holds eight states, several of which this app can never reach — it
 * never trials, never pauses and never invoices by email — so a union mirroring them would be six
 * values with no reader and two with no test.
 *
 *   pending — created, and nothing has been collected yet. the donor has not confirmed the first
 *             collection, or their confirmation is still in flight. every commitment starts here,
 *             so it is what `createRecurringGift` ordinarily answers with. also what any state this
 *             app does not recognise reads as, which is the direction safe to be wrong in: nothing
 *             may be acted on from `pending`, and the next read corrects it.
 *   active  — collecting. the processor's own retry schedule running against a missed charge is
 *             still this, because the processor has not given up and neither has the commitment.
 *   lapsed  — the processor gave up. the charge never succeeded and it will not try again, which is
 *             what the dashboard shows against a gift that has quietly stopped. a gift the donor never
 *             confirmed lands here 23 hours after it was made
 *             (https://docs.stripe.com/billing/subscriptions/overview#subscription-statuses), which
 *             is why an unconfirmed commitment needs no cleaning up and cannot be resumed — a donor
 *             coming back later is a new gift.
 *   ended   — cancelled, and nothing further will be collected. the only state this app puts a gift
 *             into itself, through `cancelRecurringGift`.
 *
 * a `const` array plus a derived union, the way `PAYMENT_FAILURE_REASONS` above does it: the array
 * is what makes "did we cover all of them" checkable.
 */
export const RECURRING_GIFT_STATES = ['pending', 'active', 'lapsed', 'ended'] as const;
export type RecurringGiftState = (typeof RECURRING_GIFT_STATES)[number];

/**
 * what a repeating gift is made from.
 *
 * every number here is the server's, for the reason `IntentRequest` above states it: an amount that
 * arrived from a browser is an input to look up against the form record, never a figure to send. the
 * stake is higher on this type than on that one — a wrong amount here is not one charge but every
 * charge, for as long as nobody cancels it.
 */
export type RecurringGiftRequest = {
	/** minor units, a positive safe integer, charged in full every interval. 2500 is $25.00. */
	readonly amountMinor: number;
	/** ISO-4217, uppercase, as `entry_group.currency` holds it. */
	readonly currency: string;
	/** how often `amountMinor` is collected. */
	readonly interval: RecurringInterval;
	/**
	 * the rail the donor was quoted on, and the only one this commitment may ever be collected on.
	 *
	 * it travels on the request rather than being decided by the adapter, for the reason
	 * `IntentRequest.method` above carries it: `amountMinor` was priced for this rail (./fees.ts) and
	 * no other, and a rail this deployment may not charge is refused by ./rail-chargeability.ts
	 * before a request is built. left off, a processor picks the rails from whatever an operator's
	 * dashboard says — the deployment's own configuration stops deciding, and it stops deciding for
	 * every collection this gift ever makes rather than for one charge.
	 */
	readonly method: QuotedRail;
	/**
	 * what makes this attempt the same attempt when it is made twice.
	 *
	 * required, and it does more work here than on `IntentRequest`: this arm makes several writes on
	 * the processor's side, and a repeat under the same key resolves every one of them to the object
	 * that already exists rather than to a second. so an answer that never arrived is settled by
	 * making the identical call again — which is exactly what the settlement path does with a
	 * redelivered notification.
	 */
	readonly idempotencyKey: string;
	/**
	 * what this app needs written on the processor's copy of the commitment.
	 *
	 * this is the anchor for every charge after the first. a repeat charge carries none of its own —
	 * the processor mints it without the metadata the opening one had — so what the commitment
	 * carries is the only thing tying charge fifty back to the gift it belongs to.
	 *
	 * never a donor's details beyond what collecting the gift needs, the rule `IntentRequest` states.
	 */
	readonly metadata?: Readonly<Record<string, string>>;
};

/**
 * a commitment the processor now holds, as the row that records it needs it — plus the one field
 * that is handed onward instead.
 *
 * the two ids are stored, and they are the same category as `payment.provider_txn_id` already is:
 * identifiers for objects this deployment created, not a mirror of somebody else's state. that is
 * what separates them from the product behind `RecurringGiftProvision` above, which is found on
 * every request precisely because nothing here created it as this donor's.
 *
 * `paymentToken` is not one of them and is not stored. it is spent once, by the browser that
 * confirms this gift's first collection, and it is worth nothing afterwards.
 */
export type RecurringGift = {
	/** the processor's own id for the commitment, and what `cancelRecurringGift` names. */
	readonly providerGiftId: string;
	/**
	 * the processor's own id for the donor's record on that account.
	 *
	 * returned so it can be stored, which is the whole reason it is on this type: without it, the
	 * only way back to a donor's commitments is a paginated search per gift, and a search on this
	 * runtime is a request budget spent on a question already answered.
	 */
	readonly providerCustomerId: string;
	readonly state: RecurringGiftState;
	/**
	 * what the donor's browser confirms this gift's first collection with, opaque here as
	 * `Intent.paymentToken` is and named the same for the same reason.
	 *
	 * it is the same kind of value the one-off path already hands a browser, so a donation form
	 * confirms a repeating gift with exactly the code that confirms a single one and no second way
	 * of confirming exists anywhere in this app.
	 *
	 * never stored and never logged: it authorises the collection it belongs to, and a commitment is
	 * already identified by `providerGiftId`.
	 */
	readonly paymentToken: string;
	/** business time: when the commitment began, as the dashboard shows it. */
	readonly startedAt: Date;
};

/** a commitment that has stopped, and when. */
export type RecurringGiftEnd = {
	readonly providerGiftId: string;
	/** business time: when collection stopped, which is when the call was made. */
	readonly endedAt: Date;
};

/**
 * what a delivery about a repeating gift turns out to be, read from the processor rather than
 * reconstructed from the event.
 *
 * the same rule `Settlement` above is written under, and it bites harder here: a commitment
 * outlives every delivery about it, so a state taken from an event that overtook another would be a
 * gift recorded as collecting after it stopped. everything here comes from a read against the pinned
 * version.
 *
 * it carries no amount, no currency and no fee. those are facts about one transaction and this app
 * already has one arm that reads them — `readSettlement` against `providerTxnId` — so a second copy
 * of them here would be two numbers for one charge with nothing saying which is the one to post.
 */
export type RecurringGiftNotice = {
	/**
	 * which of the two things this delivery was about, decided by the adapter that already knows.
	 *
	 *   collection — one charge under the commitment. money was meant to move.
	 *   commitment — the commitment's own standing changing. no charge is involved at all.
	 *
	 * it is here rather than derived by a caller from `providerTxnId` below, and the difference is a
	 * gift: a collection settled outside the processor carries no transaction, so read as "no
	 * transaction means no collection" a payment received out of band becomes a delivery about
	 * nothing. and it is here rather than derived from the delivery's `type`, because a caller
	 * telling the two apart itself would be spelling the processor's own event vocabulary — which
	 * is what this port exists to keep at one file.
	 */
	readonly about: 'collection' | 'commitment';
	/** the commitment this delivery is about, and what the gift's own record is found by. */
	readonly providerGiftId: string;
	/**
	 * the processor's own id for the donor's record, as `RecurringGift.providerCustomerId` carries
	 * it at creation.
	 *
	 * it is on this type because the row that records a commitment is written by its first
	 * successful collection rather than by the call that created it (`recurring_plan` in
	 * ../db/schema.ts), and that column is NOT NULL — so the id has to arrive with the collection
	 * that opens the row, not only with the answer nobody stored.
	 */
	readonly providerCustomerId: string;
	/** where the commitment stands now, read from it rather than inferred from the delivery. */
	readonly state: RecurringGiftState;
	/**
	 * how often the processor's own schedule says this collects, or null where that cadence is not
	 * one this app models.
	 *
	 * the schedule rather than the metadata, and it is the second answer rather than the first: what
	 * a commitment was set up as is what `INTERVAL_METADATA_KEY` carries, and this is what the rail
	 * will actually do. they agree on every commitment this app made. it is here so that a
	 * commitment whose metadata cannot be read still records a gift — a cadence is a label on money
	 * that has already moved, and refusing the money over the label is the worse trade.
	 *
	 * null covers a cadence outside `RECURRING_INTERVALS` — weekly, daily, every third month — which
	 * is a commitment this app did not make and cannot describe. inventing the nearest member would
	 * be a row asserting a schedule nobody set.
	 */
	readonly interval: RecurringInterval | null;
	/**
	 * what the commitment carries on the processor's copy of itself, read back.
	 *
	 * the three keys above are what this app writes there and the only reason this field exists:
	 * every collection after the first arrives with no metadata of its own, so a handler that could
	 * only find the donor by what the charge carried would have nothing at all. read off the
	 * commitment rather than off the collection's own invoice, so charge one and charge fifty
	 * resolve by the same means.
	 */
	readonly metadata: Readonly<Record<string, string>>;
	/**
	 * when the processor expects to collect next, or null where it expects nothing further.
	 *
	 * an expectation and never an authority, which is the same thing `recurring_plan.next_charge_at`
	 * says about the column it feeds: the schedule is the rail's, nothing in this deployment sweeps
	 * it, and no money moves because of what it says.
	 */
	readonly nextChargeAt: Date | null;
	/**
	 * the transaction this collection was attempted on, for `readSettlement` to reconcile.
	 *
	 * null on a delivery about the commitment itself, which is about no collection at all. null too
	 * where a collection has no transaction behind it — an invoice settled outside the processor is
	 * marked paid with nothing to read a fee or a rail off — and that is an outcome to record rather
	 * than a fault: the money moved somewhere this app cannot see.
	 */
	readonly providerTxnId: string | null;
	/**
	 * business time: when collection stopped, on a commitment that has stopped.
	 *
	 * null while it is still standing, and null on a commitment the processor gave up on without
	 * ending — a gift can lapse with nothing further collected and no end recorded against it. a
	 * caller writing an end date for one of those has `PaymentEvent.occurredAt`, which is the
	 * delivery's own time and is never a guess.
	 */
	readonly endedAt: Date | null;
};

export interface PaymentProvider {
	/**
	 * makes sure the processor's account holds what a repeating gift is charged against, and says
	 * whether that call is what put it there. safe to call twice, and every arm below that needs it
	 * calls it.
	 *
	 * find-or-create rather than a read and a separate write, because the two can never be allowed
	 * to disagree: a deployment that could charge a repeating gift only after somebody pressed a
	 * button would refuse the first donor to pick Monthly on a fork nobody set up, and a read that
	 * reported the account ready without the object existing would refuse them later and further
	 * from the cause.
	 */
	prepareRecurringGifts(): Promise<PaymentResult<RecurringGiftProvision>>;

	/**
	 * says what the account holds for repeating gifts, and changes nothing.
	 *
	 * the read beside the find-or-create above, and the two are not interchangeable: `prepare` makes
	 * the thing where the account holds none, so a screen drawn from it would provision an operator's
	 * account as a side effect of them looking at it. this one is what the console asks, and it
	 * is safe to call on every view of that page for exactly that reason.
	 *
	 * it answers with a standing rather than a boolean, because an archived one is a third state an
	 * operator needs a different sentence for — see `RecurringGiftStanding` above.
	 *
	 * it carries no id, the way the provision above carries none: what the account holds is found by
	 * an id this app derives, so there is nothing here for a row to keep, an environment variable to
	 * carry, or a form to post back.
	 */
	readRecurringGiftProvision(): Promise<PaymentResult<RecurringGiftStanding>>;

	/**
	 * commits a donor to a gift that repeats, and mints what their browser confirms the first
	 * collection with. charges nothing itself.
	 *
	 * the same shape `createIntent` below has, and deliberately so: the commitment is created
	 * awaiting payment, its first collection carries a `paymentToken`, and the donor's browser
	 * confirms that token exactly as it confirms a one-off gift. a repeating gift therefore needs no
	 * second way of confirming anywhere in this app — which is the whole reason it is built this way,
	 * because the confirming code is the donation form's public contract.
	 *
	 * so it takes no standing permission to charge and mints none. what the donor confirms is this
	 * gift's own first collection, and the processor keeps the method they used as the commitment's
	 * default for every collection after it.
	 *
	 * an answer comes back `pending`, and the caller may act on nothing until a settlement says
	 * otherwise: nothing has been collected at the moment this returns. a commitment nobody confirms
	 * is abandoned by the processor rather than left standing — see `RecurringGiftState` above.
	 *
	 * retried with the same `idempotencyKey` after any retryable failure, which is what makes a lost
	 * answer safe. the arm makes several writes and every one of them is keyed off that value, so a
	 * repeat resolves to the objects that already exist rather than committing the donor twice.
	 *
	 * it takes no processor customer, and creating one is part of what it does: the id comes back on
	 * `RecurringGift` for the caller to store. a donor who commits twice has two of them, which is
	 * the honest shape of a commitment that can never be edited — one confirmation, one commitment,
	 * one record, and no state shared between two gifts that a cancellation could reach across.
	 */
	createRecurringGift(request: RecurringGiftRequest): Promise<PaymentResult<RecurringGift>>;

	/**
	 * stops a repeating gift, effective at once. nothing further is collected and nothing already
	 * collected is returned.
	 *
	 * immediate rather than at the end of the period the donor has paid for, which is the decision
	 * that keeps this arm a single state change: run to the period end and a commitment spends weeks
	 * in a state that is neither collecting nor stopped, visible on the dashboard, cancellable again, and
	 * needing its own word. a refund is a separate act with its own record.
	 *
	 * it takes no idempotency key, and that is the processor's rule rather than an omission: the
	 * operation is a delete, and a delete is idempotent by definition — a key sent on one has no
	 * effect (https://docs.stripe.com/api/idempotent_requests). the operator's button is therefore
	 * safe to press twice by construction.
	 */
	cancelRecurringGift(providerGiftId: string): Promise<PaymentResult<RecurringGiftEnd>>;

	/**
	 * mints an intent for one attempt, payable only on the rail it was quoted for. never charges
	 * anything — the donor's browser confirms.
	 *
	 * retried with the same `idempotencyKey` after any retryable failure, which is what makes a
	 * lost answer safe. see `PaymentFailure` for why there is no flag saying so, and `isRetryable`
	 * for which failures those are.
	 */
	createIntent(request: IntentRequest): Promise<PaymentResult<Intent>>;

	/**
	 * checks a delivery's signature and says what it is about. never throws, never reads an
	 * unverified body.
	 *
	 * an unverified delivery is refused rather than parsed, and the order matters: anyone can post
	 * JSON to a public endpoint, so a handler that read the body first and checked the signature
	 * afterwards would be a way to grant yourself a donation record.
	 */
	verifyEvent(delivery: WebhookDelivery): Promise<PaymentResult<PaymentEvent>>;

	/**
	 * reads what a transaction currently is. the reconciliation read, safe to repeat.
	 *
	 * it can take seconds rather than one round trip, and that is the arm's contract rather than an
	 * implementation detail a caller may ignore: a charge whose fee the processor has not computed yet
	 * is asked for again before this answers, and refused as `fee_not_ready` if the figure has still
	 * not landed. so a caller holds any write until this returns — a charge posted first could never
	 * have its fee added, because the grain that refuses a duplicate posting refuses the second write
	 * too (`entry_group_source_idx` in ../db/schema.ts).
	 */
	readSettlement(providerTxnId: string): Promise<PaymentResult<Settlement>>;

	/**
	 * says which repeating gift a delivery is about, and which collection under it. the
	 * reconciliation read for the recurring kind, safe to repeat.
	 *
	 * it takes the whole delivery rather than an id, because the id alone does not say what it names:
	 * a delivery about a repeating gift names a commitment on one event type and one of its
	 * collections on another, and the two are fetched differently. handing back the delivery keeps
	 * that decision inside the adapter, where the processor's event vocabulary already lives — the
	 * alternative is a caller reading the processor's id prefixes, which is the thing this port
	 * exists to keep at one file.
	 *
	 * a caller acts on nothing it returns until it has read the money too: the state here is the
	 * commitment's, and what was collected is `readSettlement` against `providerTxnId`.
	 */
	readRecurringGift(event: RecurringEvent): Promise<PaymentResult<RecurringGiftNotice>>;

	/**
	 * what the account these credentials name is approved to charge. reads nothing about a payment
	 * and changes nothing.
	 *
	 * the account is read rather than any object this app created, which is what makes it answerable
	 * on a deployment that has never taken a donation — the state where the question is actually
	 * asked. it is also already scoped to the mode the credentials are in, the same way
	 * `listWebhookEndpoints` is: a test-mode key reports the test-mode account's approvals and
	 * nothing about the live one, so the two are never mistaken for each other here.
	 *
	 * it takes no rail and answers about the account as a whole, because the processor answers that
	 * way: the approvals arrive together on one object, so a per-rail arm would be one round trip per
	 * rail against a single answer that already holds all of them.
	 */
	readAccountChargeability(): Promise<PaymentResult<AccountChargeability>>;

	/**
	 * which rails the operator has switched on, wherever the processor keeps that setting. reads
	 * nothing about a payment and changes nothing.
	 *
	 * a second read rather than more fields on `readAccountChargeability`, because they are two facts
	 * about two different things: one is what the processor has approved this account for, the other
	 * is what the operator chose to offer out of that. an answer carrying only their conjunction could
	 * not say which of the two a missing rail is missing for, and those have different fixes.
	 *
	 * already scoped to the mode the credentials are in, the way every other read here is: a test-mode
	 * key reports the test-mode settings and nothing about the live ones.
	 *
	 * the processor does not hold this app to the answer. ./rail-chargeability.ts is where that is
	 * stated in full, and it is the reason this read exists at all rather than being left to the
	 * processor to apply.
	 */
	readRailSwitchboard(): Promise<PaymentResult<RailSwitchboard>>;

	/**
	 * every webhook endpoint registered on this account, and what one of them has to be subscribed
	 * to. reads nothing about a payment and changes nothing.
	 *
	 * the account is the one this deployment's credentials name, so the answer is already scoped to
	 * the mode those credentials are in — a test-mode key lists test-mode endpoints and nothing else.
	 * which mode that is gets read off the key wherever it matters and is not restated here.
	 *
	 * the caller matches on `url`, because this app knows no URL of its own to match on: the
	 * deployment's hostname is not committed to this repository (CLAUDE.md), so it comes off the
	 * request that asked.
	 */
	listWebhookEndpoints(): Promise<PaymentResult<WebhookEndpointRegistry>>;

	/**
	 * registers an endpoint for `url`, subscribed to exactly what this app acts on and pinned to the
	 * API version this app reads events against.
	 *
	 * safe to call twice, and it has to be: the answer carries the endpoint's signing secret, which
	 * exists in exactly one answer and cannot be asked for again, so a second call that quietly made
	 * a second endpoint would leave the deployment holding a secret for whichever of them it happened
	 * to keep — and an account may hold only sixteen. so an implementation looks first, and an
	 * already-registered `url` is refused with a failure naming the endpoint that holds it rather
	 * than silently duplicated.
	 *
	 * `url` is the caller's, taken from the request that asked, and it must be an `https://` one:
	 * the processor refuses to deliver to anything else, and a deployment cannot be registered from
	 * a laptop. a local endpoint is fed by `stripe listen` instead, which prints a secret of its own.
	 */
	registerWebhookEndpoint(url: string): Promise<PaymentResult<RegisteredWebhookEndpoint>>;

	/**
	 * brings the endpoint `id` up to what this app needs — subscribed to exactly what this app acts
	 * on, and switched on — without touching its signing secret.
	 *
	 * the repair for an endpoint that is the right endpoint and is not yet doing the job: one
	 * subscribed event left off, or a delivery switch that is off. both are ordinary rather than
	 * exotic — a list subscribed by hand is subscribed one search at a time, and the processor
	 * disables an endpoint that has been failing — and both look exactly like a finished setup on a
	 * screen while nothing is ever posted to the books.
	 *
	 * it exists so that repairing one is not replacing one. `replaceWebhookEndpoint` below is a
	 * delete and a create, which mints a new secret and kills the one an operator has already set and
	 * redeployed with; nothing about a missing subscription justifies that. the processor's update
	 * operation edits the subscription list and the enabled state and returns the endpoint with no
	 * `secret` on it (https://docs.stripe.com/api/webhook_endpoints/update), so the deployment's
	 * `STRIPE_WEBHOOK_SECRET` goes on verifying across this call.
	 *
	 * it takes no event list, for the reason `registerWebhookEndpoint` takes none: what a usable
	 * endpoint is subscribed to is the adapter's own fact — the same list `listWebhookEndpoints`
	 * reports as `requiredEventTypes` — and a list travelling in from a caller is a second copy of it
	 * to keep in step.
	 *
	 * it returns a `WebhookEndpointSummary` and never a `RegisteredWebhookEndpoint`, which is the
	 * type saying no secret came out of this: an update cannot mint one, so a return that had
	 * somewhere to put one would be a slot nothing can fill.
	 *
	 * what it cannot repair is the API version an endpoint's deliveries are serialised in — that is
	 * fixed when an endpoint is created and the update operation has no parameter for it. an endpoint
	 * on the wrong version is a replacement.
	 */
	resubscribeWebhookEndpoint(id: string): Promise<PaymentResult<WebhookEndpointSummary>>;

	/**
	 * deletes the endpoint `id` and registers a fresh one for `url`, which is how a lost signing
	 * secret is recovered.
	 *
	 * a replacement rather than a re-issue, because re-issuing is not something the processor's API
	 * can do. rolling an endpoint's secret exists only in the dashboard
	 * (https://docs.stripe.com/webhooks#roll-endpoint-secrets), and neither
	 * https://docs.stripe.com/api/webhook_endpoints nor
	 * https://docs.stripe.com/api/v2/core/event_destinations has an operation for it. what this does
	 * instead has two consequences an operator has to be told: the new endpoint has a new id, and the
	 * old secret stops verifying the moment the old endpoint is gone — where the dashboard's roll can
	 * keep the previous secret alive for up to 24 hours, this cannot.
	 *
	 * ordered delete-then-create, so the account is never briefly holding two endpoints for one URL
	 * with only one of their secrets known. the cost of that order is the window between them: a
	 * failure to create leaves the deployment with no endpoint at all, and an implementation says so
	 * in the failure rather than reporting the create's own message alone.
	 */
	replaceWebhookEndpoint(
		id: string,
		url: string
	): Promise<PaymentResult<RegisteredWebhookEndpoint>>;

	/**
	 * every hostname this account has registered for wallets, and where each drawn wallet stands on
	 * it. reads nothing about a payment and changes nothing.
	 *
	 * the read behind "will a donor on that site see the wallet buttons at all". the processor draws
	 * Apple Pay, Google Pay and Link only on a hostname registered for them, so a site that is not on
	 * this list offers a donor the ways of paying that are left.
	 *
	 * the account is the one this deployment's credentials name, so the answer is already scoped to
	 * the mode those credentials are in, the way `listWebhookEndpoints` above is.
	 *
	 * the caller matches on `host`, because this app knows no hostname of its own to match on: a
	 * deployment's sites are the operator's own rows and its own address comes off the request that
	 * asked (CLAUDE.md).
	 */
	listWalletDomains(): Promise<PaymentResult<readonly WalletDomain[]>>;

	/**
	 * registers `host` for wallets, switches it back on where the account holds it and it is off, and
	 * asks the processor to look again at any drawn wallet that is not active. safe to call twice.
	 *
	 * find-or-create by construction rather than by a look-up and then a create: the processor
	 * answers a registration for a hostname it already holds with that hostname's existing object
	 * rather than with an error, so one call covers both states and there is no window between them
	 * for a second registration to appear in.
	 *
	 * one hostname, exactly as given. no scheme, no port, and nothing added or stripped —
	 * `www.example.org` and `example.org` are two registrations, which is the processor's rule rather
	 * than this app's, so a deployment serving both registers both.
	 *
	 * no idempotency key, for the reason `registerWebhookEndpoint` above carries none: what makes
	 * this safe to repeat is the account's own state rather than a key, and nothing here mints a
	 * secret that a replayed answer could hand back dead.
	 *
	 * the look-again is one call and never a loop. what an inactive wallet is short of is satisfied
	 * outside this deployment, so asking twice in one press answers twice the same way, and the
	 * answer is reported as it stands rather than waited on.
	 */
	registerWalletDomain(host: string): Promise<PaymentResult<WalletDomain>>;
}

/**
 * the contract, enforced rather than documented. wraps any provider so that a throw escaping one
 * of its methods — a rejected dynamic import, a `TypeError` from a response shape nobody expected,
 * a bug in an adapter — leaves as a `PaymentResult` like everything else.
 *
 * ./factory.ts is the only place a provider is handed out and it seals every one, so this is not
 * defence in depth over a promise already kept: it is the promise.
 *
 * the webhook is what makes it worth code rather than prose. an exception out of a handler is a
 * 500, the processor reads a 500 as "deliver this again", and a delivery that fails on a bug fails
 * on it identically for three days — while a `PaymentFailure` is a value the handler can classify
 * with `isRetryable` and answer terminally. the quote endpoint has the milder version of the same
 * problem: a throw there is a 500 on a public endpoint instead of a body naming the value to fix.
 *
 * a failure carries no correlation id, and the shape of the problem is why it does not: a
 * delivery's `PaymentEvent.id` is only known once `verifyEvent` has succeeded, and the failures
 * worth correlating are the ones where it did not. what ties a refusal to the request that
 * produced it is the log line below, inside the request the route is already handling.
 *
 * it logs for the reason `sealed` in ../email/provider.ts logs: a seal that swallowed the cause
 * would turn an adapter bug into a deployment that refuses every donation and reports a tidy
 * reason for it.
 */
export function sealed(provider: PaymentProvider): PaymentProvider {
	return {
		prepareRecurringGifts: () => guard(() => provider.prepareRecurringGifts()),
		readRecurringGiftProvision: () => guard(() => provider.readRecurringGiftProvision()),
		createRecurringGift: (request) => guard(() => provider.createRecurringGift(request)),
		cancelRecurringGift: (id) => guard(() => provider.cancelRecurringGift(id)),
		createIntent: (request) => guard(() => provider.createIntent(request)),
		verifyEvent: (delivery) => guard(() => provider.verifyEvent(delivery)),
		readSettlement: (providerTxnId) => guard(() => provider.readSettlement(providerTxnId)),
		readRecurringGift: (event) => guard(() => provider.readRecurringGift(event)),
		readAccountChargeability: () => guard(() => provider.readAccountChargeability()),
		readRailSwitchboard: () => guard(() => provider.readRailSwitchboard()),
		listWebhookEndpoints: () => guard(() => provider.listWebhookEndpoints()),
		registerWebhookEndpoint: (url) => guard(() => provider.registerWebhookEndpoint(url)),
		resubscribeWebhookEndpoint: (id) => guard(() => provider.resubscribeWebhookEndpoint(id)),
		replaceWebhookEndpoint: (id, url) => guard(() => provider.replaceWebhookEndpoint(id, url)),
		listWalletDomains: () => guard(() => provider.listWalletDomains()),
		registerWalletDomain: (host) => guard(() => provider.registerWalletDomain(host))
	};
}

/** one arm of the seal. `await` inside the `try`, so a rejected promise is caught too. */
async function guard<T>(call: () => Promise<PaymentResult<T>>): Promise<PaymentResult<T>> {
	try {
		return await call();
	} catch (error) {
		logProviderFault('a payment provider threw, which its contract forbids:', error);
		return {
			ok: false,
			reason: 'internal_error',
			detail:
				'The payment provider failed in a way it is not supposed to be able to: it threw ' +
				'instead of reporting. Nothing about the deployment fixes this. It is a bug in this ' +
				'app, and the cause is in this deployment’s logs (the Cloudflare dashboard, or `pnpm run logs` from a checkout).'
		};
	}
}

/**
 * writes a fault to the log without becoming one.
 *
 * `console.error(…, error)` is itself a throw site: it serialises the value it is given, which
 * runs whatever getter or `toString` the thrower supplied. so the one function whose entire job
 * is to have no throw site would have one — inside the `catch` that the seal depends on.
 *
 * swallowing the second failure is right here and nowhere else. the caller is already returning a
 * result that names the fault and points at the logs, and re-throwing would defeat the seal it is
 * called from. the same reasoning `logProviderFault` in ../email/provider.ts is written from; the
 * two are not shared because importing the mail module into the money path to reach a two-line
 * `try` would make a change to mail a change to payments.
 */
function logProviderFault(context: string, error: unknown): void {
	try {
		console.error(context, error);
	} catch {
		// nothing to report it to, and nothing this function may throw.
	}
}

/**
 * a provider that does nothing and says why — Stripe variables that are not set, a credential in
 * the wrong slot, an adapter that could not be built at all.
 *
 * one of these rather than a hand-rolled object per case, for the reason `refusing` in
 * ../email/provider.ts gives: a field added to `PaymentFailure` has to reach every arm, and the
 * compiler only catches a hand-written copy at the last one somebody remembers.
 *
 * it is the whole of the unconfigured-deployment path, which is a real state and not an edge: a
 * fresh fork has no Stripe variable set and still has to serve /admin. every arm of the port
 * therefore has an answer for it that is a value rather than an exception.
 */
export function refusing(reason: PaymentFailureReason, detail: string): PaymentProvider {
	const refusal: PaymentFailure = { ok: false, reason, detail };
	return {
		async prepareRecurringGifts(): Promise<PaymentResult<RecurringGiftProvision>> {
			return refusal;
		},
		async readRecurringGiftProvision(): Promise<PaymentResult<RecurringGiftStanding>> {
			return refusal;
		},
		async createRecurringGift(): Promise<PaymentResult<RecurringGift>> {
			return refusal;
		},
		async cancelRecurringGift(): Promise<PaymentResult<RecurringGiftEnd>> {
			return refusal;
		},
		async createIntent(): Promise<PaymentResult<Intent>> {
			return refusal;
		},
		async verifyEvent(): Promise<PaymentResult<PaymentEvent>> {
			return refusal;
		},
		async readSettlement(): Promise<PaymentResult<Settlement>> {
			return refusal;
		},
		async readRecurringGift(): Promise<PaymentResult<RecurringGiftNotice>> {
			return refusal;
		},
		async readAccountChargeability(): Promise<PaymentResult<AccountChargeability>> {
			return refusal;
		},
		async readRailSwitchboard(): Promise<PaymentResult<RailSwitchboard>> {
			return refusal;
		},
		async listWebhookEndpoints(): Promise<PaymentResult<WebhookEndpointRegistry>> {
			return refusal;
		},
		async registerWebhookEndpoint(): Promise<PaymentResult<RegisteredWebhookEndpoint>> {
			return refusal;
		},
		async resubscribeWebhookEndpoint(): Promise<PaymentResult<WebhookEndpointSummary>> {
			return refusal;
		},
		async replaceWebhookEndpoint(): Promise<PaymentResult<RegisteredWebhookEndpoint>> {
			return refusal;
		},
		async listWalletDomains(): Promise<PaymentResult<readonly WalletDomain[]>> {
			return refusal;
		},
		async registerWalletDomain(): Promise<PaymentResult<WalletDomain>> {
			return refusal;
		}
	};
}
