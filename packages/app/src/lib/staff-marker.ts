// the returning-staff marker: a cookie that says "staff has signed in on this browser" and nothing
// else, so a donor page can show a way into the console to that browser and to no other.
//
// it carries no session and no identity, only the fixed value below, and it authorizes nothing:
// `/admin` is behind the session gate (./server/auth/gate.ts) whether the link is drawn or not. a
// page reads only its presence off the request's `Cookie` header, so drawing it costs a donor view
// no signing-key read, no session lookup and no database read. it is `HttpOnly` because no script
// reads it, and it is left in place on sign-out: it says the browser has been used by staff, not
// that anyone is signed in now.
//
// a pure module, not under `$lib/server/**`, because ../root.tsx reads it in its loader and the sign-in
// actions set it, and neither may drag the server tree into a client bundle (../routes.spec.ts).

/** the cookie's name, in the style of the rail's `bg_operator_rail` (@better-giving/operator). */
export const STAFF_MARKER_COOKIE = 'bg_staff_seen';

const STAFF_MARKER_VALUE = '1';

/** about a year, which is how long a browser that has signed in once is remembered. */
const STAFF_MARKER_MAX_AGE = 60 * 60 * 24 * 365;

/** whether the request carries the marker. only its presence with the fixed value counts. */
export function hasStaffMarker(headers: Headers): boolean {
	for (const pair of headers.get('cookie')?.split(';') ?? []) {
		const at = pair.indexOf('=');
		if (at === -1) continue;
		if (pair.slice(0, at).trim() !== STAFF_MARKER_COOKIE) continue;
		if (pair.slice(at + 1).trim() === STAFF_MARKER_VALUE) return true;
	}
	return false;
}

/**
 * the `Set-Cookie` value that leaves the marker. `secure` is the caller's `cookiesSecure(request)`
 * ($lib/server/runtime/cookie-scheme.ts), the decision every other cookie this app writes takes: the
 * scheme `request.url` carries is the connection's and reads `http:` behind a TLS proxy.
 */
export function staffMarkerCookie(secure: boolean): string {
	return `${STAFF_MARKER_COOKIE}=${STAFF_MARKER_VALUE}; Path=/; Max-Age=${STAFF_MARKER_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
