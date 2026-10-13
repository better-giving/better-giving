import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import type { Auth } from './index';
import { createAuth, PASSWORD_RESET_LIFETIME_SECONDS } from './index';
import { inviteMember, MEMBER_PASSWORD_MIN_LENGTH, redeemInvitation } from './invitations';
import {
	changeMemberPassword,
	requestPasswordReset,
	resetMemberPassword,
	signInMember
} from './members';
import { deleteResetLinks } from './reset-links';
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
/** what `requestPasswordReset` handed to the background, as the route hands it to `waitUntil`. */
let backgrounded: Promise<void>[];

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
		}
	});
});

/** an instance for one request, with or without a way to send a link. */
async function createAuthWith(passwordReset?: {
	send(input: { email: string; token: string }): Promise<void>;
}): Promise<Auth> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.cause);
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

/** a reset row written by hand, live for a minute, as better-auth would have written it. */
async function insertResetRow(id: string, token: string, userId: string, createdAt: number) {
	await env.DB.prepare(
		'insert into auth_verification (id, identifier, value, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?)'
	)
		.bind(id, `reset-password:${token}`, userId, Date.now() + 60_000, createdAt, createdAt)
		.run();
}

/** a request for a link, and the work it left behind, settled — as `waitUntil` would see it through. */
async function askedFor(email: string, using: Auth = auth): Promise<void> {
	requestPasswordReset(using, { email }, (task) => {
		backgrounded.push(task);
	});
	await Promise.all(backgrounded);
}

/** the link a member was mailed, or a failure saying none was. */
async function tokenFor(email: string): Promise<string> {
	await askedFor(email);
	const token = sent.at(-1)?.token;
	if (token === undefined) throw new Error('no reset link was sent');
	return token;
}

