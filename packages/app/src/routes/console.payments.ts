import type {
	PaymentsReport,
	RailLine,
	WebhookSubscriptionReading
} from '@better-giving/operator/console/payments';
import { PAYMENT_METHOD_LABELS } from '@better-giving/form/v1';
import { webhookEndpointUrl } from '@better-giving/operator/stripe/webhook-endpoint';
import { webhookSecretStanding } from '$lib/server/payments/webhook-secret';
import { consoleJson, consoleMethodNotAllowed } from '$lib/server/console/surface';
import { walletHostLine, walletHosts } from '$lib/server/console/wallet-hosts';
import { OFFERED_PAYMENT_METHODS } from '$lib/forms/offered-rails';
import { createPaymentProvider, stripeUnreadableReason } from '$lib/server/payments/factory';
import { railNotes } from '$lib/server/forms/rail-notes';
import { readRailChargeability } from '$lib/server/payments/rail-chargeability';
import type { WebhookRegistration } from '$lib/server/payments/webhook-registration';
import { readWebhookRegistration } from '$lib/server/payments/webhook-registration';
import { readWalletDomains } from '$lib/server/payments/wallet-domains';
import { database, platform } from '../context';
import type { Route } from './+types/console.payments';

// the four things about this deployment's Stripe account that only this deployment can say.
//
// on the same surface and behind the same check as the report: the check is the `middleware` on
// ./console.ts and this file makes no decision about who may read — see the header there, and
// $lib/server/console/surface.ts for what this surface owes.
//
// **it is here rather than in the console because only this deployment holds the values.** the
// rails and the hostnames the account draws wallet buttons on go through the payment port with this
// deployment's own `STRIPE_SECRET_KEY`, which the console never has after a press ends. the signing
// secret is stronger than that and is the reason
// this route exists at all: no read on Stripe's API hands a secret back
// (https://docs.stripe.com/api/webhook_endpoints/list) and no read on Cloudflare's hands a stored
// one back either, so the comparison that says whether deliveries verify can be made inside this
// worker and nowhere else. `WEBHOOK_SECRET_STANDINGS` in `packages/operator/src/console/payments.ts`
// is the four states it lands on, and `unconfirmable` is the one it lands on where there is nothing
// to compare against.
//
// **no secret and no digest leaves here.** what crosses the wire is which of four states the stored
// secret is in — `webhookSecretStanding` in $lib/server/payments/webhook-secret.ts computes it
// against the fingerprint stamped on the endpoint and hands back a state and, on one arm, a
// sentence.
//
// **the sentences are written where the standing is decided and are not written again here.**
// $lib/server/forms/rail-notes.ts holds one per rail standing and its header states the constraint
// every one of them is written under: an approved rail is a necessary condition and never a
// sufficient one, so no sentence anywhere may say a way of paying will work.
//
// **this is a block and never a capability line**, the same decision ./console.recurring.ts states.
// the payments capability already has a line on the report; a rail an account was never approved
// for is not a deployment half set up, and a line for one would be a permanent unfinished item on
// every fork that only ever takes cards.
//
// **a GET and no write, with a press beside it for each of the last two members.** all four are
// readings of somebody else's account. what repairs a rail is the Stripe dashboard and what repairs
// a stale signing secret is replacing the registration, which the console does with a key an
// operator pastes — but an endpoint that is the right one and is short of an event or switched off
// is repaired in place (./console.webhook-repair.ts), and a hostname the account does not hold or is
// not honouring is registered in place (./console.wallet-domains.ts). each is a separate address
// rather than a POST here because this address answers a read that has nothing to do with it: what
// a press changes is one member, and the other three are not what it moves.
//
// **the fourth member is which hostnames the account will draw wallet buttons on.** Stripe draws
// Apple Pay, Google Pay and Link only on a hostname registered on the account for them, so a site
// that is not registered offers a donor whatever is left and says nothing about the difference. the
// hostnames asked about are this deployment's own address and the sites it has listed, settled here
// and never sent — $lib/server/console/wallet-hosts.ts is where that list is assembled and why.
//
// **the third member is the same registration this route already reads, said differently.** the
// endpoint's subscription and whether it is delivering are on the answer `webhookSecretStanding`
// takes its fingerprint off, so no second call is made — and neither the id nor the fingerprint is
// on any arm that crosses.
//
// nothing is written down. every one of these facts lives on somebody else's account, so a copy in
// a row would be a claim about a third party's state that nothing in this deployment could ever be
// told had changed.

