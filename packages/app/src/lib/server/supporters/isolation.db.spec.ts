import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requestContext } from '../../../request-context';
import { staffGate } from '$lib/server/auth/gate';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { client, run, stmt } from '$lib/server/db/database.testing';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { readEnv } from '$lib/server/runtime/env';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';
import {
	endSupporterSession,
	readSupporterSession,
	requireSupporter,
	startSupporterSession
} from './session';

// a supporter's session and staff's are two locks with two keys: neither cookie opens the other's
// door, against the real gate and the real session tables.

const ORIGIN = 'https://give.example';
const PASSWORD = 'a-long-enough-password';
const SUPPORTER_ID = '019fb600-0000-7000-8000-000000000011';
const NOW = new Date('2026-11-11T12:00:00.000Z');

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

beforeEach(async () => {
	for (const table of ['supporter_session', 'supporter_link', 'auth_session', 'auth_user']) {
		await run(stmt(`delete from ${table}`));
	}
	await run(stmt(`delete from supporter where id = ?`, SUPPORTER_ID));
	await run(
		stmt(
			`insert into supporter (id, email, name, created_at)
			 values (?, 'isolated@example.org', 'Maya Rivera', 0)`,
			SUPPORTER_ID
		)
	);
});

/** a supporter's session, as the `Cookie` header a browser sends back. */
async function supporterCookie(): Promise<string> {
	const set = await startSupporterSession(
		db,
		new Request(`${ORIGIN}/fundraise/open`),
		SUPPORTER_ID,
		NOW
	);
	return set.split(';', 1)[0] ?? '';
}

/** a staff session signed in through better-auth, as the `Cookie` header a browser sends back. */
async function staffCookie(): Promise<string> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.cause);
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
	return headers
		.getSetCookie()
		.map((value) => value.split(';', 1)[0])
		.join('; ');
}

/** the staff gate on `/admin`, for a request carrying `cookie`: what it threw, or what it let through. */
async function throughStaffGate(cookie: string): Promise<{ ran: boolean; answer: Response }> {
	const context = requestContext({
		env: readEnv({}, specRateLimiters()),
		deferred: createDeferredWork(),
		client
	});
	let ran = false;
	const answer = await staffGate(
		{
			request: new Request(`${ORIGIN}/admin`, { headers: { cookie } }),
			url: new URL(`${ORIGIN}/admin`),
			pattern: '/*',
			params: {},
			context
		},
		async () => {
			ran = true;
			return new Response('the dashboard');
		}
	).catch((thrown: unknown) => thrown as Response);
	return { ran, answer };
}

describe('a supporter session', () => {
	it('opens no /admin screen: the staff gate sends it to the login', async () => {
		const { ran, answer } = await throughStaffGate(await supporterCookie());
		expect(ran).toBe(false);
		expect(answer.status).toBe(303);
		expect(answer.headers.get('location')).toMatch(/^\/login/);
	});

	it('opens supporter pages until it expires thirty days on', async () => {
		const request = new Request(`${ORIGIN}/fundraise/pages`, {
			headers: { cookie: await supporterCookie() }
		});
		const day = 24 * 60 * 60 * 1000;
		expect(await readSupporterSession(db, request, new Date(NOW.getTime() + 30 * day - 1))).toEqual(
			{ supporterId: SUPPORTER_ID, email: 'isolated@example.org', name: 'Maya Rivera' }
		);
		expect(await readSupporterSession(db, request, new Date(NOW.getTime() + 30 * day))).toBeNull();
	});

	it('opens nothing once signed out, and the answer clears the cookie', async () => {
		const request = new Request(`${ORIGIN}/fundraise/pages`, {
			headers: { cookie: await supporterCookie() }
		});
		const cleared = await endSupporterSession(db, request);
		expect(cleared).toMatch(/^bg_supporter_session=;.*Max-Age=0/);
		expect(await readSupporterSession(db, request, NOW)).toBeNull();
	});
});

describe('a staff session', () => {
	it('passes the staff gate, so the refusal below is not a broken cookie', async () => {
		const { ran } = await throughStaffGate(await staffCookie());
		expect(ran).toBe(true);
	});

	it('opens no supporter page: the supporter guard sends it to sign in', async () => {
		const request = new Request(`${ORIGIN}/fundraise/pages`, {
			headers: { cookie: await staffCookie() }
		});
		const refused = await requireSupporter(db, request, NOW, '/fundraise/sign-in').catch(
			(thrown: unknown) => thrown as Response
		);
		expect((refused as Response).status).toBe(303);
		expect((refused as Response).headers.get('location')).toBe('/fundraise/sign-in');
	});

	it('opens no supporter page with its token moved under the supporter cookie name', async () => {
		const value = (await staffCookie()).split('=').slice(1).join('=');
		const request = new Request(`${ORIGIN}/fundraise/pages`, {
			headers: { cookie: `bg_supporter_session=${value}` }
		});
		const refused = await requireSupporter(db, request, NOW, '/fundraise/sign-in').catch(
			(thrown: unknown) => thrown as Response
		);
		expect((refused as Response).status).toBe(303);
		expect((refused as Response).headers.get('location')).toBe('/fundraise/sign-in');
	});
});
