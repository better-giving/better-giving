import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPaymentProviders, servedProcessors } from './factory';

afterEach(() => {
	vi.restoreAllMocks();
});

const PAYPAL_CONFIGURED = {
	PAYPAL_CLIENT_ID: 'notarealclientid',
	PAYPAL_CLIENT_SECRET: 'notarealclientsecret'
};

const CHARIOT_HELD = {
	CHARIOT_API_KEY: 'notarealchariotkey',
	CHARIOT_CONNECT_ID: 'notarealconnectid',
	CHARIOT_WEBHOOK_SECRET: 'notarealsigningsecret'
};

const NOWPAYMENTS_HELD = {
	NOWPAYMENTS_API_KEY: 'notarealnowpaymentskey',
	NOWPAYMENTS_IPN_SECRET: 'notarealipnsecret',
	NOWPAYMENTS_OUTCOME_CURRENCY: 'usdttrc20'
};

const CONFIGURED = {
	STRIPE_SECRET_KEY: 'sk_test_notarealkey',
	STRIPE_WEBHOOK_SECRET: 'whsec_notarealsecret'
};

/**
 * the one call that reaches a refusal without needing a network or a valid request.
 *
 * only for the environments this module refuses outright. a provider that builds sends this one to
 * Stripe — the adapter has nothing local to reject a well-formed transaction id with — so a case
 * that expects the adapter asks it something the adapter itself refuses instead: an amount of zero
 * minor units, or an `http://` endpoint address.
 */
function anyCall(source: unknown) {
	return createPaymentProviders(source).for('stripe').readSettlement('pi_1');
}

