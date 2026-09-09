import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import type { Auth } from './index';
import { createAuth, PASSWORD_RESET_LIFETIME_SECONDS } from './index';
import { inviteMember, MEMBER_PASSWORD_MIN_LENGTH, redeemInvitation } from './invitations';
import { requestPasswordReset, resetMemberPassword, signInMember } from './members';
import { resolveAuthSecret } from './signing-key';
import { STAFF_USER_EMAIL } from './staff-plugin';

// a workers spec because every claim here is about a row D1 holds: that a token was written, that
// consuming it a second time finds nothing, that a reset deleted the sessions. CLAUDE.md refuses a
// stand-in, and the write under test is better-auth's own through the drizzle adapter — a fixture
// would prove the fixture.
//
// the fixtures are ./members.workers.spec.ts's, copied rather than imported: a spec that imported
// another spec's helpers would make one file's clean-up decide another file's isolation.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';
/** a password the configured minimum accepts. */
const PASSWORD = 'a-long-enough-member-password';
/** what a member chooses from the link, also long enough for better-auth to accept it. */
const NEW_PASSWORD = 'a-different-long-enough-password';
/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const STAFF_PASSWORD = 'a-long-enough-password';
const NOW = new Date('2026-02-01T12:00:00.000Z');

let db: Db;
/** the instance a route requesting a reset builds: the one runtime carrying a way to send. */
let auth: Auth;
/** what the route's mailer was handed, in order. */
let sent: { email: string; token: string }[];
/** what was handed to the Worker's `waitUntil`, in order. */
let backgrounded: Promise<unknown>[];

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from auth_verification').run();
	await env.DB.prepare('delete from auth_member_invitation').run();
	await env.DB.prepare('delete from auth_session').run();
	await env.DB.prepare('delete from auth_account').run();
	await env.DB.prepare('delete from auth_user').run();

	sent = [];
	backgrounded = [];
	auth = await createAuthWith({
		send: async (input) => {
			sent.push(input);
		},
		background: (task) => {
			backgrounded.push(task);
		}
	});
});

/** an instance for one request, with or without a way to send a link. */
async function createAuthWith(passwordReset?: {
	send(input: { email: string; token: string }): Promise<void>;
	background(task: Promise<unknown>): void;
}): Promise<Auth> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);
	return createAuth(
		db,
		{ ADMIN_PASSWORD: STAFF_PASSWORD },
		// spread rather than passed, because `exactOptionalPropertyTypes` refuses an explicit
		// `undefined` for an optional property — and an instance with no way to send is what the
		// disabled arm below is about.
		{
			secret: signingKey.secret,
			requestOrigin: ORIGIN,
			...(passwordReset ? { passwordReset } : {})
		}
	);
}

/** a colleague who has accepted, as the `auth_user` id their session points at. */
async function member(email: string, name = 'Priya'): Promise<string> {
	const invited = await inviteMember(db, { email, now: NOW, invitedBy: null });
	if (!invited.ok) throw new Error(`expected an invitation, got ${invited.reason}`);

	const redeemed = await redeemInvitation(db, auth, {
		token: invited.token,
		name,
		password: PASSWORD,
		headers: new Headers({ origin: ORIGIN }),
		now: NOW
	});
	if (!redeemed.ok) throw new Error(`expected a member, got ${redeemed.reason}`);
	return redeemed.user.id;
}

/** the `Cookie` header a browser would send back, from what a sign-in set. */
function cookieHeader(cookies: readonly string[]): string {
	return cookies.map((value) => value.split(';', 1)[0]).join('; ');
}

/** a member's live session, as the `Cookie` header their next request would carry. */
async function sessionOf(email: string, password: string): Promise<string> {
	const signedIn = await signInMember(auth, {
		email,
		password,
		headers: new Headers({ origin: ORIGIN })
	});
	if (!signedIn.ok) throw new Error(`expected a session, got ${signedIn.reason}`);
	return cookieHeader(signedIn.cookies);
}

