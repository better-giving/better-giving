import { describe, expect, it } from 'vitest';
import type { PaymentProvider, PaymentResult, WebhookEndpointRegistry } from './provider';
import { STRIPE_WEBHOOK_PATH } from '@better-giving/operator/stripe/webhook-endpoint';
import {
	readWebhookRegistration,
	repairWebhookRegistration,
	replaceWebhookRegistration
} from './webhook-registration';

// what the console asks the payment port about this deployment's own endpoint, away from the
// screen that asks it.
//
// a node spec rather than a workers one because nothing here touches the database (CLAUDE.md
// splits the pools by that), and a module of its own rather than cases on the route because the
// route builds its provider from a request's `platform.env` — so a case that wanted a registered
// endpoint to look at could only get one by standing in for the whole platform. the seam is the
// port, which is a value.

/**
 * the subscription a usable endpoint holds, as the adapter reports it.
 *
 * spelled here rather than imported so that this module is exercised against a port that is a value,
 * the way the header says. it mirrors `SUBSCRIBED_EVENT_TYPES` in ./stripe.ts, both halves of it: the
 * deliveries that are one transaction's own states, and the ones that are a repeating gift's. the
 * second half is what a deployment registered before repeating gifts existed is missing, which is the
 * state below that draws the repair button.
 */
const REQUIRED = [
	'payment_intent.succeeded',
	'payment_intent.payment_failed',
	'payment_intent.processing',
	'payment_intent.canceled',
	'payment_intent.requires_action',
	'invoice.paid',
	'invoice.payment_failed',
	'customer.subscription.updated',
	'customer.subscription.deleted'
] as const;

const ORIGIN = 'https://better-giving.example.workers.dev';
const URL_HERE = `${ORIGIN}${STRIPE_WEBHOOK_PATH}`;

/** one endpoint the account holds, defaulting to this deployment's own and in good order. */
function endpoint(overrides: Record<string, unknown> = {}) {
	return {
		id: 'we_1',
		url: URL_HERE,
		enabled: true,
		eventTypes: [...REQUIRED],
		apiVersion: '2026-07-29.dahlia',
		// unstamped by default, which is the state a hand-registered endpoint is in and the one this
		// module can say nothing about. the cases that are about the stamp set it.
		secretFingerprint: null,
		...overrides
	};
}

/**
 * a port that answers the endpoint arms from a script and refuses the rest.
 *
 * the money arms throw rather than returning a refusal, so a change that made this module reach for
 * one fails here with the name of the arm instead of passing quietly on a refusal it never asked
 * for.
 */
function port(list: PaymentResult<WebhookEndpointRegistry>): PaymentProvider {
	const unused = (name: string) => () => {
		throw new Error(`${name} is not part of reading a webhook registration`);
	};
	return {
		prepareRecurringGifts: unused('prepareRecurringGifts'),
		readRecurringGiftProvision: unused('readRecurringGiftProvision'),
		createRecurringGift: unused('createRecurringGift'),
		cancelRecurringGift: unused('cancelRecurringGift'),
		createIntent: unused('createIntent'),
		verifyEvent: unused('verifyEvent'),
		readSettlement: unused('readSettlement'),
		readRecurringGift: unused('readRecurringGift'),
		readAccountChargeability: unused('readAccountChargeability'),
		readRailSwitchboard: unused('readRailSwitchboard'),
		async listWebhookEndpoints() {
			return list;
		},
		registerWebhookEndpoint: unused('registerWebhookEndpoint'),
		resubscribeWebhookEndpoint: unused('resubscribeWebhookEndpoint'),
		replaceWebhookEndpoint: unused('replaceWebhookEndpoint'),
		listWalletDomains: unused('listWalletDomains'),
		registerWalletDomain: unused('registerWalletDomain')
	};
}

/** an account holding exactly these endpoints. */
function holding(
	...endpoints: ReturnType<typeof endpoint>[]
): PaymentResult<WebhookEndpointRegistry> {
	return { ok: true, value: { endpoints, requiredEventTypes: [...REQUIRED] } };
}

