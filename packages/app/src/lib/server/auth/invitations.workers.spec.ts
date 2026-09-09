import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '$lib/server/db/client';
import { authAccount, authMemberInvitation, authUser } from '$lib/server/db/auth-schema';
import type { Auth } from './index';
import { createAuth } from './index';
import {
	INVITATION_LIFETIME_MS,
	MEMBER_PASSWORD_MIN_LENGTH,
	inviteMember,
	readInvitation,
	redeemInvitation,
	revokeInvitation
} from './invitations';
import { resolveAuthSecret } from './signing-key';
import { STAFF_USER_EMAIL, STAFF_USER_ID } from './staff-plugin';

// a workers spec because every claim here is about what D1 holds: that the token is not in the
// row, that a supersede moved the old one, that a second redeem finds the invitation already
// stamped. CLAUDE.md refuses a stand-in — and the sign-up under test is better-auth's own write
// through the drizzle adapter, so a fixture would prove the fixture and not the adapter.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** a password the configured minimum accepts. */
const PASSWORD = 'a-long-enough-member-password';

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
	auth = createAuth(db, {}, { secret: signingKey.secret, requestOrigin: ORIGIN });
});

/** an invitation for one address, or a failure naming what came back instead. */
async function invite(email: string, now: Date = NOW): Promise<{ token: string; expiresAt: Date }> {
	const result = await inviteMember(db, { email, now, invitedBy: null });
	if (!result.ok) throw new Error(`expected an invitation, got ${result.reason}`);
	return { token: result.token, expiresAt: result.expiresAt };
}

/** every invitation row for one address, newest write last. */
function rowsFor(email: string) {
	return db.select().from(authMemberInvitation).where(eq(authMemberInvitation.email, email));
}

/** the deployer's row, so that "already a member" has something to be true about. */
async function seedStaffUser(): Promise<void> {
	await db.insert(authUser).values({
		id: STAFF_USER_ID,
		name: 'Staff',
		email: STAFF_USER_EMAIL,
		emailVerified: true,
		createdAt: NOW,
		updatedAt: NOW
	});
}

describe('inviteMember', () => {
	it('stores a hash of the token and never the token', async () => {
		const { token } = await invite('priya@example.org');

		const rows = await rowsFor('priya@example.org');
		// one row, so a second invitation written beside the first is not read past by the
		// destructuring below it.
		expect(rows).toHaveLength(1);
		const [row] = rows;
		expect(row?.tokenHash).toHaveLength(64);
		expect(row?.tokenHash).not.toBe(token);
		// the whole point of the column: the row a database backup carries is not a working link.
		expect(row?.tokenHash).not.toContain(token);
	});

	it('stores the expiry the caller is told about, a week out', async () => {
		const { expiresAt } = await invite('priya@example.org');

		expect(expiresAt.getTime()).toBe(NOW.getTime() + INVITATION_LIFETIME_MS);
		const [row] = await rowsFor('priya@example.org');
		expect(row?.expiresAt.getTime()).toBe(expiresAt.getTime());
	});

	it('lower-cases and trims the address, so one colleague is one invitation', async () => {
		await invite('  Priya@Example.ORG  ');

		const rows = await rowsFor('priya@example.org');
		expect(rows).toHaveLength(1);
	});

	/**
	 * one live token per address. the second invitation revokes the first rather than adding to
	 * it, so a link that was forwarded somewhere it should not have been stops working the moment
	 * a replacement is sent.
	 */
	it('supersedes a live invitation instead of minting a second one', async () => {
		const first = await invite('priya@example.org');
		const later = new Date(NOW.getTime() + 60_000);
		const second = await invite('priya@example.org', later);

		const rows = await rowsFor('priya@example.org');
		expect(rows).toHaveLength(2);
		expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);

		expect(await readInvitation(db, { token: first.token, now: later })).toEqual({ ok: false });
		expect(await readInvitation(db, { token: second.token, now: later })).toMatchObject({
			ok: true,
			email: 'priya@example.org'
		});
	});

	it('refuses an address that already signs in here', async () => {
		const { token } = await invite('priya@example.org');
		await redeemInvitation(db, auth, {
			token,
			name: 'Priya',
			password: PASSWORD,
			headers: new Headers({ origin: ORIGIN }),
			now: NOW
		});

		expect(
			await inviteMember(db, { email: 'priya@example.org', now: NOW, invitedBy: null })
		).toEqual({ ok: false, reason: 'member' });
	});

	// the deployer's identifier is a username rather than an address, and the answer names that
	// rather than the shape of the value.
	it('refuses the deployer’s own identifier', async () => {
		await seedStaffUser();

		expect(await inviteMember(db, { email: STAFF_USER_EMAIL, now: NOW, invitedBy: null })).toEqual({
			ok: false,
			reason: 'member'
		});
		expect(await rowsFor(STAFF_USER_EMAIL)).toHaveLength(0);
	});

	it('refuses a value that is not an address, before any mail is composed', async () => {
		expect(await inviteMember(db, { email: 'not an address', now: NOW, invitedBy: null })).toEqual({
			ok: false,
			reason: 'invalid_email'
		});
	});

	// a removed colleague must not take the invitations they sent with them, so there is no
	// foreign key and the pointer is allowed to dangle.
	it('records who invited without pointing at a row that has to exist', async () => {
		await inviteMember(db, {
			email: 'priya@example.org',
			now: NOW,
			invitedBy: '019fb1c4-0000-7000-8000-000000000000'
		});

		const [row] = await rowsFor('priya@example.org');
		expect(row?.invitedBy).toBe('019fb1c4-0000-7000-8000-000000000000');
	});
});