describe('the provider one processor resolves to', () => {
	/**
	 * a missing secret key is a refusal, never a throw at construction.
	 *
	 * the deployment it describes is a real one — a fresh fork has none of these set — and it has
	 * to be able to serve `/admin` while it is in that state. a factory that threw would take the
	 * whole app down over a deployment that is merely not configured yet.
	 *
	 * it is the only variable that refuses every arm, and the refusal names it and the command that
	 * sets it. what a deployment is short of beyond this one is not in the sentence: the console
	 * draws a box for each of the three and reports each of them, and a refusal that listed the
	 * others would be this module answering a question nobody asked it.
	 */
	it('refuses every arm with the secret key named when it is unset', async () => {
		const result = await anyCall({});

		expect(result.ok === false && result.reason).toBe('not_configured');
		const detail = result.ok === false ? result.detail : '';
		expect(detail).toContain('STRIPE_SECRET_KEY');
		expect(detail).toContain('better-giving start');
		expect(detail).toContain('Donation processor');
	});

	/**
	 * the signing secret is refused at the one arm that reads it, and nowhere else.
	 *
	 * it is sent on no call to Stripe — its whole job is checking that an inbound delivery came from
	 * Stripe — so this is the arm that cannot be answered without it, and the sentence has to name it
	 * and the command that sets it. the delivery's body is not read either way: a delivery nothing
	 * can verify is anyone's delivery, and this refusal is reached before the signature header is
	 * even looked at.
	 *
	 * `not_configured` is also what holds the delivery open. it is a retryable reason
	 * (`RETRYABLE_FAILURE_REASONS` in ./provider.ts), so the webhook route answers 5xx and Stripe
	 * brings the delivery back across the days an operator needs to set the value — where
	 * `bad_signature` would be answered terminally and the gift behind it lost.
	 */
	it('refuses to verify a delivery with the signing secret named when it is unset', async () => {
		const result = await createPaymentProviders({
			STRIPE_SECRET_KEY: 'sk_test_notarealkey'
		})
			.for('stripe')
			.verifyEvent({
				body: '{"id":"evt_1"}',
				headers: { 'stripe-signature': 't=1,v1=notarealsignature' }
			});

		expect(result.ok === false && result.reason).toBe('not_configured');
		const detail = result.ok === false ? result.detail : '';
		expect(detail).toContain('STRIPE_WEBHOOK_SECRET');
		expect(detail).toContain('better-giving start');
	});

	/**
	 * blank is absent, and so is whitespace.
	 *
	 * a trailing newline off a paste or off a `.deploy.vars` line is the most common thing an operator
	 * does wrong, and `'   '` is literally truthy — so a presence check alone would build a client
	 * around a key that is a space and report it as configured. `readConfigEnv` is what collapses
	 * those onto "unset", and this is the assertion that this module goes through it rather than
	 * reading the bag itself.
	 */
	it.each([
		['empty', ''],
		['whitespace', '   ']
	])('treats a %s secret key as unset', async (_label, value) => {
		const result = await anyCall({ ...CONFIGURED, STRIPE_SECRET_KEY: value });

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false && result.detail).toContain('STRIPE_SECRET_KEY');
	});

	/**
	 * a value that is not a string is not a credential.
	 *
	 * the platform env carries bindings as well as secrets, and a binding is an object however
	 * `wrangler types` declares it. coerced with `String(...)`, one would become a plausible-looking
	 * key and the deployment would report itself configured — which is the one thing this must not
	 * do.
	 */
	it('treats a non-string secret key as unset', async () => {
		const result = await anyCall({ ...CONFIGURED, STRIPE_SECRET_KEY: { binding: true } });

		expect(result.ok === false && result.reason).toBe('not_configured');
	});

	/**
	 * a configured deployment gets the adapter, not a refusal.
	 *
	 * asserted through a request the adapter rejects on its own — a fee of zero minor units — so
	 * that the answer distinguishes the two providers without a network call. a refusing provider
	 * would say `not_configured` to this; only the adapter reaches its own validation.
	 */
	it('builds the adapter when both variables are set', async () => {
		const result = await createPaymentProviders(CONFIGURED).for('stripe').createIntent({
			amountMinor: 0,
			currency: 'USD',
			method: 'card',
			idempotencyKey: 'attempt-1',
			deploymentOrigin: 'https://donate.example.org'
		});

		expect(result.ok === false && result.reason).toBe('invalid_request');
	});

	/**
	 * a deployment holding the secret key and nothing else still gets the adapter.
	 *
	 * the state this is written for is the one an operator is in before they have ever seen a
	 * signing secret: nothing mints one but registering this deployment's own endpoint, and that
	 * call is made with the secret key. a factory that refused to build without the secret would
	 * make the button that mints it unpressable, which is the deadlock this case pins open.
	 *
	 * asserted through a request the adapter rejects on its own — an `http://` address, which Stripe
	 * does not deliver to — so the answer distinguishes the two providers without a network call. a
	 * refusing provider would say `not_configured` to this; only the adapter reaches its own
	 * validation.
	 */
	it('builds the adapter for a deployment holding no signing secret', async () => {
		const result = await createPaymentProviders({
			STRIPE_SECRET_KEY: 'sk_test_notarealkey'
		})
			.for('stripe')
			.registerWebhookEndpoint('http://localhost/api/stripe/webhook');

		expect(result.ok === false && result.reason).toBe('invalid_request');
	});

	/**
	 * a provider that cannot be built at all is still a provider.
	 *
	 * the seal covers construction as well as calling, and the argument-evaluation order is the
	 * whole reason it is worth a test: `sealed(build(source))` evaluates `build` before the seal
	 * exists, so a throw inside it goes straight to a caller — the webhook route, where an
	 * exception is a 500 and a delivery redelivered for three days. nothing in `build` throws
	 * today; what is asserted is that nothing added to it can.
	 */
	it('answers with a refusal when building throws', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const hostile = {
			get STRIPE_SECRET_KEY(): string {
				throw new TypeError('a binding that refuses to be read');
			}
		};

		const result = await anyCall(hostile);

		expect(result.ok === false && result.reason).toBe('internal_error');
		expect(spy).toHaveBeenCalled();
	});
});

