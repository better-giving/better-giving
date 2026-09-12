import { describe, expect, it } from 'vitest';
import type { PaymentProvider, PaymentResult, RecurringGiftStanding } from '../payments/provider';
import { soleProcessor } from '../payments/processors.testing';
import { cachedCadences } from './cadence-cache';

// the edge cache in front of the repeating-gifts read, against workerd's own `caches`.
//
// a workers spec though it touches no database, which is the one exception to the split CONTRIBUTING
// draws: the thing under test is the platform's cache, node has none, and a hand-rolled stand-in
// would only prove the stand-in — the same reason nothing here stands in for D1 (CLAUDE.md).
//
// every case reads and writes under an origin of its own, because the entries live in one store for
// the whole run: a shared address would make each case depend on which ran first.

/**
 * a port that answers the read arm from a script and counts how often it was asked.
 *
 * the count is the whole assertion in most of these cases — a cache that serves is a port that was
 * not called — and `prepareRecurringGifts` throws, which pins that no path through here provisions
 * an operator's account.
 */
function countingPort(read: PaymentResult<RecurringGiftStanding>): {
	provider: PaymentProvider;
	reads: () => number;
} {
	let reads = 0;
	const unused = (name: string) => () => {
		throw new Error(`${name} is not part of reading how often a gift may repeat`);
	};
	return {
		reads: () => reads,
		provider: {
			processor: 'stripe',
			async readRecurringGiftProvision() {
				reads += 1;
				return read;
			},
			prepareRecurringGifts: unused('prepareRecurringGifts'),
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
		}
	};
}

/**
 * the zone's own store, reached the way ./cadence-cache.ts reaches it.
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

describe('cachedCadences', () => {
	it('reads the account the first time and serves the second from the cache', async () => {
		const { provider, reads } = countingPort({ ok: true, value: 'ready' });
		const origin = 'https://first-then-cached.example';

		expect(await cachedCadences(soleProcessor(provider), origin)).toEqual([
			'one_time',
			'monthly',
			'yearly'
		]);
		expect(await cachedCadences(soleProcessor(provider), origin)).toEqual([
			'one_time',
			'monthly',
			'yearly'
		]);
		expect(reads()).toBe(1);
	});

	it('serves one-time alone from the cache where the account holds nothing', async () => {
		const { provider, reads } = countingPort({ ok: true, value: 'absent' });
		const origin = 'https://absent-is-cached.example';

		expect(await cachedCadences(soleProcessor(provider), origin)).toEqual(['one_time']);
		expect(await cachedCadences(soleProcessor(provider), origin)).toEqual(['one_time']);
		expect(reads()).toBe(1);
	});

	/**
	 * a read that could not be made is answered and never stored.
	 *
	 * storing it would turn a processor blip into minutes of a form that has stopped offering
	 * Monthly, with nothing on either side able to clear it early. the answer is still the narrow
	 * one every time it is asked.
	 */
	it('does not store a standing it could not read', async () => {
		const { provider, reads } = countingPort(REFUSAL);
		const origin = 'https://unreadable-not-stored.example';

		expect(await cachedCadences(soleProcessor(provider), origin)).toEqual(['one_time']);
		expect(await cachedCadences(soleProcessor(provider), origin)).toEqual(['one_time']);
		expect(reads()).toBe(2);
	});

	/**
	 * an entry nothing here wrote is read past rather than served.
	 *
	 * `caches.default` is the zone's own store, so what comes back under this address is whatever is
	 * there — and a body that is not a list of cadences must not reach a donation form's config.
	 */
	it('ignores a stored body that is not a list of cadences', async () => {
		const origin = 'https://garbled-entry.example';
		const key = new Request(new URL('/__recurring-cadences', origin));
		await edge.put(
			key,
			new Response('not json at all', { headers: { 'cache-control': 'max-age=300' } })
		);

		const { provider, reads } = countingPort({ ok: true, value: 'ready' });
		expect(await cachedCadences(soleProcessor(provider), origin)).toEqual([
			'one_time',
			'monthly',
			'yearly'
		]);
		expect(reads()).toBe(1);
	});

	it('ignores a stored empty list, which is a config no donation form would render', async () => {
		const origin = 'https://empty-entry.example';
		const key = new Request(new URL('/__recurring-cadences', origin));
		await edge.put(key, new Response('[]', { headers: { 'cache-control': 'max-age=300' } }));

		const { provider, reads } = countingPort({ ok: true, value: 'ready' });
		expect(await cachedCadences(soleProcessor(provider), origin)).toEqual([
			'one_time',
			'monthly',
			'yearly'
		]);
		expect(reads()).toBe(1);
	});

	/**
	 * two deployments never read each other's answer.
	 *
	 * the key is built from the origin the request arrived on, so the entry sits inside the zone
	 * asking for it.
	 */
	it('keys the entry by the origin it was read for', async () => {
		const ready = countingPort({ ok: true, value: 'ready' });
		const absent = countingPort({ ok: true, value: 'absent' });

		expect(await cachedCadences(soleProcessor(ready.provider), 'https://one.example')).toEqual([
			'one_time',
			'monthly',
			'yearly'
		]);
		expect(await cachedCadences(soleProcessor(absent.provider), 'https://two.example')).toEqual([
			'one_time'
		]);
		expect(absent.reads()).toBe(1);
	});
});
