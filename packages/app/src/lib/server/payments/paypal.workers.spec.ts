import { describe, expect, it, vi } from 'vitest';
import { createPaypalProvider } from './paypal';

// the adapter's transport, exercised inside workerd rather than described.
//
// why this file is in the workers pool when it touches no database. everything else about this
// adapter is logic and belongs in the node pool, but the transport is true only of the runtime it
// deploys to, and it fails *open* under node:
//
//   - the SDK is generated on axios, whose default adapter reaches for node's `http` module. under
//     node that works, so a spec there would pass against a build that cannot make one request in
//     production.
//   - axios's fetch adapter sends `cache: 'default'` unless it is told otherwise, and workerd
//     rejects that outright — every call throws `Unsupported cache mode: default` before it leaves
//     the isolate. node's fetch accepts it, so the same substitution is invisible in a node spec
//     and fatal in a deployed worker.
//
// so this is CLAUDE.md's "never stand in for the platform" applied to the runtime rather than to
// D1: the property worth asserting is workerd's, and a stand-in only proves the stand-in. the pool
// is free here — these cases bind nothing and run no migration.
//
// the cases build the provider exactly as ./factory.ts does, with no seam of any kind: what is under
// test is the client production constructs. `fetch` is stubbed, because what is being asserted is
// that a request leaves this runtime at all rather than what PayPal answers — and there is no
// sandbox in this project for a spec to dial.

const CREDENTIALS = {
	clientId: 'Aa-notarealclientid',
	clientSecret: 'EL-notarealsecret',
	webhookId: '7YN47048TX2895013'
};

describe('the provider this app actually builds, inside workerd', () => {
	/**
	 * a request the SDK encodes actually leaves this runtime.
	 *
	 * both facts at once, and neither is observable from the return value: the client resolves a
	 * transport this runtime has, and the request it builds carries options this runtime accepts. a
	 * failure of either arrives as a thrown `TypeError` the adapter reports as `unreachable` — a
	 * deployment that looks configured and refuses every gift — so what is asserted is the request
	 * itself, and its bearer token, reaching the wire.
	 */
	it('mints an order through a transport workerd has', async () => {
		const seen: { url: string; authorization: string | null }[] = [];
		vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(String(input), init);
			seen.push({ url: request.url, authorization: request.headers.get('authorization') });
			return request.url.endsWith('/v1/oauth2/token')
				? Response.json({ access_token: 'A21AA-token', token_type: 'Bearer', expires_in: 32400 })
				: Response.json({ id: '5O190127TN364715T', status: 'CREATED' }, { status: 201 });
		});

		const result = await createPaypalProvider(CREDENTIALS).createIntent({
			amountMinor: 1000,
			currency: 'USD',
			method: 'paypal',
			idempotencyKey: 'attempt-1'
		});

		expect(result.ok && result.value.providerTxnId).toBe('5O190127TN364715T');
		expect(seen.map((call) => new URL(call.url).pathname)).toEqual([
			'/v1/oauth2/token',
			'/v2/checkout/orders'
		]);
		expect(seen[1]?.authorization).toBe('Bearer A21AA-token');
	});

	/**
	 * the token is minted once and spent by both halves of the adapter.
	 *
	 * the verification arm reaches the notification API past the SDK — the package ships no webhooks
	 * controller — so the two halves authenticate through one cache or through two. asserted here
	 * rather than in the node pool because the basic-auth header the mint carries is built with
	 * `Buffer`, which is a node API this runtime only has under `nodejs_compat`: a runtime without it
	 * throws on the first authenticated call, which is every call.
	 */
	it('mints one token for a delivery that verifies and then reads', async () => {
		const paths: string[] = [];
		vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(String(input), init);
			const { pathname } = new URL(request.url);
			paths.push(pathname);
			if (pathname === '/v1/oauth2/token') {
				return Response.json({
					access_token: 'A21AA-token',
					token_type: 'Bearer',
					expires_in: 32400
				});
			}
			if (pathname.endsWith('/verify-webhook-signature')) {
				return Response.json({ verification_status: 'SUCCESS' });
			}
			return Response.json({ id: '5O190127TN364715T', status: 'CREATED' });
		});

		const provider = createPaypalProvider(CREDENTIALS);
		await provider.verifyEvent({
			body: JSON.stringify({
				id: 'WH-1',
				event_type: 'CHECKOUT.ORDER.APPROVED',
				create_time: '2026-08-16T22:20:08Z',
				resource: { id: '5O190127TN364715T' }
			}),
			headers: {
				'paypal-transmission-id': '69cd13f0-d67a-11e5-baa3-778b53f4ae55',
				'paypal-transmission-time': '2026-08-16T22:20:08Z',
				'paypal-transmission-sig': 'thyEr3QCIhkC2gwCnZpU/4AS2A==',
				'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT-abc',
				'paypal-auth-algo': 'SHA256withRSA'
			}
		});
		await provider.readSettlement('5O190127TN364715T');

		expect(paths.filter((path) => path === '/v1/oauth2/token')).toHaveLength(1);
	});
});
