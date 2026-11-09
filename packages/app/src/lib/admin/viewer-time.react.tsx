import { createContext, type ReactNode, use, useEffect, useSyncExternalStore } from 'react';
import { canWriteIn, formatInstant, type InstantStyle, VIEWER_ZONE_COOKIE } from './viewer-time.ts';

// the viewer's zone, read so a server render and its hydration agree: the server's snapshot is the
// zone the `admin_zone` cookie named (null before the browser has ever written one), the client's
// is the zone the browser resolves, and either is null where this runtime cannot write in it.
// react hydrates on the server's and re-renders on the client's, so the first paint is the
// server's text. the two sides still format the one name with their own tz data, which differ for
// a zone whose rules changed recently: a time's text that differs is let stand (`LocalTime`'s
// suppressHydrationWarning) until the client's render replaces it, but a row order that differs,
// as from ./received-order.ts, is a mismatch react reports and recovers from by rendering the
// route again on the client.

const ServerZone = createContext<string | null>(null);

const YEAR_SECONDS = 60 * 60 * 24 * 365;

// the browser's zone does not change while a page is open, so there is nothing to subscribe to.
const subscribe = () => () => {};
// `timeZone` is undefined in a runtime that resolves no zone, though the dom types say string.
const browserZone = (): string | null => Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;

// a zone this runtime cannot write in reads as no zone, so formatInstant is never handed one it
// throws on: a server's ICU can know a name this browser's does not, and the browser's own is
// checked the same way rather than trusted. hydration keeps the text the server wrote, unreported;
// where the browser's zone is such a one, the client's render then writes the time in UTC
// (`LocalTime`).
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
		const zone = writable(browserZone());
		if (zone !== null && zone !== serverZone) {
			const secure = location.protocol === 'https:' ? '; Secure' : '';
			// every character of an IANA name is a valid cookie octet, so the value is written as is.
			// `Path=/`, not `/admin`: react router asks for the layout loader of exactly /admin as
			// /admin.data, which a `Path=/admin` cookie is not sent to (RFC 6265 §5.1.4).
			// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API the rule points at is not in every browser an operator opens /admin in, and it writes only in a secure context.
			document.cookie = `${VIEWER_ZONE_COOKIE}=${zone}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax${secure}`;
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

// true in the browser once hydrated, false on the server and through hydration.
const inBrowser = () => true;
const onServer = () => false;

/**
 * the instant `at` (an ISO string, as it crosses a loader) in the viewer's zone. a missing or
 * unparseable `at` is a dash with no `dateTime`. on the server with no zone it renders an empty
 * `<time>`, which the browser fills once hydrated; a browser whose zone this runtime cannot write
 * in writes the instant in UTC and says so.
 */
export function LocalTime({
	at,
	style
}: {
	readonly at: string | null | undefined;
	readonly style: InstantStyle;
}) {
	const zone = useViewerZone();
	const hydrated = useSyncExternalStore(subscribe, inBrowser, onServer);
	if (!at || Number.isNaN(Date.parse(at))) return <time>—</time>;
	// no zone on the server is a first visit, or one it cannot write in (`writable` above): the
	// time stays empty rather than guessing a day. in the browser there is no later zone to wait for.
	let text: string | null = null;
	if (zone !== null) text = formatInstant(at, zone, style);
	else if (hydrated) text = inUtc(at, style);
	return (
		<time dateTime={at} suppressHydrationWarning>
			{text}
		</time>
	);
}

/** `at` in UTC, marked as such: a moment already ends in its offset, which at zero reads `UTC`. */
function inUtc(at: string, style: InstantStyle): string {
	const text = formatInstant(at, 'UTC', style);
	return style === 'moment' ? text : `${text} UTC`;
}
