// the guarded way into Intuit's consent screen, and the single-use check on the way back.
//
// **an unguarded start address is a stranger's company connected to this deployment.** whoever
// opens `/quickbooks/connect` is sent to Intuit and comes back with a company connected — so left
// open, an outsider connects *their* books and every gift this organisation takes is posted into
// them. the console is already behind a credential, so it is what mints the address; this module is
// where that address is minted and read, so the two halves cannot come to disagree about what is
// signed.
//
// **two different values, doing two different jobs.**
//
//   - the **start address** is the guard on who may begin. it carries an expiry and a signature
//     over it, and nothing else: there is no caller's identity to carry, because the only thing it
//     grants is the right to begin a flow that still cannot be finished without signing in at
//     Intuit.
//   - the **OAuth `state`** is the check that the browser coming back is the one that went. it is
//     minted per start, set in a cookie, and compared against what Intuit hands back
//     (./quickbooks.ts's `quickbooksConnectUrl` states that it is the caller's to mint and to
//     check).
//
// **single use belongs to the cookie rather than to the link.** nothing is spendable-once without
// storage, and the only store here is D1 — a table for a value with a ten-minute life is a
// migration for a row nobody reads. so a replayed start address only ever mints a fresh `state`,
// and the cookie is what makes the round trip itself unrepeatable: the callback clears it.
//
// **the key is the one ../auth/signing-key.ts resolves, under a purpose label of its own.** the
// message signed below opens with {@link PURPOSE}, which no session token can contain — so a
// signature minted here can never be read as a cookie's and a cookie's can never be read as one of
// these. that module's header states what this signs and what it grants.

import { secretEquals } from '../secret-compare';

/** where a browser begins, and where Intuit sends it back. both are addresses on this deployment. */
export const QUICKBOOKS_CONNECT_PATH = '/quickbooks/connect';
export const QUICKBOOKS_CALLBACK_PATH = '/quickbooks/callback';

/**
 * how long a start address is good for, and how long the cookie beside it lives.
 *
 * ten minutes: the operator presses Connect on the console and the browser opens immediately, so
 * the only thing this length has to survive is one consent screen at Intuit. a fresh address is one
 * press, which is what makes the short life cost nothing.
 */
export const CONNECT_LINK_LIFETIME_MS = 10 * 60_000;

/**
 * what the signature is over, in front of the expiry.
 *
 * a session cookie's signature is over a random token, and this one is over a string that opens
 * with a word — so neither value can ever be presented as the other, however the two are moved
 * about. it carries a version so a second grammar can be told from this one rather than parsed
 * hopefully.
 */
const PURPOSE = 'quickbooks-connect.v1';

/** the expiry on the address, in epoch milliseconds. */
const EXPIRES_PARAM = 'exp';
/** the signature over {@link PURPOSE} and the expiry. */
const SIGNATURE_PARAM = 'sig';

/**
 * the address the operator's browser opens, good for {@link CONNECT_LINK_LIFETIME_MS}.
 *
 * `now` is a parameter for the reason every module under `$lib/server` takes one: a function that
 * reads the clock cannot be asserted about.
 */
export async function mintConnectLink(input: {
	readonly secret: string;
	readonly origin: string;
	readonly now: Date;
}): Promise<string> {
	const expiresAt = input.now.getTime() + CONNECT_LINK_LIFETIME_MS;
	const query = new URLSearchParams({
		[EXPIRES_PARAM]: String(expiresAt),
		[SIGNATURE_PARAM]: await sign(input.secret, expiresAt)
	});
	return `${input.origin}${QUICKBOOKS_CONNECT_PATH}?${query}`;
}

/**
 * whether an address is one this deployment minted and is still good for.
 *
 * one bit, deliberately. absent, altered and expired are the same answer to whoever is holding it —
 * press Connect again — and telling an altered signature apart from an expired one in the answer
 * would be this deployment reporting on a forgery attempt to the forger.
 */
export async function readConnectLink(input: {
	readonly secret: string;
	readonly url: URL;
	readonly now: Date;
}): Promise<boolean> {
	const expiresAt = Number(input.url.searchParams.get(EXPIRES_PARAM));
	const signature = input.url.searchParams.get(SIGNATURE_PARAM);
	if (!Number.isSafeInteger(expiresAt) || signature === null) return false;
	if (expiresAt <= input.now.getTime()) return false;
	return secretEquals(signature, await sign(input.secret, expiresAt));
}

/**
 * the cookie the `state` rides in, scoped to the two addresses of this flow.
 *
 * the path keeps it off every other request this deployment answers, the donation form's included —
 * a value with nothing to do with a donor has no business on their page's requests.
 */
const STATE_COOKIE = 'quickbooks_connect_state';

/** the path both addresses of this flow sit under, and what the cookie is scoped to. */
const COOKIE_PATH = '/quickbooks';

/**
 * every attribute the cookie carries, in one place so the set and the clear cannot differ.
 *
 * `HttpOnly` because nothing in a page ever reads it; `Secure` because this flow happens over TLS
 * on a deployment; `SameSite=Lax` because the request that has to carry it is a top-level
 * navigation arriving from Intuit, which `Strict` would strip — and stripping it is the callback
 * refusing every real round trip.
 */
const COOKIE_ATTRIBUTES = `Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax`;

/** a fresh `state`: 32 random bytes as 64 hex characters. */
export function mintConnectState(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** the `set-cookie` the redirect to Intuit carries, living as long as the address that minted it. */
export function connectStateCookie(state: string): string {
	return `${STATE_COOKIE}=${state}; ${COOKIE_ATTRIBUTES}; Max-Age=${CONNECT_LINK_LIFETIME_MS / 1000}`;
}

/**
 * the `set-cookie` the callback carries, on every arm it has.
 *
 * spent whether the round trip landed or was refused: what makes the flow unrepeatable is the
 * cookie being gone afterwards, and an arm that returned early without clearing would leave a live
 * `state` for the next attempt to match against.
 */
export const CLEARED_CONNECT_STATE_COOKIE = `${STATE_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;

/** the `state` this browser was sent with, or null where it carries none. */
export function connectStateFrom(headers: Headers): string | null {
	const cookie = headers.get('cookie');
	if (cookie === null) return null;
	for (const element of cookie.split(';')) {
		const at = element.indexOf('=');
		if (at === -1) continue;
		if (element.slice(0, at).trim() !== STATE_COOKIE) continue;
		const value = element.slice(at + 1).trim();
		return value === '' ? null : value;
	}
	return null;
}

/** the signature over one expiry, in base64url. */
async function sign(secret: string, expiresAt: number): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign(
		'HMAC',
		key,
		encoder.encode(`${PURPOSE}.${expiresAt}`)
	);
	return base64url(new Uint8Array(signature));
}

/** base64url with no padding, which is what a query string carries without escaping. */
function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
