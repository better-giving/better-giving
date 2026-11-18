// the operator shell's rail preference, as a cookie: the copy of the choice the server can read, so
// the dashboard's first paint already draws the rail the way the reader left it
// (./components/shell/Shell.jsx). the app reads it in its `/admin` layout loader with `parseRail`
// and hands the result to `Shell` as `initialCollapsed`; `Shell` writes it with `railCookie`.

export const RAIL_COOKIE = 'bg_operator_rail';

const COLLAPSED = 'collapsed';
const EXPANDED = 'expanded';

/* a year, in seconds. */
const MAX_AGE = 60 * 60 * 24 * 365;

/** whether a request's `Cookie` header holds the rail collapsed. absent, or any other value, open. */
export function parseRail(cookieHeader: string | null): boolean {
	if (cookieHeader === null) return false;
	for (const pair of cookieHeader.split(';')) {
		const at = pair.indexOf('=');
		if (at === -1 || pair.slice(0, at).trim() !== RAIL_COOKIE) continue;
		return pair.slice(at + 1).trim() === COLLAPSED;
	}
	return false;
}

/**
 * the `document.cookie` string that keeps `collapsed`. its path is `/`, not `/admin`: a navigation's
 * data request (`/admin.data`) is outside `/admin`, and a cookie scoped there never reaches its
 * loader. not `Secure`, so a dashboard served over plain http in development keeps it too.
 */
export function railCookie(collapsed: boolean): string {
	return `${RAIL_COOKIE}=${collapsed ? COLLAPSED : EXPANDED}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`;
}