/** whether a password signs the member in. */
async function signsIn(email: string, password: string): Promise<boolean> {
	const result = await signInMember(auth, {
		email,
		password,
		headers: new Headers({ origin: ORIGIN })
	});
	return result.ok;
}

/** the link a member was mailed, or a failure saying none was. */
async function tokenFor(email: string): Promise<string> {
	const asked = await requestPasswordReset(auth, { email });
	if (!asked.ok) throw new Error(`expected a request to be taken, got ${asked.reason}`);
	// the send is handed to `background` rather than awaited, so nothing has settled yet.
	await Promise.all(backgrounded);
	const token = sent.at(-1)?.token;
	if (token === undefined) throw new Error('no reset link was sent');
	return token;
}

describe('requestPasswordReset', () => {
	it('hands the member’s address and a token to the mailer', async () => {
		await member('priya@example.org');

		expect(await requestPasswordReset(auth, { email: 'priya@example.org' })).toEqual({ ok: true });
		expect(sent).toEqual([{ email: 'priya@example.org', token: expect.any(String) }]);
	});

	/**
	 * the send is deferred rather than awaited, which is what makes a request for a real address
	 * take the same time as one for an address nobody has. better-auth hands it to
	 * `advanced.backgroundTasks.handler`, and the route puts the Worker's `ctx.waitUntil` there so
	 * the isolate stays alive long enough to finish it.
	 */
	it('gives the send to the background handler instead of awaiting it', async () => {
		await member('priya@example.org');

		await requestPasswordReset(auth, { email: 'priya@example.org' });

		expect(backgrounded).toHaveLength(1);
		await expect(backgrounded[0]).resolves.toBeUndefined();
	});

	// a colleague who types their address the way their mail client shows it still gets a link.
	it('does not care how the address was capitalised', async () => {
		await member('priya@example.org');

		expect(await requestPasswordReset(auth, { email: '  Priya@Example.ORG ' })).toEqual({
			ok: true
		});
		expect(sent.map((s) => s.email)).toEqual(['priya@example.org']);
	});

	/**
	 * every refusal answers the same as a success, which is what stops this form being a way to ask
	 * whether a given person works here — on a deployment whose donation page names the
	 * organisation.
	 */
	it.each([
		['an address nobody here has', 'nobody@example.org'],
		['the deployer’s identifier', STAFF_USER_EMAIL],
		['a value that is not an address', 'not-an-address']
	])('answers ok and sends nothing for %s', async (_label, email) => {
		await member('priya@example.org');

		expect(await requestPasswordReset(auth, { email })).toEqual({ ok: true });
		expect(sent).toEqual([]);
	});

	/**
	 * the deployer's row is refused by name and before better-auth is asked, because
	 * `auth.api.resetPassword` writes a `credential` account for a user that has none — a token
	 * minted against that row would give the fixed staff identity the password hash ./credential.ts
	 * says it never has.
	 */
	it('writes no reset row for the deployer’s identifier', async () => {
		const rows = await env.DB.prepare('select count(*) as n from auth_verification').first<{
			n: number;
		}>();
		expect(rows?.n).toBe(0);

		expect(await requestPasswordReset(auth, { email: STAFF_USER_EMAIL })).toEqual({ ok: true });

		const after = await env.DB.prepare('select count(*) as n from auth_verification').first<{
			n: number;
		}>();
		expect(after?.n).toBe(0);
	});

	/**
	 * an instance built without a way to send refuses with `RESET_PASSWORD_DISABLED`, which is a
	 * route that asked for a reset without wiring one rather than anything the person at the form
	 * did. it is the only arm that does not answer `ok`.
	 */
	it('is unavailable on an instance the route gave no way to send', async () => {
		await member('priya@example.org');
		const sendless = await createAuthWith();

		expect(await requestPasswordReset(sendless, { email: 'priya@example.org' })).toEqual({
			ok: false,
			reason: 'unavailable'
		});
		expect(sent).toEqual([]);
	});
});

