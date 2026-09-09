import { MIN_ADMIN_PASSWORD_LENGTH } from '@better-giving/operator/admin-password';
import { APIError } from 'better-auth/api';
import { and, eq, gt, isNull } from 'drizzle-orm';
import * as z from 'zod';
import type { Db } from '$lib/server/db/client';
import {
	authMemberInvitation,
	authUser,
	type AuthMemberInvitation
} from '$lib/server/db/auth-schema';
import type { Auth } from './index';
import { STAFF_USER_EMAIL } from './staff-plugin';

// how a colleague becomes a member, from the invitation to the session.
//
// the only module that writes `auth_member_invitation`, and the only caller of
// `auth.api.signUpEmail` in this app. that endpoint is registered on better-auth's router and no
// route mounts one (./index.ts), so an account can be created here and nowhere else — which is the
// whole of what stops a stranger on a single-organisation deployment from minting themselves a
// dashboard account.
//
// **nothing here sends mail and nothing here builds a link.** `inviteMember` returns the token; the
// route that called it composes the address and hands it to the mailer with
// packages/emails/src/templates/invitation.tsx. that split is what keeps this module free of the
// request — it never reads a url, an origin or a header it was not given — and it is why the token
// can be returned at all: it exists in that one return value, in the mail, and in the recipient's
// address bar. it is never logged and never stored; `token_hash` is a SHA-256 of it.
//
// ---------------------------------------------------------------------------
// **an invitation is how a colleague becomes a member, and it is not the recovery path.** a member
// who cannot sign in asks for a reset link from the sign-in page — `requestPasswordReset` and
// `resetMemberPassword` in ./members.ts — and one who is signed in changes their own password
// through `changeMemberPassword` beside them. so `inviteMember` still refuses an address that
// already signs in here, and the person behind that refusal has a way in of their own.
//
// the deployer has neither. their password is a deploy-time secret with no row and no hash, reset
// from the console rather than by mail (./credential.ts, DEPLOY.md), so that way in exists whatever
// has happened to the members.
// ---------------------------------------------------------------------------

/**
 * how long a link works: seven days.
 *
 * long enough to survive a colleague's week off and short enough that a link forwarded into a
 * mailing list archive stops being a way in. a fresh invitation is one press, so the cost of it
 * being too short is a press and the cost of it being too long is an account.
 */
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * the shortest password a member may choose, and deliberately the deployer's own minimum rather
 * than better-auth's default of 8.
 *
 * a member reaches every screen the deployer does, so the account with a scrypt hash behind it must
 * not be allowed a weaker password than the one with no hash at all. it is imported rather than
 * copied so that raising one raises both — `@better-giving/operator/admin-password` is where the
 * number and the sentence an operator is refused with both live.
 */
export const MEMBER_PASSWORD_MIN_LENGTH = MIN_ADMIN_PASSWORD_LENGTH;

/** the token in the link: 32 random bytes as 64 lowercase hex characters. */
const TOKEN_BYTES = 32;

const ADDRESS = z.email();

/**
 * whether an address is one better-auth will accept.
 *
 * checked at the invitation rather than at the redeem, because the redeem is the wrong end to
 * find out: the mail has already gone to an address that cannot become an account, and the
 * colleague holding the link is the one told it is broken. `signUpEmail` runs `z.email()` on the
 * address it is given, so this is the same test one step earlier.
 *
 * exported because `requestPasswordReset` in ./members.ts asks the same question of a reset
 * request, where `auth.api.requestPasswordReset` runs the same `z.email()`, so an address the
 * invitation refuses is an address the reset refuses.
 */
export function isAddress(email: string): boolean {
	return ADDRESS.safeParse(email).success;
}

