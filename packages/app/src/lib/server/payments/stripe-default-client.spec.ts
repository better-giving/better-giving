import { describe, expect, it } from 'vitest';
import { createStripeProvider } from './stripe';

// the adapter's default HTTP client, built with no seam at all: what is under test is the client
// production constructs, not one a test handed in (./stripe.spec.ts injects its own).

const CREDENTIALS = { secretKey: 'sk_test_notarealkey', webhookSecret: 'whsec_notarealsecret' };

describe('the provider this app actually builds', () => {
	/**
	 * the default HTTP client issues a request and its failure arrives as `unreachable`.
	 *
	 * pointed at a host under `.invalid`, which RFC 2606 reserves precisely so that it can never
	 * resolve — so this is deterministic and offline rather than a call that depends on somebody
	 * else's uptime.
	 */
	it('reaches the network through the default client and reports a dead host as unreachable', async () => {
		const result = await createStripeProvider(CREDENTIALS, {
			host: 'stripe.notahost.invalid'
		}).createIntent({
			amountMinor: 1000,
			currency: 'USD',
			method: 'card',
			idempotencyKey: 'attempt-1',
			deploymentOrigin: 'https://donate.example.org'
		});

		expect(result.ok === false && result.reason).toBe('unreachable');
	}, 30_000);
});
