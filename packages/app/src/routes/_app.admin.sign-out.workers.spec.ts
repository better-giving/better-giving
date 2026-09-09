import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as signOut from './_app.admin.sign-out';

// a workers spec because what is being asserted is a row: better-auth ends a session by deleting
// it from `auth_session`, and a stand-in for D1 would only prove the stand-in (CLAUDE.md).
//
// the chain is mounted rather than the action called, so the gate on the layout runs above it —
// that is where the auth instance the action signs out through is built, and an action called on
// its own would be reaching for a context nothing set.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

/** the deploy-time env every request here carries, which is the staff credential and nothing else. */
const DEPLOYED = { ...env, ADMIN_PASSWORD: PASSWORD };

let db: Db;
let request: RouteRequester;
beforeAll(() => {
	db = createDb(env.DB);
	// the pathless layout carries no path of its own, which is what makes the gate cover a screen
	// without adding a segment to its address.
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/sign-out', module: signOut }
	]);
});

beforeEach(async () => {
	await env.DB.prepare('delete from auth_session').run();
	await env.DB.prepare('delete from auth_user').run();
});

/** a real session, as the `Cookie` header a browser would send back. */
async function signIn(): Promise<string> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);

	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});

	const cookies = headers.getSetCookie().map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

/** how many sessions this deployment is holding. */
async function sessions(): Promise<number> {
	const row = await env.DB.prepare('select count(*) as n from auth_session').first<{ n: number }>();
	return row?.n ?? 0;
}

function post(cookie: string): Request {
	return new Request(`${ORIGIN}/admin/sign-out`, {
		method: 'POST',
		headers: { cookie, origin: ORIGIN }
	});
}

describe('signing out', () => {
	it('ends the session', async () => {
		const cookie = await signIn();
		expect(await sessions()).toBe(1);

		await request(post(cookie), { env: DEPLOYED });

		// the row and not the cookie: a browser that kept the cookie is holding a name for a
		// session this deployment no longer has, and the gate turns it away like any other.
		expect(await sessions()).toBe(0);
	});

	it('lands on the login', async () => {
		const cookie = await signIn();

		const response = await request(post(cookie), { env: DEPLOYED });

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/login');
	});

	it('clears the session cookie in the browser holding it', async () => {
		const cookie = await signIn();

		const response = await request(post(cookie), { env: DEPLOYED });

		// nothing else clears it. left behind, the operator's next request carries a name for a
		// row that is gone and the gate answers with the login anyway — but the browser goes on
		// sending a credential after being told it was given up.
		expect(response.headers.getSetCookie().some((value) => /max-age=0|expires=/i.test(value))).toBe(
			true
		);
	});

	it('turns an anonymous caller away instead of ending anything', async () => {
		// the route is under the gate, so there is no address here a caller without a session can
		// reach — which is what keeps this from being a way to spend somebody else's request.
		const response = await request(post(''), { env: DEPLOYED });

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/login?next=%2Fadmin%2Fsign-out');
	});
});