export type InviteResult =
	| { readonly ok: true; readonly token: string; readonly expiresAt: Date }
	/**
	 * `member` — the address already signs in here, so there is nothing to invite it to. it covers
	 * the deployer's username as well as an existing `auth_user` row. a colleague who cannot get
	 * in at that address asks for a reset link instead (./members.ts) rather than being invited
	 * again.
	 * `invalid_email` — not an address this deployment could ever create an account for.
	 */
	| { readonly ok: false; readonly reason: 'member' | 'invalid_email' };

/**
 * mints an invitation for one address and returns the token to put in the link.
 *
 * **one live token per address, always.** inviting an address that already has a live invitation
 * revokes the old one in the same `batch()` that writes the new — so a colleague who asks for
 * another link is not left with two, and a link that was forwarded somewhere it should not have
 * been stops working the moment a replacement is sent.
 *
 * `now` is a parameter rather than a `Date.now()` here for the reason every module in
 * `$lib/server` takes one: a function that reads the clock cannot be asserted about.
 *
 * `invitedBy` is recorded and never read for a decision. who may invite and revoke is the
 * route's to say — `/admin/members` offers both presses to the deployer's session alone — and
 * there are no roles here: adding one is a schema change rather than a check somebody forgot.
 */
export async function inviteMember(
	db: Db,
	input: { readonly email: string; readonly now: Date; readonly invitedBy: string | null }
): Promise<InviteResult> {
	const email = normaliseEmail(input.email);

	// the deployer's identifier is a username and not an address (./staff-plugin.ts), so it would
	// fail the address test below anyway. it is refused first so the answer names the real reason:
	// that identity already signs in here.
	if (email === normaliseEmail(STAFF_USER_EMAIL)) return { ok: false, reason: 'member' };
	if (!isAddress(email)) return { ok: false, reason: 'invalid_email' };

	const existing = await db
		.select({ id: authUser.id })
		.from(authUser)
		.where(eq(authUser.email, email))
		.limit(1);
	if (existing.length > 0) return { ok: false, reason: 'member' };

	const token = mintToken();
	const tokenHash = await hashToken(token);
	const expiresAt = new Date(input.now.getTime() + INVITATION_LIFETIME_MS);

	await db.batch([
		db.update(authMemberInvitation).set({ revokedAt: input.now }).where(liveFor(email, input.now)),
		db.insert(authMemberInvitation).values({
			email,
			tokenHash,
			expiresAt,
			createdAt: input.now,
			invitedBy: input.invitedBy
		})
	]);

	return { ok: true, token, expiresAt };
}

export type InvitationReading =
	| { readonly ok: true; readonly email: string; readonly expiresAt: Date }
	| { readonly ok: false };

/**
 * the invitation a token names, for the screen that draws the redeem form.
 *
 * it exists so the form can say which address is about to become an account — a colleague who was
 * invited at a work address and is reading the mail at a personal one needs to see which one they
 * are signing up as, and it is not a box they may edit.
 *
 * one bit on the failure arm, deliberately. see `redeemInvitation` for why expired, used, revoked
 * and unknown are the same answer.
 */
export async function readInvitation(
	db: Db,
	input: { readonly token: string; readonly now: Date }
): Promise<InvitationReading> {
	const row = await findByToken(db, input.token);
	const state = liveness(row, input.now);
	if (state !== 'live' || row === undefined) return { ok: false };
	return { ok: true, email: row.email, expiresAt: row.expiresAt };
}

/**
 * revokes an invitation by id, and answers whether one was live to revoke.
 *
 * `false` covers a row that was already accepted, already revoked, expired, or never existed —
 * the caller renders the same thing for all of them, because the press was "make this stop
 * working" and every one of them means it already has.
 */
export async function revokeInvitation(
	db: Db,
	input: { readonly id: string; readonly now: Date }
): Promise<boolean> {
	const revoked = await db
		.update(authMemberInvitation)
		.set({ revokedAt: input.now })
		.where(
			and(
				eq(authMemberInvitation.id, input.id),
				isNull(authMemberInvitation.acceptedAt),
				isNull(authMemberInvitation.revokedAt)
			)
		)
		.returning({ id: authMemberInvitation.id });
	return revoked.length > 0;
}

