import type {
	PaymentProcessor,
	PaymentsReport,
	ProcessorPayments,
	RailLine,
	WalletsReading,
	WebhookSubscriptionReading
} from '@better-giving/operator/console/payments';
import { PAYMENT_METHOD_LABELS } from '@better-giving/form/v1';
import { webhookSecretStanding } from '$lib/server/payments/webhook-secret';
import { consoleJson, consoleMethodNotAllowed } from '$lib/server/console/surface';
import type { Agreed, SameNames } from '$lib/server/console/report';
import { walletHostLine, walletHosts, type WalletHosts } from '$lib/server/console/wallet-hosts';
import { OFFERED_PAYMENT_METHODS } from '$lib/forms/offered-rails';
import { createPaymentProviders, type Processors } from '$lib/server/payments/factory';
import {
	PROCESSOR_LABELS,
	PROCESSOR_NAMES,
	type ProcessorName
} from '$lib/server/payments/provider';
import { railNotes } from '$lib/server/forms/rail-notes';
import { railEvidence } from '$lib/server/payments/rail-evidence';
import { readRailChargeability } from '$lib/server/payments/rail-chargeability';
import { webhookAddress } from '$lib/server/payments/webhook-address';
import type { WebhookRegistration } from '$lib/server/payments/webhook-registration';
import { readWebhookRegistration } from '$lib/server/payments/webhook-registration';
import { readWalletDomains, type WalletDomainsReading } from '$lib/server/payments/wallet-domains';
import { database, platform } from '../context';
import type { Route } from './+types/console.payments';

// what this deployment can say about each processor account it charges on, and only this deployment
// can say it.
//
// on the same surface and behind the same check as the report: the check is the `middleware` on
// ./console.ts and this file makes no decision about who may read — see the header there, and
// $lib/server/console/surface.ts for what this surface owes.
//
// **one reading per processor, and a deployment holding one processor's keys says nothing about the
// other.** a processor this deployment is not configured for is reported as exactly that and
// carries no reading at all — no rails, no webhook, no wallets — because a read that was never
// attempted has no state to report and a blank one is what a console colours in as a failure.
// `PROCESSORS` in $lib/server/payments/factory.ts is what decides which of the two it is, so that
// "this deployment can call this processor" here and the refusal the port answers with can never
// mean different deployments.
//
// **it is here rather than in the console because only this deployment holds the values.** the
// rails, the endpoint's subscription and the hostnames an account draws wallet buttons on go through
// the payment port with this deployment's own credentials, which the console never has after a press
// ends. what verifies a delivery is stronger than that and is the reason this route exists at all:
// no read on a processor's API hands a signing secret back
// (https://docs.stripe.com/api/webhook_endpoints/list) and no read on Cloudflare's hands a stored
// one back either, so the comparison that says whether deliveries verify can be made inside this
// worker and nowhere else. `WEBHOOK_SECRET_STANDINGS` in `packages/operator/src/console/payments.ts`
// is the four states it lands on, and `unconfirmable` is the one it lands on where there is nothing
// to compare against.
//
// **no secret and no digest leaves here.** what crosses the wire is which of four states the stored
// value is in — `webhookSecretStanding` in $lib/server/payments/webhook-secret.ts computes it
// against the stamp on the endpoint and hands back a state and, on one arm, a sentence. the only
// names that cross are variable names, on the arm for a processor this deployment holds no
// credentials for.
//
// **the sentences are written where the standing is decided and are not written again here.**
// $lib/server/forms/rail-notes.ts holds one per rail standing, keyed to the processor that answered,
// and its header states the constraint every one of them is written under: an approved rail is a
// necessary condition and never a sufficient one, so no sentence anywhere may say a way of paying
// will work.
//
// **this is a block and never a capability line**, the same decision ./console.recurring.ts states.
// the payments capability already has a line on the report; a rail an account was never approved
// for is not a deployment half set up, and a line for one would be a permanent unfinished item on
// every fork that only ever takes cards.
//
// **a GET and no write, with a press beside it for two of the members on one processor's reading.**
// every member is a reading of somebody else's account. what repairs a rail is that processor's own
// dashboard and what repairs a stale signing secret is replacing the registration, which the console
// does with a key an operator pastes — but an endpoint that is the right one and is short of an
// event or switched off is repaired in place (./console.webhook-repair.ts), and a hostname the
// account does not hold or is not honouring is registered in place (./console.wallet-domains.ts).
// each is a separate address rather than a POST here because this address answers a read that has
// nothing to do with it: what a press changes is one member of one processor's reading, and the rest
// are not what it moves.
//
// **the wallets are one processor's alone and the other's reading carries `null` rather than an
// empty one.** a processor whose funding sources are drawn in its own window on its own domain
// registers no hostname anywhere, so there is nothing to read, nothing to press and no section to
// draw — $lib/server/payments/wallet-domains.ts is where that is told from a read that failed, and
// it is told off what the port refused with rather than off a processor named here.
//
// **the endpoint's subscription is the same registration this route already reads, said
// differently.** the endpoint's subscription and whether it is delivering are on the answer
// `webhookSecretStanding` takes its stamp off, so no second call is made — and neither the id nor
// the stamp is on any arm that crosses.
//
// nothing is written down. every one of these facts lives on somebody else's account, so a copy in a
// row would be a claim about a third party's state that nothing in this deployment could ever be
// told had changed.