describe('readInvitation', () => {
	it('names the address a live token is for', async () => {
		const { token, expiresAt } = await invite('priya@example.org');

		expect(await readInvitation(db, { token, now: NOW })).toEqual({
			ok: true,
			email: 'priya@example.org',
			expiresAt
		});
	});

	it('refuses a token nobody minted', async () => {
		expect(await readInvitation(db, { token: 'ab'.repeat(32), now: NOW })).toEqual({ ok: false });
	});

	it('refuses one that has run out', async () => {
		const { token, expiresAt } = await invite('priya@example.org');

		expect(await readInvitation(db, { token, now: expiresAt })).toEqual({ ok: false });
	});

	it('refuses a revoked one', async () => {
		const { token } = await invite('priya@example.org');
		const [row] = await rowsFor('priya@example.org');
		if (!row) throw new Error('no invitation row');

		expect(await revokeInvitation(db, { id: row.id, now: NOW })).toBe(true);
		expect(await readInvitation(db, { token, now: NOW })).toEqual({ ok: false });
	});
});

describe('revokeInvitation', () => {
	it('answers false for one that was already used', async () => {
		const { token } = await invite('priya@example.org');
		await redeemInvitation(db, auth, {
			token,
			name: 'Priya',
			password: PASSWORD,
			headers: new Headers({ origin: ORIGIN }),
			now: NOW
		});
		const [row] = await rowsFor('priya@example.org');
		if (!row) throw new Error('no invitation row');

		expect(await revokeInvitation(db, { id: row.id, now: NOW })).toBe(false);
	});

	it('answers false for an id nobody minted', async () => {
		expect(
			await revokeInvitation(db, { id: '019fb1c4-0000-7000-8000-000000000000', now: NOW })
		).toBe(false);
	});
});