describe('readWebhookRegistration', () => {
	/**
	 * an account with nothing at this address is the fresh-fork state, and the one the setup button
	 * belongs to.
	 *
	 * the endpoint on the account below is somebody else's — a second deployment, or the same
	 * organisation's staging copy — and matching it would report this deployment as set up while every
	 * delivery went somewhere else.
	 */
	it('reports no registration when the account holds none at this address', async () => {
		const registration = await readWebhookRegistration(
			port(
				holding(endpoint({ id: 'we_other', url: 'https://staging.example.org/api/stripe/webhook' }))
			),
			URL_HERE
		);

		expect(registration.state).toBe('unregistered');
	});

	/** the finished state: registered at this address, delivering, subscribed to everything. */
	it('reports a complete registration', async () => {
		const registration = await readWebhookRegistration(port(holding(endpoint())), URL_HERE);

		expect(registration).toEqual({
			state: 'registered',
			url: URL_HERE,
			delivering: true,
			complete: true,
			eventTypes: [...REQUIRED],
			missingEventTypes: [],
			secretFingerprint: null
		});
	});

	/**
	 * the endpoint's own stamp is carried out, because it is what says the stored secret is this
	 * endpoint's.
	 *
	 * `complete` says the endpoint is registered, switched on and subscribed — and every one of those
	 * is true of an endpoint whose secret this deployment does not hold. that is the state
	 * `replaceWebhookRegistration` below leaves behind when nobody sets the new value: a green block
	 * over a deployment where every delivery fails verification. the comparison itself is
	 * `webhookSecretStanding` in ./webhook-secret.ts; what this arm owes it is the fact.
	 */
	it('carries the endpoint’s signing-secret fingerprint out', async () => {
		const registration = await readWebhookRegistration(
			port(holding(endpoint({ secretFingerprint: '85fd512dab8038e3' }))),
			URL_HERE
		);

		expect(registration.state === 'registered' && registration.secretFingerprint).toBe(
			'85fd512dab8038e3'
		);
	});

	/**
	 * one subscribed event left off is the failure that reads as a finished setup.
	 *
	 * the gap is reported in the required list's own order rather than in whatever order the
	 * subscription came back in, so the same hole always reads the same way on the screen.
	 */
	it('names what a partial subscription is missing, in the required order', async () => {
		const registration = await readWebhookRegistration(
			port(
				holding(endpoint({ eventTypes: ['payment_intent.processing', 'payment_intent.succeeded'] }))
			),
			URL_HERE
		);

		expect(registration.state === 'registered' && registration.complete).toBe(false);
		expect(registration.state === 'registered' && registration.missingEventTypes).toEqual([
			'payment_intent.payment_failed',
			'payment_intent.canceled',
			'payment_intent.requires_action',
			'invoice.paid',
			'invoice.payment_failed',
			'customer.subscription.updated',
			'customer.subscription.deleted'
		]);
	});

	/**
	 * an endpoint registered before repeating gifts existed reads as incomplete, and names exactly
	 * what it is short of.
	 *
	 * this is what every already-deployed fork sees the day the recurring deliveries join the required
	 * list: the endpoint is there, Stripe is delivering to it, and the gifts that repeat would post
	 * nothing. it is the mechanism working, and nothing on the console draws it: the way back is
	 * registering the endpoint again from the Donation processor fold, which is one press and costs
	 * a new signing secret.
	 */
	it('reports an endpoint subscribed to only the transaction events as incomplete', async () => {
		const registration = await readWebhookRegistration(
			port(holding(endpoint({ eventTypes: REQUIRED.slice(0, 5) }))),
			URL_HERE
		);

		expect(registration.state === 'registered' && registration.delivering).toBe(true);
		expect(registration.state === 'registered' && registration.complete).toBe(false);
		expect(registration.state === 'registered' && registration.missingEventTypes).toEqual([
			'invoice.paid',
			'invoice.payment_failed',
			'customer.subscription.updated',
			'customer.subscription.deleted'
		]);
	});

	/**
	 * an endpoint subscribed to everything and switched off is not complete either.
	 *
	 * it is the shape that would otherwise paint the screen finished with nothing arriving: Stripe
	 * disables an endpoint that has been failing, and one click in the dashboard does the same.
	 */
	it('reports a switched-off endpoint as incomplete with nothing missing', async () => {
		const registration = await readWebhookRegistration(
			port(holding(endpoint({ enabled: false }))),
			URL_HERE
		);

		expect(registration.state === 'registered' && registration.delivering).toBe(false);
		expect(registration.state === 'registered' && registration.complete).toBe(false);
		expect(registration.state === 'registered' && registration.missingEventTypes).toEqual([]);
	});

	/**
	 * a port that could not answer is a state of this block and never of the page.
	 *
	 * the console is the screen an operator lands on to find out why a deployment is not working,
	 * so Stripe being unreachable — or unconfigured, which is a fresh fork's ordinary state — must
	 * leave every other capability on it rendering. the sentence is carried through verbatim: it names
	 * the variable to set and the command that sets it.
	 */
	it('carries a refusal through as a state rather than a failure', async () => {
		const registration = await readWebhookRegistration(
			port({
				ok: false,
				reason: 'not_configured',
				detail: 'This deployment cannot take a payment: `STRIPE_SECRET_KEY` is not set.'
			}),
			URL_HERE
		);

		expect(registration).toEqual({
			state: 'unreadable',
			detail: 'This deployment cannot take a payment: `STRIPE_SECRET_KEY` is not set.'
		});
	});

	/**
	 * the endpoint's own id is not part of what this reports, and that is the shape rather than an
	 * omission.
	 *
	 * every arm that acts on the endpoint finds it by URL on the server, so an id has no reader in a
	 * browser — and an id that travelled there would be a value a form could post back, which is a
	 * button acting on whichever endpoint the request named rather than on this deployment's own.
	 */
	it('publishes no endpoint id', async () => {
		const registration = await readWebhookRegistration(port(holding(endpoint())), URL_HERE);

		expect(JSON.stringify(registration)).not.toContain('we_1');
	});
});

