import { and, eq, gt } from 'drizzle-orm';
import { createCookie, redirect } from 'react-router';
import type { Db } from '../db/client';
import { supporter, supporterSession } from '../db/schema';
import { cookiesSecure } from '../runtime/cookie-scheme';
import { hashToken, mintToken } from './token';

// a signed-in supporter: a cookie of its own backed by a `supporter_session` row, wholly apart from
// staff's. the staff gate (../auth/gate.ts) reads better-auth's cookie against `auth_session` and
// nothing here; nothing here reads either. so a supporter's cookie opens no /admin screen and a
// staff session opens no supporter page — `isolation.db.spec.ts` holds both.

/**
 * the cookie's name. better-auth names its own `better-auth.session_token`, with a `__Secure-`
 * prefix off loopback (../auth/index.ts), so the two never share a name.
 */
export const SUPPORTER_SESSION_COOKIE = 'bg_supporter_session';

/** how long a session lasts from the link that opened it; signing in again starts a fresh one. */
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/**
 * `sameSite: 'lax'` so the cookie rides the top-level navigation a mailed link is, which `strict`
 * would withhold. `secure` is stated per response (`cookiesSecure` in ../runtime/cookie-scheme.ts),
 * as ../flash.ts and ./resend-ticket.ts state theirs: a deployment served over plain http, on any
 * host, gets a cookie the browser keeps.
 */
const cookie = createCookie(SUPPORTER_SESSION_COOKIE, {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	maxAge: SESSION_LIFETIME_SECONDS
});

/** the signed-in supporter, as a supporter screen may know them. */
export type SignedInSupporter = {
	readonly supporterId: string;
	readonly email: string;
	readonly name: string;
};

/** a fresh session for `supporterId`, and the `Set-Cookie` value that hands it to the browser. */
export async function startSupporterSession(
	db: Db,
	request: Request,
	supporterId: string,
	now: Date
): Promise<string> {
	const token = mintToken();
	await db.insert(supporterSession).values({
		tokenHash: hashToken(token),
		supporterId,
		createdAt: now,
		expiresAt: new Date(now.getTime() + SESSION_LIFETIME_SECONDS * 1000)
	});
	return cookie.serialize(token, { secure: cookiesSecure(request) });
}

/** the cookie's token, or null where the request carries none this module wrote. */
async function presentedToken(request: Request): Promise<string | null> {
	const value: unknown = await cookie.parse(request.headers.get('Cookie'));
	return typeof value === 'string' && value !== '' ? value : null;
}

/** the supporter this request's cookie signs in, or null for none, an unknown one or an expired one. */
export async function readSupporterSession(
	db: Db,
	request: Request,
	now: Date
): Promise<SignedInSupporter | null> {
	const token = await presentedToken(request);
	if (token === null) return null;
	const [row] = await db
		.select({ supporterId: supporter.id, email: supporter.email, name: supporter.name })
		.from(supporterSession)
		.innerJoin(supporter, eq(supporter.id, supporterSession.supporterId))
		.where(
			and(eq(supporterSession.tokenHash, hashToken(token)), gt(supporterSession.expiresAt, now))
		)
		.limit(1);
	return row ?? null;
}

/**
 * the signed-in supporter, or a 303 to `signInPath` thrown for a loader or action to answer with.
 * `signInPath` is the routes' own address for the sign-in screen.
 */
export async function requireSupporter(
	db: Db,
	request: Request,
	now: Date,
	signInPath: string
): Promise<SignedInSupporter> {
	const signedIn = await readSupporterSession(db, request, now);
	if (signedIn === null) throw redirect(signInPath, 303);
	return signedIn;
}

/** ends this request's session, whatever state it is in, and the `Set-Cookie` value that clears it. */
export async function endSupporterSession(db: Db, request: Request): Promise<string> {
	const token = await presentedToken(request);
	if (token !== null) {
		await db.delete(supporterSession).where(eq(supporterSession.tokenHash, hashToken(token)));
	}
	return cookie.serialize('', { maxAge: 0, secure: cookiesSecure(request) });
}
