// what this deployment's PayPal listener is: where it answers and what it is subscribed to.
//
// **here because two ends spell it.** the console registers the listener on the PayPal app and
// stores the id PayPal mints; the deployment serves the address and reads what arrives. the address
// joined differently at the two ends is a listener that reads as absent to the deployment and one
// press away from a second listener, and a delivery the listener was never subscribed to is a gift
// nothing reports as missing — an approved PayPal order is never captured without its delivery
// (`packages/app/src/routes/api.paypal.webhook.ts`).
//
// `packages/console/internal/release/config.go` holds the binary's copy, and its config_test.go
// gates that copy against this file. what is served at the address is
// `packages/app/src/routes/api.paypal.webhook.ts`, whose path comes from its own name, and
// `packages/app/src/routes.spec.ts` pins that path.
//
// it imports nothing and names no SDK, so it is as reachable from the binary's gate as from the
// adapter that talks to PayPal.

/**
 * the path this deployment answers PayPal's deliveries on.
 *
 * outside `/api/v1` deliberately, for the reason `STRIPE_WEBHOOK_PATH` in
 * ../stripe/webhook-endpoint.ts is: that is the embedded donation form's surface and this is the
 * processor's, which shares none of its controls.
 */
export const PAYPAL_WEBHOOK_PATH = '/api/paypal/webhook';

/**
 * the deliveries that say a one-off payment moved, which the settlement read reconciles.
 *
 * three rather than PayPal's whole catalogue, because three is what the one-off path has a read for.
 * `CHECKOUT.ORDER.APPROVED` is the payer having authorised the order and is what the capture is made
 * from; the two capture events are the money having moved or having been refused.
 *
 * **an event name is not unique to one API generation**, which is why membership of this list is not
 * the whole of what a delivery is read on. `PAYMENT.CAPTURE.COMPLETED` is published under Payments
 * v2 and under Payments v1, and the two carry different resources under the same name — so
 * `orderIdOf` in packages/app/src/lib/server/payments/paypal.ts looks for the order where the shape
 * this app reads puts it, and a delivery that carries none is refused rather than reconciled against
 * whatever id happened to be readable.
 */
export const SETTLEMENT_EVENT_TYPES = [
	'CHECKOUT.ORDER.APPROVED',
	'PAYMENT.CAPTURE.COMPLETED',
	'PAYMENT.CAPTURE.DENIED'
] as const;

/**
 * the deliveries about a repeating gift that say money was meant to move.
 *
 * two, and the second is not a mistake: `BILLING.SUBSCRIPTION.PAYMENT.FAILED` is a collection with
 * nothing behind it — a charge was due and did not happen — which is the same reading
 * `RECURRING_COLLECTION_EVENT_TYPES` in ../stripe/webhook-endpoint.ts gives the failed half of its own
 * pair. read as the commitment's standing instead, a gift whose card failed once would be recorded as
 * having stopped.
 *
 * **their resources are not the same object.** the charge event carries a v1 sale and the failure
 * event carries the subscription, which is what the adapter's recurring read branches on — and it is
 * the reason a caller is handed the delivery rather than an id.
 *
 * **no retry is built on the failure.** PayPal retries a failed collection twice per cycle on its
 * own and suspends the commitment when its threshold is reached
 * (https://developer.paypal.com/docs/subscriptions/customize/failed-payments/), so a retry here
 * would be a donor charged twice for one missed month.
 */
export const RECURRING_COLLECTION_EVENT_TYPES = [
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
 * registers subscribes to the Subscriptions set, and a delivery whose resource the adapter cannot
 * read is refused rather than reconciled against whatever id happened to be readable.
 */
export const RECURRING_COMMITMENT_EVENT_TYPES = [
	'BILLING.SUBSCRIPTION.ACTIVATED',
	'BILLING.SUBSCRIPTION.CANCELLED',
	'BILLING.SUBSCRIPTION.EXPIRED',
	'BILLING.SUBSCRIPTION.SUSPENDED'
] as const;

/** every delivery about a repeating gift, in one list because they share one kind and one read. */
export const RECURRING_EVENT_TYPES = [
	...RECURRING_COLLECTION_EVENT_TYPES,
	...RECURRING_COMMITMENT_EVENT_TYPES
] as const;

/**
 * everything the listener subscribes to, which is exactly what the deployment acts on.
 *
 * everything outside it verifies, reports `ignored`, and is answered — a listener subscribed to more
 * than this is noisy rather than broken. it is what the console brings a listener's `event_types`
 * to, and what the deployment reports as `requiredEventTypes` when it reads the app back — so the day
 * a member is added here every registered listener reads as incomplete until the console's press is
 * made again.
 */
export const SUBSCRIBED_EVENT_TYPES = [
	...SETTLEMENT_EVENT_TYPES,
	...RECURRING_EVENT_TYPES
] as const;
