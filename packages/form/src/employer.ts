// the two readings the thank-you's employer ask stands on: which gift page the quote named, and what
// the donor typed. pure, so the machine's guards, the projection and the element read one answer.

import { MAX_EMPLOYER } from './v1';

/**
 * the `:token` of a `Quote.giftUrl`, or `null` where the address is not a gift page on the web.
 *
 * the address is untrusted json that becomes an `href` on a page this card is a guest on, so only
 * an absolute `http:` or `https:` address whose path is exactly `/gift/{token}` passes — anything
 * else draws no ask and no link.
 */
export function giftToken(giftUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(giftUrl);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	const match = /^\/gift\/([^/]+)$/.exec(url.pathname);
	return match?.[1] ?? null;
}

/** what the donor typed as the endpoint takes it, or `null` for a blank box or one past the limit. */
export function employerAnswer(typed: string): string | null {
	const trimmed = typed.trim();
	return trimmed.length === 0 || trimmed.length > MAX_EMPLOYER ? null : trimmed;
}
