import type {
	PaymentProvider,
	PaymentResult,
	RegisteredWebhookEndpoint,
	WebhookEndpointSummary
} from './provider';

// what a caller asks the payment port about this deployment's own webhook endpoint, and the two
// repairs it can ask for.
//
// **only the read has a caller.** `src/routes/console.payments.ts` reads the registration so that
// `webhookSecretStanding` in ./webhook-secret.ts can compare the fingerprint stamped on the endpoint
// against the signing secret this deployment holds — made here rather than in the console because
// the value that verifies a delivery is the one the running version holds, and the account can be
// ahead of it for as long as a new version takes to roll. the two repairs stand and are called by
// nothing: the console registers each processor's endpoint itself, in one press that also stores what
// verifies it (`packages/console/internal/stripe`, whose header argues why it registers afresh rather
// than repairing one in place, and `packages/console/internal/paypal`). they stand because whether
// this deployment goes on answering for its own endpoint is a question about its surface rather
// than about the screen that used to ask.
//
// a module rather than four calls in a caller: what lives here is the part with a decision in it —
// which endpoint on the account is this deployment's, whether it is doing the job, and which of the
// two repairs a state calls for — and it is here because it is testable as a value: the port is an
// argument, so ./webhook-registration.spec.ts covers every state with no network, no account and no
// platform to stand in for.
//
// it imports no SDK and names no processor. ./provider.ts is the whole of what it knows, which is
// the rule ./sole-importer.spec.ts holds over the tree.
//
// nothing here writes anything down. the registration is read fresh on every view because it lives
// on somebody else's account: a copy in a row would be a claim about a third party's state that
// nothing in this deployment could ever be told had changed.

/**
 * where this deployment's own endpoint stands, as a screen has to draw it.
 *
 *   unreadable   — the port could not answer: no credentials, a rejected key, a processor that did
 *                  not reply. `detail` is the port's own sentence, which names the value to fix. it
 *                  is a state of this block and never of the page — every other capability goes
 *                  on rendering.
 *   unregistered — the account holds nothing at this address. the fresh-fork state, and the one the
 *                  setup button belongs to.
 *   registered   — the account holds one here. `complete` is whether it is actually doing the job;
 *                  what it is short of is on the two fields under it.
 *
 * no endpoint id on any arm. every call that acts on the endpoint finds it by URL on this side, so
 * an id has no reader in a browser — and one that travelled there would be a value a form could post
 * back, which is a button acting on whichever endpoint the request named rather than on this
 * deployment's own.
 */
export type WebhookRegistration =
	| { readonly state: 'unreadable'; readonly detail: string }
	| { readonly state: 'unregistered' }
	| {
			readonly state: 'registered';
			/** the address it is registered at, which is this deployment's own. */
			readonly url: string;
			/**
			 * whether the processor is currently delivering to it.
			 *
			 * an endpoint that exists and is switched off is the shape that reads as a finished setup
			 * while nothing ever arrives. the processor switches one off itself after a run of
			 * failures, so this is a state a working deployment can arrive in without anybody
			 * touching it.
			 */
			readonly delivering: boolean;
			/** what it is subscribed to, in the processor's own spelling. */
			readonly eventTypes: readonly string[];
			/**
			 * what it is not subscribed to and has to be, in the required list's own order.
			 *
			 * the order is the required list's rather than the subscription's, so the same gap always
			 * reads the same way on the screen.
			 */
			readonly missingEventTypes: readonly string[];
			/** delivering, and subscribed to everything. the only state that needs no repair. */
			readonly complete: boolean;
			/**
			 * what this endpoint was stamped with when it was created, or null where it carries no
			 * stamp.
			 *
			 * carried and not compared, because the other half of the comparison is a deploy-time
			 * variable and this module reads none. `webhookSecretStanding` in ./webhook-secret.ts is
			 * where the two meet and where which stamp belongs to which processor is decided;
			 * `WebhookEndpointSummary.verificationStamp` in ./provider.ts says what may go in it.
			 *
			 * `complete` above is not the same claim and cannot stand in for it: an endpoint that is
			 * registered, switched on and fully subscribed is `complete` whether or not this
			 * deployment holds what it verifies with — which is exactly the state
			 * `replaceWebhookRegistration` below leaves behind when nobody sets the new value.
			 */
			readonly verificationStamp: string | null;
	  };