/**
 * one processor vocabulary at both ends of the wire, held the way $lib/server/console/report.ts
 * holds the organisation's.
 *
 * `packages/operator` reaches nothing of this app's (CLAUDE.md), so the console's copy is declared
 * there and this is where the two meet. each has to extend the other, because either direction alone
 * lets one list grow a member the other has never heard of: a processor this deployment reports on
 * and no console can name, or a fold drawn for a processor nothing here answers for.
 *
 * a type and not a value, so it costs the worker nothing.
 */
export type ProcessorWireNames = Agreed<SameNames<ProcessorName, PaymentProcessor>>;

/**
 * where every processor stands, changing nothing.
 *
 * the processors are read together and so are the three reads inside each: none has anything to say
 * to the others, and a caller waiting on this is an operator holding a screen open, so in sequence
 * the worst case is every one of the port's timeouts end to end instead of one.
 *
 * a read that could not be made is a state and a 200 rather than a failure of the request, the same
 * shape ./console.recurring.ts's read takes: it says nothing about the account, and the sentence it
 * carries names the value to fix.
 */
export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
	const { env } = context.get(platform);
	const processors = createPaymentProviders(env);

	// the address this deployment answers a processor on is learned from the request that reached it:
	// no hostname is committed to this repository (CLAUDE.md).
	const origin = new URL(request.url).origin;

	// the hostnames come off this deployment's own rows, so they are read before any account is asked
	// about them. it is one local select in front of every call over the network.
	const asked = await walletHosts(context.get(database), request.url);

	const report: PaymentsReport = {
		processors: await Promise.all(
			PROCESSOR_NAMES.map((name) => processorPayments(env, processors, name, origin, asked))
		)
	};

	return consoleJson(report);
}

/**
 * one processor's whole reading, or the fact that this deployment cannot ask it anything.
 *
 * the unconfigured arm is answered before a single call is made and is the reason no reading here
 * carries a "nothing was asked" state of its own: a processor this deployment holds no credentials
 * for is settled once, above the readings, where a console reads it before it draws a row.
 */