describe('redeemInvitation', () => {
	async function redeem(token: string, overrides: { password?: string; now?: Date } = {}) {
		return redeemInvitation(db, auth, {
			token,
			name: 'Priya',
			password: overrides.password ?? PASSWORD,
			headers: new Headers({ origin: ORIGIN }),
			now: overrides.now ?? NOW
		});
	}

	it('creates the member, their credential and a session that resolves', async () => {
		const { token } = await invite('priya@example.org');

		const result = await redeem(token);
		expect(result).toMatchObject({ ok: true });
		if (!result.ok) return;

		const [user] = await db.select().from(authUser).where(eq(authUser.email, 'priya@example.org'));
		expect(user?.name).toBe('Priya');

		// the credential is a row on `auth_account` with a hash in it, and the hash is not the
		// password — the whole reason that table exists on this deployment.
		const accounts = await db
			.select()
			.from(authAccount)
			.where(eq(authAccount.userId, result.user.id));
		expect(accounts).toHaveLength(1);
		expect(accounts[0]?.providerId).toBe('credential');
		expect(accounts[0]?.password).not.toBe(PASSWORD);
		expect(accounts[0]?.password).toBeTruthy();

		// the cookies the route sets are a session the gate would resolve.
		const cookie = result.cookies.map((value) => value.split(';', 1)[0]).join('; ');
		const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
		expect(session?.user.email).toBe('priya@example.org');
	});

	/**
	 * the invitation link is the proof of the address, so the row says so. nothing gates on the
	 * column today, which is why it is asserted here rather than left to a flow to reveal.
	 */
	it('records the address as verified, because the link proved it', async () => {
		const { token } = await invite('priya@example.org');
		await redeem(token);

		const [user] = await db.select().from(authUser).where(eq(authUser.email, 'priya@example.org'));
		expect(user?.emailVerified).toBe(true);
	});

	it('stamps the invitation as accepted', async () => {
		const { token } = await invite('priya@example.org');
		await redeem(token);

		const [row] = await rowsFor('priya@example.org');
		expect(row?.acceptedAt?.getTime()).toBe(NOW.getTime());
	});

	/**
	 * the four dead-link cases are one answer. they are asserted together so that a change making
	 * one of them distinguishable fails here rather than shipping an oracle.
	 */
	it('refuses a used, expired, revoked or unknown link with the same answer', async () => {
		const used = await invite('priya@example.org');
		await redeem(used.token);
		expect(await redeem(used.token)).toEqual({ ok: false, reason: 'link' });

		const expired = await invite('sam@example.org');
		expect(await redeem(expired.token, { now: expired.expiresAt })).toEqual({
			ok: false,
			reason: 'link'
		});

		const revoked = await invite('lee@example.org');
		const [row] = await rowsFor('lee@example.org');
		if (!row) throw new Error('no invitation row');
		await revokeInvitation(db, { id: row.id, now: NOW });
		expect(await redeem(revoked.token)).toEqual({ ok: false, reason: 'link' });

		expect(await redeem('ab'.repeat(32))).toEqual({ ok: false, reason: 'link' });
	});

	it('creates nothing when the link is dead', async () => {
		await redeem('ab'.repeat(32));

		expect(await db.select().from(authUser)).toHaveLength(0);
		expect(await db.select().from(authAccount)).toHaveLength(0);
	});

	// the minimum is the deployer's, not better-auth's 8, and the refusal is the one the form can
	// act on rather than the one that names the deployment.
	it('refuses a password under the minimum, leaving the link live', async () => {
		const { token } = await invite('priya@example.org');
		const short = 'a'.repeat(MEMBER_PASSWORD_MIN_LENGTH - 1);

		expect(await redeem(token, { password: short })).toEqual({ ok: false, reason: 'password' });
		expect(await readInvitation(db, { token, now: NOW })).toMatchObject({ ok: true });
		expect(await db.select().from(authUser)).toHaveLength(0);
	});

	/**
	 * the shape a crash between the two writes leaves behind: an account made, the invitation
	 * still live. the retry is told the address is already a member, which is true and is
	 * something they can act on — they hold the password they just chose.
	 */
	it('tells a colleague whose account already exists to sign in instead', async () => {
		const { token } = await invite('priya@example.org');
		await db.insert(authUser).values({
			id: '019fb1c4-0000-7000-8000-00000000dead',
			name: 'Priya',
			email: 'priya@example.org',
			emailVerified: true,
			createdAt: NOW,
			updatedAt: NOW
		});

		expect(await redeem(token)).toEqual({ ok: false, reason: 'member' });
	});
});
