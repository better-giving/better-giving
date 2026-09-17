// where this deployment's NOWPayments IPNs arrive.
//
// here beside ../paypal/webhook-listener.ts and ../chariot/webhook-subscription.ts, and for their
// reason: two ends spell the address. NOWPayments registers no endpoint on the account — each payment
// is created carrying its own `ipn_callback_url`, built from this path
// (`packages/app/src/lib/server/payments/webhook-address.ts`) — and the deployment serves it. joined
// differently at the two ends, every payment is minted with a callback that reaches nothing and no
// crypto gift ever settles.
//
// it imports nothing and names no SDK.

/**
 * the path this deployment answers NOWPayments' IPNs on.
 *
 * outside `/api/v1` for the reason `STRIPE_WEBHOOK_PATH` in ../stripe/webhook-endpoint.ts is.
 */
export const NOWPAYMENTS_IPN_PATH = '/api/nowpayments/webhook';
