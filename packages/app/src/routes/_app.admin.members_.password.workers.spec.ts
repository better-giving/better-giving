import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth, inviteMember, redeemInvitation, signInMember } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { SAVED_FLASH } from '$lib/server/flash';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as password from './_app.admin.members_.password';

// the password screen's server half, against the real D1 the pool binds.
//
// the chain is mounted rather than the loader called, which is ../route-request.testing.ts's
// pattern and is load-bearing here twice over: the session gate is a `middleware` on ./_app.tsx,
// and whose session is holding the request is what every decision on this screen turns on — a
// loader called on its own would run with nothing on the router context to read.
//
// the deployment is set up in every case below, because the layout above this screen refuses to
// serve any child while a set-up job is outstanding (./_app.tsx).
//
// whether a password actually changed is asserted by signing in with it — `signInMember` against
// the same auth instance the deployment builds — rather than by reading `auth_account`. the hash
// is better-auth's to write and its shape is not this screen's claim; what the screen owes is
// that the old way in stops working and the new one starts.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the address this screen answers on. */
const SCREEN = '/admin/members/password';

/** where the deployer is sent, having nothing to change here. */
const MEMBERS = '/admin/members';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-very-long-random-staff-password';

/** the colleague every case below is about. */
const MEMBER = 'nadia@riverbanktrust.org';

/** what that colleague chose when they accepted, long enough for better-auth to accept it. */
const MEMBER_PASSWORD = 'a-colleagues-own-password';

/** what they change it to. */
const NEW_PASSWORD = 'a-colleagues-second-password';

function deployed() {
	return {
		...env,
		ADMIN_PASSWORD: PASSWORD,
		STRIPE_SECRET_KEY: 'sk_test_x',
		STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
		SMTP_HOST: 'smtp.example.org',
		SMTP_USERNAME: 'apikey',
		SMTP_PASSWORD: 'mail-secret',
		MAIL_FROM: 'giving@example.org'
	} as unknown as Env;
}

let db: Db;
let request: RouteRequester;
let staffSession: string;

beforeAll(async () => {
	db = createDb(env.DB);
	// the pathless layout carries no path of its own, which is what makes the gate cover a screen
	// without adding a segment to its address. the leaf's own path has no `members` layout in it:
	// the trailing underscore on `members_` is what writes this screen out of that nesting
	// (react-router/docs/how-to/file-route-conventions.md → nested URLs without layout nesting).
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/members/password', module: password }
	]);
});

beforeEach(async () => {
	await env.DB.prepare('delete from auth_member_invitation').run();
	await env.DB.prepare('delete from auth_session').run();
	await env.DB.prepare('delete from auth_user').run();
	await env.DB.prepare('delete from org_profile').run();
	await finished();
	staffSession = await signInAsDeployer();
});

/**
 * the one row the five set-up jobs are read off, so this deployment reads as finished.
 *
 * the same shape ./_app.admin.members.workers.spec.ts states, and for the same reason: a screen
 * that is only served behind the gate has to be tested on a deployment somebody finished setting
 * up.
 */
