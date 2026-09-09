import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import {
	authAccount,
	authMemberInvitation,
	authSession,
	authUser
} from '$lib/server/db/auth-schema';
import type { Auth } from './index';
import { createAuth } from './index';
import { inviteMember, MEMBER_PASSWORD_MIN_LENGTH, redeemInvitation } from './invitations';
import { changeMemberPassword, listMembers, removeMember, signInMember } from './members';
import { resolveAuthSecret } from './signing-key';
import { STAFF_USER_EMAIL, STAFF_USER_ID } from './staff-plugin';

// a workers spec for the reason ./invitations.workers.spec.ts is one, and for one more: what
// "removed" means here is a cascade D1 performs, and a stand-in that deleted the rows itself would
// prove nothing about the schema that ships.

const ORIGIN = 'https://give.example';
const PASSWORD = 'a-long-enough-member-password';
/** what a colleague changes it to, also long enough for better-auth to accept it. */
const NEW_PASSWORD = 'a-different-long-enough-password';
/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const STAFF_PASSWORD = 'a-long-enough-password';
const NOW = new Date('2026-02-01T12:00:00.000Z');

let db: Db;
let auth: Auth;

beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	await env.DB.prepare('delete from auth_member_invitation').run();
	await env.DB.prepare('delete from auth_session').run();
	await env.DB.prepare('delete from auth_account').run();
	await env.DB.prepare('delete from auth_user').run();

	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);
	auth = createAuth(
		db,
		{ ADMIN_PASSWORD: STAFF_PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
});

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

describe('listMembers', () => {
	it('is empty on a deployment nobody has invited anybody to', async () => {
		expect(await listMembers(db, NOW)).toEqual([]);
	});

	/**
	 * the deployer is the deployment, not a member: their row has no password in the database and
	 * cannot be removed, so a line for it in a list of removable people is a press to refuse
	 * rather than a row to draw.
	 */
	it('leaves the deployer off the list', async () => {
		await db.insert(authUser).values({
			id: STAFF_USER_ID,
			name: 'Staff',
			email: STAFF_USER_EMAIL,
			emailVerified: true,
			createdAt: NOW,
			updatedAt: NOW
		});

		expect(await listMembers(db, NOW)).toEqual([]);
	});

	it('carries accepted colleagues and outstanding invitations in one list, by address', async () => {
		await member('priya@example.org', 'Priya');
		await inviteMember(db, { email: 'ana@example.org', now: NOW, invitedBy: null });

		expect(await listMembers(db, NOW)).toEqual([
			{ id: expect.any(String), email: 'ana@example.org', name: null, invited: true },
			{ id: expect.any(String), email: 'priya@example.org', name: 'Priya', invited: false }
		]);
	});

	/**
	 * an invitation the redeem would refuse is not on the list, which is what makes the two agree:
	 * an operator looking at a pending line can tell the colleague the link still works.
	 */
	it('drops an invitation that has run out', async () => {
		const invited = await inviteMember(db, {
			email: 'ana@example.org',
			now: NOW,
			invitedBy: null
		});
		if (!invited.ok) throw new Error('expected an invitation');

		expect(await listMembers(db, invited.expiresAt)).toEqual([]);
	});

	// an accepted invitation is not a second line: the `auth_user` row it became carries the
	// address already.
	it('does not list an invitation beside the member it became', async () => {
		await member('priya@example.org');

		const list = await listMembers(db, NOW);
		expect(list).toHaveLength(1);
		expect(list[0]?.invited).toBe(false);
	});
});

