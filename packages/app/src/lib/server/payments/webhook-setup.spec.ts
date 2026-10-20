import { describe, expect, it } from 'vitest';
import { CHARIOT_WEBHOOK_PATH } from '@better-giving/operator/chariot/webhook-subscription';
import { PAYPAL_WEBHOOK_PATH } from '@better-giving/operator/paypal/webhook-listener';
import { STRIPE_WEBHOOK_PATH } from '@better-giving/operator/stripe/webhook-endpoint';
import type {
	PaymentProvider,
	PaymentResult,
	RegisteredWebhookEndpoint,
	WebhookEndpointRegistry
} from './provider';
import { setupWebhook } from './webhook-setup';

// what `node scripts/setup-webhook.ts <name>` decides, away from the process it runs in. the port is
// a value here, so every case runs with no network and no account.

const ORIGIN = 'https://give.example.org';
const URL_HERE = `${ORIGIN}${STRIPE_WEBHOOK_PATH}`;
const ENV = { STRIPE_SECRET_KEY: 'sk_test_123', BETTER_AUTH_URL: ORIGIN };

function summary(id: string, url = URL_HERE) {
	return {
		id,
		url,
		enabled: true,
		eventTypes: ['payment_intent.succeeded'],
		apiVersion: null,
		verificationStamp: null
	};
}

/**
 * a port whose endpoint arms answer from a script and record what they were asked; every other arm
 * throws, so reaching for one fails with its name.
 */
function port(
	list: PaymentResult<WebhookEndpointRegistry>,
	created: PaymentResult<RegisteredWebhookEndpoint> = {
		ok: true,
		value: { endpoint: summary('we_new'), verificationValue: 'whsec_new' }
	}
) {
	const calls: string[] = [];
	const unused = (name: string) => () => {
		throw new Error(`${name} is not part of setting a webhook up`);
	};
	const provider: PaymentProvider = {
		processor: 'stripe',
		prepareRecurringGifts: unused('prepareRecurringGifts'),
		readRecurringGiftProvision: unused('readRecurringGiftProvision'),
		createRecurringGift: unused('createRecurringGift'),
		cancelRecurringGift: unused('cancelRecurringGift'),
		createIntent: unused('createIntent'),
		verifyEvent: unused('verifyEvent'),
		readSettlement: unused('readSettlement'),
		readRecurringGift: unused('readRecurringGift'),
		readReversal: unused('readReversal'),
		readAccountChargeability: unused('readAccountChargeability'),
		readRailSwitchboard: unused('readRailSwitchboard'),
		async listWebhookEndpoints() {
			calls.push('list');
			return list;
		},
		async registerWebhookEndpoint(url) {
			calls.push(`register ${url}`);
			return created;
		},
		async resubscribeWebhookEndpoint(id) {
			calls.push(`resubscribe ${id}`);
			const listed = list.ok ? list.value.endpoints.find((one) => one.id === id) : undefined;
			if (!listed) throw new Error(`resubscribed ${id}, which the account does not hold`);
			return { ok: true, value: listed };
		},
		async replaceWebhookEndpoint(id, url) {
			calls.push(`replace ${id} ${url}`);
			return created;
		},
		listWalletDomains: unused('listWalletDomains'),
		registerWalletDomain: unused('registerWalletDomain'),
		listPayableCoins: unused('listPayableCoins')
	};
	return { provider, calls };
}

function holding(
	...endpoints: ReturnType<typeof summary>[]
): PaymentResult<WebhookEndpointRegistry> {
	return { ok: true, value: { endpoints, requiredEventTypes: ['payment_intent.succeeded'] } };
}

