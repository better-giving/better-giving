import type { WebhookRepairReport } from '@better-giving/operator/console/payments';
import { webhookEndpointUrl } from '@better-giving/operator/stripe/webhook-endpoint';
import { consoleJson, consoleMethodNotAllowed } from '$lib/server/console/surface';
import { keepsWebhookEndpoint } from '$lib/server/console/processors';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { PROCESSOR_LABELS, PROCESSOR_NAMES } from '$lib/server/payments/provider';
import { repairWebhookRegistration } from '$lib/server/payments/webhook-registration';
import { platform } from '../context';
import type { Route } from './+types/console.webhook-repair';

// the cheap repair for this deployment's own webhook endpoint: subscribed to everything this app
// acts on and switched back on, with the signing secret it already has left alone.
//
// a mutation and specified as one, on the same surface and behind the same check as the report: the
// check is the `middleware` on ./console.ts and this file makes no decision about who may press —
// see the header there, and $lib/server/console/surface.ts for what this surface owes.
//
// **it is here rather than in the console because only this deployment holds the key.** the call
// goes through the payment port with this deployment's own `STRIPE_SECRET_KEY`, which is
// deploy-time and lives under `$lib/server/**` (CLAUDE.md) — the same asymmetry ./console.recurring.ts
// states.
//
// **it names Stripe because no other processor's listener is repaired from this deployment.** the
// PayPal adapter refuses the repair arms as `unsupported` ($lib/server/payments/paypal.ts): the
// console's own PayPal press finds the listener at this deployment's address and brings its
// subscription level itself (`packages/console/internal/paypal`), so a press here could only report
// that refusal back.
//
// **it is the repair and never the replacement.** replacing deletes the endpoint and creates
// another, which mints a new signing secret and leaves this deployment verifying nothing until
// somebody carries the new value to it and redeploys. this one edits the endpoint that is already
// there, so the stored secret goes on verifying across the call. what it cannot fix is the API
// version an endpoint's deliveries are serialised in, which is fixed at creation — that one is a
// replacement, and $lib/server/payments/provider.ts says so at the arm.
//
// **the endpoint is not named by the caller.** which endpoint on the account is this deployment's is
// settled by the address this request reached, exactly as the reading beside it settles it
// (./console.payments.ts) — an id a request could carry would be a press acting on whichever
// endpoint it was told to, including another deployment on the same account's. a body may name the
// processor and nothing else, and only Stripe is taken: a processor that keeps no endpoint at all
// is refused by name rather than pressed on Stripe's in its place.
//
// **nothing about the endpoint comes back out.** no id, no signing secret and no fingerprint reaches
// the answer, a sentence in it or a log line: what the console draws is the outcome and, where the
// press did not land, the port's own sentence naming the value to fix.
//
// nothing is written down here. what this press changes lives on somebody else's account, so a copy
// in a row would be a claim about a third party's state that nothing in this deployment could ever
// be told had changed.

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	const named = await namedProcessor(request);
	if (named !== null) return consoleJson(named, 400);

	const { env } = context.get(platform);

	// the address this deployment answers on, learned from the request that reached it: no hostname
	// is committed to this repository (CLAUDE.md), and the reading the operator pressed from was
	// taken at the same address.
	const url = webhookEndpointUrl(new URL(request.url).origin);
	const repaired = await repairWebhookRegistration(createPaymentProviders(env).for('stripe'), url);

	// the summary the port hands back is dropped whole rather than narrowed: every field on it is
	// either already on the reading beside this or is a value that may not cross (its id).
	const report: WebhookRepairReport = repaired.ok
		? { outcome: 'repaired', detail: null }
		: { outcome: 'failed', detail: repaired.detail };

	// a hole in the deployment, a refusal from the processor and an endpoint deleted since the screen
	// was drawn are all 500s rather than 400s, for ./console.recurring.ts's reason: no value a caller
	// could send fixes any of them.
	return consoleJson(report, report.outcome === 'failed' ? 500 : 200);
}

/** why a press body cannot be acted on, or `null` where it names Stripe or nothing. */
async function namedProcessor(
	request: Request
): Promise<{ error: string; message: string } | null> {
	const sent = await request.text();
	if (sent.trim() === '') return null;

	let body: unknown;
	try {
		body = JSON.parse(sent);
	} catch {
		return { error: 'bad_body', message: 'The request body is not JSON.' };
	}
	const named =
		typeof body === 'object' && body !== null && !Array.isArray(body)
			? (body as Record<string, unknown>).processor
			: undefined;
	if (named === undefined || named === null || named === 'stripe') return null;

	const processor = PROCESSOR_NAMES.find((name) => name === named);
	if (processor !== undefined && !keepsWebhookEndpoint(processor))
		return {
			error: 'not_applicable',
			message:
				`${PROCESSOR_LABELS[processor]} keeps no webhook endpoint to repair: each payment names ` +
				'its own callback address.'
		};
	return {
		error: 'bad_processor',
		message:
			'Only Stripe’s webhook endpoint is repaired here. Send `{ "processor": "stripe" }` or no body.'
	};
}

/** the read this address does not answer. where the endpoint stands is ./console.payments.ts's. */
export function loader({ request }: Route.LoaderArgs): Response {
	return consoleMethodNotAllowed(request.method, 'POST');
}
