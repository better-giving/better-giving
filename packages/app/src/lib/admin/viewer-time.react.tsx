import { createContext, type ReactNode, use, useEffect, useSyncExternalStore } from 'react';
import { canWriteIn, formatInstant, type InstantStyle, VIEWER_ZONE_COOKIE } from './viewer-time.ts';

// the viewer's zone, read so a server render and its hydration agree: the server's snapshot is the
// zone the `admin_zone` cookie named (null before the browser has ever written one), the client's
// is the zone the browser resolves, and either is null where this runtime cannot write in it.
// react hydrates on the server's and re-renders on the client's, so the first paint is the
// server's text and no mismatch is reported.

const ServerZone = createContext<string | null>(null);

const YEAR_SECONDS = 60 * 60 * 24 * 365;

// the browser's zone does not change while a page is open, so there is nothing to subscribe to.
const subscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// a zone this runtime cannot write in reads as no zone, so formatInstant is never handed one it
// throws on: a server's ICU can know a name this browser's does not, and the browser's own is
// checked the same way rather than trusted. a time the server wrote in such a zone hydrates as a
// text mismatch, which react recovers from by rendering the empty time on the client.
const writable = (zone: string | null) => (zone !== null && canWriteIn(zone) ? zone : null);

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
			const secure = location.protocol === 'https:' ? '; Secure' : '';
			// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API the rule points at is not in every browser an operator opens /admin in, and it writes only in a secure context.
			document.cookie = `${VIEWER_ZONE_COOKIE}=${zone}; Path=/admin; Max-Age=${YEAR_SECONDS}; SameSite=Lax${secure}`;
		}
	}, [serverZone]);
	return <ServerZone value={serverZone}>{children}</ServerZone>;
}

/**
 * the viewer's zone, for a screen that orders or groups by day: the zone the server read on the
 * server and through hydration, then the browser's own. null where neither is one this runtime can
 * write in, which on the server is a first visit.
 */
export function useViewerZone(): string | null {
	const serverZone = use(ServerZone);
	return useSyncExternalStore(
		subscribe,
		() => writable(browserZone()),
		() => writable(serverZone)
	);
}

/**
 * the instant `at` (an ISO string, as it crosses a loader) in the viewer's zone. a missing or
 * unparseable `at` is a dash with no `dateTime`; with no zone it renders an empty `<time>`, which
 * the browser fills once hydrated.
 */
export function LocalTime({
	at,
	style
}: {
	readonly at: string | null | undefined;
	readonly style: InstantStyle;
}) {
	const zone = useViewerZone();
	if (!at || Number.isNaN(Date.parse(at))) return <time>—</time>;
	// no zone is a first visit, or one this runtime cannot write in (`writable` above): either way
	// the time stays empty rather than guessing a day or throwing from formatInstant.
	return <time dateTime={at}>{zone === null ? null : formatInstant(at, zone, style)}</time>;
}
