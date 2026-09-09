import { describe, expect, it } from 'vitest';
import { PAYMENT_METHODS, type PaymentMethod } from '@better-giving/form/v1';
import type {
	AccountChargeability,
	RailCapabilityState,
	PaymentProvider,
	PaymentResult,
	RailSwitchboard
} from './provider';
import { readRailChargeability } from './rail-chargeability';

// which rails this deployment is approved to charge, away from anything that would have to be
// asked over a network.
//
// a node spec rather than a workers one because nothing here touches the database (CLAUDE.md splits
// the pools by that). the seam is the port, which is a value: every state below — a rail nobody
// asked for, a rail under review, an account switched off — is a `PaymentProvider` written in three
// lines, where reaching them against a real account would mean owning one Stripe account per case.

/** an account approved for both rails and able to charge, which is the working deployment. */
function chargeable(overrides: Partial<AccountChargeability> = {}): AccountChargeability {
	return { chargesEnabled: true, cardPayments: 'active', achPayments: 'active', ...overrides };
}

/**
 * the switchboard an account of this shape would really be read beside: every switch on.
 *
 * `offered` is the processor's own conjunction — the switch is on *and* the capability is active —
 * so it is derived from the account here rather than set to `true` across the board. a fixture
 * carrying `offered: true` next to a capability the processor has not approved is a pair of answers
 * no account ever gives, and every case built on one would be asserting about a state that cannot
 * happen. a case that wants the two apart overrides the rail it is about.
 */
function switchesFor(chargeability: AccountChargeability): RailSwitchboard {
	const from = (state: RailCapabilityState) => ({ offered: state === 'active', switchedOn: true });
	return {
		card: from(chargeability.cardPayments),
		ach: from(chargeability.achPayments),
		// the wallets are the card capability as far as the processor is concerned, and their own
		// switches beside it. what this deployment can do with either is not the fixture's business.
		apple_pay: from(chargeability.cardPayments),
		google_pay: from(chargeability.cardPayments)
	};
}

/**
 * a port that answers the two reads from a script and refuses the rest.
 *
 * the other arms throw rather than returning a refusal, so a change that made this module reach for
 * one fails here with the name of the arm instead of passing quietly on a refusal it never asked
 * for. the same shape ./webhook-registration.spec.ts holds its own port to.
 *
 * `calls` records which of the two reads was issued, which is how the cases below assert that both
 * go out together rather than one waiting on the other's answer.
 */
function port(
	answer: PaymentResult<AccountChargeability>,
	switches: PaymentResult<RailSwitchboard> = { ok: true, value: switchesFor(chargeable()) }
): PaymentProvider & { readonly calls: string[] } {
	const unused = (name: string) => () => {
		throw new Error(`${name} is not part of reading rail chargeability`);
	};
	const calls: string[] = [];
	return {
		calls,
		prepareRecurringGifts: unused('prepareRecurringGifts'),
		readRecurringGiftProvision: unused('readRecurringGiftProvision'),
		createRecurringGift: unused('createRecurringGift'),
		cancelRecurringGift: unused('cancelRecurringGift'),
		createIntent: unused('createIntent'),
		verifyEvent: unused('verifyEvent'),
		readSettlement: unused('readSettlement'),
		readRecurringGift: unused('readRecurringGift'),
		async readAccountChargeability() {
			calls.push('readAccountChargeability');
			return answer;
		},
		async readRailSwitchboard() {
			calls.push('readRailSwitchboard');
			return switches;
		},
		listWebhookEndpoints: unused('listWebhookEndpoints'),
		registerWebhookEndpoint: unused('registerWebhookEndpoint'),
		resubscribeWebhookEndpoint: unused('resubscribeWebhookEndpoint'),
		replaceWebhookEndpoint: unused('replaceWebhookEndpoint'),
		listWalletDomains: unused('listWalletDomains'),
		registerWalletDomain: unused('registerWalletDomain')
	};
}

/** the account described by `chargeability`, and the switches it is read alongside. */
function account(
	chargeability: AccountChargeability,
	switches: RailSwitchboard = switchesFor(chargeability)
): PaymentProvider {
	return port({ ok: true, value: chargeability }, { ok: true, value: switches });
}

/**
 * one rail switched off where the processor keeps that setting, on an account approved for it.
 *
 * both fields go to false together, which is what the processor answers: a rail whose switch is off
 * is not offered whatever its capability says.
 */
