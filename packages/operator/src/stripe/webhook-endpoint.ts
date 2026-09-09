// what this deployment's webhook endpoint is: where it answers, what it is subscribed to, and the
// version its deliveries are serialised in.
//
// **the three facts are here together because an endpoint is registered from all of them at once,
// and because two ends now spell them.** the operator console creates the endpoint on the Stripe
// account and stores the signing secret the create returns; the deployment serves that address and
// reads what arrives. every one of these spelled differently at the two ends is a deployment that
// looks set up and takes nothing:
//
//   - the address — an endpoint registered at a URL one end joins differently reads as absent to
//     the other, one press away from a second endpoint whose signing secret nobody kept.
//   - the subscription — a delivery the endpoint was never subscribed to is a gift that never
//     reaches the books, and nothing anywhere reports a delivery that was not sent.
//   - the version — an endpoint pinned to a version the reader was not written against hands it
//     objects in a shape it does not read, and there is no repair for it: Stripe's update has no
//     parameter for `api_version`, so an endpoint on the wrong version is a replacement and a new
//     secret.
//
// it is in this package for the reason `./../deploy-split.ts` is: one enumeration in the leaf both
// surfaces already share, rather than a second list on the console side that is a missing member, a
// URL joined the other way, or a version behind — with nothing able to see the disagreement.
//
// it imports nothing and names no SDK, so it is as reachable from a console screen as from the
// adapter that talks to Stripe.
//
// what is served at the address is `packages/app/src/routes/api.stripe.webhook.ts`, whose path
// comes from its own name, and `packages/app/src/routes.spec.ts` is what pins that path — so the
// endpoint that is served and the endpoint that is registered cannot come apart.

/**
 * the path this deployment answers the payment processor on.
 *
 * outside `API_BASE_PATH` deliberately: `/api/v1` is the embedded donation form's surface and this
 * is the payment processor's, which shares none of its controls.
 */
export const STRIPE_WEBHOOK_PATH = '/api/stripe/webhook';

/**
 * the address this deployment answers the processor on, built from an origin.
 *
 * no hostname is committed to this repository (CLAUDE.md), so neither end holds one: the deployment
 * learns its own address from a request that reached it, and the console derives it from the
 * cloudflare account. a default would be a wrong answer wearing a right one.
 *
 * one function because three callers spell it and all three must agree exactly — the console
 * registers it, the deployment matches the account's endpoints against it, and the repair calls
 * find the endpoint by it. a joining mistake made in one of them is an endpoint that is registered
 * and reads as absent.
 */
export function webhookEndpointUrl(origin: string): string {
	return `${origin}${STRIPE_WEBHOOK_PATH}`;
}

/**
 * the API version the deployment is written against, pinned rather than inherited.
 *
 * unpinned, the shape of every object follows whatever version the account happens to be on, and
 * that is a value someone can change in a dashboard without touching this repository. pinned, a
 * version bump is a commit — the same reason every dependency here is an exact version (CLAUDE.md).
 *
 * it is the version the installed `stripe` package's types describe, and the two have to agree:
 * those types only reflect one version, so a different string here type-checks against fields that
 * may not be there. read it off the installed package before changing it, never from memory — the
 * package is `packages/app`'s dependency even though the value is stated here, because the console
 * sends the same string to `POST /v1/webhook_endpoints` and no endpoint may be pinned to a version
 * its reader does not hold types for.
 *
 * it does not govern a delivery's own shape after the fact. an event is serialised in the version
 * the *account* was on when it happened, so a replayed old delivery can carry an older shape than
 * anything here expects — which is why the settlement read re-reads the object over this pinned
 * version rather than trusting what arrived.
 */
export const API_VERSION = '2026-07-29.dahlia';

/**
 * the deliveries that are one transaction's own states, which the settlement read reconciles.
 *
 * every member is a state of one PaymentIntent, which is why they all collapse to a single kind:
 * deliveries carry no ordering guarantee, so the handler's answer to any of them is to re-read the
 * transaction rather than to infer state from which one arrived. that is also why adding a member
 * costs nothing here — it is a subscription, not a branch.
 *
 * the invariant is what bounds the list rather than describing it. an event whose object is not that
 * PaymentIntent cannot join it at any price: the adapter takes the id off the delivered object and
 * hands it to `paymentIntents.retrieve`, so an invoice-shaped member would retrieve an `in_…` as a
 * payment intent — a `not_found` under a signature that verified. that is why
 * {@link RECURRING_EVENT_TYPES} is a second list with a second read rather than five more members
 * here.
 *
 * refunds are absent for the same reason and not a different one. a refund is a `payment` row of its
 * own with its own id (`packages/app/src/lib/server/db/schema.ts`), so it is another kind and
 * another read, not a sixth member of this list.
 */