describe('requestPasswordReset', () => {
	it('hands the member’s address and a token to the mailer', async () => {
		await member('priya@example.org');

		await askedFor('priya@example.org');
		expect(sent).toEqual([{ email: 'priya@example.org', token: expect.any(String) }]);
	});

	/**
	 * the whole request is handed to the background rather than awaited, which is what makes a
	 * request for a real address take the same time as one for an address nobody has: a member's
	 * costs a write a stranger's does not. the route hands it to the Worker's `ctx.waitUntil`, so the
	 * isolate stays alive long enough to finish it.
	 */
	it('leaves the caller nothing to wait for, and sends once the background settles', async () => {
		await member('priya@example.org');

		requestPasswordReset(auth, { email: 'priya@example.org' }, (task) => {
			backgrounded.push(task);
		});

		expect(backgrounded).toHaveLength(1);
		expect(sent).toEqual([]);
		await expect(backgrounded[0]).resolves.toBeUndefined();
		expect(sent.map((s) => s.email)).toEqual(['priya@example.org']);
	});

	// a colleague who types their address the way their mail client shows it still gets a link.
	it('does not care how the address was capitalised', async () => {
		await member('priya@example.org');

		await askedFor('  Priya@Example.ORG ');
		expect(sent.map((s) => s.email)).toEqual(['priya@example.org']);
	});

	/**
	 * none of these mails anybody, and the caller cannot tell them from a member's request, because
	 * there is no answer to read — which is what stops this form being a way to ask whether a given
	 * person works here, on a deployment whose donation page names the organisation.
	 */
	it.each([
		['an address nobody here has', 'nobody@example.org'],
		['the deployer’s identifier', STAFF_USER_EMAIL],
		['a value that is not an address', 'not-an-address']
	])('sends nothing for %s', async (_label, email) => {
		await member('priya@example.org');

		await askedFor(email);
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

		await askedFor(STAFF_USER_EMAIL);

		const after = await env.DB.prepare('select count(*) as n from auth_verification').first<{
			n: number;
		}>();
		expect(after?.n).toBe(0);
	});

	/**
	 * a member locked out is worse than two live links for a moment, so a delete of the earlier
	 * ones that throws costs the new mail nothing. the trigger refuses the delete of the earlier row
	 * and nothing else.
	 */
	it('still sends the new link when deleting the earlier one fails', async () => {
		await member('priya@example.org');
		await tokenFor('priya@example.org');
		const earlier = await env.DB.prepare('select id from auth_verification').first<{
			id: string;
		}>();
		await env.DB.prepare(
			`create trigger refuse_earlier_delete before delete on auth_verification when old.id = '${earlier?.id}' begin select raise(abort, 'refused'); end`
		).run();

		try {
			await askedFor('priya@example.org');

			expect(sent).toHaveLength(2);
		} finally {
			await env.DB.prepare('drop trigger refuse_earlier_delete').run();
		}
	});

	/**
	 * an instance built without a way to send refuses with `RESET_PASSWORD_DISABLED`, which is a
	 * route that asked for a reset without wiring one rather than anything the person at the form
	 * did — so it is the log that says so, the request having been answered already.
	 */
	it('logs a request made of an instance the route gave no way to send', async () => {
		await member('priya@example.org');
		const sendless = await createAuthWith();
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		try {
			await askedFor('priya@example.org', sendless);

			expect(logged.mock.calls.flat().join(' ')).toContain('an auth instance that cannot send');
			expect(sent).toEqual([]);
		} finally {
			logged.mockRestore();
		}
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

	// a member who pressed "forgot" twice holds one live link, the one in the newest mail.
	it('refuses an earlier link once a newer one has been requested', async () => {
		await member('priya@example.org');
		const earlier = await tokenFor('priya@example.org');
		const newer = await tokenFor('priya@example.org');

		expect(await resetMemberPassword(auth, { token: earlier, newPassword: NEW_PASSWORD })).toEqual({
			ok: false,
			reason: 'link'
		});
		expect(await resetMemberPassword(auth, { token: newer, newPassword: NEW_PASSWORD })).toEqual({
			ok: true
		});
	});

	/**
	 * two requests whose deletes interleave keep the newest link rather than deleting each other's.
	 * the hand-written row stands for the second request, minted after this one but deleting first.
	 */
	it('leaves a newer link working when an older request deletes last', async () => {
		const userId = await member('priya@example.org');
		await insertResetRow('newer', 'the-newest-link', userId, Date.now() + 10_000);

		await tokenFor('priya@example.org');

		expect(
			await resetMemberPassword(auth, { token: 'the-newest-link', newPassword: NEW_PASSWORD })
		).toEqual({ ok: true });
	});

	/**
	 * two links minted in the same millisecond are ordered by id, so the two requests' deletes agree
	 * on which is newer whichever runs first, and exactly one link is left.
	 */
	it.each([
		['the lower id deletes first', ['a-row', 'b-row']],
		['the higher id deletes first', ['b-row', 'a-row']]
	] as const)('keeps exactly one of two links minted together when %s', async (_label, order) => {
		const userId = await member('priya@example.org');
		const createdAt = Date.now();
		await insertResetRow('a-row', 'the-a-link', userId, createdAt);
		await insertResetRow('b-row', 'the-b-link', userId, createdAt);

		for (const id of order) {
			await deleteResetLinks(db, userId, {
				olderThan: id === 'a-row' ? 'the-a-link' : 'the-b-link'
			});
		}

		const left = await env.DB.prepare('select id from auth_verification').all<{ id: string }>();
		expect(left.results).toEqual([{ id: 'b-row' }]);
	});

	/**
	 * a completed reset ends every other link the member holds. the stray row is written by hand
	 * because a later request would have deleted it — it stands for what two requests landing
	 * together, or a background delete that failed, leave behind.
	 */
	it('leaves no other link working once a reset is done', async () => {
		const userId = await member('priya@example.org');
		const token = await tokenFor('priya@example.org');
		await insertResetRow('stray', 'a-link-still-in-a-mailbox', userId, Date.now());

		await resetMemberPassword(auth, { token, newPassword: NEW_PASSWORD });

		expect(
			await resetMemberPassword(auth, {
				token: 'a-link-still-in-a-mailbox',
				newPassword: 'another-long-enough-one'
			})
		).toEqual({ ok: false, reason: 'link' });
		expect(await signsIn('priya@example.org', NEW_PASSWORD)).toBe(true);
	});

	/**
	 * better-auth runs `onPasswordReset` after the password is written and before it revokes the
	 * sessions, so a delete that throws there must not cost the revocation. the trigger refuses
	 * the delete of one stray row and nothing else, which leaves the consume of the real token
	 * working.
	 */
	it('still ends every session when deleting the other links fails', async () => {
		const userId = await member('priya@example.org');
		const before = await sessionOf('priya@example.org', PASSWORD);
		const token = await tokenFor('priya@example.org');
		await insertResetRow('stray', 'a-link-still-in-a-mailbox', userId, Date.now());
		await env.DB.prepare(
			"create trigger refuse_stray_delete before delete on auth_verification when old.id = 'stray' begin select raise(abort, 'refused'); end"
		).run();

		try {
			expect(await resetMemberPassword(auth, { token, newPassword: NEW_PASSWORD })).toEqual({
				ok: true
			});
			expect(await auth.api.getSession({ headers: new Headers({ cookie: before }) })).toBeNull();
		} finally {
			await env.DB.prepare('drop trigger refuse_stray_delete').run();
		}
	});

	// never minted is the same answer as expired and used, for `redeemInvitation`'s reason.
	it('refuses a token nobody minted', async () => {
		await member('priya@example.org');

		expect(
			await resetMemberPassword(auth, { token: 'not-a-token', newPassword: NEW_PASSWORD })
		).toEqual({ ok: false, reason: 'link' });
	});

	/**
	 * a member who asked for a link and then remembered their password changes it signed in. the
	 * link still in their mailbox would otherwise overwrite what they just chose.
	 */
	it('refuses a link once the member has changed their password signed in', async () => {
		await member('priya@example.org');
		const token = await tokenFor('priya@example.org');
		const cookie = await sessionOf('priya@example.org', PASSWORD);

		expect(
			await changeMemberPassword(db, auth, {
				currentPassword: PASSWORD,
				newPassword: NEW_PASSWORD,
				headers: new Headers({ origin: ORIGIN, cookie })
			})
		).toMatchObject({ ok: true });

		expect(
			await resetMemberPassword(auth, { token, newPassword: 'another-long-enough-one' })
		).toEqual({ ok: false, reason: 'link' });
		expect(await signsIn('priya@example.org', NEW_PASSWORD)).toBe(true);
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