export type RedeemResult =
	| {
			readonly ok: true;
			/** the `set-cookie` values the route appends to its redirect. */
			readonly cookies: readonly string[];
			readonly user: { readonly id: string; readonly email: string; readonly name: string };
	  }
	/**
	 * `link` — expired, already used, revoked, or never existed. one outcome on purpose.
	 * `password` — shorter or longer than better-auth will accept (`MEMBER_PASSWORD_MIN_LENGTH`).
	 * `member` — the address already has an account, so the way in is the sign-in.
	 * `unavailable` — the auth layer refused for a reason that is about this deployment. logged.
	 */
	| { readonly ok: false; readonly reason: 'link' | 'password' | 'member' | 'unavailable' };

/**
 * turns a token, a name and a password into a member with a session.
 *
 * **the four ways a link can be no good are one answer.** expired, already used, revoked and never
 * minted are distinguished in the log line and nowhere else: an answer that told them apart would
 * tell somebody feeding tokens at this endpoint which of theirs had ever been real, and there is
 * nothing a colleague holding a dead link does differently in any of the four cases — they ask for
 * another one.
 *
 * **the order of the two writes is the decision in this function.** better-auth's sign-up goes
 * through the drizzle adapter and cannot join a `batch()` — D1 has no interactive transaction
 * (`db/client.ts`), and the adapter's own `transaction` is off — so the account is created first
 * and the invitation is stamped after. a crash between them leaves the invitation **live** and an
 * account already made: the colleague retries, is told the address is already a member, and signs
 * in with the password they just chose. the other order fails worse — a stamped invitation with no
 * account behind it is a colleague locked out of a link that will never work again, needing
 * somebody else to press a button.
 *
 * the stamp is guarded on the invitation still being unaccepted, so two presses of the same button
 * cannot make the second one look like a fresh acceptance.
 *
 * `email_verified` is written true in that same `batch()`. better-auth's sign-up writes false and
 * has no reason to know better; here the address was proven before the account existed, because
 * the token only ever reached the mailbox it was sent to. nothing gates on the column today
 * (`requireEmailVerification` is off — ./index.ts), so this is a row that tells the truth rather
 * than a control.
 */
export async function redeemInvitation(
	db: Db,
	auth: Auth,
	input: {
		readonly token: string;
		readonly name: string;
		readonly password: string;
		readonly headers: Headers;
		readonly now: Date;
	}
): Promise<RedeemResult> {
	const row = await findByToken(db, input.token);
	const state = liveness(row, input.now);
	if (state !== 'live' || row === undefined) {
		// the log names which of the four it was, and the caller is told none of it. the token is
		// not in the line: it is a working credential right up until it is not.
		console.warn('an invitation could not be redeemed:', state);
		return { ok: false, reason: 'link' };
	}

	let created: { id: string; email: string; name: string };
	let cookies: string[];
	try {
		const { headers, response } = await auth.api.signUpEmail({
			body: { name: input.name, email: row.email, password: input.password },
			headers: input.headers,
			returnHeaders: true
		});
		created = { id: response.user.id, email: response.user.email, name: response.user.name };
		cookies = headers.getSetCookie();
	} catch (e) {
		return signUpRefusal(e);
	}

	await db.batch([
		db
			.update(authMemberInvitation)
			.set({ acceptedAt: input.now })
			.where(
				and(
					eq(authMemberInvitation.id, row.id),
					isNull(authMemberInvitation.acceptedAt),
					isNull(authMemberInvitation.revokedAt)
				)
			),
		db
			.update(authUser)
			.set({ emailVerified: true, updatedAt: input.now })
			.where(eq(authUser.id, created.id))
	]);

	return { ok: true, cookies, user: created };
}

