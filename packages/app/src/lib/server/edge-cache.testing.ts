import { type ResponseCache, responseCache } from './runtime/response-cache';

/**
 * the process's response cache, for the specs that assert what this app left in it or seed an
 * answer ahead of a read (./runtime/response-cache.ts).
 */
export function edgeCache(): ResponseCache {
	return responseCache;
}