async function processorPayments(
	env: unknown,
	processors: Processors,
	processor: ProcessorName,
	origin: string,
	asked: WalletHosts
): Promise<ProcessorPayments> {
	const label = PROCESSOR_LABELS[processor];
	if (!processors.configured.includes(processor)) {
		return { processor, label, state: 'unconfigured', unset: processors.unset(processor) };
	}

	const provider = processors.for(processor);
	const url = webhookAddress(processor, origin);

	const [chargeability, registration, domains] = await Promise.all([
		readRailChargeability(provider),
		readWebhookRegistration(provider, url),
		readWalletDomains(provider, asked.hosts)
	]);

	const notes = railNotes(processor, chargeability);

	return {
		processor,
		label,
		state: 'configured',
		rails:
			chargeability.state === 'unreadable'
				? { state: 'unreadable', detail: chargeability.detail }
				: {
						state: 'read',
						chargesEnabled: chargeability.chargesEnabled,
						// what the standings below are worth, which is not the same question as what they
						// say ($lib/server/payments/rail-evidence.ts): one processor publishes an approval
						// per rail and another publishes none, and `approved` off the second means only
						// that the credentials authenticated.
						evidence: railEvidence(processor),
						// the offered list rather than the whole vocabulary, in a donor's own order
						// ($lib/forms/offered-rails.ts): the question this block answers is why a way of
						// paying never appears on a form, and a rail no form offers has nothing to say to
						// it.
						//
						// narrowed again to the rails this read answered for, which is this processor's
						// own ($lib/server/payments/rail-chargeability.ts): a rail another processor
						// settles has no standing on this account, and a line drawn for it would be this
						// reading reporting on keys it never read.
						rails: OFFERED_PAYMENT_METHODS.flatMap((rail): RailLine[] => {
							const standing = chargeability.rails[rail];
							if (standing === undefined) return [];
							return [{ rail, label: PAYMENT_METHOD_LABELS[rail], standing, note: notes[rail] }];
						})
					},
		// the whole platform env rather than a copy narrowed for a screen, which is what that
		// function takes: a blank value and a binding sitting in a string's slot mean "unset" there
		// exactly as they do everywhere else the deploy-time values are read. the processor is named
		// so the variable compared is the one that verifies the deliveries this registration is a
		// reading of.
		webhook: await webhookSecretStanding(env, processor, registration),
		subscription: subscriptionReading(registration, url),
		wallets: walletsReading(domains, asked.own)
	};
}

/**
 * which hostnames one account will draw wallet buttons on, or `null` where it draws none anywhere.
 *
 * `null` and an empty reading are different answers: a processor that draws its funding sources in
 * its own window on its own domain registers no hostname and never will, so a console draws no
 * wallet section for it at all — where an empty host list would be a section inviting an operator to
 * register sites that would do nothing. $lib/server/payments/wallet-domains.ts is where the two are
 * told apart, off what the port refused with rather than off a processor named here.
 */
function walletsReading(domains: WalletDomainsReading, own: string): WalletsReading | null {
	if (domains.state === 'undrawn') return null;
	if (domains.state === 'unreadable') return { state: 'unreadable', detail: domains.detail };
	return {
		state: 'read',
		// the deployment's own address first and the listed sites after it, in the order they were
		// asked about — $lib/server/console/wallet-hosts.ts settles both.
		hosts: domains.hosts.map((standing) => walletHostLine(standing, own))
	};
}

/**
 * the same registration as the standing above, said as what the endpoint is delivering.
 *
 * off the one read rather than a second one: both facts are on the same answer, and asking twice
 * would be two views of one account that can disagree by the time an operator reads them.
 *
 * **the id and the stamp stay here.** the registration carries both and neither is on any arm the
 * console draws — $lib/server/payments/webhook-registration.ts states why the id never leaves this
 * side, and the stamp is half of the comparison `webhookSecretStanding` above already made.
 *
 * **`unmanaged` is the one arm that carries an address, and it is the only place this deployment
 * ever says it.** an endpoint this release does not register is one an operator registers by hand,
 * and they can only do that if they are told where deliveries have to arrive — which no console can
 * work out, because no hostname is committed to this repository (CLAUDE.md) and the path is this
 * app's. left off, an operator sets `PAYPAL_WEBHOOK_ID` to the id of a listener pointed at nothing.
 *
 * `complete` is the registration's own reading of both faults at once and is not recomputed: what
 * counts as a usable endpoint is decided where the required list is read, and a second opinion here
 * is one to keep in step.
 */
function subscriptionReading(
	registration: WebhookRegistration,
	url: string
): WebhookSubscriptionReading {
	if (registration.state === 'unreadable') {
		return { state: 'unreadable', detail: registration.detail };
	}
	if (registration.state === 'unmanaged') {
		return { state: 'unmanaged', detail: registration.detail, address: url };
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
