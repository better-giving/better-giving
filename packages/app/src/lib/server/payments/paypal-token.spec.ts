import { describe, expect, it, vi } from 'vitest';
import { createPaypalProvider, PAYPAL_DEFAULT_API_URL } from './paypal';

// the adapter's token cache, through the provider exactly as ./factory.ts builds it, with no seam of
// any kind: the SDK's own client is under test, and `fetch` is stubbed because what is asserted is
// the requests that leave rather than what PayPal answers — no spec in this project dials PayPal.

const CREDENTIALS = {
	clientId: 'Aa-notarealclientid',
	clientSecret: 'EL-notarealsecret',
	apiUrl: PAYPAL_DEFAULT_API_URL,
	webhookId: '7YN47048TX2895013'
};

describe('the provider this app actually builds', () => {
	/**
	 * the token is minted once and spent by both halves of the adapter.
	 *
	 * the verification arm reaches the notification API past the SDK — the package ships no webhooks
	 * controller — so the two halves authenticate through one cache or through two.
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
