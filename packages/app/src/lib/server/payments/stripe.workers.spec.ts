import { describe, expect, it } from 'vitest';
import { createStripeProvider } from './stripe';

// the adapter's two runtime dependencies, exercised inside workerd rather than described.
//
// why this file is in the workers pool when it touches no database. everything else about this
// adapter is logic and belongs in the node pool, but two of its decisions are true only of the
// runtime it deploys to, and both fail *open* under node:
//
//   - the HTTP client. the SDK's node-flavoured client constructs happily anywhere and throws on
//     every call in workerd, because there is no `http`/`https` module to reach. under node it
//     works, so a spec there would pass against a build that cannot make one request in
//     production.
//   - the crypto provider handed to `constructEventAsync`. node has the crypto the synchronous
//     path wants, so the same substitution is invisible in a node spec and fatal in a deployed
//     worker — on the webhook, which is the endpoint that records money.
//
// so this is CLAUDE.md's "never stand in for the platform" applied to the runtime rather than to
// D1: the property worth asserting is workerd's, and a stand-in only proves the stand-in. the
// pool is free here — these cases bind nothing and run no migration.
//
// every case builds the provider with no seam at all, which is the whole point: what is under
// test is the client and the crypto provider production constructs, not one a test handed in.

const CREDENTIALS = { secretKey: 'sk_test_notarealkey', webhookSecret: 'whsec_notarealsecret' };

/**
 * a `stripe-signature` header, computed here rather than asked for.
 *
 * `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` —
 * https://docs.stripe.com/webhooks#verify-manually. computed with the runtime's own WebCrypto,
 * which is deliberate: the adapter verifies with the SDK's subtle-crypto provider, so agreement
 * between the two is a fact about workerd rather than about the library agreeing with itself.
 */
async function sign(body: string, secret: string) {
	const at = Math.floor(Date.now() / 1000);
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${at}.${body}`));
	const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `t=${at},v1=${hex}`;
}

const BODY = JSON.stringify({
	id: 'evt_1',
	object: 'event',
	type: 'payment_intent.succeeded',
	created: 1_770_000_000,
	data: { object: { id: 'pi_1', object: 'payment_intent' } }
});

describe('the provider this app actually builds, inside workerd', () => {
	/**
	 * a real signature verifies under the runtime's own crypto.
	 *
	 * this is the assertion the synchronous verification path cannot pass. it wants node's crypto,
	 * which workerd does not have, so substituting it here is a webhook that rejects every genuine
	 * delivery in production while every node-pool spec stays green.
	 */
	it('verifies a correctly signed delivery', async () => {
		const result = await createStripeProvider(CREDENTIALS).verifyEvent({
			body: BODY,
			signature: await sign(BODY, CREDENTIALS.webhookSecret)
		});

		expect(result.ok === true && result.value.id).toBe('evt_1');
		expect(
			result.ok === true && result.value.kind === 'settlement' && result.value.providerTxnId
		).toBe('pi_1');
	});

	/**
	 * a forged signature is refused under the same crypto.
	 *
	 * the acceptance above is only worth something beside this: a verifier that returned true
	 * unconditionally would pass that case and fail this one.
	 */
	it('refuses a delivery signed with the wrong secret', async () => {
		const result = await createStripeProvider(CREDENTIALS).verifyEvent({
			body: BODY,
			signature: await sign(BODY, 'whsec_someoneelses')
		});

		expect(result.ok === false && result.reason).toBe('bad_signature');
	});

	/**
	 * the default HTTP client issues a request and its failure arrives as `unreachable`.
	 *
	 * pointed at a host under `.invalid`, which RFC 2606 reserves precisely so that it can never
	 * resolve — so this is deterministic and offline rather than a call that depends on somebody
	 * else's uptime.
	 *
	 * what it discriminates is the substitution: a client built on node's modules does not fail to
	 * *connect* here, it fails to *exist*, and that throw is not one the SDK wraps — so it leaves
	 * as `internal_error` through the seal rather than as `unreachable`. reaching this assertion at
	 * all therefore means a fetch-based client was constructed and used.
	 *
	 * **this case is why the suite prints `uncaught exception; source = Uncaught (in promise);
	 * stack = Error: internal error` and passes anyway.** that line is workerd's own log of the
	 * subrequest it could not make, written by the runtime rather than raised by anything here —
	 * nothing is unhandled, which is exactly why every assertion still runs and vitest reports no
	 * error. it is the cost of pointing at a host that cannot resolve, and it goes only if this
	 * case stops reaching the network, which is the whole of what it is for.
	 */
	it('reaches the network through the default client and reports a dead host as unreachable', async () => {
		const result = await createStripeProvider(CREDENTIALS, {
			host: 'stripe.notahost.invalid'
		}).createIntent({
			amountMinor: 1000,
			currency: 'USD',
			method: 'card',
			idempotencyKey: 'attempt-1'
		});

		expect(result.ok === false && result.reason).toBe('unreachable');
	}, 30_000);
});