describe('createPaymentProviders', () => {
	/**
	 * the four deployments, and which processors each of them can take a payment through.
	 *
	 * `configured` is the one list that answers it, and every consumer taking a union over
	 * processors takes it over this — an unconfigured processor contributing to that union is
	 * `offeredRails` in ../forms/offered-rails.ts widening one processor's rails onto a deployment
	 * that holds none of its keys.
	 */
	it.each([
		['neither', {}, []],
		['Stripe alone', CONFIGURED, ['stripe']],
		['PayPal alone', PAYPAL_CONFIGURED, ['paypal']],
		['both', { ...CONFIGURED, ...PAYPAL_CONFIGURED }, ['stripe', 'paypal']],
		['Chariot’s values alone', CHARIOT_HELD, ['chariot']],
		['NOWPayments’ values alone', NOWPAYMENTS_HELD, ['nowpayments']],
		[
			'all four',
			{ ...CONFIGURED, ...PAYPAL_CONFIGURED, ...CHARIOT_HELD, ...NOWPAYMENTS_HELD },
			['stripe', 'paypal', 'chariot', 'nowpayments']
		]
	])('names what a deployment holding %s can charge on', (_label, source, expected) => {
		expect(createPaymentProviders(source).configured).toEqual(expected);
	});

	/**
	 * a deployment short of one processor's credentials is refused in that processor's own name.
	 *
	 * the refusal an operator in this state must not get is the other processor's: their PayPal boxes
	 * are filled, so a sentence naming `STRIPE_SECRET_KEY` reads as this app having lost the values
	 * they typed. the pair is named the other way round here — the deployment holds Stripe's keys and
	 * not PayPal's — because that is the state a fresh fork reaches by filling one fold in.
	 *
	 * the arm asked is one that refuses before anything is built, so this case makes no network call
	 * on any deployment it describes.
	 */
	it('refuses a processor in its own name, naming the values it is short of', async () => {
		const result = await createPaymentProviders(CONFIGURED).for('paypal').createIntent({
			amountMinor: 1000,
			currency: 'USD',
			method: 'paypal',
			idempotencyKey: 'attempt-1',
			deploymentOrigin: 'https://donate.example.org'
		});

		expect(result.ok === false && result.reason).toBe('not_configured');
		const detail = result.ok === false ? result.detail : '';
		expect(detail).toContain('PayPal');
		expect(detail).toContain('PAYPAL_CLIENT_ID');
		expect(detail).not.toContain('STRIPE_SECRET_KEY');
	});

	/**
	 * the processor is carried on the provider, refusing or not.
	 *
	 * it is what a `payment` row is written with and what a screen reports a standing for, so a
	 * provider that did not say which processor it was would put the caller back to pairing one with
	 * a name by hand — which is the drift the whole value exists to remove.
	 */
	it.each([
		['stripe' as const, CONFIGURED],
		['paypal' as const, PAYPAL_CONFIGURED]
	])('carries %s as the processor that answered', (name, source) => {
		expect(createPaymentProviders(source).for(name).processor).toBe(name);
	});

	/**
	 * a rail selects its own processor's adapter and no caller says which.
	 *
	 * the table is `processorOf` at the port, which reads the three lists in
	 * packages/form/src/embed/rails.ts. a caller choosing by hand is a caller holding a second copy
	 * of it, and the copy is what offers a donor a rail the adapter that answers cannot mint.
	 */
	it.each([
		['card' as const, 'stripe'],
		['ach' as const, 'stripe'],
		['apple_pay' as const, 'stripe'],
		['google_pay' as const, 'stripe'],
		['paypal' as const, 'paypal'],
		['venmo' as const, 'paypal']
	])('hands %s to the processor that settles it', (rail, expected) => {
		const both = { ...CONFIGURED, ...PAYPAL_CONFIGURED };
		expect(createPaymentProviders(both).forRail(rail).processor).toBe(expected);
	});

	/**
	 * every variable a processor is listed as requiring is one it is actually refused without.
	 *
	 * the list that answers `configured` and the narrowing each adapter does are two statements of
	 * one requirement, and nothing but this holds them together: a variable dropped from the
	 * narrowing leaves a deployment reported as configured whose first call fails at the processor,
	 * and one dropped from the list leaves an adapter that builds and a `configured` that says it
	 * cannot.
	 */
	it.each([['STRIPE_SECRET_KEY']])(
		'refuses Stripe as unconfigured without %s',
		async (variable) => {
			const short: Record<string, string> = { ...CONFIGURED };
			delete short[variable];

			const result = await createPaymentProviders(short).for('stripe').readAccountChargeability();

			expect(result.ok === false && result.reason).toBe('not_configured');
			expect(result.ok === false && result.detail).toContain(variable);
			expect(createPaymentProviders(short).configured).toEqual([]);
		}
	);
});

