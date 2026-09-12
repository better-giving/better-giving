import { env } from 'cloudflare:test';
import type { MiddlewareFunction } from 'react-router';
import { describe, expect, it } from 'vitest';
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
// **nothing here reaches the network, and every case is built on a refusal that stops it short of
// one.** `verifyEvent` in $lib/server/payments/paypal.ts asks PayPal to vouch for a delivery over
// HTTP, and there is no sandbox in this project to dial. three things are refused before that call
// — no listener id, a missing signing header, a body that is not a JSON object — and the last case
// in this file is stopped earlier still, by a body a `middleware` above the route had already
// consumed. anything else pairing all five signing headers with a parseable body would leave the
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

	it('never answers 2xx for a delivery it did not act on', async () => {
		const unvouched = await deliver();
		const unsigned = await deliver('{"id":"WH-1"}', {});
		const unconfigured = await deliver('{"id":"WH-1"}', SIGNED, env);

		// 2xx means stop, and stopping on a delivery nothing was done with is a gift approved on
		// PayPal and never captured — see this route's own header.
		for (const { response } of [unvouched, unsigned, unconfigured]) {
			expect(response.ok).toBe(false);
		}
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
