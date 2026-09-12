import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	isRetryable,
	PAYMENT_FAILURE_REASONS,
	refusing,
	RETRYABLE_FAILURE_REASONS,
	sealed,
	TERMINAL_FAILURE_REASONS,
	type PaymentFailureReason,
	type PaymentProvider
} from './provider';

// `console.error` is spied on in several cases below and the spy is global state. left
// installed, one case's calls are counted by the next one's assertion, which is an
// order-dependent failure rather than a real one.
afterEach(() => {
	vi.restoreAllMocks();
});

/** the smallest valid intent request, for cases that assert something other than its contents. */
const REQUEST = {
	amountMinor: 1000,
	currency: 'USD',
	method: 'card',
	idempotencyKey: 'attempt-1'
} as const;

/** the smallest valid repeating gift, for the cases that assert something other than its contents. */
const GIFT = {
	amountMinor: 2500,
	currency: 'USD',
	interval: 'monthly',
	method: 'card',
	idempotencyKey: 'gift-1'
} as const;

/** a verified delivery about a repeating gift, for the arms that take one. */
const NOTICE = {
	id: 'evt_1',
	kind: 'recurring',
	type: 'invoice.paid',
	providerNoticeId: 'in_1',
	occurredAt: new Date(1_770_000_000_000)
} as const;

describe('refusing', () => {
	/**
	 * a provider that cannot do anything answers every method the same way, and that is what
	 * makes the unconfigured deployment safe to hand to a caller: there is no arm of the port
	 * that quietly does something while the others refuse.
	 */
	it('answers every method with the same refusal', async () => {
		const provider = refusing('stripe', 'not_configured', 'STRIPE_SECRET_KEY is not set.');

		const results = await Promise.all([
			provider.createIntent(REQUEST),
			// the repeating arms answer identically too, which is what keeps a fork that has never
			// set Stripe up from committing a donor to a gift it has no way to collect.
			provider.prepareRecurringGifts(),
			provider.readRecurringGiftProvision(),
			provider.createRecurringGift(GIFT),
			provider.cancelRecurringGift('sub_1'),
			provider.verifyEvent({ body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } }),
			provider.readSettlement('pi_1'),
			provider.readRecurringGift(NOTICE),
			// the account reads answer identically too, and on this provider that is the whole of
			// what /admin's setup screen sees on a fresh fork: no key is set, so the button has to
			// come back with a sentence naming what to set rather than a page that failed to load.
			provider.readAccountChargeability(),
			provider.listWebhookEndpoints(),
			provider.registerWebhookEndpoint('https://example.org/api/stripe/webhook'),
			provider.resubscribeWebhookEndpoint('we_1'),
			provider.replaceWebhookEndpoint('we_1', 'https://example.org/api/stripe/webhook'),
			provider.listWalletDomains(),
			provider.registerWalletDomain('donate.example.org')
		]);

		for (const result of results) {
			expect(result).toEqual({
				ok: false,
				reason: 'not_configured',
				detail: 'STRIPE_SECRET_KEY is not set.'
			});
		}
	});
});

describe('the retryable/terminal partition', () => {
	/**
	 * every reason is on exactly one side, and that is what stops a ninth from finding a `default`.
	 *
	 * two routes read this and neither is the place to decide it: the webhook has to answer a
	 * retryable failure with a 5xx so the processor redelivers and a terminal one with a 2xx so it
	 * stops, and the two mistakes are a gift lost to one bad minute and a deterministic bug
	 * hammered for three days. a reason added to the union without a side would land in whichever
	 * branch each route happens to have written — so it fails here instead.
	 */
	it('covers every failure reason exactly once', () => {
		const partitioned = [...RETRYABLE_FAILURE_REASONS, ...TERMINAL_FAILURE_REASONS];

		expect([...partitioned].sort()).toEqual([...PAYMENT_FAILURE_REASONS].sort());
		expect(new Set(partitioned).size).toBe(partitioned.length);
	});

	/** the predicate is the only reader, so it has to agree with the arrays it reads. */
	it.each(PAYMENT_FAILURE_REASONS)('answers %s consistently with the arrays', (reason) => {
		expect(isRetryable(reason)).toBe(
			(RETRYABLE_FAILURE_REASONS as readonly PaymentFailureReason[]).includes(reason)
		);
	});

	/**
	 * the two members whose side is a judgement rather than a reading, pinned so that changing
	 * either is deliberate.
	 *
	 * `not_configured` is retryable because a redelivery window is measured in days and an
	 * operator setting the missing variable inside it turns a lost gift into a recovered one.
	 * `internal_error` is terminal because it is our own defect and answers the same way every
	 * time, so holding a delivery open against it buys nothing.
	 */
	it('treats an unconfigured deployment as worth retrying and our own bug as not', () => {
		expect(isRetryable('not_configured')).toBe(true);
		expect(isRetryable('internal_error')).toBe(false);
	});

	/**
	 * a fee the processor has not computed yet is worth asking for again, and answering it terminally
	 * is the defect this reason exists to close.
	 *
	 * read as terminal it is a 200, and a 200 is the processor told to stop — so the charge posts at
	 * face value, the fee posts never, and undeposited funds is overstated with nothing reporting it.
	 */
	it('treats a fee the processor has not computed yet as worth retrying', () => {
		expect(isRetryable('fee_not_ready')).toBe(true);
	});
});

