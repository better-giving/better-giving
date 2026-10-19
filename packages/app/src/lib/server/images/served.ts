import type { Deferred } from '../runtime/deferred';
import { responseCache } from '../runtime/response-cache';
import type { BytesPort } from './bytes';

// one image's bytes as the answer to a view, kept in the process's cache so a photo is read from
// the database once rather than once per view.
//
// the bytes sit in the database the books do (CLAUDE.md → Bans → Storage), and the database runs
// one statement at a time: a campaign shared widely is every new visitor's browser pulling its hero
// and photos, each up to `IMAGE_BYTES_MAX` in ../db/schema.ts, on the connection the gift writes
// land on. the `cache-control` sent below reaches only the browser, so without this every new
// viewer is a read.
//
// **this is not the balance cache CLAUDE.md bans**, and it is the carve-out the served form config
// set: what is kept is what may be drawn, never a figure the books sum. and nothing under an id goes
// stale — the bytes never change (./bytes.ts) and a replaced photo is a new id — so an entry is kept
// as long as the response says, a year, or until the cache's byte bound evicts it
// (../runtime/response-cache.ts). an id's bytes do not outlive their image here, though: ./free.ts
// deletes an image no row names any longer, which is what replacing or removing the organisation's
// logo does (../org/queries.ts) and what an editor's write that lets a photo go does
// (`freeLetGoStatements`' callers), and a freed image's bytes go on being served from this store
// until the entry ages out or is evicted.
//
// kept under an address no route serves, for the reason ../forms/rail-cache.ts's `CACHE_PATH`
// states: the store is shared and keyed by URL. keying on the id alone also means a query string on
// a view cannot mint a second entry, or a second read, for the same bytes.
//
// a miss is answered at once and put behind the answer with `waitUntil`, so the viewer never waits
// on the write; a burst that misses together reads together.

/** where a view is answered: the origin it arrived on, and the image's id. */
export interface ImageAddress {
	/** the origin the request arrived on, so the key names an address this deployment answers on. */
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
	deferred: Deferred,
	address: ImageAddress,
	options: ServeOptions = {}
): Promise<Response> {
	const key = new Request(new URL(CACHE_PATH + encodeURIComponent(address.id), address.origin));

	const kept = await responseCache.match(key);
	if (kept !== undefined) return kept;

	const instead = await options.beforeRead?.();
	if (instead) return instead;

	const stored = await port.get(address.id);
	if (stored === null) return new Response(null, { status: 404 });

	// copied because a body must be ArrayBuffer-backed and the port promises only `Uint8Array`.
	const response = new Response(new Uint8Array(stored.bytes), {
		// a year and immutable because the bytes under an id never change. `nosniff` holds the
		// browser to the stored type, one of `IMAGE_CONTENT_TYPES` in ../db/schema.ts.
		headers: {
			'content-type': stored.contentType,
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff',
			'content-disposition': 'inline'
		}
	});
	deferred.waitUntil(responseCache.put(key, response.clone()));
	return response;
}
