import { settleDelivery } from '$lib/server/donations/settle';
import { createEmailProvider } from '$lib/server/email/factory';
import { cachedCoins } from '$lib/server/forms/coin-cache';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { database, platform } from '../context';
import type { Route } from './+types/api.nowpayments.webhook';

// where a crypto gift reaches the books: the IPNs NOWPayments posts to the address each payment was
// minted with (`ipn_callback_url`, built by `webhookAddress` in $lib/server/payments/webhook-address.ts).
//
// ./api.chariot.webhook.ts's shape, down to the status table, for the reason ./api.paypal.webhook.ts
// gives: the processor callbacks make one decision and differ only in which adapter the port hands
// back. those headers argue every choice below; what is written here is the part that is NOWPayments'.
//
// **it is named to nest under no layout, which is a control rather than filing.** the body is read
// exactly once, here, as text (CLAUDE.md): `verifyEvent` in $lib/server/payments/nowpayments.ts checks
// `x-nowpayments-sig` before a byte of it is believed. ../routes.spec.ts holds that this route has no
// layout above it, and pins its path to `NOWPAYMENTS_IPN_PATH` in
// packages/operator/src/nowpayments/ipn-callback.ts.
//
// everything the delivery does is `settleDelivery`'s ($lib/server/donations/settle.ts); this file owns
// which status each outcome answers with, and the served coin list a receipt names its coin from.
//
// nothing here is a module-scope singleton: the D1 handle arrives on the request context, which
// ../request-context.ts seeds per request, and both ports are built from that env on the call.

/**
 * one IPN from NOWPayments.
 *
 * react router routes every mutating method to this one function, so anything but a `POST` is
 * refused before it could be handed to the verifier as a delivery.
 */
export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST') return methodNotAllowed(request.method);

	const { env } = context.get(platform);
	const processors = createPaymentProviders(env);
	const result = await settleDelivery(
		{
			db: context.get(database),
			provider: processors.for('nowpayments'),
			email: createEmailProvider(env),
			payableCoins: () => cachedCoins(processors, new URL(request.url).origin)
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
			message: `This endpoint takes a NOWPayments payment notification by POST. ${method} is not a method it answers.`,
			fix: 'NOWPayments posts here for every crypto payment this deployment creates. Its IPN secret, under Payment Settings in the NOWPayments dashboard, is stored in the console (`better-giving start`) as NOWPAYMENTS_IPN_SECRET.'
		},
		{ status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } }
	);
}

/**
 * what NOWPayments is told: 2xx stops it, and a non-2xx is sent again the number of times, at the
 * interval, set under Payment Settings → Instant Payment Notifications in its dashboard — then not at
 * all until the payment's status next changes.
 *
 * every `ok` outcome is a 200, the nothing-written ones included — `refunded` or a status nobody
 * documented, a redelivery the books already hold, an address that expired with nothing sent, a
 * deposit to an address with no payment here — because a second delivery would reach each of them
 * identically.
 *
 * - 400: `x-nowpayments-sig` missing, or not NOWPayments' HMAC under `NOWPAYMENTS_IPN_SECRET`, so
 *   nothing in the body may be believed; or a signed body naming no `payment_id` or `payment_status`.
 * - 503: `NOWPAYMENTS_IPN_SECRET` not set, or a verified IPN whose valuation or payment read did not
 *   answer, or a write the database refused. a payment the key cannot read — a key replaced since it
 *   was made — settles from the verified IPN instead of waiting. repeating it is safe:
 *   `entry_group_source_idx` and `payment_provider_txn_idx` in $lib/server/db/schema.ts make the
 *   identical write a no-op.
 */
const FAILURE_STATUS = { unverified: 400, incomplete: 503 } as const;
