import { publishedOrigin, readAuthEnv, readPin } from '../auth/env';

// where a gift page's address is built: the quote's `giftUrl`, the receipt's match note, the pack
// and the reminder all name `{origin}/gift/{token}` through here, so the four agree.

/**
 * the origin a gift page is linked on, and whether it is the one `BETTER_AUTH_URL` pins. only a
 * pinned origin is one a scheduled run, which has no request, can name too, so only then does
 * anything promise mail a scheduled run sends (the pack's reminder, ./pack.ts).
 */
export type GiftOrigin = { readonly origin: string; readonly pinned: boolean };

/** the gift page's absolute address. */
export function giftPageUrl(origin: GiftOrigin, token: string): string {
	return `${origin.origin}/gift/${token}`;
}

/**
 * the origin a gift page is linked on: the one `BETTER_AUTH_URL` pins, else the host the request
 * arrived on, each published as `publishedOrigin` in ../auth/env.ts publishes one. a run with no
 * request — the scheduler's — has only the pin, and `null` where none is pinned: such a run cannot
 * name the page, and the caller sends nothing that would need it.
 */
export function giftLinkOrigin(env: unknown, requestUrl: URL | null): GiftOrigin | null {
	const pin = readPin(readAuthEnv(env));
	const pinnedAt = pin.ok ? pin.origin : null;
	if (requestUrl !== null) {
		return { origin: publishedOrigin(requestUrl, pin), pinned: pinnedAt !== null };
	}
	return pinnedAt === null
		? null
		: { origin: publishedOrigin(new URL(pinnedAt), pin), pinned: true };
}
