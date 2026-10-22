import { isTimeZone } from '$lib/page/end-date';

// the browser's IANA zone, stored so the next document can render a calendar day in it.
// the page writes the cookie (`viewerZoneScript`, from `Layout` in src/root.tsx). the
// document being drawn is already rendered, so `viewerZone` only reads the cookie the
// previous one set: the server does not `Set-Cookie` the zone. a missing cookie, a value
// `decodeURIComponent` cannot read, or a name `isTimeZone` in $lib/page/end-date.ts refuses
// is null. the screen then omits `timeZone`, and `CalendarDay` in ./local-day.tsx serves an
// empty `<time>` rather than guessing UTC. `UTC` is a zone `isTimeZone` accepts.

/** the cookie name. `viewerZoneScript` is built from it, and `viewerZone` matches on it. */
export const VIEWER_ZONE_COOKIE = 'tz';

/** how long the browser keeps the zone it wrote, in seconds: one year. */
const VIEWER_ZONE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// not `HttpOnly` and not `Secure`: the page sets it, including on local http. a thrown `Intl`
// leaves the cookie unset, which is the empty-placeholder path.
export const viewerZoneScript = `try {
	var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (typeof zone === "string" && zone !== "") {
		document.cookie = ${JSON.stringify(`${VIEWER_ZONE_COOKIE}=`)} + encodeURIComponent(zone) + "; Path=/; SameSite=Lax; Max-Age=${VIEWER_ZONE_MAX_AGE_SECONDS}";
	}
} catch (e) {}`;

/** the validated zone from this request's `Cookie` header, or null. */
export function viewerZone(request: Request): string | null {
	// the split is `connectStateFrom` in $lib/server/accounting/connect-link.ts.
	const header = request.headers.get('cookie');
	if (header === null) return null;
	for (const element of header.split(';')) {
		const at = element.indexOf('=');
		if (at === -1) continue;
		if (element.slice(0, at).trim() !== VIEWER_ZONE_COOKIE) continue;
		const raw = element.slice(at + 1).trim();
		if (raw === '') return null;
		let value: string;
		try {
			value = decodeURIComponent(raw);
		} catch {
			return null;
		}
		return isTimeZone(value) ? value : null;
	}
	return null;
}
