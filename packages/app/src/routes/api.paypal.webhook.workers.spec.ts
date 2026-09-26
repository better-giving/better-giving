import { env } from 'cloudflare:test';
import type { MiddlewareFunction } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseContact } from '$lib/server/contacts/contact-input';
import { postableId } from '$lib/server/db/accounts';
import { createDb } from '$lib/server/db/client';
import { recordDonation } from '$lib/server/donations/record';
import { mountRoutes } from '../route-request.testing';
import * as webhook from './api.paypal.webhook';

// the endpoint's own decision: which status the processor is told, which is the only thing about
// this response it reads. what a delivery does is `$lib/server/donations/settle.workers.spec.ts`.
//
// a workers spec, and not only for D1. the adapter this route builds is generated on axios, which
// resolves a different transport under node than it does on workerd and is rejected outright by
// workerd for options node accepts ($lib/server/payments/paypal.workers.spec.ts argues both) — so a
// node pool would prove nothing about the runtime this deploys to.
//
// **nothing here reaches the network.** `verifyEvent` in $lib/server/payments/paypal.ts asks PayPal
// to vouch for a delivery over HTTP, and there is no sandbox in this project to dial. three things
// are refused before that call — no listener id, a missing signing header, a body that is not a
// JSON object — and the last case in this file is stopped earlier still, by a body a `middleware`
// above the route had already consumed. every case that gets past verification stubs `fetch` to
// vouch for it, and the capture refund cases at the foot of the file answer the adapter's reads the
// same way; anything else pairing all five signing headers with a parseable body would leave the
// isolate.
//
// the route is driven through react router rather than by calling its `action`, for the reason
// ../route-request.testing.ts argues at length. on this route that is not a convention but the
// subject: what the cases at the foot of this file assert is that the raw bytes reach the handler
// unread, which a spec that skipped the pipeline could not tell apart from a pipeline that had
// eaten them.

/** the address the operator registers their listener at on PayPal's developer dashboard. */
const ADDRESS = 'https://give.example.workers.dev/api/paypal/webhook';

/** the route, mounted alone — which is how ../routes.ts nests it, and the whole point of it. */
const callback = mountRoutes([{ path: 'api/paypal/webhook', module: webhook }]);

/** a deployment PayPal can be asked to vouch for a delivery on. */
const CONFIGURED = {
	PAYPAL_CLIENT_ID: 'Aa-notarealclientid',
	PAYPAL_CLIENT_SECRET: 'EL-notarealsecret',
	PAYPAL_WEBHOOK_ID: '7YN47048TX2895013'
};

/** the credentials without the listener id, which is the one an operator sets last. */
const { PAYPAL_WEBHOOK_ID: _unset, ...NO_LISTENER } = CONFIGURED;

/**
 * the five headers PayPal signs a delivery with, keyed the way `Headers` iterates.
 *
 * the whole set, because the adapter refuses on the first one missing — so a case that wants to be
 * stopped by something else has to carry all five, and a case testing the refusal drops one.
 */
const SIGNED: Readonly<Record<string, string>> = {
	'paypal-transmission-id': 'b1c2d3e4-0000-4000-8000-000000000001',
	'paypal-transmission-time': '2026-08-03T12:00:00Z',
	'paypal-transmission-sig': 'deadbeef',
	'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT-notareal',
	'paypal-auth-algo': 'SHA256withRSA'
};

/**
 * the pool's env with the deploy-time values a case wants, as a proxy rather than a copy: `env` is
 * the runtime's own object and spreading it would keep only whichever of its members happen to be
 * enumerable — the D1 binding among the ones at risk.
 *
 * the pool declares none of the three above (../../vitest.workers.config.ts), so the bare `env` is
 * the fresh fork: nothing set, and no delivery verifiable at all.
 */
function envWith(values: Record<string, string>): Env {
	return new Proxy(env, {
		get(target, property) {
			if (typeof property === 'string' && property in values) return values[property];
			return Reflect.get(target, property);
		}
	}) as Env;
}

/**
 * the delivery as the processor sends it, counting what is read off it.
 *
 * a subclass rather than a spy on the prototype, so the count belongs to one request and no case
 * can be polluted by another. it is also self-checking: react router hands the handler the very
 * instance it was given, so a count of zero is a request that never reached the route rather than
 * a body nobody read.
 */
class CountedDelivery extends Request {
	reads = 0;

	override text(): Promise<string> {
		this.reads += 1;
		return super.text();
	}
}

/** what a route `middleware` is handed, the way $lib/server/api/meter.ts names it. */
type MiddlewareArgs = Parameters<MiddlewareFunction<Response>>[0];
type MiddlewareNext = Parameters<MiddlewareFunction<Response>>[1];

