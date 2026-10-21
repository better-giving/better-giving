import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseContact } from '$lib/server/contacts/contact-input';
import { createDb, type Db } from '$lib/server/db/client';
import { client, first, run, stmt } from '$lib/server/db/database.testing';
import type { PostableAccountId } from '$lib/server/db/postable';
import { recordDonation } from '$lib/server/donations/record';
import { SUBSCRIBED_EVENT_TYPES as PAYPAL_EVENTS } from '@better-giving/operator/paypal/webhook-listener';
import { secretFingerprint } from '@better-giving/operator/stripe/secret-fingerprint';
import { SUBSCRIBED_EVENT_TYPES as STRIPE_EVENTS } from '@better-giving/operator/stripe/webhook-endpoint';
import { createNowpaymentsProvider } from '$lib/server/payments/nowpayments';
import type { PaymentsScreen } from '$lib/server/payments/processor-cards';
import { refusing } from '$lib/server/payments/provider';
import type {
	AccountChargeability,
	PaymentProvider,
	PaymentResult,
	ProcessorName,
	RailSwitchboard,
	RecurringGiftStanding,
	WalletDomain,
	WebhookEndpointRegistry
} from '$lib/server/payments/provider';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as screen from './_app.admin.payments';

// the Payments screen's server half, against a real database, through the protected layout — who
// is signed in is what every answer here turns on, and the session gate is that layout's middleware
// (../route-request.testing.ts).
//
// the processors are stood in for at the port and nowhere nearer: a route builds its own providers
// from the request's env (`createPaymentProviders` in $lib/server/payments/factory.ts), so the
// factory is wrapped and the real one delegated to. a processor left out of `stub.ports` meets its
// real adapter, which is what the cases about variables that are not set rely on.

const ORIGIN = 'https://give.example';
const SCREEN = '/admin/payments';
const PASSWORD = 'a-very-long-random-staff-password';

const stub = vi.hoisted(() => ({
	ports: {} as Partial<Record<ProcessorName, PaymentProvider>>
}));

vi.mock('$lib/server/payments/factory', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/payments/factory')>();
	return {
		...actual,
		createPaymentProviders: (platformEnv: Env) => {
			const processors = actual.createPaymentProviders(platformEnv);
			return {
				...processors,
				for: (name: ProcessorName) => stub.ports[name] ?? processors.for(name)
			};
		}
	};
});

/** a set-up deployment: Stripe's two keys and the mail values, as the other /admin specs hold it. */
const deployed = (vars: Record<string, string | undefined> = {}): Env =>
	({ ...deployedBindings(PASSWORD), ...vars }) as Env;

const DEPLOYMENT = { env: deployed(), password: PASSWORD, origin: ORIGIN };

let db: Db;
let request: RouteRequester;
let deployer: string;

beforeAll(() => {
	db = createDb(client);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/payments', module: screen }
	]);
});

beforeEach(async () => {
	stub.ports = {};
	for (const table of ['auth_member_invitation', 'auth_session', 'auth_user', 'site']) {
		await run(stmt(`delete from ${table}`));
	}
	deployer = await signInAsDeployer(db, DEPLOYMENT);
});

function get(cookie: string, env: Env = deployed()): Promise<Response> {
	return request(new Request(`${ORIGIN}${SCREEN}`, { headers: { cookie } }), { env });
}

