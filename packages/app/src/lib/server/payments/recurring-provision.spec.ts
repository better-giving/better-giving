import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	PaymentProvider,
	PaymentResult,
	ProcessorName,
	RecurringGiftProvision
} from './provider';
import type { RecurringGiftStanding } from './provider';
import { createPaymentProviders } from './factory';
import { processorsOf, soleProcessor } from './processors.testing';
import {
	readRecurringProvision,
	readRecurringProvisions,
	setUpRecurringGifts,
	setUpRecurringGiftsOn,
	type RecurringSetupRun
} from './recurring-provision';

// what the console asks the payment port about repeating gifts, away from the screen that asks
// it.
//
// a node spec rather than a workers one because nothing here touches the database (CLAUDE.md splits
// the pools by that), and a module of its own rather than cases on the route because the route
// builds its provider from a request's `platform.env` — so a case that wanted an account holding a
// product to look at could only get one by standing in for the whole platform. the seam is the port,
// which is a value. the same arrangement ./webhook-registration.spec.ts is written under.

/**
 * a port that answers the two repeating-gift arms from a script and refuses the rest.
 *
 * the arm each case is not about throws rather than answering, which is what pins the difference the
 * screen depends on: a read that reached `prepareRecurringGifts` would provision an operator's
 * account as a side effect of them opening a page, and it fails here by name instead.
 */
function port(
	script: {
		read?: PaymentResult<RecurringGiftStanding>;
		prepare?: PaymentResult<RecurringGiftProvision>;
	},
	processor: ProcessorName = 'stripe'
): PaymentProvider {
	const unused = (name: string) => () => {
		throw new Error(`${name} is not part of reading what an account holds for repeating gifts`);
	};
	return {
		processor,
		async prepareRecurringGifts() {
			if (!script.prepare) throw new Error('prepareRecurringGifts was called by a read');
			return script.prepare;
		},
		async readRecurringGiftProvision() {
			if (!script.read) throw new Error('readRecurringGiftProvision was called by a setup');
			return script.read;
		},
		createRecurringGift: unused('createRecurringGift'),
		cancelRecurringGift: unused('cancelRecurringGift'),
		createIntent: unused('createIntent'),
		verifyEvent: unused('verifyEvent'),
		readSettlement: unused('readSettlement'),
		readRecurringGift: unused('readRecurringGift'),
		readAccountChargeability: unused('readAccountChargeability'),
		readRailSwitchboard: unused('readRailSwitchboard'),
		listWebhookEndpoints: unused('listWebhookEndpoints'),
		registerWebhookEndpoint: unused('registerWebhookEndpoint'),
		resubscribeWebhookEndpoint: unused('resubscribeWebhookEndpoint'),
		replaceWebhookEndpoint: unused('replaceWebhookEndpoint'),
		listWalletDomains: unused('listWalletDomains'),
		registerWalletDomain: unused('registerWalletDomain')
	};
}

const REFUSAL = {
	ok: false,
	reason: 'not_configured',
	detail: 'This deployment cannot take a payment: `STRIPE_SECRET_KEY` is not set.'
} as const;

describe('readRecurringProvision', () => {
	/**
	 * every standing the port can answer with reaches the screen as itself.
	 *
	 * asserted over the whole set rather than one member, because the point of the three is that none
	 * of them is folded into another: `archived` read as `absent` draws a setup button that cannot
	 * succeed, and read as `ready` reports a deployment that can take a repeating gift and cannot.
	 */
	it.each(['ready', 'absent', 'archived'] as const)(
		'reports a standing of %s as itself',
		async (standing) => {
			expect(await readRecurringProvision(port({ read: { ok: true, value: standing } }))).toEqual({
				state: standing
			});
		}
	);

	/**
	 * a read that could not be made is a state of this block and never of the page.
	 *
	 * the console is the screen an operator opens to find out why a new deployment is not working,
	 * so a processor nobody can reach must take nothing else on it down. the sentence is the port's
	 * own, which names the value to set and the command that sets it — a paraphrase would throw away
	 * the only actionable part (CLAUDE.md).
	 */
	it('reports a read it could not make as a state carrying the port’s own sentence', async () => {
		expect(await readRecurringProvision(port({ read: REFUSAL }))).toEqual({
			state: 'unreadable',
			detail: REFUSAL.detail
		});
	});
});