interface Delivered {
	readonly response: Response;
	/** how many times the handler read the body off the request it was handed. */
	readonly reads: number;
}

/** one delivery, exactly as it arrives on the wire. */
async function deliver(
	body = 'this is not a json object',
	signing: Readonly<Record<string, string>> = SIGNED,
	configEnv: Env = envWith(CONFIGURED)
): Promise<Delivered> {
	const headers = new Headers({ 'content-type': 'application/json', ...signing });
	const request = new CountedDelivery(ADDRESS, { method: 'POST', headers, body });
	const response = await callback(request, { env: configEnv });
	return { response, reads: request.reads };
}

describe('POST /api/paypal/webhook', () => {
	it('refuses a delivery whose body PayPal cannot be asked to vouch for', async () => {
		// not a JSON object, so there is no `webhook_event` to send for verification and nothing in
		// it may be believed. a handler that parsed before asking would fault here rather than
		// refuse, which is the ordering this endpoint exists to keep.
		const { response } = await deliver();

		// 400 rather than 200: every refusal here has to show as a failed delivery in PayPal's own
		// dashboard, which is the only place a deployment that verifies nothing is visible. answered
		// 200 it would read as healthy while every approved order went uncaptured.
		expect(response.status).toBe(400);
	});

	it('refuses a delivery short of a header it is signed with, and names it', async () => {
		const { 'paypal-transmission-sig': _dropped, ...short } = SIGNED;

		const { response } = await deliver('{"id":"WH-1"}', short);

		expect(response.status).toBe(400);
		// a 4xx body is read by agents rather than humans, so it names the offending value
		// (CLAUDE.md).
		expect((await response.json()) as Record<string, unknown>).toMatchObject({
			message: expect.stringContaining('paypal-transmission-sig')
		});
	});

	it('refuses a delivery carrying no signing headers at all', async () => {
		const { response } = await deliver('{"id":"WH-1"}', {});

		expect(response.status).toBe(400);
	});

	it('asks for the delivery again when this deployment has no listener id', async () => {
		// the credentials are set and the one value minted by registering the endpoint is not, which
		// is the shape a half-finished set-up leaves behind.
		const { response } = await deliver('{"id":"WH-1"}', SIGNED, envWith(NO_LISTENER));

		// not a fault in the delivery and not a permanent one: an operator sets a variable, and
		// PayPal's redelivery window is measured in days, so a delivery held open across that moment
		// is a settlement recovered.
		expect(response.status).toBe(503);
		expect((await response.json()) as Record<string, unknown>).toMatchObject({
			message: expect.stringContaining('PAYPAL_WEBHOOK_ID')
		});
	});

	it('asks for the delivery again when this deployment holds no credentials', async () => {
		const { response } = await deliver('{"id":"WH-1"}', SIGNED, env);

		expect(response.status).toBe(503);
	});

	it('never answers 2xx for a delivery it could not verify', async () => {
		const unvouched = await deliver();
		const unsigned = await deliver('{"id":"WH-1"}', {});
		const unconfigured = await deliver('{"id":"WH-1"}', SIGNED, env);

		// 2xx means stop, and stopping on a delivery nothing was done with is a gift approved on
		// PayPal and never captured — see this route's own header.
		for (const { response } of [unvouched, unsigned, unconfigured]) {
			expect(response.ok).toBe(false);
		}
	});

	/**
	 * `PAYMENT.CAPTURE.COMPLETED` is published under Payments v1 as well as v2, and a v1-shaped
	 * resource names no order. no redelivery of it ever reads differently, so asking for one buys
	 * PayPal's whole retry schedule — up to 25 attempts over three days — of the same answer.
	 */
	it('answers a verified delivery it can never read without asking for it again', async () => {
		vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(String(input), init);
			return new URL(request.url).pathname === '/v1/oauth2/token'
				? Response.json({ access_token: 'A21AA-token', token_type: 'Bearer', expires_in: 32400 })
				: Response.json({ verification_status: 'SUCCESS' });
		});
		const v1Capture = JSON.stringify({
			id: 'WH-2',
			event_type: 'PAYMENT.CAPTURE.COMPLETED',
			create_time: '2026-08-16T22:21:19Z',
			resource_type: 'capture',
			resource: { id: '3C679366HH908993F', parent_payment: 'PAY-1B56960729604235TKQQIYVY' }
		});

		const { response } = await deliver(v1Capture);

		expect(response.status).toBe(200);
		expect((await response.json()) as Record<string, unknown>).toMatchObject({
			outcome: 'unactionable'
		});
	});

	it('writes nothing on any refusal', async () => {
		await deliver();
		await deliver('{"id":"WH-1"}', {});
		await deliver('{"id":"WH-1"}', SIGNED, env);

		const groups = await env.DB.prepare('select count(*) as n from entry_group').first<{
			n: number;
		}>();
		expect(groups?.n).toBe(0);
	});

	/**
	 * a `GET` on this address, which react router sends to the `loader`. the operator pasting the
	 * URL into PayPal's developer dashboard is who opens it, and without a `loader` what they would
	 * read is the framework's own 400 naming the route id.
	 */
	it('tells a browser what the address takes, and reads nothing off it', async () => {
		const request = new CountedDelivery(ADDRESS);
		const response = await callback(request, { env: envWith(CONFIGURED) });

		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
		expect(request.reads).toBe(0);
	});
});

