import { createCookie, redirect } from 'react-router';

// how the outcome of a write in /admin survives its own redirect.
//
// every write on these screens is POST-redirect-GET, so the thing that just happened has to
// reach the GET that lands. it travels as a cookie the redirect sets and the landing `loader`
// takes: the marker is delivered to exactly one response and is gone from the browser before
// the operator can reload. that is the whole point of a cookie here rather than a query
// parameter — an address survives a reload, a bookmark and a share, so it re-announces a save
// nobody has just performed and puts a record id in front of an operator who never asked for
// one.
//
// what travels is a short marker and never a sentence: a section name, `archived`, or the id of
// a record. every word an operator reads is copy in this repository, resolved server-side from
// the marker by the screen that draws it — so the copy stays reviewable in one place and
// nothing the browser is holding is ever rendered as a message.
//
// **the cookie is written at `/` and the screen it reports on rides in the value.** scoping it to
// that screen's own path is what the browser would make of `/admin/forms/<id>`, and it does not
// survive: after the first navigation the router does not ask for `/admin/forms/<id>`, it asks for
// `/admin/forms/<id>.data`, which a cookie at `Path=/admin/forms/<id>` is not sent to. a path-scoped
// flash therefore works on the first load and silently stops working after it. so path matching
// decides nothing here and the destination is compared server-side, in `takeFlash`, against the
// address the load is running for.
//
// the cookie carries no identity and grants nothing — it is a word naming a screen's own
// section, or an id already on the page it unlocks nothing about — so CLAUDE.md's rule that
// secrets live only under `src/lib/server/**` is not what puts this file here. what puts it here
// is that it writes response headers, which is a server-only thing to do. it is `httpOnly` all
// the same, because nothing in the browser has any business reading it and a marker script could
// read is one a screen might later be tempted to trust.
//
// a name per outcome rather than one shared slot, and the reason survives the move to `/`: a
// create waiting to be landed on and a save waiting to be landed on are two markers that can be in
// flight at once, and one name is one slot — the second write would empty the first. under a name
// each, no request ever carries two of any of them.

/**
 * the outcome of a write that reports on the screen it was performed on.
 *
 * taken by that screen's own `loader` — `/admin/forms/<id>` and `/admin/members` — and by no
 * other, because the destination is in the value and every screen is sent the cookie.
 */
export const SAVED_FLASH = 'admin_saved';

/**
 * the record a create just made, reporting on the list it redirects to.
 *
 * taken by that list's `loader` — `/admin/forms`, which `/admin/forms/new` redirects to once it
 * has written one. an unlanded create is left alone by every other screen and dies on its own
 * max-age rather than being burnt by one that would not have drawn it.
 */
export const CREATED_FLASH = 'admin_created';

/**
 * the marker a finished password reset leaves for the sign-in screen.
 *
 * taken by `/login`'s own `loader` and by no other, which is the one-consumer rule the union below
 * states. it is the one marker written by a caller with no session — `/reset` mints none, on
 * purpose ($lib/server/auth/members.ts) — so what it reports is that the password changed and
 * never who changed it.
 */
export const PASSWORD_RESET_FLASH = 'password_reset';

/**
 * the three names above and nothing else.
 *
 * a union rather than a `string`, so a screen cannot invent a fourth name and get a flash nothing
 * takes — the whole scheme rests on every name having exactly one consumer.
 */
export type FlashName = typeof SAVED_FLASH | typeof CREATED_FLASH | typeof PASSWORD_RESET_FLASH;

/**
 * how long a flash nobody lands on stays in the jar.
 *
 * seconds, and deliberately short: the browser follows the 303 immediately, so anything past a
 * slow round trip is a marker waiting for a visit that is no longer the one it was written for.
 * not a session cookie — one of those lingers until the browser closes, which on the tab an
 * operator never shuts is forever.
 */
const MAX_AGE_SECONDS = 60;

/**
 * what the value holds: the address this marker is for, and the marker.
 *
 * the destination is in the value because it is no longer in the cookie's path, and it is checked
 * server-side. the browser is holding it, so it is a claim rather than a fact — which is exactly
 * why the only thing done with it is a comparison against an address this app is already serving.
 *
 * `to` is a path and never the whole destination. a redirect may carry a query — a list that opens
 * scrolled to the row a create just made — and a query is no part of the address a load runs for,
 * so one stored verbatim would be a marker no screen ever matches and nothing would say so.
 */
