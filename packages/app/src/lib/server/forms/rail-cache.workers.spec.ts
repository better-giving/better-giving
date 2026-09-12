import { describe, expect, it } from 'vitest';
import { STRIPE_RAILS } from '@better-giving/form/embed/rails';
import type {
	AccountChargeability,
	RailCapabilityState,
	PaymentProvider,
	PaymentResult,
	RailSwitchboard
} from '../payments/provider';
import { soleProcessor } from '../payments/processors.testing';
import { cachedRails } from './rail-cache';

// the edge cache in front of the rail-chargeability read, against workerd's own `caches`.
//
// a workers spec though it touches no database, which is the one exception to the split CONTRIBUTING
// draws: the thing under test is the platform's cache, node has none, and a hand-rolled stand-in
// would only prove the stand-in — the same reason nothing here stands in for D1 (CLAUDE.md).
//
// every case reads and writes under an origin of its own, because the entries live in one store for
// the whole run: a shared address would make each case depend on which ran first.

/**
 * a port that answers the two chargeability arms from a script and counts how often it was asked.
 *
 * the count is the whole assertion in most of these cases — a cache that serves is a port that was
 * not called. both arms are counted as one read because `readRailChargeability` in
 * ../payments/rail-chargeability.ts issues them together and one answer needs both.
 */
function countingPort(
	account: PaymentResult<AccountChargeability>,
	switchboard: PaymentResult<RailSwitchboard>
): { provider: PaymentProvider; reads: () => number } {
	let reads = 0;
	const unused = (name: string) => () => {
		throw new Error(`${name} is not part of reading which rails may be charged`);
	};
	return {
		reads: () => reads,
		provider: {
			processor: 'stripe',
			async readAccountChargeability() {
				reads += 1;
				return account;
			},
			async readRailSwitchboard() {
				return switchboard;
			},
			readRecurringGiftProvision: unused('readRecurringGiftProvision'),
			prepareRecurringGifts: unused('prepareRecurringGifts'),
			createRecurringGift: unused('createRecurringGift'),
			cancelRecurringGift: unused('cancelRecurringGift'),
			createIntent: unused('createIntent'),
			verifyEvent: unused('verifyEvent'),
			readSettlement: unused('readSettlement'),
			readRecurringGift: unused('readRecurringGift'),
			listWebhookEndpoints: unused('listWebhookEndpoints'),
			registerWebhookEndpoint: unused('registerWebhookEndpoint'),
			resubscribeWebhookEndpoint: unused('resubscribeWebhookEndpoint'),
			replaceWebhookEndpoint: unused('replaceWebhookEndpoint'),
			listWalletDomains: unused('listWalletDomains'),
			registerWalletDomain: unused('registerWalletDomain')
		}
	};
}

/** an account approved for the capabilities named, and able to charge. */
const account = (
	cardPayments: RailCapabilityState,
	achPayments: RailCapabilityState
): PaymentResult<AccountChargeability> => ({
	ok: true,
	value: {
		chargesEnabled: true,
		// the wallets take the card capability, which is the mapping the adapter makes
		// (`RAIL_CAPABILITIES` in $lib/server/payments/stripe.ts).
		rails: {
			card: cardPayments,
			ach: achPayments,
			apple_pay: cardPayments,
			google_pay: cardPayments
		}
	}
});

/** every rail switched on and offered, or only the ones named. */
const switches = (offered: readonly string[]): PaymentResult<RailSwitchboard> => ({
	ok: true,
	value: {
		card: { offered: offered.includes('card'), switchedOn: true },
		ach: { offered: offered.includes('ach'), switchedOn: true },
		apple_pay: { offered: false, switchedOn: false },
		google_pay: { offered: false, switchedOn: false }
	}
});

/**
 * the zone's own store, reached the way ./rail-cache.ts reaches it.
 *
 * a cast because the ambient `CacheStorage` this project compiles against has no name for
 * `default`, which is workerd's own.
 */
const edge = (globalThis as unknown as { caches: { default: Cache } }).caches.default;

const REFUSAL = {
	ok: false,
	reason: 'not_configured',
	detail: 'This deployment cannot take a payment: `STRIPE_SECRET_KEY` is not set.'
} as const;