/**
 * where the account stands on all four counts, changing nothing.
 *
 * the three reads of the account overlap rather than queue — none has anything to say to the
 * others, and a caller waiting on this is an operator holding a screen open, so in sequence the
 * worst case is three of the port's timeouts end to end instead of one.
 *
 * a read that could not be made is a state and a 200 rather than a failure of the request, the same
 * shape ./console.recurring.ts's read takes: it says nothing about the account, and the sentence it
 * carries names the value to fix.
 */
export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
	const { env } = context.get(platform);
	const provider = createPaymentProvider(env);

	// the endpoint this deployment looks for on the account is its own address, learned from the
	// request that reached it: no hostname is committed to this repository (CLAUDE.md), and the
	// console registered the endpoint at the same address it is asking on.
	const url = webhookEndpointUrl(new URL(request.url).origin);

	// the hostnames come off this deployment's own rows, so they are read before the account is
	// asked about them. it is one local select in front of three calls over the network.
	const asked = await walletHosts(context.get(database), request.url);

	const [chargeability, registration, domains] = await Promise.all([
		readRailChargeability(provider),
		readWebhookRegistration(provider, url),
		readWalletDomains(provider, asked.hosts)
	]);

	const notes = railNotes(chargeability);
	const report: PaymentsReport = {
		rails:
			chargeability.state === 'unreadable'
				? {
						state: 'unreadable',
						// which of the two ways it failed, off what this deployment holds rather than off
						// the sentence the port wrote — `stripeUnreadableReason` in
						// $lib/server/payments/factory.ts is beside the variable that decides it, and
						// `packages/operator/src/console/stripe-read.ts` states what each member means to
						// the console drawing it.
						reason: stripeUnreadableReason(env),
						detail: chargeability.detail
					}
				: {
						state: 'read',
						chargesEnabled: chargeability.chargesEnabled,
						// the offered list rather than the whole vocabulary, in a donor's own order
						// ($lib/forms/offered-rails.ts): the question this block answers is why a way of
						// paying never appears on a form, and a rail no form offers has nothing to say to
						// it.
						rails: OFFERED_PAYMENT_METHODS.map(
							(rail): RailLine => ({
								rail,
								label: PAYMENT_METHOD_LABELS[rail],
								standing: chargeability.rails[rail],
								note: notes[rail]
							})
						)
					},
		// the whole platform env rather than a copy narrowed for a screen, which is what that
		// function takes: a blank value and a binding sitting in a string's slot mean "unset" there
		// exactly as they do everywhere else the deploy-time values are read.
		webhook: await webhookSecretStanding(env, registration),
		subscription: subscriptionReading(registration),
		wallets:
			domains.state === 'unreadable'
				? { state: 'unreadable', reason: stripeUnreadableReason(env), detail: domains.detail }
				: {
						state: 'read',
						// the deployment's own address first and the listed sites after it, in the order
						// they were asked about — $lib/server/console/wallet-hosts.ts settles both.
						hosts: domains.hosts.map((standing) => walletHostLine(standing, asked.own))
					}
	};

	return consoleJson(report);
}

/**
 * the same registration as the standing above, said as what the endpoint is delivering.
 *
 * off the one read rather than a second one: both facts are on the same answer, and asking twice
 * would be two views of one account that can disagree by the time an operator reads them.
 *
 * **the id and the fingerprint stay here.** the registration carries both and neither is on any arm
 * the console draws — $lib/server/payments/webhook-registration.ts states why the id never leaves
 * this side, and the fingerprint is half of the comparison `webhookSecretStanding` above already
 * made.
 *
 * `complete` is the registration's own reading of both faults at once and is not recomputed: what
 * counts as a usable endpoint is decided where the required list is read, and a second opinion here
 * is one to keep in step.
 */
function subscriptionReading(registration: WebhookRegistration): WebhookSubscriptionReading {
	if (registration.state === 'unreadable') {
		return { state: 'unreadable', detail: registration.detail };
	}
	if (registration.state === 'unregistered') return { state: 'unregistered' };
	if (registration.complete) return { state: 'complete' };
	return {
		state: 'incomplete',
		delivering: registration.delivering,
		missingEventTypes: registration.missingEventTypes
	};
}

/**
 * a press, refused with the method this endpoint takes.
 *
 * answered rather than left to the framework, for $lib/server/console/surface.ts's reason: react
 * router faults a request it has no handler for with a 400 quoting a route id nobody outside this
 * repository has heard of, and a caller here is a person or an agent exploring with the credential
 * in hand.
 */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
	return consoleMethodNotAllowed(request.method, 'GET');
}
