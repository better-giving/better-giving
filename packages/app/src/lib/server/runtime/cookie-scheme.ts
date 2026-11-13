// whether a cookie this app writes may claim `Secure`: the scheme of the origin `BETTER_AUTH_URL`
// pins, stamped on each request by the server entry. the scheme `request.url` carries is the
// connection's, and DEPLOY.md ends TLS at a proxy, so with `TRUSTED_PROXY_HEADER` unset
// (./forwarded-proto.ts) every request reads as `http:` and a cookie keyed on it is never `Secure`.
// with no usable pin the request's scheme decides, so `pnpm dev` over plain http keeps cookies a
// browser stores.
//
// better-auth's session cookie follows another rule (`useSecureCookies` in ../auth/index.ts):
// `Secure` on any origin but loopback. the two differ for an `http:` pin that is not loopback, and
// for no pin behind a TLS proxy with `TRUSTED_PROXY_HEADER` unset, where the staff cookie is
// `Secure` and these are not.
//
// the decision travels as a header of this server's own, written over whatever the caller sent
// under that name, for ./client-ip.ts's reason: the cookie writers are handed the request alone.

/** the header the entry stamps the pinned scheme under. never trusted from a caller. */
export const COOKIE_SCHEME_HEADER = 'x-better-giving-cookie-scheme';

/**
 * writes the scheme of `pinnedOrigin` onto `request`, or removes the header where nothing is
 * pinned. `pinnedOrigin` is `readPin`'s origin (../auth/env.ts), null where it names none.
 */
export function stampCookieScheme(request: Request, pinnedOrigin: string | null): void {
	const scheme = pinnedOrigin === null ? null : new URL(pinnedOrigin).protocol;
	if (scheme === 'https:' || scheme === 'http:') {
		request.headers.set(COOKIE_SCHEME_HEADER, scheme);
	} else {
		request.headers.delete(COOKIE_SCHEME_HEADER);
	}
}

/** whether a cookie written in answer to `request` is `Secure`. */
export function cookiesSecure(request: Request): boolean {
	const pinned = request.headers.get(COOKIE_SCHEME_HEADER);
	return (pinned ?? new URL(request.url).protocol) === 'https:';
}