describe('resetMemberPassword', () => {
	it('swaps which password signs the member in', async () => {
		await member('priya@example.org');
		const token = await tokenFor('priya@example.org');

		expect(await resetMemberPassword(auth, { token, newPassword: NEW_PASSWORD })).toEqual({
			ok: true
		});

		expect(await signsIn('priya@example.org', PASSWORD)).toBe(false);
		expect(await signsIn('priya@example.org', NEW_PASSWORD)).toBe(true);
	});

	// the link works once. a second press of the same link is the ordinary way to reach this.
	it('refuses a token that has already been used', async () => {
		await member('priya@example.org');
		const token = await tokenFor('priya@example.org');
		await resetMemberPassword(auth, { token, newPassword: NEW_PASSWORD });

		expect(
			await resetMemberPassword(auth, { token, newPassword: 'another-long-enough-one' })
		).toEqual({ ok: false, reason: 'link' });
		expect(await signsIn('priya@example.org', NEW_PASSWORD)).toBe(true);
	});

	// never minted is the same answer as expired and used, for `redeemInvitation`'s reason.
	it('refuses a token nobody minted', async () => {
		await member('priya@example.org');

		expect(
			await resetMemberPassword(auth, { token: 'not-a-token', newPassword: NEW_PASSWORD })
		).toEqual({ ok: false, reason: 'link' });
	});

	/**
	 * `PASSWORD_RESET_LIFETIME_SECONDS` is what better-auth stamps on the row, so the clock is
	 * moved by writing the stamp into the past rather than by moving the clock — the same shape the
	 * invitation specs use, and the only one available here because better-auth reads the time
	 * itself.
	 */
	it('stamps the row an hour ahead and refuses the token past it', async () => {
		await member('priya@example.org');
		const token = await tokenFor('priya@example.org');

		const row = await env.DB.prepare('select expires_at from auth_verification').first<{
			expires_at: number;
		}>();
		// seconds of slack, not minutes: the whole point of asserting the stamp is that it is the
		// hour `resetPasswordTokenExpiresIn` was given and not better-auth's own default, and the
		// two are the same number today.
		expect((row?.expires_at ?? 0) - Date.now()).toBeCloseTo(
			PASSWORD_RESET_LIFETIME_SECONDS * 1000,
			-4
		);

		await env.DB.prepare('update auth_verification set expires_at = ?')
			.bind(Date.now() - 1000)
			.run();

		expect(await resetMemberPassword(auth, { token, newPassword: NEW_PASSWORD })).toEqual({
			ok: false,
			reason: 'link'
		});
		expect(await signsIn('priya@example.org', PASSWORD)).toBe(true);
	});

	/**
	 * the minimum the redeem screen states is the minimum here too. better-auth measures it before
	 * it consumes the row, so the link the member is holding still works — which is what lets the
	 * screen ask them for a longer one.
	 */
	it('refuses a password under the minimum and leaves the link working', async () => {
		await member('priya@example.org');
		const token = await tokenFor('priya@example.org');

		expect(
			await resetMemberPassword(auth, {
				token,
				newPassword: 'x'.repeat(MEMBER_PASSWORD_MIN_LENGTH - 1)
			})
		).toEqual({ ok: false, reason: 'password' });

		expect(await signsIn('priya@example.org', PASSWORD)).toBe(true);
		expect(await resetMemberPassword(auth, { token, newPassword: NEW_PASSWORD })).toEqual({
			ok: true
		});
	});

	/**
	 * every session the member held ends, which is the whole of what `revokeSessionsOnPasswordReset`
	 * buys: somebody who has just proved they hold the mailbox should not leave a browser signed in
	 * that they no longer control. no session is minted either — the member signs in with what they
	 * just chose.
	 */
	it('ends every session the member held and mints none', async () => {
		await member('priya@example.org');
		const before = await sessionOf('priya@example.org', PASSWORD);
		expect(await auth.api.getSession({ headers: new Headers({ cookie: before }) })).not.toBeNull();
		const token = await tokenFor('priya@example.org');

		expect(await resetMemberPassword(auth, { token, newPassword: NEW_PASSWORD })).toEqual({
			ok: true
		});

		expect(await auth.api.getSession({ headers: new Headers({ cookie: before }) })).toBeNull();
	});
});