function switchedOff(rail: PaymentMethod, chargeability = chargeable()): RailSwitchboard {
	return { ...switchesFor(chargeability), [rail]: { offered: false, switchedOn: false } };
}

describe('readRailChargeability', () => {
	/** the working deployment: the account can charge and every rail is approved. */
	it('approves the rails the account is approved for', async () => {
		const report = await readRailChargeability(account(chargeable()));

		expect(report).toEqual({
			state: 'read',
			chargesEnabled: true,
			rails: {
				card: 'approved',
				ach: 'approved',
				apple_pay: 'approved',
				google_pay: 'approved'
			}
		});
	});

	/**
	 * every rail the form vocabulary holds gets an answer, and no rail outside it does.
	 *
	 * `PAYMENT_METHODS` in packages/form/src/v1.ts is a permanent contract that may gain a member
	 * (CLAUDE.md), and a rail added there with no standing here is a screen rendering nothing where
	 * an answer belongs. the type is total over the union, so this is the runtime half of the same
	 * claim: the keys are read off the same list rather than written down a second time.
	 */
	it('answers for every rail the form vocabulary holds', async () => {
		const report = await readRailChargeability(account(chargeable()));

		expect(report.state === 'read' && Object.keys(report.rails).sort()).toEqual(
			[...PAYMENT_METHODS].sort()
		);
	});

	/**
	 * a rail the processor is still working through is its own answer, and waiting is the fix.
	 *
	 * read as not approved it sends an operator to appeal a refusal that has not happened, and read
	 * as approved it promises a rail that refuses every donation. neither neighbour is a vaguer
	 * version of this — both are a different instruction.
	 */
	it('reports a rail still under review as under review', async () => {
		const report = await readRailChargeability(account(chargeable({ achPayments: 'pending' })));

		expect(report.state === 'read' && report.rails.ach).toBe('in_review');
	});

	/**
	 * a rail nobody ever asked for is not a rail that was refused.
	 *
	 * the distinction this module exists to keep: one is a request to make and the other is a
	 * requirement to satisfy or a refusal to take up, and both arrive from the processor as an
	 * absence of good news. told apart wrongly, an operator goes looking for a rejection that was
	 * never issued.
	 */
	it('tells a rail nobody asked for apart from one that is not approved', async () => {
		const report = await readRailChargeability(
			account(chargeable({ cardPayments: 'inactive', achPayments: 'unrequested' }))
		);

		expect(report.state === 'read' && report.rails.card).toBe('not_approved');
		expect(report.state === 'read' && report.rails.ach).toBe('never_requested');
	});

	/**
	 * the two capability rails are not crossed.
	 *
	 * a wiring assertion rather than a behavioural one, and it is worth a case because the failure is
	 * silent in both directions: an account approved for cards and not for bank debits would report
	 * exactly backwards, and every other case here — where the two states agree — would go on
	 * passing.
	 */
	it('reads each rail off its own capability', async () => {
		const report = await readRailChargeability(
			account(chargeable({ cardPayments: 'active', achPayments: 'inactive' }))
		);

		expect(report.state === 'read' && report.rails.card).toBe('approved');
		expect(report.state === 'read' && report.rails.ach).toBe('not_approved');
	});

	/**
	 * a rail the operator switched off is not a rail the processor refused.
	 *
	 * both arrive as a rail this deployment may not charge, and the two fixes are a click and a
	 * fortnight. read as `not_approved`, an operator goes hunting through requirements and appeals for
	 * a rail whose own switch they turned off, and every screen built on this says the account is the
	 * problem when the account is fine.
	 */
	it('reports a rail the operator switched off as switched off rather than not approved', async () => {
		const report = await readRailChargeability(account(chargeable(), switchedOff('ach')));

		expect(report.state === 'read' && report.rails.ach).toBe('switched_off');
		expect(report.state === 'read' && report.rails.card).toBe('approved');
	});

	/**
	 * a switch that is on does not approve anything, and the capability is what says so.
	 *
	 * the pair the processor really produces while an operator waits on a review: the switch was
	 * turned on, the capability is not usable yet, and the rail is therefore not offered. reported as
	 * `switched_off` it would send somebody to flip a switch that is already flipped, and the state
	 * they are actually in — waiting, or a requirement outstanding — would never be named.
	 */
	it('reports a rail its capability blocks as blocked by the capability, switch on or not', async () => {
		const pendingCard = chargeable({ cardPayments: 'pending' });
		const report = await readRailChargeability(account(pendingCard, switchesFor(pendingCard)));

		expect(report.state === 'read' && report.rails.card).toBe('in_review');
	});

	/**
	 * a rail nobody ever asked for stays that, whatever its switch is doing.
	 *
	 * this is the fresh account: no capability requested and no switch on either, which is two
	 * absences arriving together. `switched_off` is the wrong one of them to report — it says the
	 * account is approved and the operator declined, on an account that has never asked.
	 */
	it('keeps a rail nobody asked for as never requested when its switch is off too', async () => {
		const untouched = chargeable({ achPayments: 'unrequested' });
		const report = await readRailChargeability(account(untouched, switchedOff('ach', untouched)));

		expect(report.state === 'read' && report.rails.ach).toBe('never_requested');
	});

	/**
	 * where the two explanations contradict the answer, the rail is not reported as chargeable.
	 *
	 * `offered` is the processor's own conjunction and it is what the list is taken from, so an
	 * account claiming an active capability and a switch that is on while the rail is not offered is
	 * an answer this app cannot reconcile. the direction that is safe to be wrong in is the one that
	 * never says a rail can be charged: a rail wrongly reported approved is a donor at a payment
	 * screen that fails.
	 */
	it('does not approve a rail the processor says it will not offer', async () => {
		const report = await readRailChargeability(
			account(chargeable(), {
				...switchesFor(chargeable()),
				card: { offered: false, switchedOn: true }
			})
		);

		expect(report.state === 'read' && report.rails.card).toBe('not_approved');
	});

	/**
	 * an account that cannot charge cannot charge on any rail, however its capabilities read.
	 *
	 * this is the state that would otherwise report two approved rails on a deployment that cannot
	 * take a cent: a restriction or a pause applies to the account rather than to a rail, so both
	 * capabilities stay exactly as they were while nothing can be charged.
	 */
	it('reports every rail as blocked by the account when it cannot charge', async () => {
		const report = await readRailChargeability(account(chargeable({ chargesEnabled: false })));

		expect(report.state === 'read' && report.rails.card).toBe('account_cannot_charge');
		expect(report.state === 'read' && report.rails.ach).toBe('account_cannot_charge');
		expect(report.state === 'read' && report.chargesEnabled).toBe(false);
	});

	/**
	 * where the account is switched off and the rail is also not approved, the account is what is
	 * reported.
	 *
	 * the account-level block is the one that has to be cleared first: approving the capability while
	 * the account cannot charge changes nothing a donor would notice. reported the other way round,
	 * an operator does the second job first and the deployment still takes no money.
	 */
	it('names the account rather than the capability when both are in the way', async () => {
		const report = await readRailChargeability(
			account(chargeable({ chargesEnabled: false, cardPayments: 'inactive' }))
		);

		expect(report.state === 'read' && report.rails.card).toBe('account_cannot_charge');
	});

	/**
	 * a wallet's approval is the card capability's, because a wallet settles as a card charge.
	 *
	 * the mapping that would look careful is the one that gives a wallet a source of its own, and
	 * there is none to give: Stripe delivers both wallets through the card method (`INTENT_METHODS`
	 * in ./stripe.ts) and reports no capability named for either, so a card capability short of
	 * active is a wallet nothing can confirm.
	 */
	it('takes a wallet’s approval from the card capability', async () => {
		const report = await readRailChargeability(account(chargeable({ cardPayments: 'inactive' })));

		expect(report.state === 'read' && report.rails.apple_pay).toBe('not_approved');
		expect(report.state === 'read' && report.rails.google_pay).toBe('not_approved');
	});

	/**
	 * a wallet's own switch is its own, which is the half the shared capability must not swallow.
	 *
	 * an operator switching Apple Pay off on an account still approved for cards has changed one
	 * thing, and a screen that answered for both from the capability would say the card is off too —
	 * sending them to undo a switch they never touched.
	 */
	it('reports a wallet switched off beside a card that is not', async () => {
		const report = await readRailChargeability(account(chargeable(), switchedOff('apple_pay')));

		expect(report.state === 'read' && report.rails.apple_pay).toBe('switched_off');
		expect(report.state === 'read' && report.rails.card).toBe('approved');
	});

	/**
	 * an account that cannot charge answers for every rail on it, wallets included.
	 *
	 * the block is above each rail's own approval, so reporting a wallet's switch underneath it
	 * would send an operator to a setting that changes nothing until the account itself is cleared.
	 */
	it('reports the account’s own block over a wallet’s standing', async () => {
		const report = await readRailChargeability(account(chargeable({ chargesEnabled: false })));

		expect(report.state === 'read' && report.rails.apple_pay).toBe('account_cannot_charge');
	});

	/**
	 * a port that could not answer is a state of this block and never of the page.
	 *
	 * the screen that would read this is the one an operator opens to find out why a deployment is
	 * not working, so a fresh fork with no key set — which is the ordinary state of one — has to leave
	 * everything else on that screen rendering. the sentence is carried through whole: it names the
	 * variable to set, and the read it failed on is named in front of it because two reads go out and
	 * a refusal that named neither would leave somebody guessing which.
	 */
	it('carries a refusal through as a state rather than a failure', async () => {
		const report = await readRailChargeability(
			port({
				ok: false,
				reason: 'not_configured',
				detail: 'This deployment cannot take a payment: `STRIPE_SECRET_KEY` is not set.'
			})
		);

		expect(report).toEqual({
			state: 'unreadable',
			detail:
				'The account’s own approvals could not be read. This deployment cannot take a payment: ' +
				'`STRIPE_SECRET_KEY` is not set.'
		});
	});

	/**
	 * the switches failing is the whole read failing, and the sentence says it was the switches.
	 *
	 * the account answering while the switches do not is the half-answer that looks most like a whole
	 * one: every approval is in hand, and what is missing is the operator's own intent — which is the
	 * half that decides what a donor is shown. reported as a list, it is this deployment stating the
	 * ways it takes money out of an answer nobody gave, and the rail it invents is one an operator
	 * deliberately switched off.
	 */
	it('reports the read as unreadable when the operator’s switches could not be read', async () => {
		const report = await readRailChargeability(
			port(
				{ ok: true, value: chargeable() },
				{ ok: false, reason: 'rate_limited', detail: 'Stripe is rate limiting this account.' }
			)
		);

		expect(report).toEqual({
			state: 'unreadable',
			detail:
				'The rails switched on with the processor could not be read. Stripe is rate limiting this ' +
				'account.'
		});
	});

	/**
	 * no list survives a failed read, whichever of the two reads failed.
	 *
	 * a partial answer is the one thing this may not report: approval without the operator's intent
	 * says nothing about what a deployment offers, and rendered as a whole answer it is a screen that
	 * is confidently wrong where a blank one would have been honest. "everything is available" is the
	 * particular wrong answer to guard, because it is what a default-on reading of a failure produces.
	 */
	it('reports no rail standing when either read failed', async () => {
		const refusal = { ok: false, reason: 'unreachable', detail: 'No answer came back.' } as const;

		for (const report of [
			await readRailChargeability(port(refusal)),
			await readRailChargeability(port({ ok: true, value: chargeable() }, refusal))
		]) {
			expect(report.state).toBe('unreadable');
			// the keys rather than the serialisation: the sentence names the read that failed and says
			// the word `rails` in doing it, so only the shape can say a list was left out.
			expect(Object.keys(report).sort()).toEqual(['detail', 'state']);
		}
	});

	/**
	 * both reads go out together rather than one waiting on the other's answer.
	 *
	 * neither needs anything from the other, and the caller is an operator holding a screen open while
	 * the port's own timeout runs — twelve seconds on this deployment (`TIMEOUT_MS` in ./stripe.ts),
	 * with no retry underneath it. issued in sequence, a processor that has stopped answering costs
	 * that twice. the account read failing is the case that would tempt a short-circuit, so it is the
	 * one asserted.
	 */
	it('issues both reads even where the first one refuses', async () => {
		const provider = port({ ok: false, reason: 'unreachable', detail: 'No answer came back.' });

		await readRailChargeability(provider);

		expect(provider.calls.sort()).toEqual(['readAccountChargeability', 'readRailSwitchboard']);
	});

	/**
	 * a refusal reports no rails at all, rather than reporting them as un-chargeable.
	 *
	 * the two are different facts and only one of them is known. an unreadable account whose rails
	 * read as blocked is a screen stating something about Stripe's answer that no answer was given
	 * for — and the fix for it is not a rail's fix.
	 */
	it('reports no rail standing when the account could not be read', async () => {
		const report = await readRailChargeability(
			port({ ok: false, reason: 'rate_limited', detail: 'Stripe is rate limiting this account.' })
		);

		expect(JSON.stringify(report)).not.toContain('not_approved');
		expect(JSON.stringify(report)).not.toContain('account_cannot_charge');
	});
});
