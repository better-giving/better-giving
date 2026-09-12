import { webhookEndpointUrl } from '@better-giving/operator/stripe/webhook-endpoint';
import type { ProcessorName } from './provider';

// where each processor's deliveries arrive on this deployment, built from an origin.
//
// one function rather than a URL joined at each caller, because the address is the same fact in
// three shapes and every one of them has to be the same string: the route that serves it, the read
// that matches this deployment's own endpoint against what the account holds
// (./webhook-registration.ts), and the sentence that tells an operator where to point a listener
// they register by hand. joined differently in any of them, an endpoint that is registered reads as
// absent and a gift that settles reaches nothing.
//
// no hostname is committed to this repository (CLAUDE.md), so every caller hands over the origin it
// learned from the request that reached it. a default would be a wrong answer wearing a right one.

/**
 * the path this deployment answers PayPal's deliveries on.
 *
 * spelled here and nowhere else in this package. what serves it is
 * `src/routes/api.paypal.webhook.ts`, whose path comes from its own name, and `src/routes.spec.ts`
 * is what pins the two together — so the address an operator is told and the address that answers
 * cannot come apart.
 *
 * outside `API_BASE_PATH` deliberately, for the reason `STRIPE_WEBHOOK_PATH` is: `/api/v1` is the
 * embedded donation form's surface and this is the processor's, which shares none of its controls.
 *
 * Stripe's counterpart is in `@better-giving/operator/stripe/webhook-endpoint` rather than here,
 * because the console's own binary registers that endpoint and has to spell the same address. no
 * console registers this one, so one spelling is enough.
 */
export const PAYPAL_WEBHOOK_PATH = '/api/paypal/webhook';

/**
 * how each processor's address is built, total over `ProcessorName` — so a third processor is a
 * compile error rather than an address a caller falls back to guessing.
 */
const ADDRESS: Readonly<Record<ProcessorName, (origin: string) => string>> = Object.freeze({
	stripe: webhookEndpointUrl,
	paypal: (origin) => `${origin}${PAYPAL_WEBHOOK_PATH}`
});

/** the address this deployment answers one processor's deliveries on. */
export function webhookAddress(processor: ProcessorName, origin: string): string {
	return ADDRESS[processor](origin);
}