describe('readRecurringProvisions', () => {
	/**
	 * one reading per configured processor, each under the name of the account it was read from.
	 *
	 * the pairing is the whole claim. the console draws each standing in that processor's own fold
	 * and `offeredCadences` in ../forms/offered-cadences.ts intersects them, so a reading filed under
	 * the wrong name is a Stripe account's answer sent to a screen about PayPal — and both readings
	 * being the same value is what would let a map keyed by position pass.
	 */
	it('files each configured processor’s standing under its own name', async () => {
		const both = processorsOf(
			port({ read: { ok: true, value: 'ready' } }),
			port({ read: { ok: true, value: 'archived' } }, 'paypal')
		);

		expect(await readRecurringProvisions(both)).toEqual({
			stripe: { state: 'ready' },
			paypal: { state: 'archived' }
		});
	});

	/**
	 * a deployment holding one processor is asked about one, and reports nothing about the other.
	 *
	 * `RecurringProvisions` is partial over `ProcessorName` for exactly this: an entry for a
	 * processor nobody configured would be a reading of an account this deployment never named.
	 */
	it('reports nothing for a processor this deployment did not configure', async () => {
		const paypal = soleProcessor(port({ read: { ok: true, value: 'ready' } }, 'paypal'));

		expect(await readRecurringProvisions(paypal)).toEqual({ paypal: { state: 'ready' } });
	});

	/** a processor nobody could reach is one reading among the others, never the whole answer. */
	it('carries one processor’s unreadable standing without losing the other’s', async () => {
		const both = processorsOf(
			port({ read: REFUSAL }),
			port({ read: { ok: true, value: 'ready' } }, 'paypal')
		);

		expect(await readRecurringProvisions(both)).toEqual({
			stripe: { state: 'unreadable', detail: REFUSAL.detail },
			paypal: { state: 'ready' }
		});
	});

	/** a fresh fork, holding nobody's credentials. */
	it('reports nothing at all where no processor is configured', async () => {
		expect(await readRecurringProvisions(processorsOf())).toEqual({});
	});
});

describe('setUpRecurringGifts', () => {
	/**
	 * the two successes are told apart, which is the only thing `created` is for.
	 *
	 * both are the same finished state and that is what makes the button safe to press twice — but an
	 * operator who pressed it and is told nothing happened learns something an operator who set it up
	 * does not need to be told.
	 */
	it('separates the account that had nothing from the account that already had it', async () => {
		expect(
			await setUpRecurringGifts(port({ prepare: { ok: true, value: { created: true } } }))
		).toEqual({ outcome: 'set_up', detail: null });
		expect(
			await setUpRecurringGifts(port({ prepare: { ok: true, value: { created: false } } }))
		).toEqual({ outcome: 'already_set_up', detail: null });
	});

	/**
	 * a press that changed nothing says why, in the port's own words.
	 *
	 * the state an operator meets first is a fork with no Stripe key set, so pressing this there is
	 * ordinary rather than exceptional — and the sentence that comes back names the variable and the
	 * command.
	 */
	it('carries a refusal through as the failure it is', async () => {
		expect(await setUpRecurringGifts(port({ prepare: REFUSAL }))).toEqual({
			outcome: 'failed',
			detail: REFUSAL.detail
		});
	});
});

