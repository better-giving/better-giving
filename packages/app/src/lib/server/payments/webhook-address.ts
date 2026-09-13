import { PAYPAL_WEBHOOK_PATH } from '@better-giving/operator/paypal/webhook-listener';
import { webhookEndpointUrl } from '@better-giving/operator/stripe/webhook-endpoint';
import type { ProcessorName } from './provider';

// where each processor's deliveries arrive on this deployment, built from an origin.
//
// one function rather than a URL joined at each caller, because the address is the same fact in
// three shapes and every one of them has to be the same string: the route that serves it, the read
// that matches this deployment's own endpoint against what the account holds
// (./webhook-registration.ts), and the address the console's binary registers. joined differently in
// any of them, an endpoint that is registered reads as absent and a gift that settles reaches
// nothing. each path is spelled in packages/operator, where that binary's copy is gated against it.
//
// no hostname is committed to this repository (CLAUDE.md), so every caller hands over the origin it
// learned from the request that reached it. a default would be a wrong answer wearing a right one.

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