/**
 * the sentence a deployment that can serve no form is handed, beside the one naming what is unset.
 *
 * the message says which values are short and this says where they come from, so it is the half
 * that can send an operator to the wrong dashboard — and every deployment it is read on holds no
 * usable processor at all, which is the only arm `publishedConfig` in ../forms/published-config.ts
 * reads it on.
 */
describe('PayPal', () => {
	/** a token and a created order the adapter is answered with, recording where each was sent. */
	function orderAddress(): string[] {
		const urls: string[] = [];
		vi.stubGlobal('fetch', async (input: Request | string | URL) => {
			const url = input instanceof Request ? input.url : String(input);
			urls.push(url);
			if (url.endsWith('/v1/oauth2/token')) {
				return Response.json({
					access_token: 'A21AA-token',
					token_type: 'Bearer',
					expires_in: 32400
				});
			}
			return Response.json({ id: '5O190127TN364715T', status: 'CREATED' }, { status: 201 });
		});
		return urls;
	}

	const ORDER = {
		amountMinor: 1000,
		currency: 'USD',
		method: 'paypal',
		idempotencyKey: 'attempt-1',
		deploymentOrigin: 'https://donate.example.org'
	} as const;

	it('calls PayPal’s own address where none is set', async () => {
		const urls = orderAddress();

		await createPaymentProviders(PAYPAL_CONFIGURED).for('paypal').createIntent(ORDER);

		expect(urls).toEqual([
			'https://api-m.paypal.com/v1/oauth2/token',
			'https://api-m.paypal.com/v2/checkout/orders'
		]);
	});

	it('mints its token and places its order at the address the deployment holds', async () => {
		const urls = orderAddress();

		await createPaymentProviders({
			...PAYPAL_CONFIGURED,
			PAYPAL_API_URL: 'https://paypal-api.example.test'
		})
			.for('paypal')
			.createIntent(ORDER);

		expect(urls).toEqual([
			'https://paypal-api.example.test/v1/oauth2/token',
			'https://paypal-api.example.test/v2/checkout/orders'
		]);
	});

	it('takes an address typed with a trailing slash as its origin', async () => {
		const urls = orderAddress();

		await createPaymentProviders({
			...PAYPAL_CONFIGURED,
			PAYPAL_API_URL: 'https://paypal-api.example.test/'
		})
			.for('paypal')
			.createIntent(ORDER);

		expect(urls).toEqual([
			'https://paypal-api.example.test/v1/oauth2/token',
			'https://paypal-api.example.test/v2/checkout/orders'
		]);
	});

	it.each([
		['a path after the host', 'https://paypal-api.example.test/v1'],
		['plain http', 'http://paypal-api.example.test'],
		['no address at all', 'paypal-api.example.test']
	])('reads an address with %s as PayPal not configured, naming it', async (_, address) => {
		const urls = orderAddress();
		const processors = createPaymentProviders({ ...PAYPAL_CONFIGURED, PAYPAL_API_URL: address });

		const result = await processors.for('paypal').createIntent(ORDER);

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false ? result.detail : '').toContain('PAYPAL_API_URL');
		expect(processors.configured).toEqual([]);
		expect(urls).toEqual([]);
	});

	it('serves no form on an address it cannot call, and names the address as what is short', () => {
		const served = servedProcessors({
			...PAYPAL_CONFIGURED,
			PAYPAL_API_URL: 'https://paypal-api.example.test/v1'
		});

		expect(served.serves).toBe(false);
		expect(served.providers).toEqual([]);
		expect(served.shortfall).toContain('`PAYPAL_API_URL`');
	});
});