describe('setUpRecurringGiftsOn', () => {
	/**
	 * the run, narrowed to the arm every case about an account is about.
	 *
	 * a press that acted on nothing carries no account at all, so the narrowing is what the type
	 * makes a case do rather than a convenience: a case reading `setups` off a run that acted on
	 * nothing is a case reading an account nobody named.
	 */
	function acted(run: RecurringSetupRun): Extract<RecurringSetupRun, { acted: true }> {
		if (!run.acted) throw new Error('the press acted on no account');
		return run;
	}

	/**
	 * one press, one report per configured processor, each under the name of the account it acted on.
	 *
	 * the pairing is the claim: a donor is offered a repeating gift only where every configured
	 * processor can collect one, so an operator pressing once has to be told which account moved —
	 * and a report filed under the wrong name is a PayPal account reported as a Stripe one.
	 */
	it('files each configured processor’s report under its own name', async () => {
		const both = processorsOf(
			port({ prepare: { ok: true, value: { created: true } } }),
			port({ prepare: { ok: true, value: { created: false } } }, 'paypal')
		);

		const run = acted(await setUpRecurringGiftsOn(both, null));

		expect(run.setups).toEqual({
			stripe: { outcome: 'set_up', detail: null, reason: null },
			paypal: { outcome: 'already_set_up', detail: null, reason: null }
		});
	});

	/** one account that moved is what an operator is owed hearing about, over one that had nothing to do. */
	it('answers with set_up where one account was provisioned and the other already held it', async () => {
		const both = processorsOf(
			port({ prepare: { ok: true, value: { created: false } } }),
			port({ prepare: { ok: true, value: { created: true } } }, 'paypal')
		);

		expect(acted(await setUpRecurringGiftsOn(both, null)).outcome).toBe('set_up');
	});

	/**
	 * one processor's refusal is the whole press's answer, and never averaged away by the other's
	 * success: a deployment offers a repeating gift only where every configured processor can collect
	 * one, so a press that left one account short left the deployment where it was.
	 */
	it('answers with the worst of them where one processor refused', async () => {
		const both = processorsOf(
			port({ prepare: { ok: true, value: { created: true } } }),
			port({ prepare: REFUSAL }, 'paypal')
		);

		const run = acted(await setUpRecurringGiftsOn(both, null));

		expect(run.outcome).toBe('failed');
		expect(run.setups).toEqual({
			stripe: { outcome: 'set_up', detail: null, reason: null },
			paypal: { outcome: 'failed', detail: REFUSAL.detail, reason: 'failed' }
		});
	});

	/** a deployment holding one processor presses on one, and reports nothing about the other. */
	it('reports nothing for a processor this deployment did not configure', async () => {
		const paypal = soleProcessor(
			port({ prepare: { ok: true, value: { created: true } } }, 'paypal')
		);

		expect(acted(await setUpRecurringGiftsOn(paypal, null)).setups).toEqual({
			paypal: { outcome: 'set_up', detail: null, reason: null }
		});
	});

	/**
	 * a press that named a processor acts on that one and asks no other.
	 *
	 * the port for the account it was not about throws rather than refusing, so the case fails on the
	 * call being made at all: a press over both accounts is exactly what the caller that names one
	 * cannot have, because it has just stored a key for the account it named.
	 */
	it('asks the processor it was named and no other', async () => {
		const both = processorsOf(
			port({ prepare: { ok: true, value: { created: true } } }),
			port({}, 'paypal')
		);

		const run = acted(await setUpRecurringGiftsOn(both, 'stripe'));

		expect(run.setups).toEqual({ stripe: { outcome: 'set_up', detail: null, reason: null } });
	});

	/**
	 * the deployment this whole address exists for: one processor's keys are already here and another's
	 * were stored seconds ago, too recently for the values this press reads to hold them.
	 *
	 * asked about the configured accounts alone, the press would never reach the account it was made
	 * for and would report the whole run as finished — which is a run that sets up nothing and says it
	 * did. named, the account is asked, and the refusal is the one that says to press again.
	 */
	it('asks a named processor this deployment counts as unconfigured, rather than the one it holds', async () => {
		const paypal = soleProcessor(
			port({ prepare: { ok: true, value: { created: true } } }, 'paypal')
		);

		const run = acted(await setUpRecurringGiftsOn(paypal, 'stripe'));

		expect(run.outcome).toBe('failed');
		expect(Object.keys(run.setups)).toEqual(['stripe']);
		expect(run.setups.stripe?.reason).toBe('no_key');
	});

	/**
	 * and one account's failure does not end a run about another: what the worst-of word is taken
	 * across is the accounts the press was about, which is the named one alone.
	 */
	it('lets a named press answer for its own account while another’s would refuse', async () => {
		const both = processorsOf(
			port({ prepare: { ok: true, value: { created: true } } }),
			port({ prepare: REFUSAL }, 'paypal')
		);

		const run = acted(await setUpRecurringGiftsOn(both, 'stripe'));

		expect(run.outcome).toBe('set_up');
		expect(Object.keys(run.setups)).toEqual(['stripe']);
	});

	/**
	 * a fresh fork, where no account was named and there is none to act on.
	 *
	 * every processor asked anyway would be a report about accounts nobody named — and it is a report
	 * this deployment cannot draw a line from, because each of its lines is an account.
	 */
	it('acts on nothing where nothing is configured and nothing is named', async () => {
		expect(await setUpRecurringGiftsOn(processorsOf(), null)).toEqual({ acted: false });
	});
});

/**
 * the same module asked about a deployment whose credentials name a processor this release cannot
 * charge on.
 *
 * the factory is in the path on purpose: what this covers is that the sentence the console draws
 * comes from the deployment's own configuration and names the processor it is about, rather than
 * sending an operator whose PayPal boxes are full to look at a Stripe variable.
 */
describe('readRecurringProvision on a PayPal deployment', () => {
	const PAYPAL_ONLY = {
		PAYPAL_CLIENT_ID: 'notarealclientid',
		PAYPAL_CLIENT_SECRET: 'notarealclientsecret'
	};

	/**
	 * PayPal, answering the way it answers credentials it does not accept.
	 *
	 * stubbed rather than left to reach the network: this adapter asks the account what it holds,
	 * and there is no sandbox in this project for a spec to dial (`API_BASE` in ./paypal.ts). the
	 * credentials above are not real, so the request that would leave this machine is one that reaches
	 * paypal.com and is refused — slowly, and differently on a laptop with no network.
	 */
	beforeEach(() => {
		vi.stubGlobal('fetch', async () => Response.json({ error: 'invalid_client' }, { status: 401 }));
	});

	it('reports the standing as unreadable, in PayPal’s own name', async () => {
		const provision = await readRecurringProvision(
			createPaymentProviders(PAYPAL_ONLY).for('paypal')
		);

		expect(provision.state).toBe('unreadable');
		expect(provision.state === 'unreadable' && provision.detail).toContain('PayPal');
	});

	/** the setup press answers the same way, so the console reports rather than throwing. */
	it('reports the setup press as failed, with the same sentence', async () => {
		const setup = await setUpRecurringGifts(createPaymentProviders(PAYPAL_ONLY).for('paypal'));

		expect(setup.outcome).toBe('failed');
		expect(setup.detail).toContain('PayPal');
	});
});
