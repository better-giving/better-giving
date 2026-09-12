import { describe, expect, it } from 'vitest';
import type { PaymentProvider, PaymentResult, WalletDomain } from './provider';
import { createPaymentProviders } from './factory';
import { levelWalletDomains, readWalletDomains } from './wallet-domains';

// what a caller asks the payment port about the hostnames a deployment wants wallets drawn on,
// away from the screen that asks it.
//
// a node spec rather than a workers one because nothing here touches the database (CLAUDE.md splits
// the pools by that), and a module of its own rather than cases on a route because a route builds
// its provider from a request's `platform.env` — so a case that wanted a registered hostname to look
// at could only get one by standing in for the whole platform. the seam is the port, which is a
// value.

const HOST = 'donate.example.org';
const OTHER_HOST = 'www.donate.example.org';

/**
 * every drawn wallet active, with nothing said about any of them.
 *
 * a drawn wallet has nothing to explain, so its sentence is null rather than empty — the state the
 * expectations below spell out whole, because what a screen must never do is draw a blank line under
 * a wallet that is working.
 */
const DRAWING: WalletDomain['wallets'] = {
	apple_pay: { state: 'active', detail: null },
	google_pay: { state: 'active', detail: null },
	link: { state: 'active', detail: null }
};

/** one registered hostname as the port reports it, drawing every wallet. */
function domain(overrides: Partial<WalletDomain> = {}): WalletDomain {
	return { host: HOST, enabled: true, wallets: DRAWING, ...overrides };
}

/**
 * a port that answers the wallet arms from a script and refuses the rest.
 *
 * the money arms throw rather than returning a refusal, so a change that made this module reach for
 * one fails here with the name of the arm instead of passing quietly on a refusal it never asked
 * for.
 */
function port(
	list: PaymentResult<readonly WalletDomain[]>,
	register?: (host: string) => Promise<PaymentResult<WalletDomain>>
): PaymentProvider {
	const unused = (name: string) => () => {
		throw new Error(`${name} is not part of reading wallet domains`);
	};
	return {
		processor: 'stripe',
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
		listWebhookEndpoints: unused('listWebhookEndpoints'),
		registerWebhookEndpoint: unused('registerWebhookEndpoint'),
		resubscribeWebhookEndpoint: unused('resubscribeWebhookEndpoint'),
		replaceWebhookEndpoint: unused('replaceWebhookEndpoint'),
		async listWalletDomains() {
			return list;
		},
		registerWalletDomain: register ?? unused('registerWalletDomain')
	};
}

/** an account holding exactly these hostnames. */
function holding(...domains: WalletDomain[]): PaymentResult<readonly WalletDomain[]> {
	return { ok: true, value: domains };
}

