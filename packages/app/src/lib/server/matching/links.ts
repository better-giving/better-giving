import { publishedOrigin, readAuthEnv, readPin } from '../auth/env';

// where a gift page's address is built: the quote's `giftUrl`, the receipt's match note, the pack
// and the reminder all name `{origin}/gift/{token}` through here, so the four agree.

/** the gift page's absolute address. */
export function giftPageUrl(origin: string, token: string): string {
	return `${origin}/gift/${token}`;
}

/**
 * the origin a gift page is linked on: the one `BETTER_AUTH_URL` pins, else the host the request
 * arrived on, each published as `publishedOrigin` in ../auth/env.ts publishes one. a run with no
 * request — the scheduler's — has only the pin, and `null` where none is pinned: such a run cannot
 * name the page, and the caller sends nothing that would need it.
 */
export function giftLinkOrigin(env: unknown, requestUrl: URL | null): string | null {
	const pin = readPin(readAuthEnv(env));
	if (requestUrl !== null) return publishedOrigin(requestUrl, pin);
	return pin.ok && pin.origin !== null ? publishedOrigin(new URL(pin.origin), pin) : null;
}
