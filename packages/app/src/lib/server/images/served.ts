import type { BytesPort } from './bytes';

// one image's bytes as the answer to a view, kept at the edge so a photo is read from D1 once per
// data centre rather than once per view.
//
// the bytes sit in the database the books do, and D1 runs one query at a time (CLAUDE.md →
// storage): a campaign shared widely is every new visitor's browser pulling its hero and photos,
// each up to `IMAGE_BYTES_MAX` in ../db/schema.ts, on the primary the gift writes land on. the
// `cache-control` sent below does not stop that by itself: a Worker runs in front of Cloudflare's
// cache, and this deployment turns on no cache of Worker responses (packages/app/wrangler.jsonc has
// no `cache` block), so without this every view is a read.
//
// **this is not the balance cache CLAUDE.md bans**, and it is the carve-out the served form config
// set: what is kept is what may be drawn, never a figure the books sum. and nothing under an id goes
// stale — the bytes never change (./bytes.ts) and a replaced photo is a new id — so an entry is kept
// as long as the response says, a year, with no window to weigh. nothing deletes an image; a path
// that does leaves its bytes served from here until the entry ages out.
//
// kept under an address no route serves, for the reason ../forms/rail-cache.ts's `CACHE_PATH`
// states: `caches.default` is the zone's store keyed by URL. keying on the id alone also means a
// query string on a view cannot mint a second entry, or a second read, for the same bytes.
//
// the store is per data centre and is not tiered (developers.cloudflare.com/workers/runtime-apis/
// cache/), so a photo is read once in each place it is viewed from, not once in all. a miss is
// answered at once and put behind the answer with `waitUntil`, so the viewer never waits on the
// write; a burst that misses together reads together.

/** where a view is answered: the origin it arrived on, and the image's id. */
export interface ImageAddress {
	/** the origin the request arrived on, so the entry sits in the zone that asked for it. */
	readonly origin: string;
	readonly id: string;
}

/** what a caller may do around a view beyond answering it. */
export interface ServeOptions {
	/**
	 * asked on a miss only, once, before the bytes are read: a `Response` is the answer, with nothing
	 * read and nothing kept, and `null` lets the read go ahead. the place to charge a meter that
	 * protects D1, since a hit never reaches D1 and never reaches this.
	 */
	readonly beforeRead?: () => Promise<Response | null>;
}

const CACHE_PATH = '/__image/';

/**
 * the answer to a view of image `id`: its bytes under their stored type, or a bodiless 404 when no
 * image has that id, or on a miss whatever `options.beforeRead` answered instead. a 404 is never
 * kept, so an id is served the moment its image exists.
 */
export async function servedImage(
	port: BytesPort,
	ctx: Pick<ExecutionContext, 'waitUntil'>,
	address: ImageAddress,
	options: ServeOptions = {}
): Promise<Response> {
	// the app is checked against the DOM lib, whose `CacheStorage` has no `default`; workerd's has.
	const cache = (caches as CacheStorage & { readonly default: Cache }).default;
	const key = new Request(new URL(CACHE_PATH + encodeURIComponent(address.id), address.origin));

	const kept = await cache.match(key);
	if (kept !== undefined) return kept;

	const instead = await options.beforeRead?.();
	if (instead) return instead;

	const stored = await port.get(address.id);
	if (stored === null) return new Response(null, { status: 404 });

	// copied because a body must be ArrayBuffer-backed and the port promises only `Uint8Array`.
	const response = new Response(new Uint8Array(stored.bytes), {
		headers: {
			'content-type': stored.contentType,
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-disposition': 'inline'
		}
	});
	ctx.waitUntil(cache.put(key, response.clone()));
	return response;
}
