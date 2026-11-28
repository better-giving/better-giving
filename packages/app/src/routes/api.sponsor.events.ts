import { settleDelivery } from '$lib/server/donations/settle';
import { createEmailProvider } from '$lib/server/email/factory';
import { giftLinkOrigin } from '$lib/server/matching/links';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { database, platform } from '../context';
import type { Route } from './+types/api.sponsor.events';

// where a hosted site's fiscal sponsor delivers its events — a gift that settled, a refund or a
// dispute, a payout — and they reach this deployment's records and books. it takes its shape from
// ./api.stripe.webhook.ts, whose header argues every part of it: a resource route that nests under
// no layout, so no `middleware` reads the body before the signature is checked
// (../routes.spec.ts holds that), the raw text read exactly once here, everything the event does
// `settleDelivery`'s, and this file owning only the status the sponsor is told.
//
// the address is exactly `/api/sponsor/events`, which provisioning sets as the site's callback on
// the sponsor's side (`SPONSOR_EVENTS_SECRET` is what signs each delivery). it is outside
// `/api/v1` for the reason the other four callbacks are.
//
// a delivery that never arrived is not lost: the hourly pull reads what the sponsor holds
// ($lib/server/payouts/pull.ts), so the two reach `settleEvent` with the same event and the second
// one is a no-op.

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	if (request.method !== 'POST') return methodNotAllowed(request.method);

	const { env } = context.get(platform);
	const processors = createPaymentProviders(env);
	const result = await settleDelivery(
		{
			db: context.get(database),
			provider: processors.for('sponsor'),
			processors,
			email: createEmailProvider(env),
			giftOrigin: giftLinkOrigin(env, new URL(request.url))
		},
		// `Headers` iterates lowercase, which is the keying the adapter reads its headers by.
		{ body: await request.text(), headers: Object.fromEntries(request.headers) }
	);

	if (result.ok) {
		// 409: the event names money the sponsor holds, not one it has taken. nothing was written
		// and the cursor stays before it, so the sponsor sends it again.
		const status = result.outcome === 'not_yet' ? 409 : 200;
		return Response.json({ outcome: result.outcome, message: result.detail }, { status });
	}
	return Response.json({ message: result.detail }, { status: FAILURE_STATUS[result.reason] });
}

/** a `GET`, `HEAD` or `OPTIONS` — `loader` in ./api.paypal.webhook.ts argues why it is written. */
export function loader({ request }: Route.LoaderArgs): Response {
	return methodNotAllowed(request.method);
}

function methodNotAllowed(method: string): Response {
	return Response.json(
		{
			message: `This endpoint takes a Better Giving delivery by POST. ${method} is not a method it answers.`,
			fix:
				'Better Giving posts this site’s gift and payout updates here, and nothing on this ' +
				'site sets it up. If gifts stop arriving, ask Better Giving to send them to this ' +
				'address again.'
		},
		{ status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } }
	);
}

/**
 * what the sponsor is told: a 2xx stops it and anything else is sent again, as
 * ./api.stripe.webhook.ts argues — 409 `not_yet` included, which is a 2xx's opposite and still
 * worth the next delivery rather than a repeat of this one.
 *
 * - 400, the signature: `webhook-id`, `webhook-timestamp` and `webhook-signature` were not all
 *   there, the timestamp was more than five minutes off, or no signature verified against
 *   `SPONSOR_EVENTS_SECRET`. nothing in the body is believed, and the sponsor's dashboard shows it
 *   as a failed delivery.
 * - 409, `not_yet`: the event names a payment or a refund the sponsor reads back as still
 *   `pending`, or a refund before its payment. nothing was written and the cursor stays before it;
 *   the sponsor sends it again (`not_yet` in $lib/server/donations/delivery.ts).
 * - 503, verified and something this deployment depends on did not answer — the sponsor
 *   unreachable, a read that did not come back, a write the database refused. repeating it is safe:
 *   `entry_group_source_idx` and `payment_provider_txn_idx` in $lib/server/db/schema.ts make the
 *   identical write a no-op.
 */
const FAILURE_STATUS = { unverified: 400, incomplete: 503 } as const;
