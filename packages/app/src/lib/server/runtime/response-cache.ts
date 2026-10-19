// the process's response cache: what ../forms/rail-cache.ts, ../forms/cadence-cache.ts,
// ../forms/coin-cache.ts, ../images/served.ts and the served form config keep between requests.
//
// **what goes in is a capability or immutable bytes, never a total** (AGENTS.md → Storage,
// ../pages/goal.ts): a rail an account may offer, a photo's bytes under an id that never changes.
// every figure the books sum is read at request time.
//
// the shape is the part of the Cache API those callers spend — `match`, `put`, `delete`, keyed by
// URL — and an entry lives as long as its `cache-control` says: `s-maxage`, else `max-age`. a
// response that names neither, or says `no-store` or `private`, is not kept.
//
// bounded in bytes, counting bodies: past the bound the entry read longest ago goes first, and a
// body larger than the bound is never kept. one process (AGENTS.md → Storage), so one store is every
// reader's.

/** what the callers key on: a URL, or a request whose URL it is. */
type Key = Request | string;

/** the cache-shaped surface every caller reads. */
export interface ResponseCache {
	match(key: Key): Promise<Response | undefined>;
	put(key: Key, response: Response): Promise<void>;
	delete(key: Key): Promise<boolean>;
	/** the body bytes held now. */
	bytes(): number;
}

interface Entry {
	readonly body: Uint8Array<ArrayBuffer>;
	readonly status: number;
	readonly headers: [string, string][];
	readonly expires: number;
}

/**
 * the bound the process's cache runs at: 32 MiB, which holds a few hundred cached config answers
 * beside a working set of photos, each at most `IMAGE_BYTES_MAX` in ../db/schema.ts.
 */
export const RESPONSE_CACHE_MAX_BYTES = 32 * 1024 * 1024;

export function createResponseCache(options: {
	readonly maxBytes: number;
	readonly now?: () => number;
}): ResponseCache {
	const { maxBytes, now = Date.now } = options;
	// a `Map` iterates in insertion order, and a read re-inserts, so the first key is the coldest.
	const entries = new Map<string, Entry>();
	let held = 0;

	function drop(url: string): boolean {
		const entry = entries.get(url);
		if (entry === undefined) return false;
		entries.delete(url);
		held -= entry.body.byteLength;
		return true;
	}

	return {
		async match(key) {
			const url = urlOf(key);
			const entry = entries.get(url);
			if (entry === undefined) return undefined;
			if (now() >= entry.expires) {
				drop(url);
				return undefined;
			}
			entries.delete(url);
			entries.set(url, entry);
			return new Response(entry.body.slice(), { status: entry.status, headers: entry.headers });
		},

		async put(key, response) {
			const url = urlOf(key);
			const lifetime = lifetimeSeconds(response.headers.get('cache-control'));
			const body = new Uint8Array(await response.arrayBuffer());
			if (lifetime === null || body.byteLength > maxBytes) return;

			drop(url);
			for (const coldest of entries.keys()) {
				if (held + body.byteLength <= maxBytes) break;
				drop(coldest);
			}
			entries.set(url, {
				body,
				status: response.status,
				headers: [...response.headers],
				expires: now() + lifetime * 1000
			});
			held += body.byteLength;
		},

		async delete(key) {
			return drop(urlOf(key));
		},

		bytes: () => held
	};
}

function urlOf(key: Key): string {
	return typeof key === 'string' ? key : key.url;
}

/** how long `cache-control` lets a response be kept, in seconds, or `null` where it may not be. */
function lifetimeSeconds(cacheControl: string | null): number | null {
	if (cacheControl === null) return null;
	const directives = new Map(
		cacheControl.split(',').map((part) => {
			const [name = '', value] = part.trim().toLowerCase().split('=');
			return [name, value] as const;
		})
	);
	if (directives.has('no-store') || directives.has('private')) return null;
	const seconds = Number(directives.get('s-maxage') ?? directives.get('max-age'));
	return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}

/** the process's one cache, the store every caller the header names reads and writes. */
export const responseCache: ResponseCache = createResponseCache({
	maxBytes: RESPONSE_CACHE_MAX_BYTES
});
