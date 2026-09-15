// where this deployment's Chariot event subscription delivers.
//
// here beside ../paypal/webhook-listener.ts and for its reason: the subscription is created against
// this address and the deployment serves it, so the two ends read one spelling. what is served at the
// address is `packages/app/src/routes/api.chariot.webhook.ts`, whose path comes from its own name, and
// `packages/app/src/routes.spec.ts` pins that path.
//
// it imports nothing and names no SDK.

/**
 * the path this deployment answers Chariot's `grant.updated` deliveries on.
 *
 * outside `/api/v1` for the reason `STRIPE_WEBHOOK_PATH` in ../stripe/webhook-endpoint.ts is.
 */
export const CHARIOT_WEBHOOK_PATH = '/api/chariot/webhook';

/**
 * the one event category this deployment's subscription is created for, as the console draws it.
 *
 * a third spelling of one value: it matches `SETTLEMENT_CATEGORY` in
 * `packages/app/src/lib/server/payments/chariot.ts`, which the webhook settles on, and
 * `ChariotEventCategory` in `packages/console/internal/release/config.go`, which the binary subscribes
 * with. `TestTheSubscriptionIsSpelledTheWayBothEndsSpellIt` in that module's `config_test.go` holds
 * all three level.
 */
export const CHARIOT_EVENT_CATEGORY = 'grant.updated';