describe('the raw body the signature is computed over', () => {
	/**
	 * the whole of what this endpoint owes, stated as a count.
	 *
	 * one read means the bytes reached the handler as they were sent: nothing above the route
	 * parsed them, cloned them or re-serialised them. the refusal beside it is what says the request
	 * got that far — a count of one against a 500 would be a body read on the way to a fault.
	 */
	it('is read exactly once, by the handler that owns it', async () => {
		const { response, reads } = await deliver();

		expect(reads).toBe(1);
		expect(response.status).toBe(400);
	});

	/**
	 * and what a `middleware` above this route would do to it, run rather than argued.
	 *
	 * this is the failure the placement exists to avoid, and it is invisible everywhere else: the
	 * delivery is well-formed, the listener id is right, and the endpoint faults — in production, on
	 * every delivery, with PayPal's dashboard the only place it shows. the chain below is composed
	 * here so the rule can be shown to fail; that the real tree has no layout over this route is
	 * ../routes.spec.ts's, against the route config react router serves.
	 */
	it('is gone by the time the handler runs if anything above it looked', async () => {
		const eavesdropper = {
			middleware: [
				async ({ request }: MiddlewareArgs, next: MiddlewareNext) => {
					await request.text();
					return next();
				}
			]
		};
		const nested = mountRoutes([
			{ path: 'api', module: eavesdropper },
			{ path: 'paypal/webhook', module: webhook }
		]);

		const request = new CountedDelivery(ADDRESS, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...SIGNED },
			body: '{"id":"WH-1"}'
		});
		const response = await nested(request, { env: envWith(CONFIGURED) });

		expect(request.reads).toBe(2);
		expect(response.status).toBe(500);
	});
});

/**
 * a capture refund reaching the books through this route, with PayPal answering a stubbed `fetch`
 * by path the way $lib/server/payments/paypal-refunds.workers.spec.ts answers the adapter — vouching
 * for every delivery, and 404 for an id it does not hold — so the status asserted is the one PayPal
 * reads for a delivery the writer acted on.
 */
