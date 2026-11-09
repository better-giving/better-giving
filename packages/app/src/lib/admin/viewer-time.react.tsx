import { createContext, type ReactNode, use, useEffect, useSyncExternalStore } from 'react';
import { formatInstant, type InstantStyle, VIEWER_ZONE_COOKIE } from './viewer-time.ts';

// the viewer's zone, read so a server render and its hydration agree: the server's snapshot is the
// zone the `admin_zone` cookie named (null before the browser has ever written one), the client's
// is the zone the browser resolves. react hydrates on the server's and re-renders on the client's,
// so the first paint is the server's text and no mismatch is reported.

const ServerZone = createContext<string | null>(null);

const YEAR_SECONDS = 60 * 60 * 24 * 365;

// the browser's zone does not change while a page is open, so there is nothing to subscribe to.
const subscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * the zone the server read from the `admin_zone` cookie, for every `LocalTime` beneath it; writes
 * the cookie when the browser's zone is another, so the next server render reads the right day.
 */
export function ViewerZoneProvider({
	serverZone,
	children
}: {
	readonly serverZone: string | null;
	readonly children: ReactNode;
}) {
	useEffect(() => {
		const zone = browserZone();
		if (zone !== serverZone) {
			// every character of an IANA name is a valid cookie octet, so the value is written as is.
			// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API the rule points at is not in every browser an operator opens /admin in, and it writes only in a secure context.
			document.cookie = `${VIEWER_ZONE_COOKIE}=${zone}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax`;
		}
	}, [serverZone]);
	return <ServerZone value={serverZone}>{children}</ServerZone>;
}

/**
 * the instant `at` (an ISO string, as it crosses a loader) in the viewer's zone. with no zone on the
 * server it renders an empty `<time>`, which the browser fills once hydrated.
 */
export function LocalTime({ at, style }: { readonly at: string; readonly style: InstantStyle }) {
	const serverZone = use(ServerZone);
	const zone = useSyncExternalStore(subscribe, browserZone, () => serverZone);
	return <time dateTime={at}>{zone === null ? null : formatInstant(at, zone, style)}</time>;
}
