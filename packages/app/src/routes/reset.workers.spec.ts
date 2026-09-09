import { createExecutionContext, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	createAuth,
	inviteMember,
	MEMBER_PASSWORD_MIN_LENGTH,
	redeemInvitation,
	requestPasswordReset,
	signInMember,
	type Auth
} from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { PASSWORD_RESET_FLASH } from '$lib/server/flash';
import { requestContext } from '../request-context';
import { action, loader } from './reset';
import type { Route } from './+types/reset';

// the screen a mailed link opens, against the real D1 the pool binds.
//
// a workers spec for ./forgot.workers.spec.ts's reason and one of its own: every claim here is
// about a row — that a token was consumed, that the old password stopped signing in, that the
// second press of the same link finds nothing. CLAUDE.md refuses a stand-in for D1, and the write
// under test is better-auth's own through the drizzle adapter.
//
// the fixtures are ./login.workers.spec.ts's and
// $lib/server/auth/password-reset.workers.spec.ts's, copied rather than imported: a spec that
// imported another spec's helpers would make one file's clean-up decide another file's isolation.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const STAFF_PASSWORD = 'a-very-long-random-staff-password';

/** what a colleague chose when they accepted, long enough for better-auth to accept it. */
const OLD_PASSWORD = 'a-colleagues-own-password';

/** what they choose from the link, also long enough. */
const NEW_PASSWORD = 'a-different-long-enough-password';

/** the address the member in every case below holds. */
const MEMBER = 'nadia@riverbanktrust.org';

const DEPLOYED = {
	...env,
	ADMIN_PASSWORD: STAFF_PASSWORD,
	STRIPE_SECRET_KEY: 'sk_test_x',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_x'
};

let db: Db;

/** what react router hands a handler, built the way src/worker.ts builds it for a real request. */
function args(request: Request, deployed: typeof DEPLOYED = DEPLOYED): Route.LoaderArgs {
	return {
		request,
		url: new URL(request.url),
		params: {},
		pattern: '/reset',
		context: requestContext(deployed, createExecutionContext())
	};
}

/** an instance for one request, with a way to send only where the caller wants the token back. */
async function authInstance(passwordReset?: {
	send(input: { email: string; token: string }): Promise<void>;
	background(task: Promise<unknown>): void;
}): Promise<Auth> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);
	return createAuth(
		db,
		{ ADMIN_PASSWORD: STAFF_PASSWORD },
		// spread rather than passed, because `exactOptionalPropertyTypes` refuses an explicit
		// `undefined` for an optional property.
		{
			secret: signingKey.secret,
			requestOrigin: ORIGIN,
			...(passwordReset ? { passwordReset } : {})
		}
	);
}

/** a colleague who accepted an invitation, made the way /join makes one. */
async function makeMember(): Promise<void> {
	const auth = await authInstance();
	const invited = await inviteMember(db, { email: MEMBER, now: new Date(), invitedBy: null });
	if (!invited.ok) throw new Error(`the fixture could not invite: ${invited.reason}`);
	const redeemed = await redeemInvitation(db, auth, {
		token: invited.token,
		name: 'Nadia Hart',
		password: OLD_PASSWORD,
		headers: new Headers({ origin: ORIGIN }),
		now: new Date()
	});
	if (!redeemed.ok) throw new Error(`the fixture could not redeem: ${redeemed.reason}`);
	await env.DB.prepare('delete from auth_session').run();
}

/**
 * the token a mailed link would carry, taken off the `send` the requesting route supplies.
 *
 * `/forgot` is not driven to get it: what that route owns is the address the link is written into,
 * and asking it for one here would make this file fail when that screen's copy changes.
 */
async function liveToken(): Promise<string> {
	let minted: string | null = null;
	const auth = await authInstance({
		send: async ({ token }) => {
			minted = token;
		},
		// awaited rather than deferred, so the token exists by the time the request returns.
		background: (task) => {
			void task;
		}
	});
	const requested = await requestPasswordReset(auth, { email: MEMBER });
	if (!requested.ok) throw new Error(`the fixture could not request a reset: ${requested.reason}`);
	if (minted === null) throw new Error('the fixture was handed no token');
	return minted;
}

/** whether a password signs this member in. */
async function signsIn(password: string): Promise<boolean> {
	const signedIn = await signInMember(await authInstance(), {
		email: MEMBER,
		password,
		headers: new Headers({ origin: ORIGIN })
	});
	await env.DB.prepare('delete from auth_session').run();
	return signedIn.ok;
}

