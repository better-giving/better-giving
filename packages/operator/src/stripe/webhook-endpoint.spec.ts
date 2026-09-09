import { describe, expect, it } from 'vitest';
import { API_VERSION, SUBSCRIBED_EVENT_TYPES, webhookEndpointUrl } from './webhook-endpoint';

// the three facts an endpoint is registered from, asserted here because two packages now spell
// them and neither can assert the other's spelling.
//
// this is the leaf, so a case here is the one both ends are held to: the console sends these to
// Stripe when it creates the endpoint, and the deployment matches the account against them when it
// reads one back.

describe('webhookEndpointUrl', () => {
	/**
	 * the address a deployment answers on, built from an origin and from nothing else.
	 *
	 * no hostname is committed to this repository (CLAUDE.md), so the origin comes off a request on
	 * one side and off the cloudflare account on the other — and the string this builds is what the
	 * two are matched on. a joining mistake here is an endpoint that is registered and reads as
	 * absent, one press away from a second one nobody can hold the secret for.
	 */
	it('joins an origin to the path the deployment serves the endpoint at', () => {
		expect(webhookEndpointUrl('https://give.example.org')).toBe(
			'https://give.example.org/api/stripe/webhook'
		);
	});

	/**
	 * no second slash and no missing one, whichever way the origin arrives.
	 *
	 * a cloudflare-derived address and a request origin are both spelled without a trailing slash,
	 * and this is what says the join does not quietly repair one that has it — a URL with a doubled
	 * slash is a different endpoint to Stripe and reads as absent to the deployment.
	 */
	it('leaves the origin exactly as it was handed', () => {
		expect(webhookEndpointUrl('https://better-giving.hound.workers.dev')).toBe(
			'https://better-giving.hound.workers.dev/api/stripe/webhook'
		);
	});
});

describe('what an endpoint is registered as', () => {
	/**
	 * pinned rather than read off a package, because the console holds no `stripe` dependency to
	 * read one off. a bump is a commit, and this case is what makes it a failing one.
	 */
	it('pins the API version an endpoint is created against', () => {
		expect(API_VERSION).toBe('2026-07-29.dahlia');
	});

	/**
	 * the subscription list, pinned by value.
	 *
	 * a member dropped here is a delivery that never arrives and a gift that never reaches the
	 * books, and nothing anywhere reports a delivery that was not sent — so the list is asserted
	 * rather than derived. adding one is a deliberate edit here and a repair every already-
	 * registered endpoint then needs.
	 */
	it('subscribes an endpoint to exactly what the deployment acts on', () => {
		expect([...SUBSCRIBED_EVENT_TYPES]).toEqual([
			'payment_intent.succeeded',
			'payment_intent.payment_failed',
			'payment_intent.processing',
			'payment_intent.canceled',
			'payment_intent.requires_action',
			'invoice.paid',
			'invoice.payment_failed',
			'customer.subscription.updated',
			'customer.subscription.deleted'
		]);
	});
});
