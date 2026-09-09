import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPaymentProvider } from './factory';

afterEach(() => {
	vi.restoreAllMocks();
});

const CONFIGURED = {
	STRIPE_SECRET_KEY: 'sk_test_notarealkey',
	STRIPE_WEBHOOK_SECRET: 'whsec_notarealsecret'
};

/**
 * the one call that reaches a refusal without needing a network or a valid request.
 *
 * only for the environments this module refuses outright. a provider that builds sends this one to
 * Stripe — the adapter has nothing local to reject a well-formed transaction id with — so a case
 * that expects the adapter asks it something the adapter itself refuses instead: an amount of zero
 * minor units, or an `http://` endpoint address.
 */
function anyCall(source: unknown) {
	return createPaymentProvider(source).readSettlement('pi_1');
}

describe('createPaymentProvider', () => {
	/**
	 * a missing secret key is a refusal, never a throw at construction.
	 *
	 * the deployment it describes is a real one — a fresh fork has none of these set — and it has
	 * to be able to serve `/admin` while it is in that state. a factory that threw would take the
	 * whole app down over a deployment that is merely not configured yet.
	 *
	 * it is the only variable that refuses every arm, and the refusal names it and the command that
	 * sets it. what a deployment is short of beyond this one is not in the sentence: the console
	 * draws a box for each of the three and reports each of them, and a refusal that listed the
	 * others would be this module answering a question nobody asked it.
	 */
	it('refuses every arm with the secret key named when it is unset', async () => {
		const result = await anyCall({});

		expect(result.ok === false && result.reason).toBe('not_configured');
		const detail = result.ok === false ? result.detail : '';
		expect(detail).toContain('STRIPE_SECRET_KEY');
		expect(detail).toContain('better-giving open');
		expect(detail).toContain('Donation processor');
	});

	/**
	 * the signing secret is refused at the one arm that reads it, and nowhere else.
	 *
	 * it is sent on no call to Stripe — its whole job is checking that an inbound delivery came from
	 * Stripe — so this is the arm that cannot be answered without it, and the sentence has to name it
	 * and the command that sets it. the delivery's body is not read either way: a delivery nothing
	 * can verify is anyone's delivery, and this refusal is reached before the signature header is
	 * even looked at.
	 *
	 * `not_configured` is also what holds the delivery open. it is a retryable reason
	 * (`RETRYABLE_FAILURE_REASONS` in ./provider.ts), so the webhook route answers 5xx and Stripe
	 * brings the delivery back across the days an operator needs to set the value — where
	 * `bad_signature` would be answered terminally and the gift behind it lost.
	 */
	it('refuses to verify a delivery with the signing secret named when it is unset', async () => {
		const result = await createPaymentProvider({
			STRIPE_SECRET_KEY: 'sk_test_notarealkey'
		}).verifyEvent({ body: '{"id":"evt_1"}', signature: 't=1,v1=notarealsignature' });

		expect(result.ok === false && result.reason).toBe('not_configured');
		const detail = result.ok === false ? result.detail : '';
		expect(detail).toContain('STRIPE_WEBHOOK_SECRET');
		expect(detail).toContain('better-giving open');
	});

	/**
	 * blank is absent, and so is whitespace.
	 *
	 * a trailing newline off a paste or off a `.deploy.vars` line is the most common thing an operator
	 * does wrong, and `'   '` is literally truthy — so a presence check alone would build a client
	 * around a key that is a space and report it as configured. `readConfigEnv` is what collapses
	 * those onto "unset", and this is the assertion that this module goes through it rather than
	 * reading the bag itself.
	 */
	it.each([
		['empty', ''],
		['whitespace', '   ']
	])('treats a %s secret key as unset', async (_label, value) => {
		const result = await anyCall({ ...CONFIGURED, STRIPE_SECRET_KEY: value });

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false && result.detail).toContain('STRIPE_SECRET_KEY');
	});

	/**
	 * a value that is not a string is not a credential.
	 *
	 * the platform env carries bindings as well as secrets, and a binding is an object however
	 * `wrangler types` declares it. coerced with `String(...)`, one would become a plausible-looking
	 * key and the deployment would report itself configured — which is the one thing this must not
	 * do.
	 */
	it('treats a non-string secret key as unset', async () => {
		const result = await anyCall({ ...CONFIGURED, STRIPE_SECRET_KEY: { binding: true } });

		expect(result.ok === false && result.reason).toBe('not_configured');
	});

	/**
	 * a configured deployment gets the adapter, not a refusal.
	 *
	 * asserted through a request the adapter rejects on its own — a fee of zero minor units — so
	 * that the answer distinguishes the two providers without a network call. a refusing provider
	 * would say `not_configured` to this; only the adapter reaches its own validation.
	 */
	it('builds the adapter when both variables are set', async () => {
		const result = await createPaymentProvider(CONFIGURED).createIntent({
			amountMinor: 0,
			currency: 'USD',
			method: 'card',
			idempotencyKey: 'attempt-1'
		});

		expect(result.ok === false && result.reason).toBe('invalid_request');
	});

	/**
	 * a deployment holding the secret key and nothing else still gets the adapter.
	 *
	 * the state this is written for is the one an operator is in before they have ever seen a
	 * signing secret: nothing mints one but registering this deployment's own endpoint, and that
	 * call is made with the secret key. a factory that refused to build without the secret would
	 * make the button that mints it unpressable, which is the deadlock this case pins open.
	 *
	 * asserted through a request the adapter rejects on its own — an `http://` address, which Stripe
	 * does not deliver to — so the answer distinguishes the two providers without a network call. a
	 * refusing provider would say `not_configured` to this; only the adapter reaches its own
	 * validation.
	 */
	it('builds the adapter for a deployment holding no signing secret', async () => {
		const result = await createPaymentProvider({
			STRIPE_SECRET_KEY: 'sk_test_notarealkey'
		}).registerWebhookEndpoint('http://localhost/api/stripe/webhook');

		expect(result.ok === false && result.reason).toBe('invalid_request');
	});

	/**
	 * a provider that cannot be built at all is still a provider.
	 *
	 * the seal covers construction as well as calling, and the argument-evaluation order is the
	 * whole reason it is worth a test: `sealed(build(source))` evaluates `build` before the seal
	 * exists, so a throw inside it goes straight to a caller — the webhook route, where an
	 * exception is a 500 and a delivery redelivered for three days. nothing in `build` throws
	 * today; what is asserted is that nothing added to it can.
	 */
	it('answers with a refusal when building throws', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const hostile = {
			get STRIPE_SECRET_KEY(): string {
				throw new TypeError('a binding that refuses to be read');
			}
		};

		const result = await anyCall(hostile);

		expect(result.ok === false && result.reason).toBe('internal_error');
		expect(spy).toHaveBeenCalled();
	});
});
