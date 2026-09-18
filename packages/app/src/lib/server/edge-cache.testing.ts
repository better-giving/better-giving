/**
 * workerd's zone cache, for the workers specs that assert what this app left in it.
 *
 * the cast is the whole of this file. `caches.default` is workerd's own and is on no lib type
 * the checker loads here, so a spec reaching for it directly mints a cast of its own, which
 * silences the checker for whatever else that line goes on to read.
 *
 * the store exists only on workerd, so this is a function rather than a value: a node-pool file
 * importing the module fails where it calls rather than on the import.
 */

export function edgeCache(): Cache {
	return (globalThis as unknown as { caches: { default: Cache } }).caches.default;
}