describe('cachedRails', () => {
	it('reads the account the first time and serves the second from the cache', async () => {
		const { provider, reads } = countingPort(
			account('active', 'active'),
			switches(['card', 'ach'])
		);
		const origin = 'https://rails-first-then-cached.example';

		expect(await cachedRails(soleProcessor(provider), origin)).toEqual(['card', 'ach']);
		expect(await cachedRails(soleProcessor(provider), origin)).toEqual(['card', 'ach']);
		expect(reads()).toBe(1);
	});

	it('keeps a narrowed answer, so a rail switched off stays off for the whole window', async () => {
		const { provider, reads } = countingPort(account('active', 'active'), switches(['card']));
		const origin = 'https://rails-narrowed-is-cached.example';

		expect(await cachedRails(soleProcessor(provider), origin)).toEqual(['card']);
		expect(await cachedRails(soleProcessor(provider), origin)).toEqual(['card']);
		expect(reads()).toBe(1);
	});

	/**
	 * a read that could not be made is answered and never stored.
	 *
	 * the answer on that arm is that processor's own rails whole (`offeredRails` in
	 * ./offered-rails.ts), which is the wide direction — so storing it would turn a processor blip
	 * into minutes of a form offering a rail the account may not be approved for, with nothing on
	 * either side able to clear it early.
	 *
	 * that processor's rails and not `OFFERED_PAYMENT_METHODS` whole: the widening is per processor,
	 * so a blip on the one account this deployment holds cannot put another processor's rails on the
	 * form.
	 */
	it('does not store a chargeability it could not read', async () => {
		const { provider, reads } = countingPort(REFUSAL, switches(['card', 'ach']));
		const origin = 'https://rails-unreadable-not-stored.example';

		const widened = [...STRIPE_RAILS];
		expect(await cachedRails(soleProcessor(provider), origin)).toEqual(widened);
		expect(await cachedRails(soleProcessor(provider), origin)).toEqual(widened);
		expect(reads()).toBe(2);
	});

	/**
	 * an entry nothing here wrote is read past rather than served.
	 *
	 * `caches.default` is the zone's own store, so what comes back under this address is whatever is
	 * there — and a body that is not a list of rails must not reach a donation form's config.
	 */
	it('ignores a stored body that is not a list of rails', async () => {
		const origin = 'https://rails-garbled-entry.example';
		await edge.put(
			new Request(new URL('/__offered-rails', origin)),
			new Response('not json at all', { headers: { 'cache-control': 'max-age=300' } })
		);

		const { provider, reads } = countingPort(account('active', 'active'), switches(['card']));
		expect(await cachedRails(soleProcessor(provider), origin)).toEqual(['card']);
		expect(reads()).toBe(1);
	});

	/**
	 * an empty stored list is served, unlike the cadence cache's.
	 *
	 * the difference is that an account approved for no rail is a real answer here — `offeredRails`
	 * in ./offered-rails.ts has no floor to fall back to — so reading past it would ask the processor
	 * again on every form boot for as long as the account stayed that way. what stops it reaching a
	 * donation form is `publishedConfig`'s refusal in ./published-config.ts, which names the fix.
	 */
	it('serves a stored empty list rather than asking the processor again', async () => {
		const origin = 'https://rails-empty-entry.example';
		await edge.put(
			new Request(new URL('/__offered-rails', origin)),
			new Response('[]', { headers: { 'cache-control': 'max-age=300' } })
		);

		const { provider, reads } = countingPort(account('active', 'active'), switches(['card']));
		expect(await cachedRails(soleProcessor(provider), origin)).toEqual([]);
		expect(reads()).toBe(0);
	});

	/**
	 * two deployments never read each other's answer.
	 *
	 * the key is built from the origin the request arrived on, so the entry sits inside the zone
	 * asking for it.
	 */
	it('keys the entry by the origin it was read for', async () => {
		const both = countingPort(account('active', 'active'), switches(['card', 'ach']));
		const cards = countingPort(account('active', 'inactive'), switches(['card']));

		expect(await cachedRails(soleProcessor(both.provider), 'https://rails-one.example')).toEqual([
			'card',
			'ach'
		]);
		expect(await cachedRails(soleProcessor(cards.provider), 'https://rails-two.example')).toEqual([
			'card'
		]);
		expect(cards.reads()).toBe(1);
	});
});