/**
 * a port whose repair arms record what they were handed, over an account holding `list`.
 *
 * separate from `port` above because these cases assert the argument rather than the answer: what
 * matters is that the id acted on is the one found on the account at this deployment's own address,
 * and an arm that merely returned something could not show it.
 */
function repairable(list: PaymentResult<WebhookEndpointRegistry>) {
	const resubscribed: string[] = [];
	const replaced: { id: string; url: string }[] = [];
	const provider: PaymentProvider = {
		...port(list),
		async resubscribeWebhookEndpoint(id: string) {
			resubscribed.push(id);
			return { ok: true as const, value: endpoint({ id }) };
		},
		async replaceWebhookEndpoint(id: string, url: string) {
			replaced.push({ id, url });
			return {
				ok: true as const,
				value: { endpoint: endpoint({ id: 'we_new', url }), signingSecret: 'whsec_notarealsecret' }
			};
		}
	};
	return { provider, resubscribed, replaced };
}

describe('repairWebhookRegistration', () => {
	/**
	 * the endpoint acted on is the one found at this deployment's address, and the id is never a
	 * value that arrived from a browser.
	 *
	 * an account can hold sixteen endpoints and some of them belong to other deployments. a button
	 * that posted its own id back would be a button that acts on whichever endpoint the request
	 * named — so the account is read here and the id comes off the match.
	 */
	it('resubscribes the endpoint registered at this address', async () => {
		const { provider, resubscribed } = repairable(
			holding(
				endpoint({ id: 'we_theirs', url: 'https://staging.example.org/api/stripe/webhook' }),
				endpoint({ id: 'we_ours', eventTypes: ['payment_intent.succeeded'] })
			)
		);

		const result = await repairWebhookRegistration(provider, URL_HERE);

		expect(resubscribed).toEqual(['we_ours']);
		expect(result.ok).toBe(true);
	});

	/**
	 * an endpoint deleted in the dashboard between the page being drawn and the button being pressed
	 * is answered with what to do next.
	 *
	 * the button on this state exists because the page said the endpoint was there, so "no such
	 * endpoint" on its own would read as a bug in this app. what is left to do is register one, and
	 * the sentence says so.
	 */
	it('refuses when nothing is registered at this address any more', async () => {
		const { provider, resubscribed } = repairable(holding());

		const result = await repairWebhookRegistration(provider, URL_HERE);

		expect(resubscribed).toEqual([]);
		expect(result.ok === false && result.reason).toBe('not_found');
		expect(result.ok === false && result.detail).toContain('set the webhook up again');
	});

	/**
	 * a port that could not read the account does not get repaired past.
	 *
	 * the refusal travels through unchanged, so the reason a caller classifies on stays the port's
	 * own — a read that failed because Stripe is rate limiting is worth pressing again, and one that
	 * failed on a rejected key is not.
	 */
	it('passes a failed read through unchanged', async () => {
		const { provider, resubscribed } = repairable({
			ok: false,
			reason: 'rate_limited',
			detail: 'Stripe is rate limiting this account.'
		});

		const result = await repairWebhookRegistration(provider, URL_HERE);

		expect(resubscribed).toEqual([]);
		expect(result).toEqual({
			ok: false,
			reason: 'rate_limited',
			detail: 'Stripe is rate limiting this account.'
		});
	});
});

describe('replaceWebhookRegistration', () => {
	/**
	 * the recovery path for a signing secret nobody kept: the endpoint at this address is deleted and
	 * a fresh one takes its place, at the same address.
	 *
	 * the id it is called with is asserted for the reason the repair's is, and the URL is asserted
	 * beside it because the replacement has to land back at this deployment rather than wherever the
	 * request happened to say.
	 */
	it('replaces the endpoint registered at this address, at the same address', async () => {
		const { provider, replaced } = repairable(holding(endpoint({ id: 'we_ours' })));

		const result = await replaceWebhookRegistration(provider, URL_HERE);

		expect(replaced).toEqual([{ id: 'we_ours', url: URL_HERE }]);
		expect(result.ok && result.value.signingSecret).toBe('whsec_notarealsecret');
	});

	/** the same race the repair answers, and the same answer: there is nothing to replace. */
	it('refuses when nothing is registered at this address', async () => {
		const { provider, replaced } = repairable(holding());

		const result = await replaceWebhookRegistration(provider, URL_HERE);

		expect(replaced).toEqual([]);
		expect(result.ok === false && result.reason).toBe('not_found');
	});
});