export const SETTLEMENT_EVENT_TYPES = [
	'payment_intent.succeeded',
	'payment_intent.payment_failed',
	'payment_intent.processing',
	'payment_intent.canceled',
	'payment_intent.requires_action'
] as const;

/**
 * the deliveries that are one collection under a repeating gift, whose object is an invoice.
 *
 * a repeating gift has to be recognised from an event and can be recognised no other way. Stripe
 * mints the PaymentIntent behind a collection itself, and it copies nothing onto it — so every
 * charge under a commitment, the donor's first one included, reaches the deployment with the
 * metadata empty and `DONATION_METADATA_KEY` in
 * `packages/app/src/lib/server/payments/provider.ts` naming nothing. what ties a collection to the
 * gift it belongs to is the invoice that raised it, and only that.
 *
 * `invoice.paid` and not `invoice.payment_succeeded`, which Stripe also sends for the same money —
 * "occurs whenever an invoice payment attempt succeeds or an invoice is marked as paid out-of-band"
 * against "occurs whenever an invoice payment attempt succeeds"
 * (https://docs.stripe.com/api/events/types). one covers what the other does and one case more, so
 * subscribing to both would be every collection delivered twice under two names.
 *
 * `payment_intent.succeeded` above fires for this same money as well, and the two are told apart by
 * what they name rather than by anything a handler has to remember: a settlement delivery names a
 * PaymentIntent and is posted against the donation that intent's metadata carries, and a
 * collection's PaymentIntent carries none — so it names no gift and posts nothing, while the invoice
 * delivery is the one that resolves to a commitment.
 */
export const RECURRING_COLLECTION_EVENT_TYPES = ['invoice.paid', 'invoice.payment_failed'] as const;

/**
 * the deliveries that are the commitment's own standing, whose object is a subscription.
 *
 * both members, because a gift stops in two ways and neither can be read off the other.
 * `customer.subscription.deleted` — "occurs whenever a customer's subscription ends"
 * (https://docs.stripe.com/api/events/types) — is what an operator's own cancellation sends, and
 * also what a run of failed collections sends on an account whose retry settings end in
 * cancellation.
 *
 * `customer.subscription.updated` is the same ending on an account configured the other way: when
 * smart retries are exhausted, the commitment moves to `canceled`, `unpaid` or stays `past_due`
 * depending on a setting in the operator's own dashboard
 * (https://docs.stripe.com/billing/subscriptions/webhooks#catch-subscription-status-changes), and
 * `unpaid` arrives as an update rather than a deletion. it is also how a gift nobody confirmed
 * reaches `incomplete_expired`. a deployment is a fork of this repository against somebody else's
 * Stripe settings, so the list covers both settings rather than the one this repository could
 * check.
 *
 * the cost of the second member is deliveries that change nothing — an update fires on every
 * renewal too — and that is the direction to be wrong in: the read is one round trip and the state
 * it reports is the state the gift is already in.
 */
export const RECURRING_COMMITMENT_EVENT_TYPES = [
	'customer.subscription.updated',
	'customer.subscription.deleted'
] as const;

/**
 * every delivery about a repeating gift, in one list because they share one kind and one read arm.
 *
 * which of the two objects a member names is the two lists above, and the recurring read reads it
 * off them rather than off the id it is handed: an id prefix is a fact about Stripe's own spelling,
 * and the type is a fact this deployment subscribed to.
 */
export const RECURRING_EVENT_TYPES = [
	...RECURRING_COLLECTION_EVENT_TYPES,
	...RECURRING_COMMITMENT_EVENT_TYPES
] as const;

/**
 * everything a deployment's endpoint subscribes to, which is exactly what the deployment acts on.
 *
 * one list rather than a switch, so that what the account is configured with and what the code
 * handles are the same sentence. everything outside it verifies, reports `ignored`, and is
 * answered — an endpoint subscribed to more than this is noisy rather than broken.
 *
 * it is what the console sends as `enabled_events` when it registers the endpoint, and what the
 * deployment reports as `requiredEventTypes` when it reads the account back — so the day a member
 * is added here every already-registered endpoint reads as incomplete until an operator registers
 * it again. no screen draws that reading — the deployment computes it (../console/payments.ts) and
 * packages/console-ui/src/lib/payments-fold.tsx takes only the account's ways of paying off the
 * report — so what an operator has is the fold's own press, which registers afresh.
 */
export const SUBSCRIBED_EVENT_TYPES = [
	...SETTLEMENT_EVENT_TYPES,
	...RECURRING_EVENT_TYPES
] as const;
