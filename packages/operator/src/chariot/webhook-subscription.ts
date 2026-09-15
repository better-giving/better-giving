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