describe('readWalletDomains', () => {
	/**
	 * a hostname the account does not hold is the fresh-fork state, and the one the setup button
	 * belongs to.
	 *
	 * the hostname on the account below is a second registration rather than a near miss: Stripe
	 * treats `www.donate.example.org` and `donate.example.org` as two, so matching one against the
	 * other would report a site as set up while the donor on it is shown no wallet at all.
	 */
	it('reports a hostname the account does not hold as unregistered', async () => {
		const reading = await readWalletDomains(port(holding(domain({ host: OTHER_HOST }))), [HOST]);

		expect(reading).toEqual({ state: 'read', hosts: [{ host: HOST, state: 'unregistered' }] });
	});

	/** the finished state: registered, switched on, every drawn wallet active. */
	it('reports a hostname drawing every wallet as complete', async () => {
		const reading = await readWalletDomains(port(holding(domain())), [HOST]);

		expect(reading).toEqual({
			state: 'read',
			hosts: [
				{
					host: HOST,
					state: 'registered',
					drawing: true,
					wallets: DRAWING,
					inactiveWallets: [],
					complete: true
				}
			]
		});
	});

	/**
	 * a registration switched off is registered and drawing nothing, which are two different things
	 * to say.
	 *
	 * folded into one, an operator reads "not set up" over an account that already holds their site
	 * and goes looking for a registration that is there. the wallets are reported as the account has
	 * them because they are what the hostname goes back to drawing the moment it is switched on.
	 */
	it('reports a registration that is switched off as not complete', async () => {
		const reading = await readWalletDomains(port(holding(domain({ enabled: false }))), [HOST]);

		expect(reading.state === 'read' && reading.hosts[0]).toEqual({
			host: HOST,
			state: 'registered',
			drawing: false,
			wallets: DRAWING,
			inactiveWallets: [],
			complete: false
		});
	});

	/**
	 * a hostname drawing one of the three names the two it is missing, and says what Stripe said
	 * about each.
	 *
	 * the state that is invisible without it. the site is registered and switched on, most donors see
	 * what they expect, and the ones on an iPhone see one button fewer — so the reading has to say
	 * which wallet, and then what to do about it. the second half is the sentence: what an inactive
	 * wallet is short of is a requirement on the operator's own domain, so Stripe's own words are the
	 * only thing on this screen that can point anywhere. a wallet Stripe said nothing about carries
	 * null and gets no line drawn under it.
	 */
	it('names the wallets that are not active and carries what Stripe said', async () => {
		const reading = await readWalletDomains(
			port(
				holding(
					domain({
						wallets: {
							apple_pay: { state: 'inactive', detail: 'This domain is not registered with Apple.' },
							google_pay: { state: 'active', detail: null },
							link: { state: 'inactive', detail: null }
						}
					})
				)
			),
			[HOST]
		);

		expect(reading.state === 'read' && reading.hosts[0]).toEqual({
			host: HOST,
			state: 'registered',
			drawing: true,
			wallets: {
				apple_pay: { state: 'inactive', detail: 'This domain is not registered with Apple.' },
				google_pay: { state: 'active', detail: null },
				link: { state: 'inactive', detail: null }
			},
			inactiveWallets: ['apple_pay', 'link'],
			complete: false
		});
	});

	/**
	 * the hosts come back in the order they were asked about, whatever order the account lists them
	 * in.
	 *
	 * the screen draws a row per site the operator keeps, so the answer is keyed to the question
	 * rather than to somebody else's list — and a hostname the account holds that this deployment
	 * does not serve is not a row on it.
	 */
	it('answers per host asked, in that order', async () => {
		const reading = await readWalletDomains(
			port(holding(domain({ host: OTHER_HOST }), domain({ host: 'unrelated.example.org' }))),
			[HOST, OTHER_HOST]
		);

		expect(reading.state === 'read' && reading.hosts.map((h) => [h.host, h.state])).toEqual([
			[HOST, 'unregistered'],
			[OTHER_HOST, 'registered']
		]);
	});

	/**
	 * a port that could not answer is a state of this block, carrying its own sentence.
	 *
	 * the fresh-fork state as much as the outage one: `STRIPE_SECRET_KEY` unset is a read that never
	 * lands, and the sentence the port wrote is what names the value to fix. reported as "none of
	 * these is registered" it would draw a setup button that registers nothing.
	 */
	it('reports a read that did not land as unreadable', async () => {
		const reading = await readWalletDomains(
			port({ ok: false, reason: 'not_configured', detail: 'Stripe rejected the key.' }),
			[HOST]
		);

		expect(reading).toEqual({ state: 'unreadable', detail: 'Stripe rejected the key.' });
	});
});