/**
 * what the auth layer's refusal means to the screen.
 *
 * better-auth answers a duplicate address with 422 and a short password with 400, and both are
 * things the person at the form can act on. anything else is about the deployment — a table that
 * is not there on a database nobody migrated is the one a fresh fork meets — and it is logged
 * rather than repeated back, exactly as the login's action does with the same class of failure.
 */
function signUpRefusal(e: unknown): RedeemResult {
	if (e instanceof APIError) {
		const code = e.body?.code;
		if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
			return { ok: false, reason: 'password' };
		}
		if (code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') return { ok: false, reason: 'member' };
		console.error('an invitation sign-up failed:', e.statusCode, code, e.body?.message);
		return { ok: false, reason: 'unavailable' };
	}
	// not an APIError: the auth layer threw before it could shape a response. on a database with no
	// `auth_account` table that is what a fresh fork hits.
	console.error('an invitation sign-up failed before the auth layer could respond:', e);
	return { ok: false, reason: 'unavailable' };
}

/**
 * one address, one spelling. better-auth lower-cases on every lookup, so the row has to match.
 *
 * exported for ./members.ts, which compares a reset request against the deployer's identifier and
 * has to be comparing the same spelling this module stored.
 */
export function normaliseEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * the token, from the runtime's CSPRNG.
 *
 * 32 bytes because the hash of it is the only thing stored: a token short enough to be searched
 * offline against `token_hash` would be a session anybody with a database backup could mint. hex
 * rather than base64url so the value survives being pasted, quoted and url-encoded unchanged, and
 * so the `length = 64` check on the column means something.
 */
function mintToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
	return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of the token, as the 64 lowercase hex characters `token_hash` stores. */
async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * the row a token names, found by the unique index on `token_hash`.
 *
 * an index lookup and not a constant-time compare, and that is the right primitive here rather
 * than a shortcut past ../secret-compare.ts. that module exists because two *configured* secrets
 * are compared against what a caller posted, and a compare that returned early would leak the
 * configured value a byte at a time. nothing is configured here: what is stored is a hash of 32
 * bytes this app minted, so the only way to make the lookup answer is to already hold a preimage
 * of one of them. a timing difference between "row found" and "no row" tells an attacker which of
 * their own guesses was right, which is what the answer tells them anyway.
 *
 * it returns the row whatever state it is in. `liveness` below is what decides, so that the log
 * line can say which of the four it was while the caller is told one thing.
 */
async function findByToken(db: Db, token: string): Promise<AuthMemberInvitation | undefined> {
	const rows = await db
		.select()
		.from(authMemberInvitation)
		.where(eq(authMemberInvitation.tokenHash, await hashToken(token)))
		.limit(1);
	return rows[0];
}

/** what has become of an invitation, for the log line. */
type Liveness = 'live' | 'unknown' | 'used' | 'revoked' | 'expired';

function liveness(row: AuthMemberInvitation | undefined, now: Date): Liveness {
	if (row === undefined) return 'unknown';
	if (row.acceptedAt !== null) return 'used';
	if (row.revokedAt !== null) return 'revoked';
	// `>`, not `>=`: an invitation is dead at the instant it is due, which is what the `expires_at`
	// on the mail promised.
	return row.expiresAt.getTime() > now.getTime() ? 'live' : 'expired';
}

/**
 * every live invitation — unaccepted, unrevoked and not yet due.
 *
 * exported so that ./members.ts lists exactly what a redeem would accept. a second copy of the
 * three conditions is a screen showing an invitation the redeem refuses, or hiding one it takes.
 * `liveness` above is the same rule stated over one row, and the two are checked against each
 * other by the specs rather than by the compiler.
 */
export function liveInvitations(now: Date) {
	return and(
		isNull(authMemberInvitation.acceptedAt),
		isNull(authMemberInvitation.revokedAt),
		gt(authMemberInvitation.expiresAt, now)
	);
}

/** the live invitations for one address. */
function liveFor(email: string, now: Date) {
	return and(eq(authMemberInvitation.email, email), liveInvitations(now));
}