describe('setupWebhook', () => {
	it('registers an endpoint at this deployment’s address and gives back the line .env takes', async () => {
		const { provider, calls } = port(holding(summary('we_other', 'https://other.example/x')));

		const result = await setupWebhook(['stripe'], ENV, () => provider);

		expect(result).toEqual({ ok: true, line: 'STRIPE_WEBHOOK_SECRET=whsec_new', notices: [] });
		expect(calls.at(-1)).toBe(`register ${URL_HERE}`);
	});

	/**
	 * a re-run on a deployment that already has an endpoint. the secret was returned once, when that
	 * endpoint was made, so the only way to a line worth printing is a fresh endpoint — and the
	 * operator is told the old value is dead, since a paste they skip is every delivery refused.
	 */
	it('replaces the endpoint already at this address and says the old secret stopped working', async () => {
		const { provider, calls } = port(holding(summary('we_old')));

		const result = await setupWebhook(['stripe'], ENV, () => provider);

		expect(result).toMatchObject({ ok: true, line: 'STRIPE_WEBHOOK_SECRET=whsec_new' });
		expect(calls).not.toContain(`register ${URL_HERE}`);
		expect(calls.at(-1)).toBe(`replace we_old ${URL_HERE}`);
		const notices = result.ok ? result.notices.join('\n') : '';
		expect(notices).toMatch(/replaced/i);
		expect(notices).toMatch(/STRIPE_WEBHOOK_SECRET.*no longer verifies|stopped working/);
	});

	it.each([
		['the secret key', { BETTER_AUTH_URL: ORIGIN }, 'STRIPE_SECRET_KEY'],
		['a blank secret key', { ...ENV, STRIPE_SECRET_KEY: '  ' }, 'STRIPE_SECRET_KEY'],
		['the public address', { STRIPE_SECRET_KEY: 'sk_test_123' }, 'BETTER_AUTH_URL']
	])('refuses without %s, naming it, and asks Stripe nothing', async (_, env, named) => {
		const result = await setupWebhook(['stripe'], env, () => {
			throw new Error('connected with an input missing');
		});

		expect(result).toMatchObject({ ok: false, status: 1 });
		expect(result.ok ? '' : result.message).toContain(named);
	});

	it.each([
		['plain http', 'http://give.example.org', []],
		['http on localhost, without the flag', 'http://localhost:5173', []],
		['http elsewhere, even with the flag', 'http://give.example.org', ['--allow-http-localhost']],
		['a value that is not an address', 'give.example.org', []]
	])('refuses %s and asks Stripe nothing', async (_, address, flags) => {
		const result = await setupWebhook(
			['stripe', ...flags],
			{ ...ENV, BETTER_AUTH_URL: address },
			() => {
				throw new Error('connected with an address nothing can deliver to');
			}
		);

		expect(result).toMatchObject({ ok: false, status: 1 });
		expect(result.ok ? '' : result.message).toContain('BETTER_AUTH_URL');
	});

	it('takes http on localhost when the flag asks for it', async () => {
		const { provider, calls } = port(holding());

		await setupWebhook(
			['stripe', '--allow-http-localhost'],
			{ ...ENV, BETTER_AUTH_URL: 'http://localhost:5173/' },
			() => provider
		);

		expect(calls.at(-1)).toBe(`register http://localhost:5173${STRIPE_WEBHOOK_PATH}`);
	});

	it('passes on what Stripe refused', async () => {
		const { provider } = port(holding(), {
			ok: false,
			reason: 'not_configured',
			detail: 'Stripe rejected the secret key.'
		});

		const result = await setupWebhook(['stripe'], ENV, () => provider);

		expect(result).toEqual({ ok: false, status: 1, message: 'Stripe rejected the secret key.' });
	});

	it.each([
		['no processor', []],
		['an option it does not know', ['stripe', '--yes']],
		['a processor it cannot set up', ['nowpayments']]
	])('answers %s with a usage error naming the ones it can', async (_, argv) => {
		const result = await setupWebhook(argv, ENV, () => {
			throw new Error('connected without a processor');
		});

		expect(result).toMatchObject({ ok: false, status: 2 });
		expect(result.ok ? '' : result.message).toMatch(/usage: .*setup-webhook\.ts .*stripe/);
	});
});

