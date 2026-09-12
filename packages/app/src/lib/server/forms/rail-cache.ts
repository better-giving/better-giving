import { PAYMENT_METHODS, type PaymentMethod } from '@better-giving/form/v1';
import type { Processors } from '../payments/factory';
import { readRailChargeabilities } from '../payments/rail-chargeability';
import { offeredRails } from './offered-rails';

// the rail-chargeability read, kept at the edge for a few minutes at a time.
//
// the same store, the same window and the same reasoning as ./cadence-cache.ts, whose header states
// it in full: `GET /api/v1/forms/:id/config` is what every embedded donation form boots on, from a
// donor's browser on somebody else's website, and it is public and unauthenticated. this read costs
// more than that one — `readRailChargeability` in ../payments/rail-chargeability.ts issues two calls
// rather than one — so the case for not making it per boot is the stronger of the two.
//
// what a cold boot costs, stated because it is easy to under-count: three outbound Stripe calls, the
// cadence read's one and this read's two. **there is no stampede protection and none of the three is
// deduplicated across concurrent requests** — the entry is written after an answer arrives, so a
// burst that misses together asks together. and while the account reads unreadable nothing is stored
// at all (below), so a processor outage is every request re-issuing all three for its duration
// rather than one request paying for the rest. that is the ceiling to weigh before another read
// joins them here.
//
// **this is not the balance cache CLAUDE.md bans**, and it is the same carve-out that file already
// names: what is kept here is which rails a third party's account is approved for, which is a
// capability and not money. nothing here touches the ledger or the database, and every figure in the
// books is still a `SUM` at read time.
//
// what a stale entry costs runs in both directions here, unlike the cadence one, and that is why the
// window is short. an operator who has just been approved for a rail waits it out before the rail
// appears; an account that has just lost one keeps offering it for the same few minutes, which is a
// donor meeting a failure at the last step. nothing about collecting a gift waits on this —
// `createIntent` and `createRecurringGift` on the port both name the rail they were quoted on
// (`INTENT_METHODS` in ../payments/stripe.ts) and charge against whatever the account holds at the
// moment they are called.
//
// a rail this list has stopped offering is still charged rather than refused: `parseQuoteRequest` in
// ../donations/quote-input.ts gates a submitted rail against `OFFERED_PAYMENT_METHODS` whole rather
// than against this answer, because the served config is cached and reaches pages this deployment
// cannot recall (CLAUDE.md).
//
// nothing built from a binding is a module-scope singleton (CLAUDE.md): the store is reached inside
// the call, and the processor set arrives as an argument from whichever request built it.

/**
 * how long an answer is kept, in seconds.
 *
 * five minutes, the same window ./cadence-cache.ts keeps: long enough that a form boot almost never
 * waits on the processor, short enough that an operator who has just cleared a rail's standing on
 * the processor's dashboard sits through it once rather than wondering whether it took.
 */
const TTL_SECONDS = 300;

/**
 * the address an answer is kept under, which no route serves.
 *
 * `caches.default` is the zone's own store, keyed by URL — so an entry written under a path this app
 * answers on could be handed to a visitor asking for that path. a name outside the routing tree is
 * what keeps this entry reachable only from here.
 */
const CACHE_PATH = '/__offered-rails';

/**
 * which rails a donor may be shown here, from the edge where there is an answer and from the
 * processor where there is not.
 *
 * `origin` is the origin the request arrived on, so the entry sits inside the zone that asked for
 * it. it is taken as an argument rather than invented, because a synthetic hostname is one this
 * deployment does not own.
 *
 * a chargeability that could not be read is answered and never stored. the answer on that arm is that
 * processor's rails whole (`offeredRails` in ./offered-rails.ts), so keeping it would turn a
 * processor blip into minutes of a form offering rails the account may not be approved for, with
 * nothing on either side able to clear it early.
 *
 * an empty answer *is* stored, which is where this parts company with the cadence cache: an account
 * approved for no rail is a read that succeeded, and re-asking on every form boot would be an
 * outbound call per donor for as long as the account stayed that way. what stops it reaching a
 * donation form is `publishedConfig`'s refusal in ./published-config.ts.
 *
 * never throws and never rejects: the read below turns every failing arm of the port into a state,
 * and a store with no cache in front of it — `vite dev` runs on node, which has none — reads
 * straight through.
 */
export async function cachedRails(
	processors: Processors,
	origin: string
): Promise<readonly PaymentMethod[]> {
	const cache = edgeCache();
	const key = cache === null ? null : new Request(new URL(CACHE_PATH, origin));

	if (cache !== null && key !== null) {
		const kept = await storedRails(cache, key);
		if (kept !== null) return kept;
	}

	const readings = await readRailChargeabilities(processors);
	const rails = offeredRails(readings);

	// every configured processor answered, or nothing is kept. one processor's blip widens its own
	// rails (`offeredRails` in ./offered-rails.ts), and storing that would hold the widening open
	// for the whole window with nothing on either side able to clear it early.
	const readable = Object.values(readings).every((reading) => reading.state !== 'unreadable');
	if (cache !== null && key !== null && readable) {
		await cache.put(
			key,
			new Response(JSON.stringify(rails), {
				headers: {
					'content-type': 'application/json',
					'cache-control': `max-age=${TTL_SECONDS}`
				}
			})
		);
	}

	return rails;
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
 * fails closed the way ./form-json.ts's decoders do and for the reason ./cadence-cache.ts states:
 * this store is the zone's, so what comes back under an address is whatever is there. an empty list
 * is the one difference from that reader — here it is an answer rather than a body to read past, so
 * emptiness is not what disqualifies an entry. a member outside `PAYMENT_METHODS` still does.
 */
async function storedRails(cache: Cache, key: Request): Promise<readonly PaymentMethod[] | null> {
	const hit = await cache.match(key);
	if (hit === undefined) return null;

	let decoded: unknown;
	try {
		decoded = await hit.json();
	} catch {
		return null;
	}

	if (!Array.isArray(decoded)) return null;
	const named: readonly string[] = PAYMENT_METHODS;
	const rails = decoded.filter(
		(entry): entry is PaymentMethod => typeof entry === 'string' && named.includes(entry)
	);
	return rails.length === decoded.length ? rails : null;
}