describe('removeMember', () => {
	it('deletes the member, their credential and every session they held', async () => {
		const id = await member('priya@example.org');
		const signedIn = await signInMember(auth, {
			email: 'priya@example.org',
			password: PASSWORD,
			headers: new Headers({ origin: ORIGIN })
		});
		if (!signedIn.ok) throw new Error(`expected a session, got ${signedIn.reason}`);
		const cookie = cookieHeader(signedIn.cookies);
		expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();

		expect(await removeMember(db, { id, now: NOW })).toEqual({ ok: true, removed: 'member' });

		expect(await db.select().from(authUser).where(eq(authUser.id, id))).toEqual([]);
		// both by cascade, which is a clause in a hand-edited migration and therefore worth
		// asserting rather than assuming (CONTRIBUTING.md → Migrations).
		expect(await db.select().from(authAccount).where(eq(authAccount.userId, id))).toEqual([]);
		expect(await db.select().from(authSession).where(eq(authSession.userId, id))).toEqual([]);

		// the cookie they are still holding resolves nothing on the next request, which is what
		// `session.cookieCache` being off buys.
		expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
	});

	it('revokes a pending invitation instead of deleting a member', async () => {
		const invited = await inviteMember(db, {
			email: 'ana@example.org',
			now: NOW,
			invitedBy: null
		});
		if (!invited.ok) throw new Error('expected an invitation');
		const [row] = await db
			.select()
			.from(authMemberInvitation)
			.where(eq(authMemberInvitation.email, 'ana@example.org'));
		if (!row) throw new Error('no invitation row');

		expect(await removeMember(db, { id: row.id, now: NOW })).toEqual({
			ok: true,
			removed: 'invitation'
		});
		expect(await listMembers(db, NOW)).toEqual([]);
	});

	/**
	 * by name and not only by absence from the list. the id arrives in a form body, so a caller
	 * can post one the list never showed.
	 */
	it('refuses the deployer’s row', async () => {
		await db.insert(authUser).values({
			id: STAFF_USER_ID,
			name: 'Staff',
			email: STAFF_USER_EMAIL,
			emailVerified: true,
			createdAt: NOW,
			updatedAt: NOW
		});

		expect(await removeMember(db, { id: STAFF_USER_ID, now: NOW })).toEqual({
			ok: false,
			reason: 'staff'
		});
		expect(await db.select().from(authUser).where(eq(authUser.id, STAFF_USER_ID))).toHaveLength(1);
	});

	it('answers unknown for an id that is neither', async () => {
		expect(
			await removeMember(db, { id: '019fb1c4-0000-7000-8000-000000000000', now: NOW })
		).toEqual({ ok: false, reason: 'unknown' });
	});
});

describe('signInMember', () => {
	it('mints a session the gate resolves', async () => {
		await member('priya@example.org');

		const result = await signInMember(auth, {
			email: 'priya@example.org',
			password: PASSWORD,
			headers: new Headers({ origin: ORIGIN })
		});

		expect(result).toMatchObject({ ok: true });
		if (!result.ok) return;
		const session = await auth.api.getSession({
			headers: new Headers({ cookie: cookieHeader(result.cookies) })
		});
		expect(session?.user.email).toBe('priya@example.org');
	});

	// better-auth lower-cases on every lookup, and the invitation stored the address lower-cased,
	// so a colleague typing their address the way their mail client shows it still gets in.
	it('does not care how the address was capitalised', async () => {
		await member('priya@example.org');

		expect(
			await signInMember(auth, {
				email: 'Priya@Example.ORG',
				password: PASSWORD,
				headers: new Headers({ origin: ORIGIN })
			})
		).toMatchObject({ ok: true });
	});

	/**
	 * one refusal for both, which is what stops this form being a way to ask whether a given
	 * person works here.
	 */
	it('answers a wrong password and an unknown address the same way', async () => {
		await member('priya@example.org');

		expect(
			await signInMember(auth, {
				email: 'priya@example.org',
				password: 'not-the-right-password',
				headers: new Headers({ origin: ORIGIN })
			})
		).toEqual({ ok: false, reason: 'credential' });

		expect(
			await signInMember(auth, {
				email: 'nobody@example.org',
				password: PASSWORD,
				headers: new Headers({ origin: ORIGIN })
			})
		).toEqual({ ok: false, reason: 'credential' });
	});

	/**
	 * the deployer has no `auth_account` row — `ADMIN_PASSWORD` is a deploy-time secret and
	 * nothing hashes it (./credential.ts) — so their identifier is refused here whatever is
	 * typed, and `signInStaff` stays the only way that credential works.
	 */
	it('refuses the deployer’s credential, which is not a member credential', async () => {
		await auth.api.signInStaff({
			body: { password: STAFF_PASSWORD },
			headers: new Headers({ origin: ORIGIN })
		});

		expect(
			await signInMember(auth, {
				email: STAFF_USER_EMAIL,
				password: STAFF_PASSWORD,
				headers: new Headers({ origin: ORIGIN })
			})
		).toEqual({ ok: false, reason: 'credential' });
	});

	// the staff way in is untouched by any of this, and a member existing does not change it.
	it('leaves the deployer’s own sign-in working', async () => {
		await member('priya@example.org');

		const { headers } = await auth.api.signInStaff({
			body: { password: STAFF_PASSWORD },
			headers: new Headers({ origin: ORIGIN }),
			returnHeaders: true
		});
		const session = await auth.api.getSession({
			headers: new Headers({ cookie: cookieHeader(headers.getSetCookie()) })
		});
		expect(session?.user.id).toBe(STAFF_USER_ID);
	});
});