/**
 * what the processor's account currently holds at this deployment's address.
 *
 * never throws and never rejects: every arm of the port answers with a value, and this turns the
 * failing one into a state rather than passing it up. that is what keeps a processor nobody can
 * reach from taking the screen down — the screen it takes down is the screen an operator opened to
 * find out why.
 */
export async function readWebhookRegistration(
	provider: PaymentProvider,
	url: string
): Promise<WebhookRegistration> {
	const registry = await provider.listWebhookEndpoints();
	if (!registry.ok) return { state: 'unreadable', detail: registry.detail };

	const { endpoints, requiredEventTypes } = registry.value;
	// matched on the URL and on nothing else, because that is the only fact this deployment holds
	// about its own endpoint. an account may carry a second deployment's or a staging copy's, and
	// reporting one of those would be a screen saying set up over a deployment nothing is delivered
	// to.
	const registered = endpoints.find((candidate) => candidate.url === url);
	if (!registered) return { state: 'unregistered' };

	const subscribed = new Set(registered.eventTypes);
	const missingEventTypes = requiredEventTypes.filter((type) => !subscribed.has(type));

	return {
		state: 'registered',
		url: registered.url,
		delivering: registered.enabled,
		eventTypes: registered.eventTypes,
		missingEventTypes,
		verificationStamp: registered.verificationStamp,
		// both halves, because either alone is a green screen over a deployment that posts no gift.
		// a subscription with an extra event on it is noise rather than a fault, so nothing here
		// counts one.
		complete: registered.enabled && missingEventTypes.length === 0
	};
}

/**
 * subscribes this deployment's endpoint to every delivery this app acts on and switches it
 * on, leaving its signing secret alone.
 *
 * the repair for a registration that is the right one and is not yet working, which is every
 * `registered` state whose `complete` is false. it is not a replacement, and the difference is the
 * whole reason this exists: a replacement mints a new signing secret and kills the one the operator
 * has already set and redeployed with, and nothing about a missing subscription is worth that.
 *
 * the endpoint is found here rather than named by the caller, so the id never leaves this side.
 */
export async function repairWebhookRegistration(
	provider: PaymentProvider,
	url: string
): Promise<PaymentResult<WebhookEndpointSummary>> {
	const registered = await findRegistered(provider, url);
	if (!registered.ok) return registered;
	return provider.resubscribeWebhookEndpoint(registered.value.id);
}

/**
 * deletes this deployment's endpoint and registers a fresh one at the same address, which is the
 * only way back to a signing secret nobody kept.
 *
 * destructive in two ways the operator has to have been told about before it is called: the new
 * endpoint has a new id, and the old secret stops verifying the moment the old endpoint is gone.
 * neither is recoverable and there is no overlap window — rolling a secret exists only in the
 * processor's dashboard, so this is a delete and a create. ./provider.ts states it at the arm.
 */
export async function replaceWebhookRegistration(
	provider: PaymentProvider,
	url: string
): Promise<PaymentResult<RegisteredWebhookEndpoint>> {
	const registered = await findRegistered(provider, url);
	if (!registered.ok) return registered;
	return provider.replaceWebhookEndpoint(registered.value.id, url);
}

/**
 * the endpoint the account holds at this address, or why there is nothing to act on.
 *
 * both repairs read the account first rather than taking an id from the request they are answering.
 * the id is a value a form could carry back, and a request naming its own endpoint id is a button
 * that acts on whichever endpoint it was told to — including one belonging to another deployment on
 * the same account.
 *
 * a live race rather than a defensive one: the screen read the endpoint a moment ago and somebody in
 * the dashboard may have deleted it since, so the refusal says what to press next rather than
 * merely saying no.
 */
async function findRegistered(
	provider: PaymentProvider,
	url: string
): Promise<PaymentResult<WebhookEndpointSummary>> {
	const registry = await provider.listWebhookEndpoints();
	if (!registry.ok) return registry;

	const registered = registry.value.endpoints.find((candidate) => candidate.url === url);
	if (!registered) {
		return {
			ok: false,
			reason: 'not_found',
			detail:
				'Stripe has no webhook endpoint at this deployment’s address, so there is nothing to ' +
				'change. It was there when this page was drawn, which means it has been deleted in the ' +
				'Stripe dashboard since. Reload this page and set the webhook up again.'
		};
	}

	return { ok: true, value: registered };
}
