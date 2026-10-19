// which address a request came from, decided once by the server entry and read everywhere else.
//
// the rule: with `TRUSTED_PROXY_HEADER` unset the address is the TCP peer, and no header a caller
// sends is read. with it set, the address is that header's value — for `x-forwarded-for` its
// right-most entry, the one the fronting proxy appended — and a request arriving without it falls
// back to the peer. a proxy header is only as trustworthy as the proxy in front, so naming one is
// the operator's statement that every request passes through a proxy that sets it.
//
// the answer travels as a header of this server's own, written over whatever the caller sent under
// that name, so ../api/rate-limit.ts, ../api/turnstile.ts and better-auth's `ipAddressHeaders` all
// read one value without the peer address having to be threaded down to them.

/** the header the entry stamps the decided address under. never trusted from a caller. */
export const CLIENT_IP_HEADER = 'x-better-giving-client-ip';

/**
 * writes the decided address onto `request`, or removes the header where there is none.
 *
 * `peer` is the TCP peer address, `null` where the socket reported none. `trustedHeader` is
 * `TRUSTED_PROXY_HEADER` as configured, unset or blank meaning none.
 */
export function stampClientIp(
	request: Request,
	peer: string | null,
	trustedHeader: string | undefined
): void {
	const address = fromProxy(request.headers, trustedHeader) ?? peer;
	if (address === null) request.headers.delete(CLIENT_IP_HEADER);
	else request.headers.set(CLIENT_IP_HEADER, address);
}

/** the address `stampClientIp` decided for this request, or `null` where it decided none. */
export function clientIp(request: Request): string | null {
	return request.headers.get(CLIENT_IP_HEADER);
}

function fromProxy(headers: Headers, trustedHeader: string | undefined): string | null {
	const name = trustedHeader?.trim().toLowerCase();
	if (!name) return null;
	const value = headers.get(name);
	if (value === null) return null;
	// `Headers` joins repeated fields with ", ", so the right-most entry is the last one appended
	// whichever way the proxy wrote it.
	const entry = name === 'x-forwarded-for' ? value.split(',').at(-1) : value;
	return entry?.trim() || null;
}