describe('setupWebhook for PayPal', () => {
	const PAYPAL_HERE = `${ORIGIN}${PAYPAL_WEBHOOK_PATH}`;
	const PAYPAL_ENV = {
		PAYPAL_CLIENT_ID: 'Aa-client',
		PAYPAL_CLIENT_SECRET: 'EL-secret',
		BETTER_AUTH_URL: ORIGIN
	};

	it('registers a listener at this deployment’s address and gives back its id as the line', async () => {
		const { provider, calls } = port(holding(summary('WH-OTHER', 'https://other.example/x')), {
			ok: true,
			value: { endpoint: summary('WH-NEW', PAYPAL_HERE), verificationValue: 'WH-NEW' }
		});

		const result = await setupWebhook(['paypal'], PAYPAL_ENV, () => provider);

		expect(result).toEqual({ ok: true, line: 'PAYPAL_WEBHOOK_ID=WH-NEW', notices: [] });
		expect(calls.at(-1)).toBe(`register ${PAYPAL_HERE}`);
	});

	/**
	 * a re-run on a deployment that already has a listener. what verifies a PayPal delivery is the
	 * listener's own id, which every list hands back, so the listener is kept — its subscription
	 * brought level — and the line printed is the id `.env` already holds.
	 */
	it('keeps the listener already at this address and says its id is unchanged', async () => {
		const { provider, calls } = port(holding(summary('WH-HERE', PAYPAL_HERE)));

		const result = await setupWebhook(['paypal'], PAYPAL_ENV, () => provider);

		expect(result).toMatchObject({ ok: true, line: 'PAYPAL_WEBHOOK_ID=WH-HERE' });
		expect(calls).toContain('resubscribe WH-HERE');
		expect(calls.some((call) => call.startsWith('register') || call.startsWith('replace'))).toBe(
			false
		);
		const notices = result.ok ? result.notices.join('\n') : '';
		expect(notices).toMatch(/kept/i);
		expect(notices).toMatch(/PAYPAL_WEBHOOK_ID.*unchanged/);
	});

	it.each([
		['the client id', { ...PAYPAL_ENV, PAYPAL_CLIENT_ID: undefined }, 'PAYPAL_CLIENT_ID'],
		['the client secret', { ...PAYPAL_ENV, PAYPAL_CLIENT_SECRET: ' ' }, 'PAYPAL_CLIENT_SECRET'],
		['the public address', { ...PAYPAL_ENV, BETTER_AUTH_URL: undefined }, 'BETTER_AUTH_URL']
	])('refuses without %s, naming it, and asks PayPal nothing', async (_, env, named) => {
		const result = await setupWebhook(['paypal'], env, () => {
			throw new Error('connected with an input missing');
		});

		expect(result).toMatchObject({ ok: false, status: 1 });
		expect(result.ok ? '' : result.message).toContain(named);
	});
});

describe('setupWebhook for Chariot', () => {
	const CHARIOT_HERE = `${ORIGIN}${CHARIOT_WEBHOOK_PATH}`;
	const CHARIOT_ENV = { CHARIOT_API_KEY: 'notarealchariotkey', BETTER_AUTH_URL: ORIGIN };
	const MINTED = 'ab'.repeat(32);

	it('subscribes this deployment’s address and gives back the secret it signs with as the line', async () => {
		const { provider, calls } = port(holding(), {
			ok: true,
			value: { endpoint: summary('sub-new', CHARIOT_HERE), verificationValue: MINTED }
		});

		const result = await setupWebhook(['chariot'], CHARIOT_ENV, () => provider);

		expect(result).toEqual({ ok: true, line: `CHARIOT_WEBHOOK_SECRET=${MINTED}`, notices: [] });
		expect(calls.at(-1)).toBe(`register ${CHARIOT_HERE}`);
	});

	/**
	 * a re-run on a deployment that already has a subscription. Chariot hands the signing secret back
	 * on no call, so the only line worth printing is a fresh subscription's — and the operator is told
	 * the old one stopped working.
	 */
	it('replaces the subscription already at this address and says the old secret stopped working', async () => {
		const { provider, calls } = port(holding(summary('sub-old', CHARIOT_HERE)), {
			ok: true,
			value: { endpoint: summary('sub-new', CHARIOT_HERE), verificationValue: MINTED }
		});

		const result = await setupWebhook(['chariot'], CHARIOT_ENV, () => provider);

		expect(result).toMatchObject({ ok: true, line: `CHARIOT_WEBHOOK_SECRET=${MINTED}` });
		expect(calls.at(-1)).toBe(`replace sub-old ${CHARIOT_HERE}`);
		const notices = result.ok ? result.notices.join('\n') : '';
		expect(notices).toMatch(/CHARIOT_WEBHOOK_SECRET stopped working/);
	});

	it.each([
		['the API key', { BETTER_AUTH_URL: ORIGIN }, 'CHARIOT_API_KEY'],
		['the public address', { CHARIOT_API_KEY: 'notarealchariotkey' }, 'BETTER_AUTH_URL']
	])('refuses without %s, naming it, and asks Chariot nothing', async (_, env, named) => {
		const result = await setupWebhook(['chariot'], env, () => {
			throw new Error('connected with an input missing');
		});

		expect(result).toMatchObject({ ok: false, status: 1 });
		expect(result.ok ? '' : result.message).toContain(named);
	});
});