describe('changeMemberPassword', () => {
	it('swaps which password signs in', async () => {
		await member('priya@example.org');
		const cookie = await sessionOf('priya@example.org', PASSWORD);

		const changed = await changeMemberPassword(auth, {
			currentPassword: PASSWORD,
			newPassword: NEW_PASSWORD,
			headers: new Headers({ origin: ORIGIN, cookie })
		});

		expect(changed).toMatchObject({ ok: true });
		expect(
			await signInMember(auth, {
				email: 'priya@example.org',
				password: PASSWORD,
				headers: new Headers({ origin: ORIGIN })
			})
		).toEqual({ ok: false, reason: 'credential' });
		expect(
			await signInMember(auth, {
				email: 'priya@example.org',
				password: NEW_PASSWORD,
				headers: new Headers({ origin: ORIGIN })
			})
		).toMatchObject({ ok: true });
	});

	it('refuses a wrong current password and leaves the old one working', async () => {
		await member('priya@example.org');
		const cookie = await sessionOf('priya@example.org', PASSWORD);

		expect(
			await changeMemberPassword(auth, {
				currentPassword: 'not-the-right-password',
				newPassword: NEW_PASSWORD,
				headers: new Headers({ origin: ORIGIN, cookie })
			})
		).toEqual({ ok: false, reason: 'current' });

		expect(
			await signInMember(auth, {
				email: 'priya@example.org',
				password: PASSWORD,
				headers: new Headers({ origin: ORIGIN })
			})
		).toMatchObject({ ok: true });
	});

	/**
	 * the minimum the redeem screen states is the minimum here too, because it is one number
	 * (`MEMBER_PASSWORD_MIN_LENGTH`) and better-auth is configured with it once.
	 */
	it('refuses a new password shorter than the minimum', async () => {
		await member('priya@example.org');
		const cookie = await sessionOf('priya@example.org', PASSWORD);

		expect(
			await changeMemberPassword(auth, {
				currentPassword: PASSWORD,
				newPassword: 'x'.repeat(MEMBER_PASSWORD_MIN_LENGTH - 1),
				headers: new Headers({ origin: ORIGIN, cookie })
			})
		).toEqual({ ok: false, reason: 'password' });
	});

	/**
	 * the whole of what `revokeOtherSessions` buys, and why the cookies come back: better-auth
	 * deletes every session the member held — the one that made the change included — and mints a
	 * replacement, so a caller that dropped the returned `set-cookie` would sign the member out of
	 * the browser they are looking at.
	 */
	it('ends the member’s other sessions and carries the current one on', async () => {
		await member('priya@example.org');
		const other = await sessionOf('priya@example.org', PASSWORD);
		const cookie = await sessionOf('priya@example.org', PASSWORD);

		const changed = await changeMemberPassword(auth, {
			currentPassword: PASSWORD,
			newPassword: NEW_PASSWORD,
			headers: new Headers({ origin: ORIGIN, cookie })
		});
		if (!changed.ok) throw new Error(`expected a change, got ${changed.reason}`);

		expect(await auth.api.getSession({ headers: new Headers({ cookie: other }) })).toBeNull();
		const session = await auth.api.getSession({
			headers: new Headers({ cookie: cookieHeader(changed.cookies) })
		});
		expect(session?.user.email).toBe('priya@example.org');
	});

	/**
	 * the deployer holds a session like anybody's but no credential in the database, so this is the
	 * screen's own refusal rather than a wrong password: their password is a deploy-time secret and
	 * the console is where it is changed (./credential.ts).
	 */
	it('refuses the deployer, whose password is not a row', async () => {
		const { headers } = await auth.api.signInStaff({
			body: { password: STAFF_PASSWORD },
			headers: new Headers({ origin: ORIGIN }),
			returnHeaders: true
		});
		const cookie = cookieHeader(headers.getSetCookie());

		expect(
			await changeMemberPassword(auth, {
				currentPassword: STAFF_PASSWORD,
				newPassword: NEW_PASSWORD,
				headers: new Headers({ origin: ORIGIN, cookie })
			})
		).toEqual({ ok: false, reason: 'deployer' });

		// no credential was written for them, and the session they were holding still resolves.
		expect(
			await db.select().from(authAccount).where(eq(authAccount.userId, STAFF_USER_ID))
		).toEqual([]);
		const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
		expect(session?.user.id).toBe(STAFF_USER_ID);
	});
});