beforeEach(async () => {
	db = createDb(env.DB);
	await env.DB.prepare('delete from auth_verification').run();
	await env.DB.prepare('delete from auth_member_invitation').run();
	await env.DB.prepare('delete from auth_session').run();
	await env.DB.prepare('delete from auth_account').run();
	await env.DB.prepare('delete from auth_user').run();
	await env.DB.prepare('delete from org_profile').run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		 values ('default', 'Riverbank Trust', '12-3456789', 'alerts@example.org', 0, 0)`
	).run();
});

describe('GET /reset', () => {
	it('draws the box for a caller holding a token', async () => {
		expect(await loader(args(new Request(`${ORIGIN}/reset?token=whatever-it-says`)))).toEqual({
			shape: 'form',
			orgName: 'Riverbank Trust'
		});
	});

	/**
	 * an address with nothing on it is the one thing this screen can answer without spending a
	 * token: better-auth's `auth.api` exposes no read of a reset token, so a link is proven by the
	 * press and by nothing before it.
	 */
	it('says the link is dead when the address carries no token at all', async () => {
		expect(await loader(args(new Request(`${ORIGIN}/reset`)))).toEqual({
			shape: 'dead',
			orgName: 'Riverbank Trust'
		});
	});

	/** and a token nobody minted still draws the box, because nothing here has looked it up. */
	it('draws the box for a token this deployment never minted', async () => {
		const answer = await loader(args(new Request(`${ORIGIN}/reset?token=never-minted`)));

		expect(answer).toMatchObject({ shape: 'form' });
	});
});

// ---------------------------------------------------------------------------
// the write. it charges nothing, exactly as /join charges nothing: a random token is not a
// credential anybody guesses at, and the sign-in bucket exists to bound guessing.

/** what the action answers with when it refuses: `invalid()`'s data, with the status on it. */
type Refused = Exclude<Awaited<ReturnType<typeof action>>, Response>;

function typed(password: string): FormData {
	const body = new FormData();
	body.set('password', password);
	return body;
}

function post(token: string, body: FormData) {
	return action(
		args(
			new Request(`${ORIGIN}/reset?token=${token}`, {
				method: 'POST',
				headers: new Headers({ origin: ORIGIN }),
				body
			})
		)
	);
}

/** the refusal, or a loud failure rather than a case that silently asserted nothing. */
async function refused(token: string, body: FormData): Promise<Refused> {
	const answer = await post(token, body);
	if (answer instanceof Response) {
		throw new Error(`the reset answered ${answer.status} instead of refusing`);
	}
	return answer;
}

/** the form-level sentence a refusal carries, which is what the banner renders. */
function banner(answer: Refused): string | undefined {
	return answer.data.form.result.error?.['']?.[0];
}

describe('POST /reset', () => {
	it('sets the new password and sends the member to the sign-in page', async () => {
		await makeMember();
		const token = await liveToken();

		const answer = (await post(token, typed(NEW_PASSWORD))) as Response;

		expect(answer.status).toBe(303);
		expect(answer.headers.get('location')).toBe('/login');
		// the marker the sign-in screen turns into its banner, and the only thing this response
		// carries: no session is minted here ($lib/server/auth/members.ts).
		expect(answer.headers.get('set-cookie')).toContain(PASSWORD_RESET_FLASH);
		expect(answer.headers.getSetCookie().some((value) => value.includes('session'))).toBe(false);
		expect(await signsIn(NEW_PASSWORD)).toBe(true);
		expect(await signsIn(OLD_PASSWORD)).toBe(false);
	});

	/**
	 * the link works once. expired, already used and never minted are one answer, which is
	 * `resetMemberPassword`'s decision: an answer that told them apart would tell somebody feeding
	 * tokens at this address which of theirs had ever been real.
	 */
	it('refuses the same link a second time and leaves the password alone', async () => {
		await makeMember();
		const token = await liveToken();
		await post(token, typed(NEW_PASSWORD));

		const answer = await refused(token, typed('a-third-long-enough-password'));

		expect(answer.init?.status).toBe(400);
		expect(banner(answer)).toBe('This link has expired or was already used.');
		expect(await signsIn(NEW_PASSWORD)).toBe(true);
	});

	it('refuses a token this deployment never minted, in the same words', async () => {
		await makeMember();

		const answer = await refused('never-minted', typed(NEW_PASSWORD));

		expect(answer.init?.status).toBe(400);
		expect(banner(answer)).toBe('This link has expired or was already used.');
	});

	/**
	 * a short password lands under the box and leaves the link working, because better-auth
	 * measures the length before it consumes the row — so the member can answer it in place.
	 */
	it('puts a short password under the box and leaves the old one signing in', async () => {
		await makeMember();
		const token = await liveToken();

		const answer = await refused(token, typed('short'));

		expect(answer.init?.status).toBe(400);
		expect(answer.data.form.result.error?.password?.[0]).toBe(
			`must be at least ${MEMBER_PASSWORD_MIN_LENGTH} characters`
		);
		expect(await signsIn(OLD_PASSWORD)).toBe(true);
	});

	/** and the box is never echoed back, whatever the refusal was about. */
	it('never sends the password back to the browser', async () => {
		await makeMember();

		const answer = await refused('never-minted', typed(NEW_PASSWORD));

		expect(JSON.stringify(answer.data)).not.toContain(NEW_PASSWORD);
	});
});
