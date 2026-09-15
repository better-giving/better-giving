import { settleDelivery } from '$lib/server/donations/settle';
import { createEmailProvider } from '$lib/server/email/factory';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { database, platform } from '../context';
import type { Route } from './+types/api.chariot.webhook';

// where a received DAF grant becomes a gift in the books: the `grant.updated` deliveries Chariot's
// event subscription posts here.
//
// ./api.stripe.webhook.ts's shape, down to the status table, for the reason ./api.paypal.webhook.ts
// gives: the processor callbacks make one decision and differ only in which adapter the port hands
// back. those headers argue every choice below; what is written here is the part that is Chariot's.
//
// **it is named to nest under no layout, which is a control rather than filing.** the body is read
// exactly once, here, as text (CLAUDE.md): `verifyEvent` in $lib/server/payments/chariot.ts checks
// `chariot-webhook-signature` as an HMAC over the bytes exactly as sent. ../routes.spec.ts holds that
// this route has no layout above it, and pins its path to `CHARIOT_WEBHOOK_PATH` in
// packages/operator/src/chariot/webhook-subscription.ts, the address the subscription is created
// against.
//
// no replay window, because Chariot documents none and a replayed delivery does nothing but re-read
// the grant (`verifyEvent`'s own comment).
//
// everything the delivery does is `settleDelivery`'s ($lib/server/donations/settle.ts); this file owns
// which status each outcome answers with, which is the one thing Chariot reads.
//
// nothing here is a module-scope singleton: the D1 handle arrives on the request context, which
// ../request-context.ts seeds per request, and both ports are built from that env on the call.

/**
 * one delivery from Chariot.
 *
 * react router routes every mutating method to this one function, so anything but a `POST` is
 * refused before it could be handed to the verifier as a delivery.
 */
export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST') return methodNotAllowed(request.method);

	const { env } = context.get(platform);
	const result = await settleDelivery(
		{
			db: context.get(database),
			provider: createPaymentProviders(env).for('chariot'),
			email: createEmailProvider(env)
		},
		// `Headers` iterates lowercase, which is the keying the adapter reads its header by.
		{ body: await request.text(), headers: Object.fromEntries(request.headers) }
	);

	if (result.ok) return Response.json({ outcome: result.outcome, message: result.detail });
	return Response.json({ message: result.detail }, { status: FAILURE_STATUS[result.reason] });
}

/** a `GET`, `HEAD` or `OPTIONS` — `loader` in ./api.paypal.webhook.ts argues why it is written. */
export function loader({ request }: Route.LoaderArgs): Response {
	return methodNotAllowed(request.method);
}

function methodNotAllowed(method: string): Response {
	return Response.json(
		{
			message: `This endpoint takes a Chariot delivery by POST. ${method} is not a method it answers.`,
			fix: 'Chariot posts grant updates here. Setting Chariot up in the console (`better-giving start`, under Donation processor) creates the subscription for this address and stores its secret as CHARIOT_WEBHOOK_SECRET.'
		},
		{ status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } }
	);
}

/**
 * what Chariot is told: 2xx stops it, anything else is sent again.
 *
 * every `ok` outcome is a 200, the nothing-written ones included — a category this app ignores, a
 * redelivery the books already hold, a grant no gift here is bound to — because a second delivery
 * would reach each of them identically.
 *
 * - 400, the signature: `chariot-webhook-signature` missing, unreadable, or not computed with
 *   `CHARIOT_WEBHOOK_SECRET`. nothing in the body may be believed, and a non-2xx is what shows a
 *   deployment holding the wrong secret as failing deliveries on Chariot's side.
 * - 503, verified or not yet checkable and something this deployment depends on did not answer —
 *   no secret or key set, Get Grant unreachable, a write the database refused. repeating it is safe:
 *   the grant is re-read, and `entry_group_source_idx` in $lib/server/db/schema.ts makes the identical
 *   posting a no-op.
 */
const FAILURE_STATUS = { unverified: 400, incomplete: 503 } as const;
