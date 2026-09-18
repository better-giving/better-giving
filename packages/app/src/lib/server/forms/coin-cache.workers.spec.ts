import { describe, expect, it } from 'vitest';
import {
	refusing,
	type PayableCoin,
	type PaymentProvider,
	type PaymentResult
} from '../payments/provider';
import { edgeCache } from '../edge-cache.testing';
import { soleProcessor } from '../payments/processors.testing';
import { cachedCoins } from './coin-cache';

// the edge cache in front of the account's coin list, against workerd's own `caches`. a workers spec
// for ./rail-cache.workers.spec.ts's reason, and every case reads under an origin of its own.

const USDT: PayableCoin = {
	coin: 'usdttrc20',
	name: 'Tether USD (Tron)',
	network: 'trx',
	ticker: 'usdt',
	memoRequired: false
};

/** a NOWPayments port answering `listPayableCoins` from a script, counting how often it was asked. */
function countingPort(answer: PaymentResult<readonly PayableCoin[]>): {
	provider: PaymentProvider;
	reads: () => number;
} {
	let reads = 0;
	return {
		reads: () => reads,
		provider: {
			...refusing('nowpayments', 'internal_error', 'not part of reading the coin list'),
			async listPayableCoins() {
				reads += 1;
				return answer;
			}
		}
	};
}

const edge = edgeCache();

const coins = (value: readonly PayableCoin[]): PaymentResult<readonly PayableCoin[]> => ({
	ok: true,
	value
});

describe('cachedCoins', () => {
	it('reads the account the first time and serves the second from the cache', async () => {
		const { provider, reads } = countingPort(coins([USDT]));
		const origin = 'https://coins-first-then-cached.example';

		expect(await cachedCoins(soleProcessor(provider), origin)).toEqual([USDT]);
		expect(await cachedCoins(soleProcessor(provider), origin)).toEqual([USDT]);
		expect(reads()).toBe(1);
	});

	it('asks nobody on a deployment holding no NOWPayments keys', async () => {
		const { provider, reads } = countingPort(coins([USDT]));
		const stripeOnly = { ...soleProcessor(provider), configured: ['stripe'] as const };

		expect(await cachedCoins(stripeOnly, 'https://coins-no-keys.example')).toEqual([]);
		expect(reads()).toBe(0);
	});

	it('answers a failed read as unread and keeps nothing, so the next boot asks again', async () => {
		const { provider, reads } = countingPort({
			ok: false,
			reason: 'unreachable',
			detail: 'NOWPayments did not answer.'
		});
		const origin = 'https://coins-failed-read.example';

		expect(await cachedCoins(soleProcessor(provider), origin)).toBeNull();
		expect(await cachedCoins(soleProcessor(provider), origin)).toBeNull();
		expect(reads()).toBe(2);
	});

	it('keeps an account with no coin enabled as the answer it is', async () => {
		const { provider, reads } = countingPort(coins([]));
		const origin = 'https://coins-none-enabled.example';

		await cachedCoins(soleProcessor(provider), origin);
		expect(await cachedCoins(soleProcessor(provider), origin)).toEqual([]);
		expect(reads()).toBe(1);
	});

	it('reads the account again over a kept entry carrying no ticker', async () => {
		const { provider, reads } = countingPort(coins([USDT]));
		const origin = 'https://coins-kept-without-ticker.example';
		const { ticker: _, ...tickerless } = USDT;
		await edge.put(
			new Request(new URL('/__payable-coins', origin)),
			new Response(JSON.stringify([tickerless]), {
				headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
			})
		);

		expect(await cachedCoins(soleProcessor(provider), origin)).toEqual([USDT]);
		expect(reads()).toBe(1);
	});
});
