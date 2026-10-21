// which scheme a request is read with, decided once by the server entry, beside the client address
// (./client-ip.ts) and on the same trust: with `TRUSTED_PROXY_HEADER` unset the scheme is the
// connection's, and `x-forwarded-proto` is never read. with it set, the first `x-forwarded-proto`
// value is taken where it is `http` or `https`, and anything else leaves the connection's.
//
// the proxy in front ends TLS, so without this every request reads as `http:` and whatever builds
// an absolute address or a secure cookie from `request.url` builds the wrong one.

/** the header a TLS-ending proxy states the caller's scheme in. */
const FORWARDED_PROTO_HEADER = 'x-forwarded-proto';

/**
 * `request`, or a copy of it whose URL carries the scheme the proxy forwarded. `trustedHeader` is
 * `TRUSTED_PROXY_HEADER` as configured, unset or blank meaning none.
 */
export function withForwardedProto(request: Request, trustedHeader: string | undefined): Request {
	if (!trustedHeader?.trim()) return request;
	const forwarded = request.headers
		.get(FORWARDED_PROTO_HEADER)
		?.split(',')[0]
		?.trim()
		.toLowerCase();
	if (forwarded !== 'http' && forwarded !== 'https') return request;
	const url = new URL(request.url);
	if (url.protocol === `${forwarded}:`) return request;
	url.protocol = forwarded;
	// node's `Request` reads `duplex` off the request it copies, so a body carries over unread.
	return new Request(url, request);
}
