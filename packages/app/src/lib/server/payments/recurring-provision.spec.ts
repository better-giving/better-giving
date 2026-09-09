import { describe, expect, it } from 'vitest';
import type { PaymentProvider, PaymentResult, RecurringGiftProvision } from './provider';
import type { RecurringGiftStanding } from './provider';
import { readRecurringProvision, setUpRecurringGifts } from './recurring-provision';

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
function port(script: {
	read?: PaymentResult<RecurringGiftStanding>;
	prepare?: PaymentResult<RecurringGiftProvision>;
}): PaymentProvider {
	const unused = (name: string) => () => {
		throw new Error(`${name} is not part of reading what an account holds for repeating gifts`);
	};
	return {
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