async function finished(): Promise<void> {
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		 values ('default', 'Riverbank Trust', '12-3456789', 'alerts@example.org', 0, 0)`
	).run();
}

/** the deployer's session, as the `Cookie` header a browser would send back. */
async function signInAsDeployer(): Promise<string> {
	const auth = await authInstance();
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});
	return asCookieHeader(headers.getSetCookie());
}

/**
 * a colleague who accepted an invitation, and the session they hold.
 *
 * it goes through the real invite and the real redeem rather than writing the two rows, because
 * what this screen changes is the credential the redeem wrote — a hand-written `auth_user` row
 * with no `auth_account` behind it is the deployer's shape, which is the case being told apart.
 */
async function signInAsMember(email: string = MEMBER): Promise<string> {
	const invited = await inviteMember(db, { email, now: new Date(), invitedBy: null });
	if (!invited.ok) throw new Error(`the fixture could not invite ${email}: ${invited.reason}`);

	const redeemed = await redeemInvitation(db, await authInstance(), {
		token: invited.token,
		name: 'Nadia Hart',
		password: MEMBER_PASSWORD,
		headers: new Headers({ origin: ORIGIN }),
		now: new Date()
	});
	if (!redeemed.ok) throw new Error(`the fixture could not redeem ${email}: ${redeemed.reason}`);
	return asCookieHeader([...redeemed.cookies]);
}

async function authInstance() {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);
	return createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
}

/** the same jar with one cookie dropped, which is what the browser does with a burnt flash. */
function without(response: Response, name: string): string {
	return asCookieHeader(
		response.headers.getSetCookie().filter((set) => !set.startsWith(`${name}=`))
	);
}

function asCookieHeader(setCookies: readonly string[]): string {
	const cookies = setCookies.map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

/** whether a password still signs this colleague in, which is the whole of what changed. */
async function signsIn(candidate: string): Promise<boolean> {
	const attempt = await signInMember(await authInstance(), {
		email: MEMBER,
		password: candidate,
		headers: new Headers({ origin: ORIGIN })
	});
	return attempt.ok;
}

function get(cookie: string): Promise<Response> {
	return request(new Request(`${ORIGIN}${SCREEN}`, { headers: { cookie } }), { env: deployed() });
}

/** the loader's answer, as the screen's own data. */
async function visit(cookie: string): Promise<{ changed: boolean }> {
	const response = await get(cookie);
	expect(response.status).toBe(200);
	return await response.json();
}

describe('GET /admin/members/password — who it is for', () => {
	it('is a member, who is offered the form with nothing to report yet', async () => {
		const memberSession = await signInAsMember();

		expect(await visit(memberSession)).toEqual({ changed: false });
	});

	/**
	 * the deployer's password is a deploy-time secret with no `auth_account` row behind it
	 * ($lib/server/auth/credential.ts), so there is nothing on this screen for them to press.
	 */
	it('is not the deployer, who is sent back to the list', async () => {
		const response = await get(staffSession);

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe(MEMBERS);
	});
});

// ---------------------------------------------------------------------------
// the one write.

function post(cookie: string, body: FormData, { ip }: { ip?: string } = {}): Promise<Response> {
	return request(
		new Request(`${ORIGIN}${SCREEN}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN, ...(ip ? { 'cf-connecting-ip': ip } : {}) },
			body
		}),
		{ env: deployed() }
	);
}

function changeBody(current: string, next: string): FormData {
	const body = new FormData();
	body.set('current_password', current);
	body.set('new_password', next);
	return body;
}

/** the sentence under one box, off a rejection the screen would render. */
async function underTheBox(response: Response, box: string): Promise<string[] | undefined> {
	const answer = (await response.json()) as {
		form: { result: { error?: Record<string, string[]> } };
	};
	return answer.form.result.error?.[box];
}

/** the form-level sentence a refusal carries, which is what the banner would render. */
async function formRefusal(response: Response): Promise<string | undefined> {
	const answer = (await response.json()) as {
		form: { result: { error?: Record<string, string[]> } };
	};
	return answer.form.result.error?.['']?.[0];
}

describe('POST /admin/members/password — a press that is not a member’s', () => {
	it('is refused, and points at where that password is set instead', async () => {
		const answer = await post(staffSession, changeBody(PASSWORD, NEW_PASSWORD));

		expect(answer.status).toBe(403);
		expect(await formRefusal(answer)).toContain('ADMIN_PASSWORD');
	});
});

