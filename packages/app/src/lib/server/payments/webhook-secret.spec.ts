import { describe, expect, it } from 'vitest';
import type { WebhookRegistration } from './webhook-registration';
import { webhookSecretStanding } from './webhook-secret';

/**
 * whether the stored signing secret is the one the processor is signing with, which nothing
 * reading the variable alone can say.
 *
 * a variable reports presence and can report nothing else: the value it would have to be compared
 * against is returned once at creation and by no read afterwards (`RegisteredWebhookEndpoint` in
 * ./provider.ts). so a deployment holding the secret of an endpoint that was replaced this morning
 * looks exactly like one holding the right secret — while every delivery fails verification and no
 * gift is posted to the books. that is the state `replaceWebhookRegistration` leaves behind
 * whenever the operator reads the new secret off the dialog and does not set it.
 *
 * a fingerprint stamped on the endpoint at creation is what makes the comparison possible at all;
 * `packages/operator/src/stripe/secret-fingerprint.ts` holds the reasoning. the digests below are
 * literals computed outside this file, so a case disagrees with the implementation rather than
 * recomputing it the same way.
 */
describe('webhookSecretStanding', () => {
	/** a registration that is registered, delivering and fully subscribed, stamped as named. */
	const registered = (secretFingerprint: string | null): WebhookRegistration => ({
		state: 'registered',
		url: 'https://give.example.workers.dev/api/stripe/webhook',
		delivering: true,
		eventTypes: [],
		missingEventTypes: [],
		complete: true,
		secretFingerprint
	});

	it('reports a stored secret that is the registered endpoint’s as verifying', async () => {
		const standing = await webhookSecretStanding(
			{ STRIPE_WEBHOOK_SECRET: 'whsec_notarealsecret' },
			registered('85fd512dab8038e3')
		);
		expect(standing.state).toBe('verifying');
	});

	/**
	 * the defect, named: a secret is stored and it is not the one this endpoint signs with.
	 *
	 * the sequence is one button and one omission. the operator presses Replace, Stripe mints a new
	 * endpoint with a new secret, the dialog shows it once — and the deployment goes on holding the
	 * old one until the console registers the endpoint again. everything else on the screen is green
	 * throughout.
	 */
	it('reports a stored secret from a replaced endpoint as stale', async () => {
		const standing = await webhookSecretStanding(
			{ STRIPE_WEBHOOK_SECRET: 'whsec_theoldone' },
			registered('362db036820ee774')
		);
		expect(standing.state).toBe('stale');
		expect(standing.detail).toContain('better-giving open');
		expect(standing.detail).toContain('Donation processor');
	});

	/**
	 * an endpoint carrying no stamp is a third answer and never a mismatch.
	 *
	 * an endpoint registered in the Stripe dashboard by hand, or by `stripe listen` locally, was
	 * never stamped — so nothing can be said about the secret beside it. reported as stale, a working
	 * deployment would be told to replace an endpoint that is fine, which costs it the secret it has.
	 */
	it('reports an unstamped endpoint as unconfirmable, not as stale', async () => {
		const standing = await webhookSecretStanding(
			{ STRIPE_WEBHOOK_SECRET: 'whsec_notarealsecret' },
			registered(null)
		);
		expect(standing.state).toBe('unconfirmable');
	});

	/**
	 * an unset variable is a state of its own and never a mismatch.
	 *
	 * reported as `stale` it would send an operator to replace an endpoint when what they have to
	 * do is set a value.
	 */
	it.each([
		['unset', {}],
		['blank', { STRIPE_WEBHOOK_SECRET: '   ' }]
	])('says nothing about a %s variable beyond that it is unset', async (_label, env) => {
		const standing = await webhookSecretStanding(env, registered('85fd512dab8038e3'));
		expect(standing.state).toBe('unset');
	});

	/**
	 * no endpoint and no answer means nothing to compare against.
	 *
	 * the two arms that are not `registered` carry no endpoint at all — a fresh fork has none, and a
	 * processor nobody could reach said nothing about the one it may have. both are blocks the
	 * webhook section already words for itself, and a standing that guessed at either would be this
	 * line reporting a fault it cannot see.
	 */
	it.each([
		['nothing is registered', { state: 'unregistered' } as const],
		['the account could not be read', { state: 'unreadable', detail: 'no key' } as const]
	])('reports the secret as unconfirmable where %s', async (_label, registration) => {
		const standing = await webhookSecretStanding(
			{ STRIPE_WEBHOOK_SECRET: 'whsec_notarealsecret' },
			registration
		);
		expect(standing.state).toBe('unconfirmable');
	});

	/** the digest never leaves this side, and neither does the value it was taken over. */
	it('carries no part of the stored secret or its digest out', async () => {
		const standing = await webhookSecretStanding(
			{ STRIPE_WEBHOOK_SECRET: 'whsec_theoldone' },
			registered('362db036820ee774')
		);
		expect(JSON.stringify(standing)).not.toContain('whsec_');
		expect(JSON.stringify(standing)).not.toContain('05a06e8e12cff3f9');
	});
});
