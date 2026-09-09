import { env } from 'cloudflare:test';
import type { MiddlewareFunction } from 'react-router';
import { describe, expect, it } from 'vitest';
import { mountRoutes } from '../route-request.testing';
import * as webhook from './api.stripe.webhook';

// the endpoint's own decision: which status the processor is told, which is the only thing about
// this response it reads. what a delivery does is `$lib/server/donations/settle.workers.spec.ts`.
//
// a workers spec, and not only for D1. every case here runs the signature check the deployed
// adapter runs — `constructEventAsync` with the subtle-crypto provider, which is the form that
// exists on workerd and the reason the synchronous one is not used (see $lib/server/payments/
// stripe.ts). in the node pool that call would succeed against node's own crypto and prove nothing
// about the runtime this deploys to.
//
// nothing here reaches the network: a signature that does not verify is refused before any HTTP
// call, and a deployment with no credentials refuses before that.
//
// the route is driven through react router rather than by calling its `action`, for the reason
// ../route-request.testing.ts argues at length — `queryRoute` without `generateMiddlewareResponse`
// runs the handler with no middleware at all and says nothing. on this route that is not a
// convention but the subject: what the cases at the foot of this file assert is that the raw bytes
// reach the handler unread, which a spec that skipped the pipeline could not tell apart from a
// pipeline that had eaten them.

/** the address the processor delivers to. `STRIPE_WEBHOOK_PATH` in @better-giving/operator/stripe/webhook-endpoint. */
const ADDRESS = 'https://give.example.workers.dev/api/stripe/webhook';

/** the route, mounted alone — which is how ../routes.ts nests it, and the whole point of it. */
const callback = mountRoutes([{ path: 'api/stripe/webhook', module: webhook }]);

/** a deployment with a signing secret, so the verification is real rather than skipped. */
const CONFIGURED = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
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
	body = '{"id":"evt_1","type":"payment_intent.succeeded"}',
	signature: string | null = 't=1,v1=deadbeef',
	configEnv: Env = envWith(CONFIGURED)
): Promise<Delivered> {
	const headers = new Headers({ 'content-type': 'application/json' });
	if (signature !== null) headers.set('stripe-signature', signature);
	const request = new CountedDelivery(ADDRESS, { method: 'POST', headers, body });
	const response = await callback(request, { env: configEnv });
	return { response, reads: request.reads };
}

describe('POST /api/stripe/webhook', () => {
	it('refuses a delivery whose signature does not verify', async () => {
		const { response } = await deliver();

		// 400 rather than 200: a deployment holding the wrong signing secret shows up as failed
		// deliveries in the processor's own dashboard, which is the only place that fault is
		// visible. answered 200 it would read as healthy while every settlement was dropped.
		expect(response.status).toBe(400);
		expect((await response.json()) as Record<string, unknown>).toMatchObject({
			message: expect.stringContaining('STRIPE_WEBHOOK_SECRET')
		});
	});

	it('refuses a delivery carrying no signature at all', async () => {
		const { response } = await deliver('{}', null);

		expect(response.status).toBe(400);
	});

	it('does not read the body of a delivery that did not verify', async () => {
		// not JSON at all. a handler that parsed before checking the signature would fault here
		// rather than refuse, which is the ordering this endpoint exists to keep.
		const { response } = await deliver('this is not json', 't=1,v1=deadbeef');

		expect(response.status).toBe(400);
	});

	it('asks for the delivery again when this deployment holds no credentials', async () => {
		const { response } = await deliver('{}', 't=1,v1=deadbeef', env);

		// not a fault in the delivery and not a permanent one: an operator sets a variable, and the
		// processor's redelivery window is measured in days, so a delivery held open across that
		// moment is a settlement recovered.
		expect(response.status).toBe(503);
	});

	it('never answers 2xx for a delivery it did not act on', async () => {
		const unverified = await deliver();
		const unconfigured = await deliver('{}', 't=1,v1=deadbeef', env);

		// 2xx means stop, and stopping on a delivery nothing was done with is a settlement lost.
		for (const { response } of [unverified, unconfigured]) {
			expect(response.ok).toBe(false);
		}
	});

	it('writes nothing on any refusal', async () => {
		await deliver();
		await deliver('{}', null);
		await deliver('{}', 't=1,v1=deadbeef', env);

		const groups = await env.DB.prepare('select count(*) as n from entry_group').first<{
			n: number;
		}>();
		expect(groups?.n).toBe(0);
	});

	/**
	 * a `GET` on this address, which react router sends to the `loader`. the operator opening the
	 * URL out of the processor's dashboard is who reads it, and without a `loader` what they would
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
	 * parsed them, cloned them or re-serialised them, and the signature was checked against what
	 * the processor signed. the refusal beside it is what says the request got that far — a count
	 * of one against a 500 would be a body read on the way to a fault.
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
	 * delivery is well-formed, the signing secret is right, and the endpoint faults — in
	 * production, on every delivery, with the processor's dashboard the only place it shows. the
	 * chain below is composed here so the rule can be shown to fail; that the real tree has no
	 * layout over this route is ../routes.spec.ts's, against the route config react router serves.
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
			{ path: 'stripe/webhook', module: webhook }
		]);

		const request = new CountedDelivery(ADDRESS, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
			body: '{"id":"evt_1","type":"payment_intent.succeeded"}'
		});
		const response = await nested(request, { env: envWith(CONFIGURED) });

		expect(request.reads).toBe(2);
		expect(response.status).toBe(500);
	});
});
