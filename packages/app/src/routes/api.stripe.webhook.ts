import { settleDelivery } from '$lib/server/donations/settle';
import { createEmailProvider } from '$lib/server/email/factory';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { database, platform } from '../context';
import type { Route } from './+types/api.stripe.webhook';

// where a settled Stripe payment becomes a gift in the books: the processor's own callback, and one
// of the two routes in this app whose caller is a machine belonging to somebody else — the other is
// ./api.paypal.webhook.ts, which takes this file's shape for PayPal.
//
// a resource route: no component export, so react router answers with what the handlers return
// instead of rendering anything (react-router/docs/how-to/resource-routes.md). the delivery is a
// `POST`, so it reaches the `action`; the `loader` at the foot of this file is where every other
// method the framework routes to it lands.
//
// it lives outside `/api/v1` on purpose, and the difference is not filing. that surface is the
// embedded donation form's — it answers browsers on sites this deployment cannot see, so every
// request there carries CORS from the form's `allowed_origins`, a Turnstile token and a rate limit
// keyed on the caller's address, and the rate limit is a `middleware` on the layout those routes
// nest under (./api.v1.ts). none of that applies here: there is no origin to echo because there is
// no page, no challenge to solve because there is no visitor, and no form id in the path at all.
// what stands in for all of it is one signature over the raw body, which is a stronger claim than
// any of them — see `verifyEvent` in $lib/server/payments/provider.ts.
//
// **so this file is named to nest under no layout, and that is a control rather than filing
// either.** the body is read exactly once, here, as text (CLAUDE.md): the signature is computed
// over the bytes that were sent, so a body parsed and re-serialised verifies against nothing, and
// anything that touched this request ahead of the handler would break every delivery in production
// with nothing anywhere reporting it. a `middleware` above this route is the way that happens, and
// the two halves of the claim are asserted rather than left to the name — ../routes.spec.ts holds
// that this route has no layout above it and that no route but the three surface layouts exports a
// `middleware` at all, and ./api.stripe.webhook.workers.spec.ts holds that the bytes arrive unread
// and are read once.
//
// what is decided here and what is not. everything the delivery does is `settleDelivery`'s
// ($lib/server/donations/settle.ts); this file owns which status each outcome answers with, which
// is the one decision the processor actually reads.
//
// nothing here is a module-scope singleton. the D1 handle arrives on the request context, which
// ../request-context.ts seeds per request, and both ports are built from that env on the call.

/**
 * one delivery from the processor.
 *
 * react router routes every mutating method to this one function, so a `PUT` or a `DELETE` arrives
 * here as readily as a delivery does — and would otherwise be handed to the verifier as one.
 */
export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST') return methodNotAllowed(request.method);

	const { env } = context.get(platform);
	const result = await settleDelivery(
		{
			db: context.get(database),
			provider: createPaymentProviders(env).for('stripe'),
			email: createEmailProvider(env)
		},
		// the headers whole, because which of them verifies a delivery is the adapter's fact
		// ($lib/server/payments/provider.ts). `Headers` iterates lowercase, which is the keying that
		// type states.
		{ body: await request.text(), headers: Object.fromEntries(request.headers) }
	);

	if (result.ok) return Response.json({ outcome: result.outcome, message: result.detail });
	return Response.json({ message: result.detail }, { status: FAILURE_STATUS[result.reason] });
}

/**
 * the answer to a `GET`, a `HEAD` or an `OPTIONS`, which react router sends to a route's `loader`.
 *
 * written rather than left out: a route module with no `loader` answers a `GET` with the
 * framework's own 400, whose body names the route id and asks the reader to add one. this address
 * is in the processor's dashboard and in DEPLOY.md, so it is one an operator will open in a
 * browser, and what they should read there is that it takes a `POST`.
 *
 * no preflight branch, unlike the endpoints on `/api/v1`: there is no browser on this surface, so
 * there is no origin to echo and nothing to grant.
 */
export function loader({ request }: Route.LoaderArgs): Response {
	return methodNotAllowed(request.method);
}

/**
 * the answer to a method this endpoint does not take.
 *
 * `Allow` is what a caller acts on, and it is required on a 405
 * (https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/405).
 */
function methodNotAllowed(method: string): Response {
	return Response.json(
		{
			message: `This endpoint takes a Stripe delivery by POST. ${method} is not a method it answers.`,
			fix: 'Stripe posts deliveries here. Saving Stripe’s keys in the console (`better-giving start`, under Donation processor) registers this address as the endpoint.'
		},
		{ status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } }
	);
}

/**
 * what the processor is told, and it is the only thing about this response it reads.
 *
 * 2xx means stop, and everything else means send it again — that is the processor's rule rather
 * than this app's, and it is what makes the split load-bearing. every outcome above is a 200,
 * including the ones where nothing was written: a delivery this app subscribes to nothing for, a
 * redelivery the books already hold, and a settlement with no gift behind it are all things a
 * second delivery would reach identically, so asking for one buys three days of retries and an
 * endpoint the processor marks as failing.
 *
 * - 400, the signature. no body was read, so nothing about the delivery is known — including
 *   whether it came from the processor at all. non-2xx rather than 200 because of who reads it: a
 *   deployment holding the wrong signing secret shows up as failed deliveries in the processor's
 *   own dashboard, which is the only place that fault is visible, and a 200 would leave it reading
 *   as healthy while every settlement was dropped.
 * - 503, everything verified and something this deployment depends on did not answer — the
 *   processor shedding load, a read that never came back, a write the database refused, or a fee
 *   the processor has not finished computing. the delivery is worth having again, and repeating it
 *   is safe: the constraint that refuses a duplicate posting (`entry_group_source_idx` in
 *   $lib/server/db/schema.ts) is what makes the identical batch a no-op the second time.
 *
 * no `Retry-After`. the processor's schedule is its own and it backs off across three days; a
 * header from here would either be ignored or would be this app guessing at somebody else's queue.
 */
const FAILURE_STATUS = { unverified: 400, incomplete: 503 } as const;