/** a provider whose every arm throws, which is the thing the port says an adapter may not do. */
function throwing(): PaymentProvider {
	const fault = () => {
		throw new TypeError('Cannot read properties of undefined');
	};
	return {
		processor: 'stripe',
		prepareRecurringGifts: fault,
		readRecurringGiftProvision: fault,
		createRecurringGift: fault,
		cancelRecurringGift: fault,
		createIntent: fault,
		verifyEvent: fault,
		readSettlement: fault,
		readRecurringGift: fault,
		readAccountChargeability: fault,
		readRailSwitchboard: fault,
		listWebhookEndpoints: fault,
		registerWebhookEndpoint: fault,
		resubscribeWebhookEndpoint: fault,
		replaceWebhookEndpoint: fault,
		listWalletDomains: fault,
		registerWalletDomain: fault
	};
}

describe('sealed', () => {
	/**
	 * the contract is enforced rather than documented, and it is the webhook that makes that
	 * worth code. a throw out of an adapter becomes a 500, Stripe reads a 500 as "try again", and
	 * the delivery comes back for three days against a bug that will answer it the same way every
	 * time. a refusal is something the handler can classify and answer.
	 */
	it.each([
		['createIntent', (p: PaymentProvider) => p.createIntent(REQUEST)],
		['prepareRecurringGifts', (p: PaymentProvider) => p.prepareRecurringGifts()],
		['readRecurringGiftProvision', (p: PaymentProvider) => p.readRecurringGiftProvision()],
		['createRecurringGift', (p: PaymentProvider) => p.createRecurringGift(GIFT)],
		['cancelRecurringGift', (p: PaymentProvider) => p.cancelRecurringGift('sub_1')],
		['verifyEvent', (p: PaymentProvider) => p.verifyEvent({ body: '{}', headers: {} })],
		['readSettlement', (p: PaymentProvider) => p.readSettlement('pi_1')],
		['readRecurringGift', (p: PaymentProvider) => p.readRecurringGift(NOTICE)],
		['readAccountChargeability', (p: PaymentProvider) => p.readAccountChargeability()],
		['readRailSwitchboard', (p: PaymentProvider) => p.readRailSwitchboard()],
		['listWebhookEndpoints', (p: PaymentProvider) => p.listWebhookEndpoints()],
		[
			'registerWebhookEndpoint',
			(p: PaymentProvider) => p.registerWebhookEndpoint('https://example.org/api/stripe/webhook')
		],
		['resubscribeWebhookEndpoint', (p: PaymentProvider) => p.resubscribeWebhookEndpoint('we_1')],
		[
			'replaceWebhookEndpoint',
			(p: PaymentProvider) =>
				p.replaceWebhookEndpoint('we_1', 'https://example.org/api/stripe/webhook')
		],
		['listWalletDomains', (p: PaymentProvider) => p.listWalletDomains()],
		['registerWalletDomain', (p: PaymentProvider) => p.registerWalletDomain('donate.example.org')]
	])('turns a throw out of %s into a refusal', async (_name, call) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await call(sealed(throwing()));

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toBe('internal_error');
	});

	/**
	 * an escaped throw is terminal, which is the point of giving it its own reason.
	 *
	 * it is our defect rather than the processor's, so a webhook that answered it as retryable
	 * would redeliver against code that cannot succeed until somebody ships a fix.
	 */
	it('produces a reason a handler will not retry', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await sealed(throwing()).readSettlement('pi_1');

		expect(result.ok === false && isRetryable(result.reason)).toBe(false);
	});

	/**
	 * it logs, and that is not optional. a seal that swallowed the cause would turn an adapter bug
	 * into a deployment that refuses every donation and reports a tidy reason for it — the failure
	 * mode is worse than the throw. the operator gets a result; the log gets the stack.
	 */
	it('writes the thrown value to the log', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		await sealed(throwing()).readSettlement('pi_1');

		expect(logged).toHaveBeenCalledOnce();
		expect(logged.mock.calls[0]?.[1]).toBeInstanceOf(TypeError);
	});
});
