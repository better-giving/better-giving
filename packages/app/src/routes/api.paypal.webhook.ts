import { settleDelivery } from '$lib/server/donations/settle';
import { createEmailProvider } from '$lib/server/email/factory';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { database, platform } from '../context';
import type { Route } from './+types/api.paypal.webhook';

// where a settled PayPal payment becomes a gift in the books: the processor's own callback, and the
// second of the two routes in this app whose caller is a machine belonging to somebody else.
//
// it is ./api.stripe.webhook.ts's shape, deliberately and down to the status table, because the two
// routes make the same decision for two processors and the whole of what differs is which adapter
// the port hands back. that file's header argues every choice below; what is written here is the
// part that is PayPal's.
//
// **an unanswered delivery here is a gift that is never taken, which is not true of the other
// route.** PayPal has no auto-capture: an order this app created with `intent: CAPTURE` and the
// payer approved is money authorised and not moved, and the capture is made inside the
// reconciliation read off the `CHECKOUT.ORDER.APPROVED` delivery (`readSettlement` in
// $lib/server/payments/paypal.ts). so a delivery this route swallows is not a settlement recorded
// late — it is a donor who pressed the button, believes they gave, and was never charged. that is
// why every refusal below is answered honestly rather than with the 200 that would make this
// endpoint look healthy.
//
// a resource route: no component export, so react router answers with what the handlers return
// instead of rendering anything (react-router/docs/how-to/resource-routes.md). the delivery is a
// `POST`, so it reaches the `action`; the `loader` at the foot of this file is where every other
// method the framework routes to it lands.
//
// it lives outside `/api/v1` for the reason the Stripe callback does, and **it is named to nest
// under no layout, which is a control rather than filing.** the body is read exactly once, here, as
// text (CLAUDE.md): PayPal is asked to vouch for the delivery's own event
// (https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature) together with the
// five headers it signed, and a body some hook above the route had already consumed reaches the
// handler as an exception rather than as bytes. ../routes.spec.ts holds that this route has no
// layout above it and that no route but the three surface layouts exports a `middleware` at all,
// and ./api.paypal.webhook.workers.spec.ts holds that the bytes arrive unread and are read once.
//
// **the console registers this address, and its id is what `PAYPAL_WEBHOOK_ID` holds.** the path is
// `PAYPAL_WEBHOOK_PATH` in packages/operator/src/paypal/webhook-listener.ts, which the binary's copy is
// gated against, and ../routes.spec.ts pins this file's name to it.
//
// what is decided here and what is not. everything the delivery does is `settleDelivery`'s
// ($lib/server/donations/settle.ts); this file owns which status each outcome answers with, which
// is the one decision the processor actually reads.
//
// nothing here is a module-scope singleton. the D1 handle arrives on the request context, which
// ../request-context.ts seeds per request, and both ports are built from that env on the call.

/**
 * one delivery from PayPal.
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
			provider: createPaymentProviders(env).for('paypal'),
			email: createEmailProvider(env)
		},
		// the headers whole, because which of them verifies a delivery is the adapter's fact
		// ($lib/server/payments/provider.ts) — and here it is five of them rather than one.
		// `Headers` iterates lowercase, which is the keying that type states.
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
 * is listed on PayPal's developer dashboard beside the listener, so it is one an operator will open
 * in a browser, and what they should read there is that it takes a `POST`.
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
			message: `This endpoint takes a PayPal delivery by POST. ${method} is not a method it answers.`,
			fix: 'PayPal posts deliveries here. Saving PayPal’s credentials in the console (`better-giving start`, under Donation processor) registers this address as the listener and stores its id as PAYPAL_WEBHOOK_ID.'
		},
		{ status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } }
	);
}

/**
 * what the processor is told, and it is the only thing about this response it reads.
 *
 * 2xx means stop, and everything else means send it again. every outcome above is a 200, including
 * the ones where nothing was written: a delivery this app subscribes to nothing for, a redelivery
 * the books already hold, and a settlement with no gift behind it are all things a second delivery
 * would reach identically, so asking for one buys days of retries and an endpoint PayPal marks as
 * failing.
 *
 * - 400, the signature. either the delivery carried none of the five headers PayPal signs with, or
 *   PayPal declined to vouch for it — so nothing in the body may be believed, including whether it
 *   came from PayPal at all. non-2xx rather than 200 because of who reads it: a deployment whose
 *   `PAYPAL_WEBHOOK_ID` is another listener's shows up as failed deliveries in PayPal's own
 *   dashboard, which is the only place that fault is visible, and a 200 would leave it reading as
 *   healthy while every approved order went uncaptured.
 * - 503, everything verified and something this deployment depends on did not answer — PayPal
 *   unreachable, a read that never came back, a write the database refused, or no listener id set
 *   at all. the delivery is worth having again, and repeating it is safe twice over: the capture
 *   carries a request id derived from the order (`readSettlement` in
 *   $lib/server/payments/paypal.ts) so a second attempt resolves to the capture that already
 *   exists, and the constraint that refuses a duplicate posting (`entry_group_source_idx` in
 *   $lib/server/db/schema.ts) is what makes the identical batch a no-op the second time.
 *
 * no `Retry-After`. the processor's schedule is its own; a header from here would either be ignored
 * or would be this app guessing at somebody else's queue.
 */
const FAILURE_STATUS = { unverified: 400, incomplete: 503 } as const;