describe('POST /admin/members/password — what the boxes are refused for', () => {
	it('says so under the current box when it is not the password they hold', async () => {
		const memberSession = await signInAsMember();

		const answer = await post(memberSession, changeBody('not-their-password', NEW_PASSWORD));

		expect(answer.status).toBe(400);
		expect(await underTheBox(answer, 'current_password')).toEqual(['does not match your password']);
		// and nothing moved: the password they hold is still the way in.
		expect(await signsIn(MEMBER_PASSWORD)).toBe(true);
	});

	it('says so under the new box when it is shorter than this deployment accepts', async () => {
		const memberSession = await signInAsMember();

		const answer = await post(memberSession, changeBody(MEMBER_PASSWORD, 'short'));

		expect(answer.status).toBe(400);
		expect(await underTheBox(answer, 'new_password')).toEqual([
			expect.stringContaining('must be at least')
		]);
		expect(await signsIn(MEMBER_PASSWORD)).toBe(true);
	});

	/** neither box is ever echoed back, whichever of them was refused. */
	it('sends neither password back into the page', async () => {
		const memberSession = await signInAsMember();

		const answer = await post(memberSession, changeBody(MEMBER_PASSWORD, 'short'));

		const body = await answer.text();
		expect(body).not.toContain(MEMBER_PASSWORD);
		expect(body).not.toContain('short');
	});
});

describe('POST /admin/members/password — a change that lands', () => {
	it('replaces the way in and carries the new session back on the redirect', async () => {
		const memberSession = await signInAsMember();

		const answer = await post(memberSession, changeBody(MEMBER_PASSWORD, NEW_PASSWORD));

		expect(answer.status).toBe(303);
		expect(answer.headers.get('location')).toBe(SCREEN);
		// better-auth revoked every session the member held, this request's included, and minted a
		// replacement — so the response the browser follows has to carry it or the change signs them
		// out of the browser they are standing in.
		expect(answer.headers.getSetCookie().length).toBeGreaterThan(0);
		expect(await signsIn(MEMBER_PASSWORD)).toBe(false);
		expect(await signsIn(NEW_PASSWORD)).toBe(true);
	});

	it('reports itself once on the screen it redirects to, and not on the reload after', async () => {
		const memberSession = await signInAsMember();
		const answer = await post(memberSession, changeBody(MEMBER_PASSWORD, NEW_PASSWORD));
		const landed = await get(asCookieHeader(answer.headers.getSetCookie()));

		expect(await landed.json()).toEqual({ changed: true });
		// the header that burns the marker rides on the response that publishes it, so the browser
		// carries no flash into the reload — which is what the second visit is, with everything the
		// redirect set except the cookie this response just emptied.
		expect(landed.headers.get('set-cookie')).toContain(`${SAVED_FLASH}=;`);
		expect(await visit(without(answer, SAVED_FLASH))).toEqual({ changed: false });
	});
});

// ---------------------------------------------------------------------------
// the bound on the write. the pool binds the real `SIGN_IN_RATE_LIMITER`, so what is under test is
// the charge as it deploys rather than a description of it.
//
// a wrong current password here is a guess at a member's credential, and the bucket it spends is
// the login's own — one payer per deployment on `signInRateLimitKey`, which is what stops a second
// way in from minting a fresh budget (CLAUDE.md → Product surface). the address below is this
// file's alone, so nothing it spends is counted against ./login.workers.spec.ts's.

describe('the limit on POST /admin/members/password', () => {
	it('refuses a caller who has guessed too often, before the current password is compared', async () => {
		const memberSession = await signInAsMember();
		const guess = () =>
			post(memberSession, changeBody('not-their-password', NEW_PASSWORD), {
				ip: '203.0.113.90'
			});

		let refusal: Response | undefined;
		for (let i = 0; i < 50 && !refusal; i++) {
			const answer = await guess();
			if (answer.status === 429) refusal = answer;
		}
		if (!refusal) throw new Error('50 guesses and the limiter refused none of them');

		expect(await formRefusal(refusal)).toContain('Too many sign-in attempts');
		// the status alone would pass against an action that refused after the compare. what is
		// being bounded is the work one press can buy, so the assertion is that the guess did not
		// reach the auth layer at all — a correct current password would have changed the password.
		const withTheRightOne = await post(memberSession, changeBody(MEMBER_PASSWORD, NEW_PASSWORD), {
			ip: '203.0.113.90'
		});
		expect(withTheRightOne.status).toBe(429);
		expect(await signsIn(MEMBER_PASSWORD)).toBe(true);
	});
});