function post(cookie: string, body: FormData, env: Env = deployed()): Promise<Response> {
	return request(
		new Request(`${ORIGIN}${SCREEN}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body
		}),
		{ env }
	);
}

/** a body naming one of this screen's forms, with its boxes. */
function bodyOf(form: string, boxes: Record<string, string> = {}): FormData {
	const body = new FormData();
	body.set('__form_id__', form);
	for (const [name, value] of Object.entries(boxes)) body.set(name, value);
	return body;
}

/** a Stripe account that counts every press made on it, and answers none of the reads. */
function countingPort(pressed: string[]): PaymentProvider {
	return {
		...refusing('stripe', 'not_configured', 'no case here asks this arm'),
		async prepareRecurringGifts() {
			pressed.push('recurring');
			return { ok: true, value: { created: true } };
		},
		async registerWalletDomain(host: string) {
			pressed.push(`wallet ${host}`);
			return { ok: false, reason: 'not_configured', detail: 'no case here registers' };
		}
	};
}

describe('a member’s session', () => {
	it('gets not-found for the page, which the deployer is served', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);

		expect((await get(deployer)).status).toBe(200);
		expect((await get(member)).status).toBe(404);
	});

	it('gets not-found for each press, and no press reaches the processor', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);
		const pressed: string[] = [];
		stub.ports.stripe = countingPort(pressed);

		const recurring = await post(member, bodyOf('payments-recurring', { processor: 'stripe' }));
		const wallets = await post(member, bodyOf('payments-wallets'));

		expect(recurring.status).toBe(404);
		expect(wallets.status).toBe(404);
		expect(pressed).toEqual([]);
	});
});

/** the screen as the loader draws it for the deployer. */
async function drawn(env: Env = deployed()): Promise<Drawn> {
	const response = await get(deployer, env);
	expect(response.status).toBe(200);
	return (await response.json()) as Drawn;
}

/** the loader's answer as it crosses the wire, which is JSON of exactly this. */
type Drawn = PaymentsScreen;

/** a deployment holding no processor key at all, which is every fork before payments are set up. */
const NO_STRIPE = { STRIPE_SECRET_KEY: undefined, STRIPE_PUBLISHABLE_KEY: undefined };

describe('a deployment with no processor set up', () => {
	it('draws no card, and lists every processor as not set up', async () => {
		const screen = await drawn(deployed(NO_STRIPE));

		expect(screen.cards).toEqual([]);
		expect(screen.others).toEqual([
			{ processor: 'stripe', label: 'Stripe' },
			{ processor: 'paypal', label: 'PayPal' },
			{ processor: 'chariot', label: 'Chariot' },
			{ processor: 'nowpayments', label: 'NOWPayments' }
		]);
	});
});

/** the deployment's own Stripe signing secret, which the endpoint below is stamped with. */
const STRIPE_WEBHOOK_SECRET = 'whsec_SomethingSecretAndLong';

/** every drawn wallet active, with nothing said about any of them. */
const DRAWING: WalletDomain['wallets'] = {
	apple_pay: { state: 'active', detail: null },
	google_pay: { state: 'active', detail: null },
	link: { state: 'active', detail: null }
};

/** what one case scripts a Stripe account to hold; every arm left out answers as a working one. */
type StripeAccount = {
	rails?: PaymentResult<AccountChargeability>;
	domains?: PaymentResult<readonly WalletDomain[]>;
	endpoint?: { enabled?: boolean; eventTypes?: readonly string[]; stamp?: string | null } | null;
	endpoints?: PaymentResult<WebhookEndpointRegistry>;
	recurring?: PaymentResult<RecurringGiftStanding>;
};

/**
 * a Stripe account answering the reads this screen makes, from the script a case hands it: card
 * approved, bank payments never asked for, the deployment's own address registered and drawing,
 * the endpoint at this address on and subscribed and stamped with the secret above, and the item
 * repeating gifts are collected against in place.
 */
async function stripeAccount(account: StripeAccount = {}): Promise<PaymentProvider> {
	const stamp =
		account.endpoint?.stamp === undefined
			? await secretFingerprint(STRIPE_WEBHOOK_SECRET)
			: account.endpoint.stamp;
	const endpoints: PaymentResult<WebhookEndpointRegistry> = account.endpoints ?? {
		ok: true,
		value: {
			endpoints:
				account.endpoint === null
					? []
					: [
							{
								id: 'we_1',
								url: `${ORIGIN}/api/stripe/webhook`,
								enabled: account.endpoint?.enabled ?? true,
								eventTypes: account.endpoint?.eventTypes ?? [...STRIPE_EVENTS],
								apiVersion: null,
								verificationStamp: stamp
							}
						],
			requiredEventTypes: STRIPE_EVENTS
		}
	};
	const rails: PaymentResult<AccountChargeability> = account.rails ?? {
		ok: true,
		value: {
			chargesEnabled: true,
			rails: { card: 'active', ach: 'unrequested', apple_pay: 'active', google_pay: 'active' }
		}
	};
	const switchboard: RailSwitchboard = {
		card: { offered: true, switchedOn: true },
		ach: { offered: false, switchedOn: false },
		apple_pay: { offered: true, switchedOn: true },
		google_pay: { offered: true, switchedOn: true }
	};
	return {
		...refusing('stripe', 'not_configured', 'no case here asks this arm'),
		readAccountChargeability: async () => rails,
		readRailSwitchboard: async () => (rails.ok ? { ok: true, value: switchboard } : rails),
		listWalletDomains: async () =>
			account.domains ?? {
				ok: true,
				value: [{ host: 'give.example', enabled: true, wallets: DRAWING }]
			},
		listWebhookEndpoints: async () => endpoints,
		readRecurringGiftProvision: async () => account.recurring ?? { ok: true, value: 'ready' }
	};
}

/** NOWPayments' two charge values. */
const NOWPAYMENTS_VALUES = {
	NOWPAYMENTS_API_KEY: 'notarealnowpaymentskey',
	NOWPAYMENTS_OUTCOME_CURRENCY: 'usdttrc20'
};

/**
 * a NOWPayments account with a coin to be paid out in. the real adapter answers everything else,
 * which keeps no endpoint and draws no wallet.
 */
function nowpaymentsAccount(
	read: PaymentResult<AccountChargeability> = {
		ok: true,
		value: { chargesEnabled: true, rails: { crypto: 'active' } }
	}
): PaymentProvider {
	return {
		...createNowpaymentsProvider({
			apiKey: NOWPAYMENTS_VALUES.NOWPAYMENTS_API_KEY,
			outcomeCurrency: NOWPAYMENTS_VALUES.NOWPAYMENTS_OUTCOME_CURRENCY,
			ipnSecret: null
		}),
		readAccountChargeability: async () => read,
		readRailSwitchboard: async () =>
			read.ok ? { ok: true, value: { crypto: { offered: true, switchedOn: true } } } : read
	};
}

/** the deployment with its signing secret, which every case about a working Stripe holds. */
const STRIPE_SET = deployed({ STRIPE_WEBHOOK_SECRET });

/** the one card a case is about. */
async function cardOf(processor: ProcessorName, env: Env = STRIPE_SET) {
	const card = (await drawn(env)).cards.find((one) => one.processor === processor);
	if (card === undefined) throw new Error(`the screen drew no ${processor} card`);
	return card;
}

describe('a deployment set up on Stripe', () => {
	it('draws its card with where the account stands, and lists the other three as not set up', async () => {
		stub.ports.stripe = await stripeAccount();

		const screen = await drawn(STRIPE_SET);

		expect(screen.cards.map((card) => card.processor)).toEqual(['stripe']);
		expect(screen.others.map((other) => other.processor)).toEqual([
			'paypal',
			'chariot',
			'nowpayments'
		]);
		const [stripe] = screen.cards;
		expect(stripe?.label).toBe('Stripe');
		expect(stripe?.unreadable).toBeNull();
		expect(stripe?.rails?.map((row) => [row.rail, row.standing])).toEqual([
			['card', 'approved'],
			['ach', 'never_requested'],
			['apple_pay', 'approved'],
			['google_pay', 'approved']
		]);
		expect(stripe?.link).toBe('everywhere');
		expect(stripe?.notices).toBe('working');
		expect(stripe?.recurring).toBe('ready');
	});

	/**
	 * the signing secret's standing is computed from a digest that stays on the server
	 * (`packages/operator/src/stripe/secret-fingerprint.ts`), so neither credential, whole or cut,
	 * reaches the page.
	 */
	it('carries neither Stripe credential in its answer', async () => {
		const secretKey = 'sk_live_51SomethingSecretAndLong';
		stub.ports.stripe = await stripeAccount();

		const response = await get(
			deployer,
			deployed({ STRIPE_SECRET_KEY: secretKey, STRIPE_WEBHOOK_SECRET })
		);
		const said = await response.text();

		expect(response.status).toBe(200);
		expect((JSON.parse(said) as PaymentsScreen).cards.map((card) => card.processor)).toEqual([
			'stripe'
		]);
		expect(said).not.toContain(secretKey);
		expect(said).not.toContain(STRIPE_WEBHOOK_SECRET);
		expect(said).not.toContain('sk_live');
		expect(said).not.toContain('whsec_');
	});
});

describe('whether payment notices reach this deployment', () => {
	it('is unset where the signing secret is not in .env, whatever the account holds', async () => {
		stub.ports.stripe = await stripeAccount();

		expect((await cardOf('stripe', deployed())).notices).toBe('unset');
	});

	it('is failing where the endpoint at this address is switched off', async () => {
		stub.ports.stripe = await stripeAccount({ endpoint: { enabled: false } });

		expect((await cardOf('stripe')).notices).toBe('failing');
	});

	it('is failing where the endpoint is short of an event', async () => {
		stub.ports.stripe = await stripeAccount({
			endpoint: { eventTypes: STRIPE_EVENTS.slice(1) }
		});

		expect((await cardOf('stripe')).notices).toBe('failing');
	});

	it('is failing where the account holds no endpoint at this address', async () => {
		stub.ports.stripe = await stripeAccount({ endpoint: null });

		expect((await cardOf('stripe')).notices).toBe('failing');
	});

	it('is failing where the endpoint was created with another secret', async () => {
		stub.ports.stripe = await stripeAccount({
			endpoint: { stamp: await secretFingerprint('whsec_AnotherEndpointsSecret') }
		});

		expect((await cardOf('stripe')).notices).toBe('failing');
	});

	it('is working where the endpoint carries no stamp to compare against', async () => {
		// an endpoint registered in the dashboard was never stamped, and a deployment on one works.
		stub.ports.stripe = await stripeAccount({ endpoint: { stamp: null } });

		expect((await cardOf('stripe')).notices).toBe('working');
	});

	it('says whether the account lists an endpoint here, which a repair keeps', async () => {
		stub.ports.stripe = await stripeAccount();
		expect((await cardOf('stripe', deployed())).endpointListed).toBe(true);

		stub.ports.stripe = await stripeAccount({ endpoint: null });
		expect((await cardOf('stripe', deployed())).endpointListed).toBe(false);
	});
});

describe('a Stripe account this deployment could not read', () => {
	const REFUSED = {
		ok: false,
		reason: 'not_configured',
		detail: 'Stripe refused STRIPE_SECRET_KEY.'
	} as const;

	it('keeps the page up, says on the card which reads it lost, and draws every other card', async () => {
		stub.ports.stripe = await stripeAccount({
			rails: REFUSED,
			domains: REFUSED,
			endpoints: REFUSED,
			recurring: REFUSED
		});
		stub.ports.nowpayments = nowpaymentsAccount();

		const screen = await drawn(deployed({ STRIPE_WEBHOOK_SECRET, ...NOWPAYMENTS_VALUES }));

		const [stripe, nowpayments] = screen.cards;
		expect(stripe?.unreadable).toEqual({
			says: [
				'which ways of paying it can take',
				'which sites draw wallet buttons',
				'whether Stripe is telling it when a gift is paid',
				'whether repeating gifts are set up'
			],
			detail: 'The account’s own approvals could not be read. Stripe refused STRIPE_SECRET_KEY.'
		});
		expect([stripe?.rails, stripe?.link, stripe?.notices, stripe?.recurring]).toEqual([
			null,
			null,
			null,
			null
		]);
		expect(nowpayments?.processor).toBe('nowpayments');
		expect(nowpayments?.unreadable).toBeNull();
	});

	it('says only the read it lost, and draws the rest of the card', async () => {
		stub.ports.stripe = await stripeAccount({ recurring: REFUSED });

		const stripe = await cardOf('stripe');

		expect(stripe.unreadable).toEqual({
			says: ['whether repeating gifts are set up'],
			detail: 'Stripe refused STRIPE_SECRET_KEY.'
		});
		expect(stripe.notices).toBe('working');
	});
});

describe('a deployment set up on a processor that publishes no per-rail approval', () => {
	const PAYPAL_VALUES = {
		PAYPAL_CLIENT_ID: 'notarealclientid',
		PAYPAL_CLIENT_SECRET: 'notarealclientsecret'
	};
	/** the id PayPal minted for the listener registered at this deployment's address. */
	const LISTENER_ID = '7YN47048TX2895013';

	/** PayPal's two rails, asserted the way the adapter asserts them, and the one listener. */
	function paypalAccount(venmo: 'active' | 'inactive' = 'active'): PaymentProvider {
		return {
			...refusing('paypal', 'not_configured', 'no case here asks this arm'),
			readAccountChargeability: async () => ({
				ok: true,
				value: { chargesEnabled: true, rails: { paypal: 'active', venmo } }
			}),
			readRailSwitchboard: async () => ({
				ok: true,
				value: {
					paypal: { offered: true, switchedOn: true },
					venmo: { offered: venmo === 'active', switchedOn: true }
				}
			}),
			listWebhookEndpoints: async () => ({
				ok: true,
				value: {
					endpoints: [
						{
							id: LISTENER_ID,
							url: `${ORIGIN}/api/paypal/webhook`,
							enabled: true,
							eventTypes: [...PAYPAL_EVENTS],
							apiVersion: null,
							verificationStamp: LISTENER_ID
						}
					],
					requiredEventTypes: PAYPAL_EVENTS
				}
			}),
			listWalletDomains: async () => ({
				ok: false,
				reason: 'unsupported',
				detail: 'PayPal registers no hostname for wallets.'
			}),
			readRecurringGiftProvision: async () => ({ ok: true, value: 'absent' })
		};
	}

	const PAYPAL_ONLY = deployed({ ...NO_STRIPE, ...PAYPAL_VALUES, PAYPAL_WEBHOOK_ID: LISTENER_ID });

	beforeEach(() => {
		stub.ports.paypal = paypalAccount();
	});

	it('draws no ledger where every rail is approved on the keys alone', async () => {
		// an approval here is the keys authenticating, so a tick per rail would say a rail works
		// that nothing has read ($lib/server/payments/rail-evidence.ts).
		const paypal = await cardOf('paypal', PAYPAL_ONLY);

		expect(paypal.rails).toBeNull();
		expect(paypal.link).toBeNull();
	});

	it('draws the rail that is short of approval, with the deployment’s sentence about it', async () => {
		stub.ports.paypal = paypalAccount('inactive');

		const rails = (await cardOf('paypal', PAYPAL_ONLY)).rails ?? [];

		expect(rails.map((row) => [row.rail, row.standing])).toEqual([['venmo', 'not_approved']]);
		expect(rails[0]?.note).toMatch(/PayPal/);
	});

	it('reads the listener this deployment holds the id of as working, and another’s as failing', async () => {
		expect((await cardOf('paypal', PAYPAL_ONLY)).notices).toBe('working');
		expect(
			(
				await cardOf(
					'paypal',
					deployed({ ...NO_STRIPE, ...PAYPAL_VALUES, PAYPAL_WEBHOOK_ID: 'WH-OTHER' })
				)
			).notices
		).toBe('failing');
	});

	it('reads repeating gifts on its own account', async () => {
		expect((await cardOf('paypal', PAYPAL_ONLY)).recurring).toBe('absent');
	});

	it('reads the charity rate off .env, as the fee quote does', async () => {
		expect((await cardOf('paypal', PAYPAL_ONLY)).charityRate).toBe(false);
		expect(
			(
				await cardOf(
					'paypal',
					deployed({ ...NO_STRIPE, ...PAYPAL_VALUES, PAYPAL_CHARITY_RATE_APPROVED: 'True' })
				)
			).charityRate
		).toBe(true);
	});

	it('says nothing about a charity rate on a processor that has none', async () => {
		stub.ports.stripe = await stripeAccount();

		expect((await cardOf('stripe')).charityRate).toBeNull();
	});
});

describe('a deployment set up on NOWPayments', () => {
	const NOWPAYMENTS_ONLY = deployed({ ...NO_STRIPE, ...NOWPAYMENTS_VALUES });

	beforeEach(() => {
		stub.ports.nowpayments = nowpaymentsAccount();
	});

	const IPN_SET = deployed({
		...NO_STRIPE,
		...NOWPAYMENTS_VALUES,
		NOWPAYMENTS_IPN_SECRET: 'notarealipn'
	});

	/**
	 * a crypto gift whose posting landed `minutesAfter` its payment was minted — sooner than half an
	 * hour only an IPN can post it ($lib/server/donations/pending-crypto-read.ts).
	 */
	async function settledCryptoGift(minutesAfter: number): Promise<void> {
		const revenue = await first<{ id: string }>(
			stmt(`select id from account where is_postable = 1 and code = '4110'`)
		);
		if (!revenue) throw new Error('no 4110 account in migrations/0000_initial_schema.sql');
		await run(
			stmt(
				`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
			                   suggested_amounts, allowed_origins, created_at, updated_at)
			 values ('frm_paymentscrypto1', 'General Fund', 'live', ?, 'USD', 500, 1000000, '[]', '[]', 0, 0)`,
				revenue.id
			)
		);
		const donor = parseContact({
			kind: 'individual',
			first_name: 'Ada',
			last_name: 'Okafor',
			primary_email: 'ada@example.org'
		});
		if (!donor.ok) throw new Error('the fixture donor did not parse');
		const minted = Date.parse('2026-10-01T12:00:00.000Z');
		const recorded = await recordDonation(db, {
			donationId: crypto.randomUUID(),
			donor: donor.value,
			formId: 'frm_paymentscrypto1',
			origin: 'https://acme.org',
			currency: 'USD',
			processor: 'nowpayments',
			totalMinor: 2_500,
			feeMinor: 0,
			lines: [
				{ label: 'Donation', revenueAccountId: revenue.id as PostableAccountId, amountMinor: 2_500 }
			],
			method: 'crypto',
			providerTxnId: '5745459419',
			deposit: { coin: 'xrp', network: 'xrp', validUntil: new Date(minted + 20 * 60_000) },
			occurredAt: new Date(minted),
			consentedToContact: false,
			note: undefined,
			tribute: null,
			programId: null
		});
		if (!recorded.ok) throw new Error(`the fixture gift was not recorded: ${recorded.detail}`);
		const { paymentId } = recorded.value;
		await run(stmt('update payment set created_at = ? where id = ?', minted, paymentId));
		await run(
			stmt(
				`insert into entry_group (id, source_type, source_id, currency, occurred_at, created_at)
			 values (?, 'payment', ?, 'USD', ?, ?)`,
				crypto.randomUUID(),
				paymentId,
				minted,
				minted + minutesAfter * 60_000
			)
		);
	}

	beforeEach(async () => {
		for (const table of ['entry_group', 'payment', 'line_item', 'donation', 'contact', 'form']) {
			await run(stmt(`delete from ${table}`));
		}
	});

	it('reads notices as unset where the IPN secret is not in .env', async () => {
		expect((await cardOf('nowpayments', NOWPAYMENTS_ONLY)).notices).toBe('unset');
	});

	it('reads a set IPN secret as unconfirmed until a notice has settled a gift here', async () => {
		await settledCryptoGift(45);

		expect((await cardOf('nowpayments', IPN_SET)).notices).toBe('unconfirmed');
	});

	it('reads a set IPN secret as working once a notice has settled a gift here', async () => {
		await settledCryptoGift(5);

		expect((await cardOf('nowpayments', IPN_SET)).notices).toBe('working');
	});

	it('draws no ledger, no Link and no repeating gifts where the account has a coin', async () => {
		const card = await cardOf('nowpayments', NOWPAYMENTS_ONLY);

		expect([card.rails, card.link, card.recurring, card.unreadable]).toEqual([
			null,
			null,
			null,
			null
		]);
	});

	it('says it could not read the account where the key is refused', async () => {
		stub.ports.nowpayments = nowpaymentsAccount({
			ok: false,
			reason: 'not_configured',
			detail: 'NOWPayments did not accept NOWPAYMENTS_API_KEY.'
		});

		const card = await cardOf('nowpayments', NOWPAYMENTS_ONLY);

		expect(card.unreadable).toEqual({
			says: ['which ways of paying it can take'],
			detail:
				'The account’s own approvals could not be read. NOWPayments did not accept NOWPAYMENTS_API_KEY.'
		});
	});

	it('carries no NOWPayments credential in its answer', async () => {
		const said = await (
			await get(
				deployer,
				deployed({ ...NOWPAYMENTS_VALUES, NOWPAYMENTS_IPN_SECRET: 'notarealipnsecret' })
			)
		).text();

		expect(said).not.toContain(NOWPAYMENTS_VALUES.NOWPAYMENTS_API_KEY);
		expect(said).not.toContain('notarealipnsecret');
	});
});

describe('a deployment set up on Chariot', () => {
	const CHARIOT_VALUES = { CHARIOT_API_KEY: 'notarealchariotkey', CHARIOT_CONNECT_ID: 'connect_1' };
	const CHARIOT_SECRET = 'notarealchariotsecret';

	/** a Chariot account holding the subscription at this address, or none. */
	function chariotAccount(subscribed: boolean): PaymentProvider {
		return {
			...refusing('chariot', 'not_configured', 'no case here asks this arm'),
			readAccountChargeability: async () => ({
				ok: true,
				value: { chargesEnabled: true, rails: { daf: 'active' } }
			}),
			readRailSwitchboard: async () => ({
				ok: true,
				value: { daf: { offered: true, switchedOn: true } }
			}),
			listWebhookEndpoints: async () => ({
				ok: true,
				value: {
					endpoints: subscribed
						? [
								{
									id: 'sub_1',
									url: `${ORIGIN}/api/chariot/webhook`,
									enabled: true,
									eventTypes: ['grant.updated'],
									apiVersion: null,
									verificationStamp: await secretFingerprint(CHARIOT_SECRET)
								}
							]
						: [],
					requiredEventTypes: ['grant.updated']
				}
			}),
			listWalletDomains: async () => ({ ok: false, reason: 'unsupported', detail: 'none' })
		};
	}

	const CHARIOT_ONLY = deployed({
		...NO_STRIPE,
		...CHARIOT_VALUES,
		CHARIOT_WEBHOOK_SECRET: CHARIOT_SECRET
	});

	it('reads the subscription at this address as working, and none there as failing', async () => {
		stub.ports.chariot = chariotAccount(true);
		expect((await cardOf('chariot', CHARIOT_ONLY)).notices).toBe('working');

		stub.ports.chariot = chariotAccount(false);
		expect((await cardOf('chariot', CHARIOT_ONLY)).notices).toBe('failing');
	});

	it('reads notices as unset where the secret is not in .env', async () => {
		stub.ports.chariot = chariotAccount(true);

		const card = await cardOf('chariot', deployed({ ...NO_STRIPE, ...CHARIOT_VALUES }));

		expect(card.notices).toBe('unset');
	});

	it('draws no ledger and no repeating gifts, since a grant is one gift', async () => {
		stub.ports.chariot = chariotAccount(true);

		const card = await cardOf('chariot', CHARIOT_ONLY);

		expect([card.rails, card.recurring]).toEqual([null, null]);
	});

	it('carries no Chariot credential in its answer', async () => {
		stub.ports.chariot = chariotAccount(true);

		const said = await (await get(deployer, CHARIOT_ONLY)).text();

		expect(said).not.toContain(CHARIOT_VALUES.CHARIOT_API_KEY);
		expect(said).not.toContain(CHARIOT_SECRET);
	});
});

/** one site row, in the operator's own order. */
function listSite(id: string, origin: string, position: number): Promise<unknown> {
	return run(
		stmt(
			`insert into site (id, origin, position, created_at, updated_at) values (?, ?, ?, 0, 0)`,
			id,
			origin,
			position
		)
	);
}

describe('where Link is drawn', () => {
	it('is everywhere where this address and every listed site are registered and drawing it', async () => {
		await listSite('ste_1', 'https://www.hope.example', 0);
		stub.ports.stripe = await stripeAccount({
			domains: {
				ok: true,
				value: [
					{ host: 'give.example', enabled: true, wallets: DRAWING },
					{ host: 'www.hope.example', enabled: true, wallets: DRAWING }
				]
			}
		});

		expect((await cardOf('stripe')).link).toBe('everywhere');
	});

	it('is not everywhere where a listed site is not registered', async () => {
		await listSite('ste_1', 'https://www.hope.example', 0);
		stub.ports.stripe = await stripeAccount();

		expect((await cardOf('stripe')).link).toBe('not_everywhere');
	});

	it('is not everywhere where a registration is switched off, or Link is inactive on it', async () => {
		stub.ports.stripe = await stripeAccount({
			domains: { ok: true, value: [{ host: 'give.example', enabled: false, wallets: DRAWING }] }
		});
		expect((await cardOf('stripe')).link).toBe('not_everywhere');

		stub.ports.stripe = await stripeAccount({
			domains: {
				ok: true,
				value: [
					{
						host: 'give.example',
						enabled: true,
						wallets: { ...DRAWING, link: { state: 'inactive', detail: 'Not yet.' } }
					}
				]
			}
		});
		expect((await cardOf('stripe')).link).toBe('not_everywhere');
	});
});

describe('Set up recurring gifts', () => {
	/** a Stripe account whose repeating-gift press answers `prepare`, recording each press. */
	async function recurringAccount(
		prepare: Awaited<ReturnType<PaymentProvider['prepareRecurringGifts']>>,
		pressed: string[]
	): Promise<PaymentProvider> {
		return {
			...(await stripeAccount({ recurring: { ok: true, value: 'absent' } })),
			async prepareRecurringGifts() {
				pressed.push('stripe');
				return prepare;
			}
		};
	}

	it('sets the item up on the account it names, and says so', async () => {
		const pressed: string[] = [];
		stub.ports.stripe = await recurringAccount({ ok: true, value: { created: true } }, pressed);

		const response = await post(
			deployer,
			bodyOf('payments-recurring', { processor: 'stripe' }),
			STRIPE_SET
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			recurring: { label: 'Stripe', outcome: 'set_up', detail: null }
		});
		expect(pressed).toEqual(['stripe']);
	});

	it('says the account already had it, where it did', async () => {
		stub.ports.stripe = await recurringAccount({ ok: true, value: { created: false } }, []);

		const response = await post(
			deployer,
			bodyOf('payments-recurring', { processor: 'stripe' }),
			STRIPE_SET
		);

		expect(((await response.json()) as { recurring: { outcome: string } }).recurring.outcome).toBe(
			'already_set_up'
		);
	});

	it('answers a refusal from the processor with its own sentence', async () => {
		stub.ports.stripe = await recurringAccount(
			{ ok: false, reason: 'invalid_request', detail: 'Stripe holds an archived product.' },
			[]
		);

		const response = await post(
			deployer,
			bodyOf('payments-recurring', { processor: 'stripe' }),
			STRIPE_SET
		);

		expect(response.status).toBe(500);
		expect(((await response.json()) as { recurring: unknown }).recurring).toEqual({
			label: 'Stripe',
			outcome: 'failed',
			detail: 'Stripe holds an archived product.'
		});
	});

	it('refuses a press naming a processor that takes no repeating gifts, having pressed nothing', async () => {
		const pressed: string[] = [];
		stub.ports.stripe = await recurringAccount({ ok: true, value: { created: true } }, pressed);

		const response = await post(deployer, bodyOf('payments-recurring', { processor: 'chariot' }));

		expect(response.status).toBe(400);
		expect(pressed).toEqual([]);
	});
});

describe('Register all sites', () => {
	/** a Stripe account holding `held`, recording every hostname it is asked to register. */
	async function walletAccount(
		held: readonly WalletDomain[],
		registered: string[],
		refuse: string | null = null
	): Promise<PaymentProvider> {
		return {
			...(await stripeAccount({ domains: { ok: true, value: held } })),
			async registerWalletDomain(host: string) {
				registered.push(host);
				if (refuse === host) {
					return { ok: false, reason: 'invalid_request', detail: `Stripe refused ${host}.` };
				}
				return { ok: true, value: { host, enabled: true, wallets: DRAWING } };
			}
		};
	}

	it('registers this address and every listed site the account does not hold, once each', async () => {
		await listSite('ste_1', 'https://www.hope.example', 0);
		await listSite('ste_2', ORIGIN, 1);
		await listSite('ste_3', 'https://hope.example:8443', 2);
		const registered: string[] = [];
		stub.ports.stripe = await walletAccount([], registered);

		const response = await post(deployer, bodyOf('payments-wallets'), STRIPE_SET);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ wallets: { state: 'levelled', failed: [] } });
		expect(registered).toEqual(['give.example', 'www.hope.example', 'hope.example']);
	});

	it('leaves alone a site already registered and drawing everything', async () => {
		await listSite('ste_1', 'https://www.hope.example', 0);
		const registered: string[] = [];
		stub.ports.stripe = await walletAccount(
			[{ host: 'give.example', enabled: true, wallets: DRAWING }],
			registered
		);

		await post(deployer, bodyOf('payments-wallets'), STRIPE_SET);

		expect(registered).toEqual(['www.hope.example']);
	});

	it('names each site it could not register, with the processor’s sentence, and registers the rest', async () => {
		await listSite('ste_1', 'https://www.hope.example', 0);
		const registered: string[] = [];
		stub.ports.stripe = await walletAccount([], registered, 'give.example');

		const response = await post(deployer, bodyOf('payments-wallets'), STRIPE_SET);

		expect(response.status).toBe(200);
		expect(registered).toEqual(['give.example', 'www.hope.example']);
		expect(((await response.json()) as { wallets: { failed: unknown } }).wallets.failed).toEqual([
			{ host: 'give.example', detail: 'Stripe refused give.example.' }
		]);
	});

	it('registers nothing and says why where the account could not be read', async () => {
		const registered: string[] = [];
		stub.ports.stripe = {
			...(await walletAccount([], registered)),
			listWalletDomains: async () => ({
				ok: false,
				reason: 'not_configured',
				detail: 'Stripe refused STRIPE_SECRET_KEY.'
			})
		};

		const response = await post(deployer, bodyOf('payments-wallets'), STRIPE_SET);

		expect(response.status).toBe(500);
		expect(((await response.json()) as { wallets: unknown }).wallets).toEqual({
			state: 'unreadable',
			detail: 'Stripe refused STRIPE_SECRET_KEY.'
		});
		expect(registered).toEqual([]);
	});
});