type Flash = { to: string; marker: string };

/**
 * `sameSite: 'lax'` is what survives the redirect. everything in /admin is same-site, and lax is
 * sent on a top-level navigation — which a 303 followed by the browser is — where `strict` would
 * withhold the cookie on exactly the request the flash exists for.
 *
 * `secure` is not here, because it cannot be one value: `true` everywhere is a cookie no browser
 * stores against `pnpm dev`, which serves over http. it is stated per response instead, off the
 * scheme the request arrived on.
 */
const cookies: Record<FlashName, ReturnType<typeof createCookie>> = {
	[SAVED_FLASH]: createCookie(SAVED_FLASH, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: MAX_AGE_SECONDS
	}),
	[CREATED_FLASH]: createCookie(CREATED_FLASH, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: MAX_AGE_SECONDS
	}),
	[PASSWORD_RESET_FLASH]: createCookie(PASSWORD_RESET_FLASH, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: MAX_AGE_SECONDS
	})
};

/**
 * the screen a request is for, which is not always the path it names.
 *
 * the router asks for a screen's data at `<path>.data`, and `<path>/_.data` where the path ends in
 * a slash. it strips that itself before matching a route, but the `Request` a loader is handed
 * still carries the `.data` address — so a comparison against a destination has to undo it here or
 * every flash stops being taken the moment the app stops doing full-document loads.
 */
function screenPath(request: Request): string {
	const { pathname } = new URL(request.url);
	if (pathname.endsWith('/_.data')) return pathname.slice(0, -'_.data'.length);
	if (pathname.endsWith('.data')) return pathname.slice(0, -'.data'.length);
	return pathname;
}

/** whether this response may claim the cookie is https-only. */
function isSecure(request: Request): boolean {
	return new URL(request.url).protocol === 'https:';
}

/**
 * write the marker and redirect to the screen that will take it.
 *
 * the destination is both the redirect's location and the marker's address, which is what makes
 * the pair impossible to get wrong: a redirect and a flash aimed at two different screens would
 * leave a cookie no load ever claims, and there is no way to spell that here.
 */
export async function redirectWithFlash(
	request: Request,
	name: FlashName,
	destination: string,
	marker: string
): Promise<Response> {
	// the base is a stand-in and never reaches anything: `destination` is a bare path, and `URL`
	// needs one to parse a relative reference at all.
	const value: Flash = { to: new URL(destination, 'https://flash.invalid').pathname, marker };
	return redirect(destination, {
		status: 303,
		headers: {
			'Set-Cookie': await cookies[name].serialize(value, { secure: isSecure(request) })
		}
	});
}

/**
 * the marker left for this address, and the header that burns it.
 *
 * being shown twice is what this transport exists to prevent, so the clearing has to ride on the
 * same response that publishes the marker — a reload of the page that landed then carries no
 * cookie and reports nothing. it is handed back rather than applied, because a loader owns its own
 * response and this is one header on it.
 *
 * a marker for another screen is reported as nothing and is *not* cleared: at `/` every screen is
 * sent it, and the operator may still land where it was aimed.
 *
 * the marker itself is not interpreted here: what one means is the landing screen's, and
 * `$lib/admin/saved-section.ts` is where a screen decides whether one is a section of its own.
 */
export async function takeFlash(
	request: Request,
	name: FlashName
): Promise<{ marker: string; clear: string } | null> {
	const cookie = cookies[name];
	const value: unknown = await cookie.parse(request.headers.get('Cookie'));
	// `parse` answers `{}` for a value it cannot decode, so the shape is checked rather than
	// trusted: a cookie under this name that this app did not write is somebody else's, and an
	// arbitrary string handed on as a marker would reach a screen's own lookup as if a redirect
	// had put it there.
	if (typeof value !== 'object' || value === null) return null;
	const { to, marker } = value as Partial<Flash>;
	if (typeof to !== 'string' || typeof marker !== 'string' || marker === '') return null;
	if (to !== screenPath(request)) return null;

	return {
		marker,
		clear: await cookie.serialize('', { maxAge: 0, secure: isSecure(request) })
	};
}
