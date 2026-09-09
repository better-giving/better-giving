import { createExecutionContext, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { staff } from '../../../context';
import { requestContext } from '../../../request-context';
import { staffGate } from './gate';
import { createAuth, STAFF_USER_EMAIL } from './index';
import { resolveAuthSecret } from './signing-key';

// a workers spec because the gate reads D1 twice on every request it lets through: the signing key
// row and the session row. CLAUDE.md refuses a stand-in for either — what is worth asserting here
// is that a real session cookie against a real `auth_session` row resolves, and a fixture would
// only prove the fixture.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

let db: Db;
beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from auth_session').run();
	await env.DB.prepare('delete from auth_user').run();
});

/**
 * the middleware args react router hands a route `middleware`, for one request.
 *
 * `url` and `request.url` are separate parameters because react router keeps them separate: the
 * first is the address the app is navigating to, the second is the request that carried it, and on
 * a client-side navigation those differ. `sentTo` is how a case says so.
 *
 * the context is the deployment's own — `requestContext` is what src/worker.ts seeds — so the gate
 * reads the same D1 handle here that it reads in the worker.
 */
function args(url: string, options: { headers?: HeadersInit; sentTo?: string } = {}) {
	const context = requestContext(env, createExecutionContext());
	return {
		request: new Request(
			options.sentTo ?? url,
			options.headers ? { headers: options.headers } : {}
		),
		url: new URL(url),
		pattern: '/*',
		params: {},
		context
	};
}

/** what runs beneath the gate, and whether it ran at all. */
function screen() {
	const state = { ran: false };
	return {
		state,
		next: async () => {
			state.ran = true;
			return new Response('the screen');
		}
	};
}

/**
 * a real session, signed in through better-auth against the real `auth_session` table, as the
 * `Cookie` header a browser would send back.
 *
 * a second auth instance rather than the gate's, because the two agree on the only thing that
 * matters: both resolve the signing key from the same `auth_signing_key` row, so a cookie one
 * signs is one the other verifies. it is also where `ADMIN_PASSWORD` enters — the pool declares no
 * such variable, and the gate itself never reads one.
 */
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

/** the response the gate threw, or a failure naming what came back instead. */
async function refusal(promise: Promise<Response>): Promise<Response> {
	const thrown = await promise.then(
		(response) => response,
		(error: unknown) => error
	);
	expect(thrown).toBeInstanceOf(Response);
	return thrown as Response;
}

describe('the gate on the protected layout', () => {
	it('turns an anonymous request away to the login, carrying where it was going', async () => {
		const beneath = screen();

		const redirect = await refusal(staffGate(args(`${ORIGIN}/admin/forms?tab=live`), beneath.next));

		expect(redirect.status).toBe(303);
		// the whole request target, percent-encoded into one parameter: a deep link into /admin
		// names a tab or a filter in its query as often as not.
		expect(redirect.headers.get('location')).toBe('/login?next=%2Fadmin%2Fforms%3Ftab%3Dlive');
		// nothing beneath the layout ran, which is the whole of what a gate is.
		expect(beneath.state.ran).toBe(false);
	});

	it('names where the browser was going, not the data request that was made for it', async () => {
		// after the first navigation react router asks for a screen at `<path>.data`, and it is
		// that request the gate sees. sending the operator back to a `.data` address would hand
		// them a serialized payload where the screen belongs.
		const redirect = await refusal(
			staffGate(
				args(`${ORIGIN}/admin/forms?tab=live`, {
					sentTo: `${ORIGIN}/admin/forms.data?tab=live&_routes=routes%2F_app`
				}),
				screen().next
			)
		);

		expect(redirect.headers.get('location')).toBe('/login?next=%2Fadmin%2Fforms%3Ftab%3Dlive');
	});

	it('hands the session it resolved to the loaders beneath it', async () => {
		const cookie = await signIn();
		const passed = args(`${ORIGIN}/admin/forms`, { headers: { cookie } });

		const response = await staffGate(passed, screen().next);

		expect(await response.text()).toBe('the screen');
		// read off the router context, which is how a loader beneath the layout takes it — no
		// loader resolves a session of its own.
		expect(passed.context.get(staff).email).toBe(STAFF_USER_EMAIL);
	});

	it('carries the rolled-forward session cookie out on the response', async () => {
		const cookie = await signIn();
		// past `updateAge` (./index.ts), which is what makes better-auth write a fresh expiry and
		// a fresh cookie on the next read. both columns move together: the row stays valid, it is
		// only older than a day.
		const twoDays = 2 * 24 * 60 * 60 * 1000;
		await env.DB.prepare(
			'update auth_session set updated_at = updated_at - ?1, expires_at = expires_at - ?1'
		)
			.bind(twoDays)
			.run();

		const response = await staffGate(
			args(`${ORIGIN}/admin/forms`, { headers: { cookie } }),
			screen().next
		);

		// nothing else copies better-auth's cookies onto the response, so what a missing one looks
		// like is an operator signed out seven days after signing in, however much they used the
		// app in between.
		expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
	});
});