describe('Chariot', () => {
	/** a Create Grant the adapter answers, recording the address it was sent to. */
	function grantAddress(): string[] {
		const urls: string[] = [];
		vi.stubGlobal('fetch', async (input: Request | string | URL) => {
			urls.push(input instanceof Request ? input.url : String(input));
			return Response.json({ id: 'grant-1' }, { status: 201 });
		});
		return urls;
	}

	const GRANT = {
		amountMinor: 5000,
		currency: 'USD',
		method: 'daf',
		idempotencyKey: 'attempt-1',
		deploymentOrigin: 'https://donate.example.org',
		authorizedSessionId: 'session-1'
	} as const;

	it('hands the DAF rail to Chariot’s adapter, on the live address where none is set', async () => {
		const urls = grantAddress();

		const result = await createPaymentProviders(CHARIOT_HELD).forRail('daf').createIntent(GRANT);

		expect(result.ok && result.value.providerTxnId).toBe('grant-1');
		expect(urls).toEqual(['https://api.givechariot.com/v1/grants']);
	});

	it('calls the address the deployment holds', async () => {
		const urls = grantAddress();

		await createPaymentProviders({
			...CHARIOT_HELD,
			CHARIOT_API_URL: 'https://sandboxapi.givechariot.com'
		})
			.for('chariot')
			.createIntent(GRANT);

		expect(urls).toEqual(['https://sandboxapi.givechariot.com/v1/grants']);
	});

	it('refuses Chariot as unconfigured without its key, naming it', async () => {
		const { CHARIOT_API_KEY: _, ...short } = CHARIOT_HELD;

		const result = await createPaymentProviders(short).for('chariot').createIntent(GRANT);

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false ? result.detail : '').toContain('CHARIOT_API_KEY');
		expect(createPaymentProviders(short).configured).toEqual([]);
	});

	// the signing secret is read by the one arm that verifies, as Stripe's and PayPal's are.
	it('refuses to verify a delivery with the signing secret named when it is unset', async () => {
		const { CHARIOT_WEBHOOK_SECRET: _, ...unsigned } = CHARIOT_HELD;

		const result = await createPaymentProviders(unsigned)
			.for('chariot')
			.verifyEvent({
				body: '{}',
				headers: { 'chariot-webhook-signature': 't=2024-01-19T18:48:56Z,v1=00' }
			});

		expect(result.ok === false && result.reason).toBe('not_configured');
		expect(result.ok === false ? result.detail : '').toContain('CHARIOT_WEBHOOK_SECRET');
	});

	it('serves a form on Chariot’s values, handing the browser the Connect id', () => {
		expect(servedProcessors(CHARIOT_HELD).providers).toEqual([
			{ name: 'chariot', publishableKey: 'notarealconnectid' }
		]);
	});

	it('names Chariot for a deployment part-way through Chariot’s values', () => {
		const fix = servedProcessors({ CHARIOT_API_KEY: 'notarealchariotkey' }).fix;

		expect(fix).toContain('Chariot');
		expect(fix).not.toContain('Stripe');
	});

	// the console refuses Chariot's values by command, since a key set that way holds no event
	// subscription and no signing secret; the fix sends an operator to the page that makes both.
	it('sends an operator setting Chariot up to the console, and names no command', () => {
		const fix = servedProcessors({ CHARIOT_API_KEY: 'notarealchariotkey' }).fix;

		expect(fix).toContain('better-giving start');
		expect(fix).not.toContain('pnpm run deploy --var');
	});
});

describe('servedProcessors — the fix', () => {
	// the operator who filled one of PayPal's two boxes is setting PayPal up, whatever else is
	// unset. a sentence naming Stripe's dashboard sends them somewhere they have no account.
	it('names PayPal for a deployment part-way through PayPal’s pair', () => {
		const fix = servedProcessors({ PAYPAL_CLIENT_ID: 'notarealclientid' }).fix;

		expect(fix).toContain('PayPal');
		expect(fix).toContain('PAYPAL_CLIENT_SECRET');
		expect(fix).not.toContain('Stripe');
	});

	it('names Stripe for a deployment part-way through Stripe’s pair', () => {
		const fix = servedProcessors({ STRIPE_SECRET_KEY: 'sk_test_notarealkey' }).fix;

		expect(fix).toContain('Stripe');
		expect(fix).toContain('STRIPE_PUBLISHABLE_KEY');
		expect(fix).not.toContain('PayPal');
	});

	// a fresh fork holds nothing, so there is no processor an operator has chosen and picking one
	// for them would be inventing the answer. either pair finishes the job on its own, and the
	// sentence says so.
	it('names both for a deployment that has started on neither', () => {
		const fix = servedProcessors({}).fix;

		expect(fix).toContain('Stripe');
		expect(fix).toContain('PayPal');
		expect(fix).toContain('Any one processor is enough on its own.');
	});
});