describe('POST /api/paypal/webhook — a capture refund', () => {
	const FORM_ID = 'frm_paypalroute00001';
	const ORDER_ID = '5O190127TN364715T';
	const CAPTURE_ID = '3C679366HH908993F';
	const REFUND_ID = '1JU08902781691411';
	const SETTLED = '2026-08-16T22:21:19Z';
	const REFUNDED = '2026-08-20T09:12:40Z';

	beforeEach(async () => {
		for (const table of [
			'dispute',
			'zapier_delivery',
			'quickbooks_sync',
			'ledger_entry',
			'entry_group',
			'payment',
			'line_item',
			'donation',
			'contact',
			'form'
		]) {
			await env.DB.prepare(`delete from ${table}`).run();
		}
		await env.DB.prepare(
			`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`
		)
			.bind(FORM_ID, postableId('donationsDeductible'))
			.run();
	});

	/** a $100 one-off gift quoted on the order, as the donation endpoint records one. */
	async function quotedGift(): Promise<string> {
		const donationId = crypto.randomUUID();
		const donor = parseContact({
			kind: 'individual',
			first_name: 'Ada',
			last_name: 'Okafor',
			primary_email: 'ada@example.org'
		});
		if (!donor.ok) throw new Error('the fixture donor did not parse');
		const recorded = await recordDonation(createDb(env.DB), {
			donationId,
			donor: donor.value,
			formId: FORM_ID,
			origin: 'https://acme.org',
			currency: 'USD',
			processor: 'paypal',
			totalMinor: 10_000,
			feeMinor: 0,
			lines: [
				{
					label: 'Donation',
					revenueAccountId: postableId('donationsDeductible'),
					amountMinor: 10_000
				}
			],
			method: 'paypal',
			providerTxnId: ORDER_ID,
			occurredAt: new Date(SETTLED),
			consentedToContact: false,
			note: undefined,
			tribute: null,
			programId: null
		});
		if (!recorded.ok) throw new Error(`the fixture gift was not recorded: ${recorded.detail}`);
		return donationId;
	}

	/** PayPal holding the order, its capture in `captureStatus`, and a full refund of it. */
	function paypalHolds(donationId: string, captureStatus: 'COMPLETED' | 'REFUNDED'): void {
		const customId = JSON.stringify({ donation_id: donationId });
		const answers: Readonly<Record<string, unknown>> = {
			'GET /v1/customer/disputes': { items: [] },
			[`GET /v2/checkout/orders/${ORDER_ID}`]: {
				id: ORDER_ID,
				status: 'COMPLETED',
				create_time: SETTLED,
				payment_source: { paypal: { email_address: 'payer@example.org' } },
				purchase_units: [
					{
						custom_id: customId,
						amount: { currency_code: 'USD', value: '100.00' },
						payments: { captures: [{ id: CAPTURE_ID, status: captureStatus }] }
					}
				]
			},
			[`GET /v2/payments/captures/${CAPTURE_ID}`]: {
				id: CAPTURE_ID,
				status: captureStatus,
				custom_id: customId,
				create_time: SETTLED,
				supplementary_data: { related_ids: { order_id: ORDER_ID } },
				seller_receivable_breakdown: {
					gross_amount: { currency_code: 'USD', value: '100.00' },
					paypal_fee: { currency_code: 'USD', value: '3.98' },
					net_amount: { currency_code: 'USD', value: '96.02' }
				}
			},
			[`GET /v2/payments/refunds/${REFUND_ID}`]: {
				id: REFUND_ID,
				status: 'COMPLETED',
				amount: { currency_code: 'USD', value: '100.00' },
				create_time: REFUNDED,
				update_time: REFUNDED,
				links: [
					{
						rel: 'up',
						method: 'GET',
						href: `https://api-m.paypal.com/v2/payments/captures/${CAPTURE_ID}`
					}
				]
			}
		};
		vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(String(input), init);
			const { pathname } = new URL(request.url);
			if (pathname === '/v1/oauth2/token') {
				return Response.json({
					access_token: 'A21AA-token',
					token_type: 'Bearer',
					expires_in: 32400
				});
			}
			if (pathname === '/v1/notifications/verify-webhook-signature') {
				return Response.json({ verification_status: 'SUCCESS' });
			}
			const route = `${request.method} ${pathname}`;
			return route in answers
				? Response.json(answers[route])
				: Response.json(
						{ name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] },
						{ status: 404 }
					);
		});
	}

	async function settlement(donationId: string) {
		paypalHolds(donationId, 'COMPLETED');
		return deliver(
			JSON.stringify({
				id: 'WH-SETTLE',
				event_version: '1.0',
				event_type: 'PAYMENT.CAPTURE.COMPLETED',
				resource_type: 'capture',
				create_time: SETTLED,
				resource: { id: CAPTURE_ID, supplementary_data: { related_ids: { order_id: ORDER_ID } } }
			})
		);
	}

	async function refund(donationId: string) {
		paypalHolds(donationId, 'REFUNDED');
		return deliver(
			JSON.stringify({
				id: 'WH-R1',
				event_version: '1.0',
				event_type: 'PAYMENT.CAPTURE.REFUNDED',
				resource_type: 'refund',
				create_time: REFUNDED,
				resource: { id: REFUND_ID, status: 'COMPLETED' }
			})
		);
	}

	async function refundRows() {
		const { results } = await env.DB.prepare(
			`select provider_txn_id, amount_minor from payment where direction = 'refund'`
		).all<{ provider_txn_id: string; amount_minor: number }>();
		return results;
	}

	it('posts the refund of a settled gift, and answers 200', async () => {
		const donationId = await quotedGift();
		await settlement(donationId);

		const { response } = await refund(donationId);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ outcome: 'posted' });
		expect(await refundRows()).toEqual([{ provider_txn_id: REFUND_ID, amount_minor: 10_000 }]);
	});

	it('asks again for a refund that arrives before its gift settles, and posts it once it has', async () => {
		const donationId = await quotedGift();

		const early = await refund(donationId);

		expect(early.response.status).toBe(503);
		expect(await refundRows()).toEqual([]);

		await settlement(donationId);
		const again = await refund(donationId);

		expect(again.response.status).toBe(200);
		expect(await refundRows()).toEqual([{ provider_txn_id: REFUND_ID, amount_minor: 10_000 }]);
	});
});