describe('levelWalletDomains', () => {
	/**
	 * a hostname the account does not hold is registered, and the press says it changed something.
	 *
	 * `changed` is what the screen has to report afterwards, and it is the only thing separating the
	 * two successes: the account had nothing and now does, or it already did and the press was a
	 * no-op. both leave the same finished state, which is what makes the button safe to press twice.
	 */
	it('registers a hostname the account does not hold', async () => {
		const pressed: string[] = [];
		const levelling = await levelWalletDomains(
			port(holding(), async (host) => {
				pressed.push(host);
				return { ok: true, value: domain({ host }) };
			}),
			[HOST]
		);

		expect(pressed).toEqual([HOST]);
		expect(levelling.state === 'levelled' && levelling.hosts[0]).toEqual({
			standing: {
				host: HOST,
				state: 'registered',
				drawing: true,
				wallets: DRAWING,
				inactiveWallets: [],
				complete: true
			},
			changed: true,
			detail: null
		});
	});
	/**
	 * a mix of hostnames is levelled in one press, and one that fails stops none of the others.
	 *
	 * the real shape of the press: an operator adds a site, presses once, and the sites that were
	 * already fine have to stay untouched while the new one is registered. the refusal in the middle
	 * is what the assertion is really for — a loop that gave up on the first failure would leave the
	 * remaining sites unregistered with nothing on the screen saying they were never attempted.
	 */
	it('levels every hostname and carries one failure without stopping', async () => {
		const pressed: string[] = [];
		const levelling = await levelWalletDomains(
			port(holding(domain(), domain({ host: OTHER_HOST, enabled: false })), async (host) => {
				pressed.push(host);
				if (host === 'refused.example.org') {
					return { ok: false, reason: 'rate_limited', detail: 'Stripe is rate limiting.' };
				}
				return { ok: true, value: domain({ host }) };
			}),
			[HOST, OTHER_HOST, 'refused.example.org', 'fresh.example.org']
		);

		// the complete hostname is not among them, and every other one is, in order.
		expect(pressed).toEqual([OTHER_HOST, 'refused.example.org', 'fresh.example.org']);
		expect(
			levelling.state === 'levelled' &&
				levelling.hosts.map((one) => [one.standing.host, one.changed, one.detail])
		).toEqual([
			[HOST, false, null],
			[OTHER_HOST, true, null],
			['refused.example.org', false, 'Stripe is rate limiting.'],
			['fresh.example.org', true, null]
		]);
	});

	/**
	 * a hostname the press could not move goes on reporting where it stands.
	 *
	 * the row stays legible: the site is registered and switched off, the press failed, and both
	 * facts are on the same row. blanked to an unregistered-looking state it would draw a setup
	 * button over a registration that is already there.
	 */
	it('keeps the standing a failed press could not move', async () => {
		const levelling = await levelWalletDomains(
			port(holding(domain({ enabled: false })), async () => ({
				ok: false,
				reason: 'rate_limited',
				detail: 'Stripe is rate limiting.'
			})),
			[HOST]
		);

		expect(levelling.state === 'levelled' && levelling.hosts[0]?.standing).toEqual({
			host: HOST,
			state: 'registered',
			drawing: false,
			wallets: DRAWING,
			inactiveWallets: [],
			complete: false
		});
	});

	/**
	 * a press that asks Stripe to look again at an inactive wallet and gets the same answer changed
	 * nothing, and says so.
	 *
	 * what an inactive wallet is short of is satisfied outside this deployment, so the honest report
	 * is that the press landed and moved nothing — not that it failed, and not that it worked. read
	 * as a change, an operator presses again expecting the button to appear.
	 */
	it('reports a press that moved nothing as unchanged', async () => {
		const inactive: WalletDomain['wallets'] = {
			apple_pay: { state: 'inactive', detail: 'This domain is not registered with Apple.' },
			google_pay: { state: 'active', detail: null },
			link: { state: 'active', detail: null }
		};
		const levelling = await levelWalletDomains(
			port(holding(domain({ wallets: inactive })), async () => ({
				ok: true,
				value: domain({ wallets: inactive })
			})),
			[HOST]
		);

		expect(levelling.state === 'levelled' && levelling.hosts[0]?.changed).toBe(false);
		expect(
			levelling.state === 'levelled' &&
				levelling.hosts[0]?.standing.state === 'registered' &&
				levelling.hosts[0]?.standing.inactiveWallets
		).toEqual(['apple_pay']);
	});

	/**
	 * an account that could not be read is a press that attempted nothing.
	 *
	 * the press has to know what was there to say what it changed, so a read that did not land is the
	 * whole answer rather than a per-hostname failure — and registering blind on the strength of a
	 * rejected key is how an account acquires a registration per outage.
	 */
	it('attempts nothing when the account could not be read', async () => {
		const levelling = await levelWalletDomains(
			port({ ok: false, reason: 'not_configured', detail: 'Stripe rejected the key.' }),
			[HOST]
		);

		expect(levelling).toEqual({ state: 'unreadable', detail: 'Stripe rejected the key.' });
	});
});

/**
 * the same module asked about a processor that draws no wallet on a page this deployment serves.
 *
 * the wallet block is one processor's question — the three wallets are drawn inside that
 * processor's own box — and another's funding sources are drawn on its own domain, where no
 * hostname of this deployment's is registered or could be. so there is nothing to read rather than
 * a read that failed, and the two are told apart here because a console draws a section for one and
 * none at all for the other.
 */
describe('readWalletDomains on a PayPal deployment', () => {
	it('reports the hostnames as undrawn rather than unreadable', async () => {
		const reading = await readWalletDomains(
			createPaymentProviders({
				PAYPAL_CLIENT_ID: 'notarealclientid',
				PAYPAL_CLIENT_SECRET: 'notarealclientsecret'
			}).for('paypal'),
			['give.example.org']
		);

		expect(reading.state).toBe('undrawn');
	});
});