describe('NOWPayments', () => {
	/** a coin read the adapter answers, recording the address and key it was sent with. */
	function coinRead(): { url: string; key: string | null }[] {
		const calls: { url: string; key: string | null }[] = [];
		vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : new Request(String(input), init);
			calls.push({ url: request.url, key: request.headers.get('x-api-key') });
			// the payout coin is listed, or the read refuses the deployment's own configuration.
			return Response.json({ selectedCurrencies: [], currencies: [{ code: 'USDTTRC20' }] });
		});
		return calls;
	}

	it('builds the adapter on a deployment holding NOWPayments’ values', async () => {
		const calls = coinRead();

		await createPaymentProviders(NOWPAYMENTS_HELD).for('nowpayments').listPayableCoins();

		expect(calls[0]?.url).toBe('https://api.nowpayments.io/v1/merchant/coins');
		expect(calls[0]?.key).toBe('notarealnowpaymentskey');
	});

	// a minimum is only right quoted against the coin the account pays out in, and no NOWPayments
	// call reports it — so a deployment without it can price no coin at all.
	it.each([['NOWPAYMENTS_API_KEY'], ['NOWPAYMENTS_OUTCOME_CURRENCY']])(
		'refuses NOWPayments as unconfigured without %s, naming it',
		async (variable) => {
			const short: Record<string, string> = { ...NOWPAYMENTS_HELD };
			delete short[variable];

			const result = await createPaymentProviders(short).for('nowpayments').listPayableCoins();

			expect(result.ok === false && result.reason).toBe('not_configured');
			expect(result.ok === false ? result.detail : '').toContain(variable);
			expect(createPaymentProviders(short).configured).toEqual([]);
		}
	);

	// read by the IPN arm alone, as every other processor's signing value is.
	// the rails read, the coin list and the quote each take the adapter off one request's set, and
	// what the adapter keeps for the request (`accountSelection` in ./nowpayments.ts) is shared by all three.
	it('hands one request the same adapter however it is asked for', async () => {
		const calls = coinRead();
		const processors = createPaymentProviders(NOWPAYMENTS_HELD);

		await processors.for('nowpayments').listPayableCoins();
		await processors.forRail('crypto').listPayableCoins();

		expect(calls.filter((call) => call.url.endsWith('/v1/merchant/coins'))).toHaveLength(1);
	});

	it('builds the adapter for a deployment holding no IPN secret', async () => {
		const calls = coinRead();
		const { NOWPAYMENTS_IPN_SECRET: _, ...unsigned } = NOWPAYMENTS_HELD;

		const result = await createPaymentProviders(unsigned).for('nowpayments').listPayableCoins();

		expect(result.ok).toBe(true);
		expect(calls).not.toHaveLength(0);
	});

	// `Provider.publishableKey` on the wire starts a browser SDK, and NOWPayments has none to start.
	it('names no NOWPayments entry for the donor’s page', () => {
		expect(servedProcessors({ ...CONFIGURED, ...NOWPAYMENTS_HELD }).providers).toEqual([]);
		expect(
			servedProcessors({
				...CONFIGURED,
				STRIPE_PUBLISHABLE_KEY: 'pk_test_notarealkey',
				...NOWPAYMENTS_HELD
			}).providers
		).toEqual([{ name: 'stripe', publishableKey: 'pk_test_notarealkey' }]);
	});

	// no browser half is owed, so its server half alone is a deployment that can take a gift.
	it('counts a deployment holding NOWPayments’ values as one that can take a gift', () => {
		expect(servedProcessors(NOWPAYMENTS_HELD).serves).toBe(true);
		expect(servedProcessors({}).serves).toBe(false);
		expect(servedProcessors({ STRIPE_SECRET_KEY: 'sk_test_notarealkey' }).serves).toBe(false);
	});

	it('names NOWPayments for a deployment part-way through NOWPayments’ values', () => {
		const served = servedProcessors({ NOWPAYMENTS_API_KEY: 'notarealnowpaymentskey' });

		expect(served.fix).toContain('NOWPayments');
		expect(served.fix).not.toContain('Stripe');
		expect(served.shortfall).toContain('NOWPAYMENTS_OUTCOME_CURRENCY');
	});
});
