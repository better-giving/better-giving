import type { PayableCoin } from '@better-giving/form/v1';
import type { Processors } from '../payments/factory';

// the coins a crypto gift may be sent in, kept at the edge for a few minutes at a time.
//
// the same store, window and argument as ./rail-cache.ts, whose header states it in full: the
// config boot is public and unauthenticated, and which coins an account takes is a capability and
// not money — the carve-out CLAUDE.md names under *Storage*. what is kept is a list of codes, names,
// networks, tickers and whether a memo is required; a coin's minimum and price cap are numbers that
// move with its price, are never read here, and are refused by name at the quote instead
// (`createIntent` in ../payments/nowpayments.ts).
//
// a cold boot's NOWPayments calls are counted in ./rail-cache.ts's header, with the same absence of
// stampede protection.
//
// a stale entry costs one direction more than the other. a coin switched on in the dashboard waits
// out the window; a coin switched off stays on the list for the same minutes, and a donor who picks
// it is refused `coin_not_accepted` at the quote, which reads the account at that moment.

/** how long an answer is kept, in seconds — ./rail-cache.ts's window. */
const TTL_SECONDS = 300;

/** the address an answer is kept under, which no route serves (`CACHE_PATH` in ./rail-cache.ts). */
const CACHE_PATH = '/__payable-coins';

/**
 * the coins a donor may pick here, from the edge where there is an answer and from NOWPayments where
 * there is not — empty on a deployment holding no NOWPayments keys, and asked of nobody there.
 *
 * a read that failed answers `null` and is never stored, so crypto is withdrawn from the served
 * rails for the blip and no longer, and a form left with no rail says NOWPayments did not answer
 * (`renderableConfig` in ./published-config.ts). an empty read that
 * succeeded *is* stored: an account with no coin enabled is an answer, and asking again per boot
 * would be two outbound calls per donor for as long as it stays that way.
 *
 * never throws: the port is sealed, and a runtime with no cache reads straight through.
 */
export async function cachedCoins(
	processors: Processors,
	origin: string
): Promise<readonly PayableCoin[] | null> {
	if (!processors.configured.includes('nowpayments')) return [];

	const cache = edgeCache();
	const key = cache === null ? null : new Request(new URL(CACHE_PATH, origin));
	if (cache !== null && key !== null) {
		const kept = await storedCoins(cache, key);
		if (kept !== null) return kept;
	}

	const read = await processors.for('nowpayments').listPayableCoins();
	if (!read.ok) return null;

	if (cache !== null && key !== null) {
		await cache.put(
			key,
			new Response(JSON.stringify(read.value), {
				headers: {
					'content-type': 'application/json',
					'cache-control': `max-age=${TTL_SECONDS}`
				}
			})
		);
	}
	return read.value;
}

/** the platform's cache, or `null` where the runtime has none (`edgeCache` in ./rail-cache.ts). */
function edgeCache(): Cache | null {
	const store = (globalThis as { caches?: { default?: Cache } }).caches;
	return store?.default ?? null;
}

/**
 * a kept answer, or `null` for anything that is not one — failing closed, since the zone's store
 * hands back whatever is under the address. one malformed entry disqualifies the whole list.
 */
async function storedCoins(cache: Cache, key: Request): Promise<readonly PayableCoin[] | null> {
	const hit = await cache.match(key);
	if (hit === undefined) return null;

	let decoded: unknown;
	try {
		decoded = await hit.json();
	} catch {
		return null;
	}
	if (!Array.isArray(decoded)) return null;
	const coins = decoded.filter(isPayableCoin);
	return coins.length === decoded.length ? coins : null;
}

function isPayableCoin(entry: unknown): entry is PayableCoin {
	if (typeof entry !== 'object' || entry === null) return false;
	const { coin, name, network, ticker, memoRequired } = entry as Record<string, unknown>;
	return (
		typeof coin === 'string' &&
		typeof name === 'string' &&
		typeof network === 'string' &&
		typeof ticker === 'string' &&
		typeof memoRequired === 'boolean'
	);
}
