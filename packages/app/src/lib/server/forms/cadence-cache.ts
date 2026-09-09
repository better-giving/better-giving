import { FREQUENCIES, type Frequency } from '@better-giving/form/v1';
import type { PaymentProvider } from '../payments/provider';
import { readRecurringProvision } from '../payments/recurring-provision';
import { offeredCadences } from './offered-cadences';

// the repeating-gifts read, kept at the edge for a few minutes at a time.
//
// what it is in front of: `GET /api/v1/forms/:id/config` is what every embedded donation form boots
// on, from a donor's browser on somebody else's website, and it is public and unauthenticated.
// asking the processor on each of those is a slower boot for every donor, a processor blip that
// quietly stops offering Monthly, and an outbound call anybody on the internet can make this
// deployment issue by asking repeatedly.
//
// **this is not the balance cache CLAUDE.md bans.** that rule is about money: no running balance is
// stored and no gate reads one, because every figure in the books is a `SUM` at read time — and it
// still is, with nothing here touching the ledger or the database at all. what is kept here is what
// a third party's account holds, which no query of ours can answer and which changes only when an
// operator presses a button on the console.
//
// what a stale entry costs is bounded and one-directional: an operator who has just set up
// repeating gifts waits out the TTL before Monthly appears on their forms, once, ever. nothing
// about collecting a gift waits on this — `createRecurringGift` on the port charges against
// whatever the account holds at the moment it is called — and a cadence a donor was offered is
// re-checked against the served config by `parseQuoteRequest` in ../donations/quote-input.ts.
//
// nothing built from a binding is a module-scope singleton (CLAUDE.md): the store is reached inside
// the call, and the provider arrives as an argument from whichever request built it.

/**
 * how long an answer is kept, in seconds.
 *
 * five minutes: long enough that a form boot almost never waits on the processor, short enough that
 * an operator who has just pressed Set up recurring gifts sits through it once rather than
 * wondering whether the button worked. the one thing it delays is Monthly and Yearly appearing.
 */
const TTL_SECONDS = 300;

/**
 * the address an answer is kept under, which no route serves.
 *
 * `caches.default` is the zone's own store, keyed by URL — so an entry written under a path this app
 * answers on could be handed to a visitor asking for that path. a name outside the routing tree is
 * what keeps this entry reachable only from here.
 */
const CACHE_PATH = '/__recurring-cadences';

/**
 * how often a gift may repeat here, from the edge where there is an answer and from the processor
 * where there is not.
 *
 * `origin` is the origin the request arrived on, so the entry sits inside the zone that asked for
 * it. it is taken as an argument rather than invented, because a synthetic hostname is one this
 * deployment does not own.
 *
 * a standing that could not be read is answered and never stored: a failure kept for five minutes
 * is a blip turned into a form that has stopped offering Monthly, with nothing on either side able
 * to clear it early. every other standing is stored, including the two that offer one-time alone —
 * those are answers, and re-asking for them costs a donor the same wait as re-asking for a ready
 * one.
 *
 * never throws and never rejects: the read below turns every failing arm of the port into a state,
 * and a store with no cache in front of it — `vite dev` runs on node, which has none — reads
 * straight through.
 */
export async function cachedCadences(
	provider: PaymentProvider,
	origin: string
): Promise<readonly Frequency[]> {
	const cache = edgeCache();
	const key = cache === null ? null : new Request(new URL(CACHE_PATH, origin));

	if (cache !== null && key !== null) {
		const kept = await storedCadences(cache, key);
		if (kept !== null) return kept;
	}

	const provision = await readRecurringProvision(provider);
	const cadences = offeredCadences(provision);

	if (cache !== null && key !== null && provision.state !== 'unreadable') {
		await cache.put(
			key,
			new Response(JSON.stringify(cadences), {
				headers: {
					'content-type': 'application/json',
					'cache-control': `max-age=${TTL_SECONDS}`
				}
			})
		);
	}

	return cadences;
}

/**
 * the platform's cache, or `null` where the runtime has none.
 *
 * `vite dev` runs this app on node, which has no `caches` at all, so the absence is a state rather
 * than a fault — `pnpm run preview` is where the cache is real, and so is every deployment.
 */
function edgeCache(): Cache | null {
	const store = (globalThis as { caches?: { default?: Cache } }).caches;
	return store?.default ?? null;
}

/**
 * a kept answer, or `null` for anything that is not one.
 *
 * fails closed the way ./form-json.ts's decoders do and for a sharper reason: this store is the
 * zone's, so what comes back under an address is whatever is there. a body that is not a non-empty
 * list of `v1` cadences is read past rather than served — an empty one would reach `readFormConfig`
 * in packages/form/src/config.ts, which drops the whole config, leaving a donation form that renders
 * nothing on a site nobody here can see.
 */
async function storedCadences(cache: Cache, key: Request): Promise<readonly Frequency[] | null> {
	const hit = await cache.match(key);
	if (hit === undefined) return null;

	let decoded: unknown;
	try {
		decoded = await hit.json();
	} catch {
		return null;
	}

	if (!Array.isArray(decoded) || decoded.length === 0) return null;
	const named: readonly string[] = FREQUENCIES;
	const cadences = decoded.filter(
		(entry): entry is Frequency => typeof entry === 'string' && named.includes(entry)
	);
	return cadences.length === decoded.length ? cadences : null;
}
